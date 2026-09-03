//! Album download: fetches every track's playback URL from NetEase's
//! official API (via `netease_client`) and writes them to disk under
//! `music/<artist>/<album>/`, alongside the cover art — same layout
//! `scan_library` expects, so the vinyl shelf shows the real artist name.

use crate::netease_client::{self, NeteaseSession};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, Runtime, Scopes, State};

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("failed to build http client: {e}"))
}

/// Track handed back from the frontend to request a download.
#[derive(Debug, Deserialize)]
pub struct DownloadTrack {
    pub id: String,
    pub title: String,
}

/// Progress event emitted to the frontend while an album downloads.
#[derive(Debug, Serialize, Clone)]
struct DownloadProgress {
    album: String,
    completed: usize,
    total: usize,
    current_title: String,
}

/// Strip characters that are illegal (or awkward) in file/folder names on
/// the common desktop filesystems.
fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            other => other,
        })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "未知".to_string()
    } else {
        trimmed.to_string()
    }
}

/// True when `dest` already holds a non-empty file — used to skip re-downloads
/// so a partial album retry does not overwrite songs that already succeeded.
fn file_already_downloaded(dest: &PathBuf) -> bool {
    std::fs::metadata(dest)
        .map(|m| m.is_file() && m.len() > 0)
        .unwrap_or(false)
}

async fn download_to_file(
    client: &reqwest::Client,
    url: &str,
    dest: &PathBuf,
) -> Result<(), String> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download request failed: {e}"))?;
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("download body read failed: {e}"))?;
    std::fs::write(dest, &bytes).map_err(|e| format!("failed to write {}: {e}", dest.display()))
}

/// Resolve the library root `<app>/music` (dev: project-root `music`;
/// bundled: resource-dir `music`) — albums land at `music/<artist>/<album>/`
/// so `scan_library` picks up the real artist folder name.
fn music_library_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        Ok(manifest_dir
            .parent()
            .ok_or("cannot resolve project root")?
            .join("music"))
    } else {
        app.path()
            .resource_dir()
            .map(|dir| dir.join("music"))
            .map_err(|e| format!("failed to resolve resource dir: {e}"))
    }
}

/// Download every track in `tracks` into `music/<artist>/<album>/`,
/// writing sequential `NN - title.mp3` files plus a shared `cover.jpg`.
/// Emits `download-progress` events as tracks complete. Allow-lists the
/// target folder on the asset protocol scope so it can be scanned/played
/// immediately after.
#[tauri::command]
pub async fn download_album<R: Runtime>(
    app: AppHandle<R>,
    session: State<'_, NeteaseSession>,
    album: String,
    artist: String,
    tracks: Vec<DownloadTrack>,
    cover_url: Option<String>,
) -> Result<String, String> {
    if tracks.is_empty() {
        return Err("专辑没有可下载的曲目".to_string());
    }

    let client = http_client()?;
    let root = music_library_dir(&app)?;
    let album_dir = root
        .join(sanitize_filename(&artist))
        .join(sanitize_filename(&album));
    std::fs::create_dir_all(&album_dir)
        .map_err(|e| format!("failed to create {}: {e}", album_dir.display()))?;

    if let Some(cover_url) = cover_url.filter(|u| !u.is_empty()) {
        let cover_path = album_dir.join("cover.jpg");
        if !file_already_downloaded(&cover_path) {
            let _ = download_to_file(&client, &cover_url, &cover_path).await;
        }
    }

    let total = tracks.len();
    let mut failed: Vec<String> = Vec::new();

    for (i, track) in tracks.iter().enumerate() {
        let filename = format!(
            "{:02} - {}.mp3",
            i + 1,
            sanitize_filename(&track.title)
        );
        let dest = album_dir.join(&filename);

        let _ = app.emit(
            "download-progress",
            DownloadProgress {
                album: album.clone(),
                completed: i,
                total,
                current_title: track.title.clone(),
            },
        );

        // Retry after a partial failure: keep existing successes intact.
        if file_already_downloaded(&dest) {
            continue;
        }

        match netease_client::song_play_url(
            &client,
            &session,
            &track.id,
            Some(&track.title),
            Some(&artist),
        )
        .await
        {
            Ok(Some(track_url)) => {
                if let Err(e) = download_to_file(&client, &track_url, &dest).await {
                    failed.push(format!("{}: {e}", track.title));
                }
            }
            Ok(None) => failed.push(format!("{}: 无可用播放地址（可能需要会员或已下架）", track.title)),
            Err(e) => failed.push(format!("{}: {e}", track.title)),
        }
    }

    let _ = app.emit(
        "download-progress",
        DownloadProgress {
            album: album.clone(),
            completed: total,
            total,
            current_title: String::new(),
        },
    );

    app.state::<Scopes>()
        .allow_directory(&album_dir, true)
        .map_err(|e| format!("failed to allow asset scope: {e}"))?;

    if failed.is_empty() {
        Ok(album_dir.to_string_lossy().into_owned())
    } else if failed.len() == total {
        Err(format!("专辑下载失败：{}", failed.join("; ")))
    } else {
        Err(format!(
            "专辑部分下载失败（{}/{}）：{}",
            failed.len(),
            total,
            failed.join("; ")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn skips_existing_non_empty_file_only() {
        let dir = std::env::temp_dir().join(format!(
            "yoin-dl-skip-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let present = dir.join("01 - a.mp3");
        let empty = dir.join("02 - b.mp3");
        let missing = dir.join("03 - c.mp3");
        std::fs::File::create(&present)
            .unwrap()
            .write_all(b"mp3")
            .unwrap();
        std::fs::File::create(&empty).unwrap();
        assert!(file_already_downloaded(&present));
        assert!(!file_already_downloaded(&empty));
        assert!(!file_already_downloaded(&missing));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
