use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime, Scopes};

#[derive(Serialize, Clone)]
struct TrackInfo {
    /// File name without extension, used as display title.
    title: String,
    /// Absolute path on disk. Frontend converts this via convertFileSrc.
    path: String,
    /// Start offset (seconds) into `path` — CUE tracks share one file.
    #[serde(skip_serializing_if = "Option::is_none")]
    start: Option<f64>,
}

/// A vinyl record: `root/artist/album/<audio files>`.
#[derive(Serialize, Clone)]
struct Album {
    /// Album folder name.
    name: String,
    /// Artist folder name.
    artist: Option<String>,
    tracks: Vec<TrackInfo>,
    /// Absolute path to cover art (cover.jpg/png/…), if present in the folder.
    cover: Option<String>,
}

/// Resolve the default music directory.
/// - Dev mode: `<project_root>/music` (one level above `src-tauri`).
/// - Bundled app: the resource dir `music` folder mapped in tauri.conf.json.
fn default_music_dir<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let dev_dir = manifest_dir
            .parent()
            .ok_or("cannot resolve project root")?
            .join("music");
        return Ok(dev_dir);
    }

    app.path()
        .resource_dir()
        .map(|dir| dir.join("music"))
        .map_err(|e| format!("failed to resolve resource dir: {e}"))
}

/// Look for album artwork in `dir` (non-recursive). Prefers common names
/// (cover / folder / album / front / artwork); as a last resort falls back to
/// the largest image file in the folder — covers usually dwarf back scans
/// and thumbnails.
fn find_cover(dir: &Path) -> Option<String> {
    const STEMS: &[&str] = &["cover", "folder", "album", "front", "artwork"];
    const EXTS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif"];

    let entries = std::fs::read_dir(dir).ok()?;
    let mut files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .collect();
    files.sort();

    for stem in STEMS {
        for ext in EXTS {
            if let Some(path) = files.iter().find(|p| {
                let s = p
                    .file_stem()
                    .and_then(|x| x.to_str())
                    .map(|x| x.eq_ignore_ascii_case(stem))
                    .unwrap_or(false);
                let e = p
                    .extension()
                    .and_then(|x| x.to_str())
                    .map(|x| x.eq_ignore_ascii_case(ext))
                    .unwrap_or(false);
                s && e
            }) {
                return Some(path.to_string_lossy().into_owned());
            }
        }
    }

    files
        .iter()
        .filter(|p| {
            p.extension()
                .and_then(|x| x.to_str())
                .map(|x| EXTS.iter().any(|e| x.eq_ignore_ascii_case(e)))
                .unwrap_or(false)
        })
        .max_by_key(|p| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0))
        .map(|p| p.to_string_lossy().into_owned())
}

/// Audio extensions collected as tracks (matched case-insensitively; all are
/// natively decodable by the WebView's HTMLAudioElement).
const AUDIO_EXTS: &[&str] = &["mp3", "flac", "m4a", "ogg", "opus", "wav", "aac"];

/* --- CUE sheet parsing ----------------------------------------------------- */

/// One CUE track: its title, the file it lives in, and the INDEX 01 start.
struct CueEntry {
    file: String,
    title: String,
    start: f64,
}

/// Extract the text between the first and last double quotes of a line.
fn quoted_arg(line: &str) -> Option<&str> {
    let start = line.find('"')? + 1;
    let end = line.rfind('"')?;
    if end >= start {
        Some(&line[start..end])
    } else {
        None
    }
}

/// `MM:SS:FF` (75 frames/sec) → seconds.
fn cue_index_time(arg: &str) -> Option<f64> {
    let mut parts = arg.split(':');
    let mm: f64 = parts.next()?.trim().parse().ok()?;
    let ss: f64 = parts.next()?.trim().parse().ok()?;
    let ff: f64 = parts.next()?.trim().parse().ok()?;
    Some(mm * 60.0 + ss + ff / 75.0)
}

fn is_audio_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| AUDIO_EXTS.iter().any(|a| ext.eq_ignore_ascii_case(a)))
        .unwrap_or(false)
}

/// Parse a CUE sheet's FILE/TRACK/TITLE/INDEX lines (everything else,
/// including REM and PERFORMER, is ignored). Only AUDIO tracks with an
/// INDEX 01 are kept, in sheet order.
fn parse_cue(text: &str) -> Vec<CueEntry> {
    let mut entries = Vec::new();
    let mut file = String::new();
    let mut title: Option<String> = None;
    let mut start: Option<f64> = None;
    let mut in_track = false;

    let flush = |entries: &mut Vec<CueEntry>,
                     file: &mut String,
                     title: &mut Option<String>,
                     start: &mut Option<f64>,
                     in_track: &mut bool| {
        if *in_track {
            if let (Some(title), Some(start)) = (title.take(), start.take()) {
                entries.push(CueEntry {
                    file: file.clone(),
                    title,
                    start,
                });
            }
        }
        *title = None;
        *start = None;
        *in_track = false;
    };

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("REM") {
            continue;
        }
        let mut words = line.split_whitespace();
        let Some(command) = words.next() else { continue };
        let arg = quoted_arg(line).map(str::to_owned).unwrap_or_else(|| {
            words.collect::<Vec<_>>().join(" ")
        });
        match command.to_ascii_uppercase().as_str() {
            "FILE" => {
                flush(&mut entries, &mut file, &mut title, &mut start, &mut in_track);
                file = arg;
            }
            "TRACK" => {
                flush(&mut entries, &mut file, &mut title, &mut start, &mut in_track);
                // "TRACK 01 AUDIO" — skip data tracks.
                let is_audio = line
                    .split_whitespace()
                    .last()
                    .map(|t| t.eq_ignore_ascii_case("AUDIO"))
                    .unwrap_or(false);
                in_track = is_audio;
            }
            "TITLE" => {
                if in_track {
                    title = Some(arg);
                }
                // Album-level TITLE (before any TRACK) is unused: the folder
                // name is the album name, like every other layout.
            }
            "INDEX" => {
                if in_track {
                    let mut parts = line.split_whitespace();
                    let _ = parts.next(); // INDEX
                    let no = parts.next().unwrap_or("");
                    let time = parts.next().unwrap_or("");
                    if no == "01" {
                        if let Some(secs) = cue_index_time(time) {
                            start = Some(secs);
                        }
                    }
                }
            }
            _ => {}
        }
    }
    flush(&mut entries, &mut file, &mut title, &mut start, &mut in_track);
    entries
}

/// Decode CUE text: BOMs win, then valid UTF-8, then GBK — the de-facto
/// encoding of Chinese CD rips (EAC/foobar2000 export ANSI sheets).
fn decode_cue_text(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return encoding_rs::UTF_16LE.decode(bytes).0.into_owned();
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return encoding_rs::UTF_16BE.decode(bytes).0.into_owned();
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.trim_start_matches('\u{feff}').to_owned();
    }
    encoding_rs::GBK.decode(bytes).0.into_owned()
}

/// Collect audio files directly inside `dir` (non-recursive), sorted by
/// title. A `.cue` sheet next to a single-file rip (album.wav + album.cue)
/// replaces that file with its virtual tracks, each carrying a start offset.
fn collect_audio_files(dir: &Path) -> Result<Vec<TrackInfo>, String> {
    let entries =
        std::fs::read_dir(dir).map_err(|e| format!("failed to read dir {}: {e}", dir.display()))?;

    let mut audio_files: Vec<PathBuf> = Vec::new();
    let mut cue_files: Vec<PathBuf> = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let is_cue = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("cue"))
            .unwrap_or(false);
        if is_cue {
            cue_files.push(path);
        } else if is_audio_path(&path) {
            audio_files.push(path);
        }
    }
    audio_files.sort();
    cue_files.sort();

    let mut tracks = Vec::new();
    let mut consumed: Vec<String> = Vec::new(); // lowercase file names claimed by cues

    for cue in &cue_files {
        let bytes = match std::fs::read(cue) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let text = decode_cue_text(&bytes);
        for entry in parse_cue(&text) {
            let target = dir.join(&entry.file);
            if !target.is_file() || !is_audio_path(&target) {
                continue;
            }
            consumed.push(entry.file.to_lowercase());
            tracks.push(TrackInfo {
                title: entry.title,
                path: target.to_string_lossy().into_owned(),
                start: Some(entry.start),
            });
        }
    }

    for path in &audio_files {
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        if consumed.iter().any(|c| *c == name) {
            continue;
        }
        let title = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Unknown")
            .to_string();
        tracks.push(TrackInfo {
            title,
            path: path.to_string_lossy().into_owned(),
            start: None,
        });
    }

    // CUE order is authoritative; plain folders keep the title sort.
    if tracks.iter().all(|t| t.start.is_none()) {
        tracks.sort_by(|a, b| a.title.cmp(&b.title));
    }
    Ok(tracks)
}

/// Album tracks: audio files directly in the album folder plus files one
/// level deeper — multi-disc layouts like `album/cd1`, `album/cd2`. Files in
/// the album folder come first, then each subfolder in name order, so disc
/// order is preserved. Nothing deeper is scanned.
fn collect_tracks(dir: &Path) -> Result<Vec<TrackInfo>, String> {
    let mut tracks = collect_audio_files(dir)?;
    for sub in list_dirs(dir)? {
        tracks.extend(collect_audio_files(&sub)?);
    }
    Ok(tracks)
}

fn dir_name(path: &Path) -> String {
    path.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown")
        .to_string()
}

fn list_dirs(path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(path)
        .map_err(|e| format!("failed to read dir {}: {e}", path.display()))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    dirs.sort();
    Ok(dirs)
}

/// Album artwork: search `dir`, then its (cd) subfolders.
fn album_cover(dir: &Path) -> Option<String> {
    find_cover(dir).or_else(|| {
        list_dirs(dir)
            .ok()
            .and_then(|subs| subs.into_iter().find_map(|sub| find_cover(&sub)))
    })
}

/// Scan a music library directory (or the default one when `dir` is None).
///
/// Two layouts share the root, told apart by whether the first-level folder
/// holds audio files directly:
/// - `root/artist/album/<audio>` (optionally one level deeper for multi-disc
///   `album/cd1`, `album/cd2`) — artist inferred from the folder name;
/// - flat `root/album/<audio>` — the folder is the album itself.
/// Artwork is searched in the album folder first, then its subfolders. The
/// whole tree is allow-listed on the asset protocol scope so the frontend can
/// stream files via `convertFileSrc`.
#[tauri::command]
fn scan_library<R: Runtime>(
    app: tauri::AppHandle<R>,
    dir: Option<String>,
) -> Result<Vec<Album>, String> {
    let root_dir = match dir {
        Some(d) => PathBuf::from(d),
        None => default_music_dir(&app)?,
    };

    if !root_dir.is_dir() {
        return Err(format!("directory not found: {}", root_dir.display()));
    }

    app.state::<Scopes>()
        .allow_directory(&root_dir, true)
        .map_err(|e| format!("failed to allow asset scope: {e}"))?;

    let mut albums = Vec::new();
    for first_dir in list_dirs(&root_dir)? {
        // Flat layout: audio files directly in the first-level folder make it
        // an album (multi-disc subfolders still merge in), artist unknown.
        if !collect_audio_files(&first_dir)?.is_empty() {
            let tracks = collect_tracks(&first_dir)?;
            if tracks.is_empty() {
                continue;
            }
            albums.push(Album {
                name: dir_name(&first_dir),
                artist: None,
                tracks,
                cover: album_cover(&first_dir),
            });
            continue;
        }

        let artist = dir_name(&first_dir);
        for album_dir in list_dirs(&first_dir)? {
            let tracks = collect_tracks(&album_dir)?;
            if tracks.is_empty() {
                continue;
            }
            albums.push(Album {
                name: dir_name(&album_dir),
                artist: Some(artist.clone()),
                tracks,
                cover: album_cover(&album_dir),
            });
        }
    }

    Ok(albums)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![scan_library])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Chinese CD rips ship ANSI (GBK) cues — the FILE reference must survive
    /// decoding so the wav can be matched on disk.
    #[test]
    fn cue_gbk_text_decodes() {
        let (gbk, _, _) = encoding_rs::GBK.encode(
            "FILE \"邓紫棋 - 棋开得胜K2HD.wav\" WAVE\n\
             \x20 TRACK 01 AUDIO\n\
             \x20   TITLE \"泡沫\"\n\
             \x20   INDEX 01 00:00:00\n",
        );
        let text = decode_cue_text(gbk.as_ref());
        assert!(text.contains("棋开得胜K2HD.wav"));
        assert!(text.contains("泡沫"));
    }

    #[test]
    fn cue_parses_tracks_and_starts() {
        let text = "FILE \"album.wav\" WAVE\n\
                    TRACK 01 AUDIO\n\
                    \x20 TITLE \"One\"\n\
                    \x20 INDEX 01 00:00:00\n\
                    TRACK 02 AUDIO\n\
                    \x20 TITLE \"Two\"\n\
                    \x20 INDEX 01 04:17:68\n";
        let entries = parse_cue(text);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].title, "One");
        assert_eq!(entries[0].file, "album.wav");
        assert!((entries[1].start - (4.0 * 60.0 + 17.0 + 68.0 / 75.0)).abs() < 1e-6);
    }
}
