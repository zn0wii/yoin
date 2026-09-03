//! NetEase Cloud Music official API client: anonymous-token session,
//! `weapi`/`eapi` request assembly, and the three business calls this app
//! needs (search, album detail, song playback url). Ported from the
//! `NeteaseCloudMusicApi` reference implementation's `request.js`.

use crate::netease_crypto;
use rand::Rng;
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::State;

const WEB_DOMAIN: &str = "https://music.163.com";
const API_DOMAIN: &str = "https://interface.music.163.com";
const WEAPI_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
const EAPI_USER_AGENT: &str = "NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)";

// `pc` entry of the reference implementation's `osMap` (`util/request.js`).
const OS: &str = "pc";
const OSVER: &str = "Microsoft-Windows-10-Professional-build-19045-64bit";
const CHANNEL: &str = "netease";
// Must match the reference `osMap.pc.appver` — other values work sometimes,
// but this is what AlgerMusicPlayer / netease-cloud-music-api-alger send.
const APPVER: &str = "3.1.17.204416";

fn random_hex(bytes: usize) -> String {
    let mut rng = rand::thread_rng();
    let data: Vec<u8> = (0..bytes).map(|_| rng.gen()).collect();
    hex::encode(data)
}

/// One process-lifetime set of the extra cookie fields the reference
/// implementation's `processCookieObject` (`util/request.js`) synthesizes
/// for every request (`_ntes_nuid`/`_ntes_nnid`/`WNMCID`/...). The real
/// server rejects requests missing these — observed as `{"code":400}` on
/// `/weapi/register/anonimous` even with an otherwise-correct payload.
struct CookieBase {
    ntes_nuid: String,
    wnmcid: String,
}

impl CookieBase {
    fn new() -> Self {
        let mut rng = rand::thread_rng();
        let letters: String = (0..6)
            .map(|_| (b'a' + rng.gen_range(0..26)) as char)
            .collect();
        let now_ms = chrono_now_millis();
        Self {
            ntes_nuid: random_hex(32),
            wnmcid: format!("{letters}.{now_ms}.01.0"),
        }
    }
}

/// Builds the `Cookie` header value the same way `processCookieObject` +
/// `cookieObjToString` do: the base identity fields every request carries,
/// plus whatever caller-specific fields (`deviceId`, `MUSIC_A`, ...) are
/// passed in. `include_nmtid` mirrors the reference impl's `uri.indexOf('login') === -1` check —
/// true for every call this app makes (none of them are login endpoints).
fn build_cookie(base: &CookieBase, extra: &[(&str, &str)], include_nmtid: bool) -> String {
    let now_ms = chrono_now_millis();
    let mut parts: Vec<(String, String)> = vec![
        ("__remember_me".into(), "true".into()),
        ("ntes_kaola_ad".into(), "1".into()),
        ("_ntes_nuid".into(), base.ntes_nuid.clone()),
        (
            "_ntes_nnid".into(),
            format!("{},{now_ms}", base.ntes_nuid),
        ),
        ("WNMCID".into(), base.wnmcid.clone()),
        ("WEVNSM".into(), "1.0.0".into()),
        ("osver".into(), OSVER.into()),
        ("os".into(), OS.into()),
        ("channel".into(), CHANNEL.into()),
        ("appver".into(), APPVER.into()),
    ];
    for (k, v) in extra {
        parts.push((k.to_string(), v.to_string()));
    }
    if include_nmtid {
        parts.push(("NMTID".into(), random_hex(16)));
    }
    parts
        .into_iter()
        .map(|(k, v)| format!("{}={}", urlencode(&k), urlencode(&v)))
        .collect::<Vec<_>>()
        .join("; ")
}

/// Minimal `encodeURIComponent`-equivalent for the small set of characters
/// that ever show up in these cookie keys/values (hex digits, dots, `=`
/// from base64 tokens, letters). Matches JS `encodeURIComponent` for the
/// unreserved set it leaves untouched.
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// A random Mainland-China-looking IPv4 address, generated once per process
/// and sent as `X-Real-IP`/`X-Forwarded-For` on every request. NetEase's
/// servers geo-check the caller and reject (`{"code":400}`, no matter how
/// correct the rest of the request is) traffic that doesn't look like it
/// originates from China — the reference implementation fakes this for
/// exactly that reason (`generateRandomChineseIP` in `util/index.js`).
fn generate_fake_cn_ip() -> String {
    const PREFIXES: &[&str] = &[
        "116.25", "116.76", "116.77", "116.78", "116.79", "116.80", "116.81",
        "116.82", "116.83", "116.84", "116.85", "116.86", "116.87", "116.88",
        "116.89", "116.90", "116.91", "116.92", "116.93", "116.94",
    ];
    let mut rng = rand::thread_rng();
    let prefix = PREFIXES[rng.gen_range(0..PREFIXES.len())];
    format!(
        "{prefix}.{}.{}",
        rng.gen_range(1..=255u16),
        rng.gen_range(1..=255u16)
    )
}

/// One process-lifetime NetEase identity: a device id and the anonymous
/// session token from `/api/register/anonimous` (fetched lazily on first
/// use, then reused). `device_id` is behind a mutex because the real server
/// stably rejects some freshly-generated ids with `{"code":400}` — the
/// reference `register_anonimous.js` generates a new id on every call, so
/// we regenerate on each failed attempt and keep the id that succeeded.
pub struct NeteaseSession {
    device_id: Mutex<String>,
    music_a: Mutex<Option<String>>,
    cookie_base: CookieBase,
    fake_cn_ip: String,
}

impl NeteaseSession {
    pub fn new() -> Self {
        Self {
            device_id: Mutex::new(netease_crypto::generate_device_id()),
            music_a: Mutex::new(None),
            cookie_base: CookieBase::new(),
            fake_cn_ip: generate_fake_cn_ip(),
        }
    }

    fn device_id(&self) -> String {
        self.device_id.lock().unwrap().clone()
    }

    fn regenerate_device_id(&self) {
        *self.device_id.lock().unwrap() = netease_crypto::generate_device_id();
    }
}

impl Default for NeteaseSession {
    fn default() -> Self {
        Self::new()
    }
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("failed to build http client: {e}"))
}

/// Registers a fresh anonymous session and returns its `MUSIC_A` token.
/// Uses the session's current `device_id` (caller retries with a new id on
/// the sticky `{"code":400}` rejection NetEase returns for some ids).
async fn register_anonymous(
    client: &reqwest::Client,
    session: &NeteaseSession,
) -> Result<String, String> {
    let device_id = session.device_id();
    let username = netease_crypto::anonymous_username(&device_id);
    let body = json!({ "username": username, "csrf_token": "" });
    let payload = netease_crypto::weapi(&body.to_string());

    // The register call happens before any `MUSIC_A` token exists, but the
    // server still rejects the request (400) unless the `MUSIC_A` cookie
    // *key* is present — matching `processCookieObject`'s
    // `processedCookie.MUSIC_A = processedCookie.MUSIC_A || anonymous_token`
    // fallback, which always sets the field even when empty.
    let cookie = build_cookie(
        &session.cookie_base,
        &[
            ("deviceId", device_id.as_str()),
            ("MUSIC_A", ""),
        ],
        true,
    );

    let url = format!("{WEB_DOMAIN}/weapi/register/anonimous");
    let resp = client
        .post(&url)
        .header("Referer", WEB_DOMAIN)
        .header("User-Agent", WEAPI_USER_AGENT)
        .header("Cookie", cookie)
        .header("X-Real-IP", session.fake_cn_ip.as_str())
        .header("X-Forwarded-For", session.fake_cn_ip.as_str())
        .form(&[
            ("params", payload.params.as_str()),
            ("encSecKey", payload.enc_sec_key.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("anonymous register request failed: {e}"))?;

    // The reference impl reads the `MUSIC_A` token back out of the
    // response's `Set-Cookie` headers (not the JSON body) — `body.cookie`
    // in `register_anonimous.js`. Read headers before consuming the body.
    let set_cookie_values: Vec<String> = resp
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok().map(str::to_string))
        .collect();

    let json: Value = resp
        .json()
        .await
        .map_err(|e| format!("anonymous register response was not valid JSON: {e}"))?;

    if json.get("code").and_then(Value::as_i64) != Some(200) {
        return Err(format!("anonymous register response not ok: {json}"));
    }

    extract_music_a(&set_cookie_values)
        .ok_or_else(|| "anonymous register response missing MUSIC_A cookie".to_string())
}

/// Extracts `MUSIC_A=...` from a `Set-Cookie` header value list.
fn extract_music_a(set_cookie_values: &[String]) -> Option<String> {
    for raw in set_cookie_values {
        for part in raw.split(';') {
            let part = part.trim();
            if let Some(value) = part.strip_prefix("MUSIC_A=") {
                if !value.is_empty() {
                    return Some(value.to_string());
                }
            }
        }
    }
    None
}

/// Returns the cached `MUSIC_A` token, registering a new anonymous session
/// on first use. Retries with a fresh `device_id` on failure — NetEase
/// rejects some ids with a sticky `{"code":400}` (confirmed against
/// AlgerMusicPlayer's `register_anonimous`, which also regenerates per call).
async fn ensure_music_a(
    client: &reqwest::Client,
    session: &NeteaseSession,
) -> Result<String, String> {
    {
        let cached = session.music_a.lock().unwrap();
        if let Some(token) = cached.as_ref() {
            return Ok(token.clone());
        }
    }

    const MAX_ATTEMPTS: usize = 5;
    let mut last_err = String::new();
    for attempt in 0..MAX_ATTEMPTS {
        match register_anonymous(client, session).await {
            Ok(token) => {
                *session.music_a.lock().unwrap() = Some(token.clone());
                return Ok(token);
            }
            Err(e) => {
                last_err = e;
                if attempt + 1 < MAX_ATTEMPTS {
                    session.regenerate_device_id();
                }
            }
        }
    }
    Err(format!(
        "anonymous register failed after {MAX_ATTEMPTS} attempts: {last_err}"
    ))
}

/// POSTs `body` to `uri` (e.g. `/api/cloudsearch/pc`) using `weapi`
/// encryption, with the anonymous session's cookie attached.
async fn post_weapi(
    client: &reqwest::Client,
    session: &NeteaseSession,
    uri: &str,
    mut body: Value,
) -> Result<Value, String> {
    let music_a = ensure_music_a(client, session).await?;
    let device_id = session.device_id();
    body["csrf_token"] = json!("");
    let payload = netease_crypto::weapi(&body.to_string());

    // uri is "/api/xxx"; the reference impl does `DOMAIN + '/weapi/' + uri.substr(5)`.
    let suffix = uri.strip_prefix("/api/").ok_or("uri must start with /api/")?;
    let url = format!("{WEB_DOMAIN}/weapi/{suffix}");

    let cookie = build_cookie(
        &session.cookie_base,
        &[
            ("deviceId", device_id.as_str()),
            ("MUSIC_A", music_a.as_str()),
        ],
        true,
    );

    let resp = client
        .post(&url)
        .header("Referer", WEB_DOMAIN)
        .header("User-Agent", WEAPI_USER_AGENT)
        .header("Cookie", cookie)
        .header("X-Real-IP", session.fake_cn_ip.as_str())
        .header("X-Forwarded-For", session.fake_cn_ip.as_str())
        .form(&[
            ("params", payload.params.as_str()),
            ("encSecKey", payload.enc_sec_key.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("weapi request to {uri} failed: {e}"))?;

    resp.json()
        .await
        .map_err(|e| format!("weapi response from {uri} was not valid JSON: {e}"))
}

/// POSTs `body` to `uri` using `eapi` encryption (used by the playback-url
/// endpoint), with the anonymous session's device header block attached.
async fn post_eapi(
    client: &reqwest::Client,
    session: &NeteaseSession,
    uri: &str,
    mut body: Value,
) -> Result<Value, String> {
    let music_a = ensure_music_a(client, session).await?;
    let device_id = session.device_id();

    // Mirrors the reference impl's `case 'eapi'` branch: the `header`
    // object's fields come straight from the (processed) cookie, not a
    // separate device profile — so this reuses the same `pc` identity as
    // the weapi calls, not an iPhone one.
    let now_ms = chrono_now_millis();
    let header = json!({
        "osver": OSVER,
        "deviceId": device_id,
        "os": OS,
        "appver": APPVER,
        "versioncode": "140",
        "mobilename": "",
        "buildver": now_ms.to_string().chars().take(10).collect::<String>(),
        "resolution": "1920x1080",
        "__csrf": "",
        "channel": CHANNEL,
        "requestId": format!("{now_ms}_{:04}", now_ms % 1000),
        "MUSIC_A": music_a,
    });
    body["header"] = header.clone();

    let text = body.to_string();
    let params = netease_crypto::eapi(uri, &text);

    let suffix = uri.strip_prefix("/api/").ok_or("uri must start with /api/")?;
    let url = format!("{API_DOMAIN}/eapi/{suffix}");

    // `createHeaderCookie`: the `Cookie` header here is the `header` object
    // itself serialized as `key=value` pairs, not the full cookie-jar set.
    let cookie_header = header
        .as_object()
        .map(|obj| {
            obj.iter()
                .map(|(k, v)| {
                    let v = match v {
                        Value::String(s) => s.clone(),
                        other => other.to_string(),
                    };
                    format!("{}={}", urlencode(k), urlencode(&v))
                })
                .collect::<Vec<_>>()
                .join("; ")
        })
        .unwrap_or_default();

    let resp = client
        .post(&url)
        .header("Cookie", cookie_header)
        .header("User-Agent", EAPI_USER_AGENT)
        .header("X-Real-IP", session.fake_cn_ip.as_str())
        .header("X-Forwarded-For", session.fake_cn_ip.as_str())
        .form(&[("params", params.as_str())])
        .send()
        .await
        .map_err(|e| format!("eapi request to {uri} failed: {e}"))?;

    resp.json()
        .await
        .map_err(|e| format!("eapi response from {uri} was not valid JSON: {e}"))
}

fn chrono_now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

// ---------------------------------------------------------------------
// Business calls
// ---------------------------------------------------------------------

/// One album hit from `cloudsearch` (`type=10`).
#[derive(Debug, Serialize, Clone)]
pub struct AlbumSearchResult {
    pub id: String,
    pub name: String,
    pub artist: String,
    pub cover_url: String,
}

/// One song hit from `cloudsearch` (`type=1`).
#[derive(Debug, Serialize, Clone)]
pub struct SongSearchResult {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album_id: String,
    pub album_name: String,
    pub cover_url: String,
}

/// A single hit in the mixed song+album search results, tagged so the
/// frontend can tell which shape it got without guessing from field
/// presence.
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MusicSearchResult {
    Song(SongSearchResult),
    Album(AlbumSearchResult),
}

/// `type=10` cloudsearch — search albums by free-text query.
pub async fn search_albums(
    client: &reqwest::Client,
    session: &NeteaseSession,
    query: &str,
) -> Result<Vec<AlbumSearchResult>, String> {
    let body = json!({
        "s": query,
        "type": 10,
        "limit": 30,
        "offset": 0,
        "total": true,
    });
    let resp = post_weapi(client, session, "/api/cloudsearch/pc", body).await?;
    let albums = resp
        .pointer("/result/albums")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    Ok(albums
        .into_iter()
        .filter_map(|a| {
            let id = a.get("id")?.as_u64()?.to_string();
            let name = a.get("name")?.as_str()?.to_string();
            let artist = a
                .pointer("/artist/name")
                .and_then(Value::as_str)
                .unwrap_or("未知歌手")
                .to_string();
            let cover_url = a
                .get("picUrl")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            Some(AlbumSearchResult {
                id,
                name,
                artist,
                cover_url,
            })
        })
        .collect())
}

/// `type=1` cloudsearch — search songs by free-text query.
pub async fn search_songs(
    client: &reqwest::Client,
    session: &NeteaseSession,
    query: &str,
) -> Result<Vec<SongSearchResult>, String> {
    let body = json!({
        "s": query,
        "type": 1,
        "limit": 30,
        "offset": 0,
        "total": true,
    });
    let resp = post_weapi(client, session, "/api/cloudsearch/pc", body).await?;
    let songs = resp
        .pointer("/result/songs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    Ok(songs
        .into_iter()
        .filter_map(|s| {
            let id = s.get("id")?.as_u64()?.to_string();
            let title = s.get("name")?.as_str()?.to_string();
            let artist = s
                .pointer("/ar/0/name")
                .and_then(Value::as_str)
                .unwrap_or("未知歌手")
                .to_string();
            let album_id = s
                .pointer("/al/id")
                .and_then(Value::as_u64)
                .map(|n| n.to_string())
                .unwrap_or_default();
            let album_name = s
                .pointer("/al/name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let cover_url = s
                .pointer("/al/picUrl")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            Some(SongSearchResult {
                id,
                title,
                artist,
                album_id,
                album_name,
                cover_url,
            })
        })
        .collect())
}

/// Combined song + album search — runs both `cloudsearch` queries and
/// interleaves songs first, then albums, so the frontend can render one
/// flat list with a `kind` tag per item.
pub async fn search_music(
    client: &reqwest::Client,
    session: &NeteaseSession,
    query: &str,
) -> Result<Vec<MusicSearchResult>, String> {
    let songs = search_songs(client, session, query).await?;
    let albums = search_albums(client, session, query).await?;

    Ok(songs
        .into_iter()
        .map(MusicSearchResult::Song)
        .chain(albums.into_iter().map(MusicSearchResult::Album))
        .collect())
}

/// One track inside an album's detail response.
#[derive(Debug, Serialize, Clone)]
pub struct AlbumTrack {
    pub id: String,
    pub title: String,
    /// Track number within the album (1-based).
    pub track_no: u32,
    /// Duration in seconds, if known.
    pub duration: Option<f64>,
}

/// Full album detail: cover, info, and every track.
#[derive(Debug, Serialize, Clone)]
pub struct AlbumDetail {
    pub id: String,
    pub name: String,
    pub artist: String,
    pub cover_url: String,
    pub description: String,
    pub publish_time: Option<i64>,
    pub tracks: Vec<AlbumTrack>,
}

/// `GET /api/v1/album/{id}` (via weapi) — cover, info, full track list.
pub async fn album_detail(
    client: &reqwest::Client,
    session: &NeteaseSession,
    album_id: &str,
) -> Result<AlbumDetail, String> {
    let uri = format!("/api/v1/album/{album_id}");
    let resp = post_weapi(client, session, &uri, json!({})).await?;

    let album = resp
        .get("album")
        .ok_or_else(|| format!("album detail response missing 'album': {resp}"))?;

    let name = album
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("未知专辑")
        .to_string();
    let artist = album
        .pointer("/artist/name")
        .and_then(Value::as_str)
        .unwrap_or("未知歌手")
        .to_string();
    let cover_url = album
        .get("picUrl")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let description = album
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let publish_time = album.get("publishTime").and_then(Value::as_i64);

    let songs = resp
        .get("songs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let tracks = songs
        .into_iter()
        .enumerate()
        .filter_map(|(i, s)| {
            let id = s.get("id")?.as_u64()?.to_string();
            let title = s.get("name")?.as_str()?.to_string();
            let duration = s
                .get("duration")
                .or_else(|| s.get("dt"))
                .and_then(Value::as_f64)
                .map(|ms| ms / 1000.0);
            Some(AlbumTrack {
                id,
                title,
                track_no: (i + 1) as u32,
                duration,
            })
        })
        .collect();

    Ok(AlbumDetail {
        id: album_id.to_string(),
        name,
        artist,
        cover_url,
        description,
        publish_time,
        tracks,
    })
}

/// Resolve a streamable URL for one track.
///
/// 1. Official NetEase eapi `/song/enhance/player/url`
/// 2. GD Studio `pyncmd`-style lookup by NetEase id
/// 3. GD Studio search on joox/kuwo/migu/netease by `title`+`artist`
///    (AlgerMusicPlayer's metadata-from-NetEase / audio-from-elsewhere path)
///
/// Returns `None` only when every source fails.
pub async fn song_play_url(
    client: &reqwest::Client,
    session: &NeteaseSession,
    song_id: &str,
    title: Option<&str>,
    artist: Option<&str>,
) -> Result<Option<String>, String> {
    let body = json!({
        "ids": format!("[{song_id}]"),
        "br": 320000,
    });
    let resp = post_eapi(client, session, "/api/song/enhance/player/url", body).await?;
    if let Some(url) = resp
        .pointer("/data/0/url")
        .and_then(Value::as_str)
        .filter(|u| !u.is_empty())
        .map(str::to_string)
    {
        return Ok(Some(url));
    }

    if let Ok(Some(url)) = crate::gdmusic::url_by_netease_id(client, song_id).await {
        return Ok(Some(url));
    }

    let title = title.map(str::trim).filter(|s| !s.is_empty()).unwrap_or("");
    let artist = artist.map(str::trim).filter(|s| !s.is_empty()).unwrap_or("");
    if !title.is_empty() {
        if let Some(url) = crate::gdmusic::url_by_search(client, title, artist).await? {
            return Ok(Some(url));
        }
    }

    Ok(None)
}

// ---------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------

#[tauri::command]
pub async fn search_netease_music(
    session: State<'_, NeteaseSession>,
    query: String,
) -> Result<Vec<MusicSearchResult>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let client = http_client()?;
    search_music(&client, &session, query).await
}

#[tauri::command]
pub async fn get_netease_album_detail(
    session: State<'_, NeteaseSession>,
    album_id: String,
) -> Result<AlbumDetail, String> {
    let client = http_client()?;
    album_detail(&client, &session, &album_id).await
}

#[tauri::command]
pub async fn get_netease_song_url(
    session: State<'_, NeteaseSession>,
    song_id: String,
    title: Option<String>,
    artist: Option<String>,
) -> Result<Option<String>, String> {
    let client = http_client()?;
    song_play_url(
        &client,
        &session,
        &song_id,
        title.as_deref(),
        artist.as_deref(),
    )
    .await
}

/// Live smoke test against the real NetEase servers — not run in CI, only
/// on demand (`cargo test --lib live_smoke -- --ignored --nocapture`) while
/// developing this module, to confirm the anonymous-session + weapi/eapi
/// round trip actually works end to end (unit tests above only check the
/// crypto math against reference vectors, not real server acceptance).
#[cfg(test)]
mod live_smoke {
    use super::*;

    /// NetEase sticky-rejects some device ids with `{"code":400}`;
    /// `ensure_music_a` must regenerate and retry so a single unlucky id
    /// cannot poison the whole process session.
    #[tokio::test]
    #[ignore]
    async fn ensure_music_a_survives_bad_device_ids() {
        let client = http_client().unwrap();
        let mut ok = 0usize;
        for trial in 0..10 {
            let session = NeteaseSession::new();
            match ensure_music_a(&client, &session).await {
                Ok(token) => {
                    ok += 1;
                    println!("[trial {trial}] OK token_len={}", token.len());
                }
                Err(e) => panic!("[trial {trial}] ensure_music_a failed: {e}"),
            }
        }
        assert_eq!(ok, 10);
    }

    #[tokio::test]
    #[ignore]
    async fn search_songs_survives_register_flake() {
        let client = http_client().unwrap();
        for trial in 0..8 {
            let session = NeteaseSession::new();
            let songs = search_songs(&client, &session, "晴天").await.expect("search_songs");
            println!("[trial {trial}] songs={} first={:?}", songs.len(), songs.first().map(|s| &s.title));
            assert!(!songs.is_empty());
        }
    }

    #[tokio::test]
    #[ignore]
    async fn full_flow_search_detail_play_url() {
        let client = http_client().unwrap();
        let session = NeteaseSession::new();

        let albums = search_albums(&client, &session, "晴天").await.unwrap();
        println!("search results: {albums:#?}");
        assert!(!albums.is_empty(), "expected at least one album hit");

        let first = &albums[0];
        let detail = album_detail(&client, &session, &first.id).await.unwrap();
        println!("album detail: {detail:#?}");
        assert!(!detail.tracks.is_empty(), "expected at least one track");

        let first_track = &detail.tracks[0];
        let url = song_play_url(
            &client,
            &session,
            &first_track.id,
            Some(&first_track.title),
            Some(&detail.artist),
        )
        .await
        .unwrap();
        println!("play url: {url:?}");
        assert!(url.is_some(), "expected a playable url via official or fallback");
    }

    #[tokio::test]
    #[ignore]
    async fn jay_chou_qing_tian_resolves_via_fallback() {
        let client = http_client().unwrap();
        // Classic 晴天 id — official eapi typically returns empty; fallback must work.
        let url = song_play_url(
            &client,
            &NeteaseSession::new(),
            "186016",
            Some("晴天"),
            Some("周杰伦"),
        )
        .await
        .unwrap();
        println!("晴天 url: {url:?}");
        assert!(url.is_some());
    }
}
