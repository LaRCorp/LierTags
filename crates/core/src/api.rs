use anyhow::{Context, Result};
use serde_json::Value;

use crate::models::MusicBrainzRecording;

const APP_USER_AGENT: &str = "LierTags/0.1.0 (https://github.com/LaRevole/LierTags)";

/// Query MusicBrainz Recording API for song information
pub fn search_musicbrainz(query: &str, limit: usize) -> Result<Vec<MusicBrainzRecording>> {
    let encoded_query = urlencoding_simple(query);
    let url = format!(
        "https://musicbrainz.org/ws/2/recording/?query={}&limit={}&fmt=json",
        encoded_query, limit
    );

    let mut response = ureq::get(&url)
        .header("User-Agent", APP_USER_AGENT)
        .header("Accept", "application/json")
        .call()
        .with_context(|| format!("MusicBrainz API request failed for query: {}", query))?;

    let json: Value = response
        .body_mut()
        .read_json()
        .context("Failed to parse MusicBrainz JSON response")?;

    let mut results = Vec::new();
    if let Some(recordings) = json.get("recordings").and_then(|r| r.as_array()) {
        for rec in recordings {
            let id = rec.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
            let title = rec.get("title").and_then(|v| v.as_str()).unwrap_or_default().to_string();

            let artist = rec
                .get("artist-credit")
                .and_then(|ac| ac.as_array())
                .and_then(|arr| arr.first())
                .and_then(|first| first.get("name"))
                .and_then(|n| n.as_str())
                .map(|s| s.to_string());

            let release = rec
                .get("releases")
                .and_then(|rel| rel.as_array())
                .and_then(|arr| arr.first());

            let album = release
                .and_then(|rel| rel.get("title"))
                .and_then(|t| t.as_str())
                .map(|s| s.to_string());

            let release_id = release
                .and_then(|rel| rel.get("id"))
                .and_then(|id| id.as_str())
                .map(|s| s.to_string());

            let year = release
                .and_then(|rel| rel.get("date"))
                .and_then(|d| d.as_str())
                .and_then(|date_str| date_str.get(0..4))
                .and_then(|y| y.parse::<u32>().ok());

            results.push(MusicBrainzRecording {
                id,
                title,
                artist,
                album,
                release_id,
                year,
            });
        }
    }

    Ok(results)
}

/// Download cover art image from URL and convert to Base64 data URI
pub fn fetch_artwork_as_data_uri(url: &str) -> Result<String> {
    let mut response = ureq::get(url)
        .header("User-Agent", APP_USER_AGENT)
        .call()
        .with_context(|| format!("Failed to download artwork from: {}", url))?;

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();

    use std::io::Read;
    let mut bytes = Vec::new();
    response.body_mut().as_reader().read_to_end(&mut bytes)?;

    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
    Ok(format!("data:{};base64,{}", content_type, b64))
}

fn urlencoding_simple(input: &str) -> String {
    let mut output = String::new();
    for b in input.bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                output.push(b as char);
            }
            b' ' => output.push('+'),
            _ => {
                output.push_str(&format!("%{:02X}", b));
            }
        }
    }
    output
}
