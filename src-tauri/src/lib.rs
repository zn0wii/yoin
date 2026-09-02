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

/// A vinyl record: the root music folder, or one of its immediate
/// subfolders. Each maps to exactly one physical record on the shelf.
#[derive(Serialize, Clone)]
struct Album {
    /// Display name (folder name, or "Root" for the top-level record).
    name: String,
    /// Artist if the folder is named `Artist - Title`.
    artist: Option<String>,
    tracks: Vec<TrackInfo>,
    /// Absolute path to cover art (cover.jpg/png/…), if present in the folder.
    cover: Option<String>,
}

/// Split `Artist - Title` folder names; otherwise the whole stem is the title.
fn parse_album_label(folder: &str) -> (String, Option<String>) {
    if let Some((artist, title)) = folder.split_once(" - ") {
        let artist = artist.trim();
        let title = title.trim();
        if !artist.is_empty() && !title.is_empty() {
            return (title.to_string(), Some(artist.to_string()));
        }
    }
    (folder.to_string(), None)
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

/// Look for album artwork in `dir` (non-recursive).
/// Prefers common names: cover / folder / album / front / artwork.
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
    None
}

/// Collect `.mp3` files directly inside `dir` (non-recursive), sorted by title.
fn collect_mp3s(dir: &Path) -> Result<Vec<TrackInfo>, String> {
    let entries =
        std::fs::read_dir(dir).map_err(|e| format!("failed to read dir {}: {e}", dir.display()))?;

    let mut tracks = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let is_mp3 = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("mp3"))
            .unwrap_or(false);
        if !is_mp3 {
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

/// Scan a music library directory (or the default one when `dir` is None).
///
/// Layout convention: mp3 files directly in the root form one "record".
/// Each immediate subfolder containing mp3 files forms another record.
/// The whole tree is allow-listed on the asset protocol scope so the
/// frontend can stream files back via `convertFileSrc`.
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

    let root_tracks = collect_mp3s(&root_dir)?;
    if !root_tracks.is_empty() {
        let name = root_dir
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("Root")
            .to_string();
        let (name, artist) = parse_album_label(&name);
        albums.push(Album {
            name,
            artist,
            tracks: root_tracks,
            cover: find_cover(&root_dir),
        });
    }

    let mut subdirs: Vec<PathBuf> = std::fs::read_dir(&root_dir)
        .map_err(|e| format!("failed to read dir {}: {e}", root_dir.display()))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    subdirs.sort();

    for subdir in subdirs {
        let tracks = collect_mp3s(&subdir)?;
        if tracks.is_empty() {
            continue;
        }
        let name = subdir
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("Unknown")
            .to_string();
        let (name, artist) = parse_album_label(&name);
        albums.push(Album {
            name,
            artist,
            tracks,
            cover: find_cover(&subdir),
        });
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
