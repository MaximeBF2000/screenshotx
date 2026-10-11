//! OCR through a local Ollama server (default model: GLM-OCR).

use anyhow::{anyhow, Context, Result};
use base64::Engine as _;
use image::RgbaImage;
use serde::Serialize;
use std::time::Duration;

/// Longest image side sent to the model: enough for screen text, keeps
/// requests fast.
const MAX_SIDE: u32 = 2048;

fn agent(timeout: Duration) -> ureq::Agent {
    ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(2)).timeout(timeout).build()
}

fn endpoint(url: &str, path: &str) -> String {
    format!("{}/{}", url.trim_end_matches('/'), path)
}

/// Recognize the text in `img` with `model`.
pub fn recognize(url: &str, model: &str, prompt: &str, img: &RgbaImage) -> Result<String> {
    let img = if img.width().max(img.height()) > MAX_SIDE {
        let k = MAX_SIDE as f32 / img.width().max(img.height()) as f32;
        image::imageops::resize(img, (img.width() as f32 * k) as u32, (img.height() as f32 * k) as u32, image::imageops::FilterType::Triangle)
    } else {
        img.clone()
    };
    let mut png = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)?;
    let body = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "images": [base64::engine::general_purpose::STANDARD.encode(&png)],
        "stream": false,
        // GLM-OCR may repeat its answer in a Markdown fence and then loop
        // on empty fences: stop there, and cap the output anyway
        "options": { "temperature": 0, "num_predict": 4096, "stop": ["\n```markdown"] },
    });
    // the first request also loads the model into memory
    let res: serde_json::Value = agent(Duration::from_secs(120))
        .post(&endpoint(url, "api/generate"))
        .send_json(body)
        .map_err(|e| match e {
            ureq::Error::Status(code, r) => anyhow!("Ollama returned {code}: {}", r.into_string().unwrap_or_default()),
            other => anyhow!("Ollama is not reachable at {url} ({other})"),
        })?
        .into_json()
        .context("invalid Ollama response")?;
    let text = res["response"].as_str().ok_or_else(|| anyhow!("no text in Ollama response"))?;
    Ok(clean(text))
}

/// The recognized text without Markdown fences. GLM-OCR sometimes answers
/// with the text, then repeats it in a fence followed by empty fences: keep
/// the text before the first fence, or the inside of a leading fence.
fn clean(text: &str) -> String {
    let t = text.trim();
    let body = match t.find("```") {
        Some(0) => {
            let inner = t[3..].split_once('\n').map(|(_, rest)| rest).unwrap_or("");
            inner.split("```").next().unwrap_or("")
        }
        Some(i) => &t[..i],
        None => t,
    };
    body.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::clean;

    #[test]
    fn strips_fences() {
        assert_eq!(clean("Hello\nworld"), "Hello\nworld");
        assert_eq!(clean("Hello\n\n```markdown\nHello\n```\n```\n```"), "Hello");
        assert_eq!(clean("```text\nHello\n```"), "Hello");
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// the server answered
    pub running: bool,
    /// the model is installed
    pub installed: bool,
    pub error: Option<String>,
}

/// Is the server up, and is `model` installed?
pub fn status(url: &str, model: &str) -> Status {
    match agent(Duration::from_secs(3)).get(&endpoint(url, "api/tags")).call() {
        Ok(r) => {
            let v: serde_json::Value = r.into_json().unwrap_or_default();
            let want = if model.contains(':') { model.to_string() } else { format!("{model}:latest") };
            let installed = v["models"]
                .as_array()
                .map(|ms| ms.iter().any(|m| m["name"].as_str().is_some_and(|n| n == model || n == want)))
                .unwrap_or(false);
            Status { running: true, installed, error: None }
        }
        Err(e) => Status { running: false, installed: false, error: Some(e.to_string()) },
    }
}

/// Download `model` (blocks until Ollama has it).
pub fn pull(url: &str, model: &str) -> Result<()> {
    let res: serde_json::Value = agent(Duration::from_secs(3600))
        .post(&endpoint(url, "api/pull"))
        .send_json(serde_json::json!({ "model": model, "stream": false }))
        .map_err(|e| anyhow!("download failed: {e}"))?
        .into_json()?;
    match res["status"].as_str() {
        Some("success") => Ok(()),
        _ => Err(anyhow!("download failed: {}", res["error"].as_str().unwrap_or("unknown error"))),
    }
}
