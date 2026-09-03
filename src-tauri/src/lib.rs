use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime, Scopes};

#[derive(Serialize, Clone)]
struct TrackInfo {
    /// File name without extension, used as display title.
    title: String,
    /// Absolute path on disk. Frontend converts this via convertFileSrc.
    path: String,
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

/// Collect audio files directly inside `dir` (non-recursive), sorted by title.
fn collect_audio_files(dir: &Path) -> Result<Vec<TrackInfo>, String> {
    let entries =
        std::fs::read_dir(dir).map_err(|e| format!("failed to read dir {}: {e}", dir.display()))?;

    let mut tracks = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let is_audio = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| AUDIO_EXTS.iter().any(|a| ext.eq_ignore_ascii_case(a)))
            .unwrap_or(false);
        if !is_audio {
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
        });
    }
    tracks.sort_by(|a, b| a.title.cmp(&b.title));
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

/// Scan a music library directory (or the default one when `dir` is None).
///
/// Layout: `root/artist/album/<audio files>`, optionally one level deeper for
/// multi-disc albums (`album/cd1`, `album/cd2`). Artwork is searched in the
/// album folder first, then its subfolders. The whole tree is allow-listed on
/// the asset protocol scope so the frontend can stream files via
/// `convertFileSrc`.
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
    for artist_dir in list_dirs(&root_dir)? {
        let artist = dir_name(&artist_dir);
        for album_dir in list_dirs(&artist_dir)? {
            let tracks = collect_tracks(&album_dir)?;
            if tracks.is_empty() {
                continue;
            }
            let cover = find_cover(&album_dir).or_else(|| {
                list_dirs(&album_dir)
                    .ok()
                    .and_then(|subs| subs.into_iter().find_map(|sub| find_cover(&sub)))
            });
            albums.push(Album {
                name: dir_name(&album_dir),
                artist: Some(artist.clone()),
                tracks,
                cover,
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
