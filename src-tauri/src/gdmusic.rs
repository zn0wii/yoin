//! Alternate audio-source fallback, following AlgerMusicPlayer's split:
//! NetEase for metadata, another source for the actual stream.
//!
//! Search goes through GD Studio's music-api (same host as Alger's
//! `gdmusic.ts` / unblock `pyncmd`). For Kuwo play URLs we call Kuwo's
//! `antiserver` directly — GD Studio's `types=url&source=kuwo` currently
//! returns empty (`br:-1`), which is what Alger's `@unblockneteasemusic`
//! Kuwo provider also bypasses.

use serde_json::Value;

const API: &str = "https://music-api.gdstudio.xyz/api.php";
const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const REFERER: &str = "https://music.gdstudio.xyz/";
const KUWO_UA: &str = "okhttp/3.10.0";

/// Kuwo first: search via GD Studio is reliable and play URLs come from
/// Kuwo antiserver. Joox/migu/netease are best-effort extras (flaky here).
const SEARCH_SOURCES: &[&str] = &["kuwo", "joox", "migu", "netease"];

/// Direct-by-NetEase-id lookup (`pyncmd` in unblockneteasemusic).
pub async fn url_by_netease_id(
    client: &reqwest::Client,
    song_id: &str,
) -> Result<Option<String>, String> {
    fetch_gd_url(client, "netease", song_id, "320").await
}

/// Search `title`+`artist` on each fallback source and return the first
/// playable URL whose candidate matches the expected song (name required;
/// artist when both sides have one — same "don't return the wrong cover"
/// rule as Alger's `pickBestCandidate`).
pub async fn url_by_search(
    client: &reqwest::Client,
    title: &str,
    artist: &str,
) -> Result<Option<String>, String> {
    let title = title.trim();
    if title.is_empty() {
        return Ok(None);
    }
    let artist = artist.trim();
    let query = if artist.is_empty() {
        title.to_string()
    } else {
        format!("{title} {artist}")
    };
    let expected_artists: Vec<&str> = if artist.is_empty() {
        Vec::new()
    } else {
        artist
            .split(|c| c == '/' || c == ',' || c == '、' || c == '&')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect()
    };

    for source in SEARCH_SOURCES {
        match search_and_pick(client, source, &query, title, &expected_artists).await {
            Ok(Some(url)) => return Ok(Some(url)),
            Ok(None) => continue,
            Err(e) => {
                // One flaky source must not abort the whole chain.
                eprintln!("[gdmusic] {source} failed: {e}");
                continue;
            }
        }
    }
    Ok(None)
}

async fn search_and_pick(
    client: &reqwest::Client,
    source: &str,
    query: &str,
    expected_title: &str,
    expected_artists: &[&str],
) -> Result<Option<String>, String> {
    let search_url = format!(
        "{API}?types=search&source={source}&name={}&count=5&pages=1",
        urlencoding::encode(query)
    );
    let resp = client
        .get(&search_url)
        .header("User-Agent", UA)
        .header("Referer", REFERER)
        .send()
        .await
        .map_err(|e| format!("search request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("search HTTP {}", resp.status()));
    }
    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("search JSON failed: {e}"))?;
    let candidates = body.as_array().cloned().unwrap_or_default();
    let Some(pick) = pick_best(&candidates, expected_title, expected_artists) else {
        return Ok(None);
    };
    let id = match &pick.id {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => return Ok(None),
    };
    let track_source = pick
        .source
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(source);
    resolve_stream_url(client, track_source, &id).await
}

struct Candidate {
    id: Value,
    source: Option<String>,
}

fn pick_best(
    candidates: &[Value],
    expected_title: &str,
    expected_artists: &[&str],
) -> Option<Candidate> {
    let mut best: Option<(i32, Candidate)> = None;
    for raw in candidates {
        let id = raw.get("id")?.clone();
        if id.is_null() {
            continue;
        }
        let name = raw.get("name")?.as_str()?.to_string();
        if !names_match(expected_title, &name) {
            continue;
        }
        let artist_text = artist_field_text(raw.get("artist"));
        let source = raw
            .get("source")
            .and_then(Value::as_str)
            .map(str::to_string);
        let score = match (expected_artists.is_empty(), artist_text.is_empty()) {
            (true, _) => 2, // no expected artist → name match is enough
            (_, true) => 1, // candidate missing artist → low priority
            (false, false) => {
                let ok = expected_artists
                    .iter()
                    .any(|a| artists_match(a, &artist_text));
                if !ok {
                    continue; // refuse wrong-artist covers
                }
                3
            }
        };
        let cand = Candidate { id, source };
        if best.as_ref().map(|(s, _)| *s).unwrap_or(0) < score {
            best = Some((score, cand));
        }
    }
    best.map(|(_, c)| c)
}

fn artist_field_text(v: Option<&Value>) -> String {
    match v {
        Some(Value::Array(arr)) => arr
            .iter()
            .filter_map(|a| {
                if let Some(s) = a.as_str() {
                    Some(s.to_string())
                } else {
                    a.get("name").and_then(Value::as_str).map(str::to_string)
                }
            })
            .collect::<Vec<_>>()
            .join(" "),
        Some(Value::String(s)) => s.clone(),
        _ => String::new(),
    }
}

fn names_match(expected: &str, candidate: &str) -> bool {
    let e = normalize(expected);
    let c = normalize(candidate);
    if e.is_empty() || c.is_empty() {
        return false;
    }
    e == c || c.contains(&e) || e.contains(&c)
}

fn artists_match(expected: &str, candidate: &str) -> bool {
    let e = normalize(expected);
    let c = normalize(candidate);
    !e.is_empty() && !c.is_empty() && (c.contains(&e) || e.contains(&c))
}

/// Strip parenthetical notes / punctuation so "晴天 (Live)" ≈ "晴天",
/// and fold a small set of traditional CJK forms so Joox's 「周杰倫」
/// still matches NetEase's 「周杰伦」.
fn normalize(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut depth = 0i32;
    for ch in text.chars() {
        match ch {
            '(' | '（' | '[' | '【' => depth += 1,
            ')' | '）' | ']' | '】' => depth = (depth - 1).max(0),
            _ if depth > 0 => {}
            c if c.is_whitespace()
                || matches!(
                    c,
                    '-' | '—' | '_' | '·' | '・' | '\'' | '"' | '‘' | '’' | '“' | '”' | '!'
                        | '！' | '?' | '？' | '.' | ',' | '，' | '。' | '&' | '＆' | '+'
                ) => {}
            c => {
                let folded = fold_trad(c);
                for x in folded.to_lowercase() {
                    out.push(x);
                }
            }
        }
    }
    if out.is_empty() {
        text.chars()
            .filter(|c| !c.is_whitespace())
            .map(fold_trad)
            .flat_map(|c| c.to_lowercase())
            .collect()
    } else {
        out
    }
}

fn fold_trad(c: char) -> char {
    match c {
        '倫' => '伦',
        '傑' => '杰',
        '葉' => '叶',
        '調' => '调',
        '樂' => '乐',
        '風' => '风',
        '愛' => '爱',
        '後' => '后',
        '語' => '语',
        '時' => '时',
        '國' => '国',
        '歡' => '欢',
        '興' => '兴',
        '點' => '点',
        '臺' | '台' => '台',
        '灣' => '湾',
        '劉' => '刘',
        '陳' => '陈',
        '張' => '张',
        '楊' => '杨',
        '黃' => '黄',
        '趙' => '赵',
        '鄧' => '邓',
        '馬' => '马',
        '孫' => '孙',
        '許' => '许',
        '謝' => '谢',
        '韓' => '韩',
        '華' => '华',
        '東' => '东',
        '亞' => '亚',
        '會' => '会',
        '說' => '说',
        '對' => '对',
        '們' => '们',
        '這' => '这',
        '還' => '还',
        other => other,
    }
}

async fn resolve_stream_url(
    client: &reqwest::Client,
    source: &str,
    id: &str,
) -> Result<Option<String>, String> {
    if source == "kuwo" {
        return kuwo_play_url(client, id).await;
    }
    fetch_gd_url(client, source, id, "320").await
}

/// Kuwo play URL via `antiserver` — same fallback path as
/// `@unblockneteasemusic/server` `provider/kuwo.js` (`track`).
async fn kuwo_play_url(client: &reqwest::Client, id: &str) -> Result<Option<String>, String> {
    let rid = id.trim().trim_start_matches("MUSIC_");
    if rid.is_empty() {
        return Ok(None);
    }
    let url = format!(
        "http://antiserver.kuwo.cn/anti.s?type=convert_url&format=mp3&response=url&rid=MUSIC_{rid}"
    );
    let resp = client
        .get(&url)
        .header("User-Agent", KUWO_UA)
        .send()
        .await
        .map_err(|e| format!("kuwo antiserver request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("kuwo antiserver HTTP {}", resp.status()));
    }
    let body = resp
        .text()
        .await
        .map_err(|e| format!("kuwo antiserver body failed: {e}"))?;
    let trimmed = body.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Ok(Some(trimmed.to_string()));
    }
    // Some responses embed the URL among other text.
    if let Some(start) = trimmed.find("http://").or_else(|| trimmed.find("https://")) {
        let end = trimmed[start..]
            .find(|c: char| c.is_whitespace() || c == '"' || c == '\'')
            .map(|i| start + i)
            .unwrap_or(trimmed.len());
        return Ok(Some(trimmed[start..end].to_string()));
    }
    Ok(None)
}

async fn fetch_gd_url(
    client: &reqwest::Client,
    source: &str,
    id: &str,
    br: &str,
) -> Result<Option<String>, String> {
    let url = format!(
        "{API}?types=url&source={source}&id={}&br={br}",
        urlencoding::encode(id)
    );
    let resp = client
        .get(&url)
        .header("User-Agent", UA)
        .header("Referer", REFERER)
        .send()
        .await
        .map_err(|e| format!("url request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("url HTTP {}", resp.status()));
    }
    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("url JSON failed: {e}"))?;
    let stream = body
        .get("url")
        .and_then(Value::as_str)
        .map(|s| s.replace('\\', ""))
        .filter(|s| !s.is_empty());
    let br_ok = body
        .get("br")
        .and_then(Value::as_i64)
        .map(|n| n > 0)
        .unwrap_or(stream.is_some());
    Ok(if br_ok { stream } else { None })
}

#[cfg(test)]
mod live {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn live_url_by_search_qing_tian() {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .unwrap();
        let url = url_by_search(&client, "晴天", "周杰伦").await.unwrap();
        println!("search fallback: {url:?}");
        assert!(url.as_ref().is_some_and(|u| u.starts_with("http")));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_strips_live_suffix() {
        assert_eq!(normalize("晴天 (Live)"), normalize("晴天"));
        assert!(names_match("晴天", "晴天 (Live)"));
    }

    #[test]
    fn traditional_artist_matches_simplified() {
        assert!(artists_match("周杰伦", "周杰倫"));
    }

    #[test]
    fn pick_best_rejects_wrong_artist_cover() {
        let candidates = serde_json::json!([
            {"id": "1", "name": "晴天", "artist": ["翻唱小号"], "source": "netease"},
            {"id": "2", "name": "晴天", "artist": ["周杰伦"], "source": "kuwo"},
        ]);
        let pick = pick_best(candidates.as_array().unwrap(), "晴天", &["周杰伦"]).unwrap();
        assert_eq!(pick.id, json_str_or_num_eq("2"));
    }

    fn json_str_or_num_eq(s: &str) -> Value {
        Value::String(s.to_string())
    }
}
