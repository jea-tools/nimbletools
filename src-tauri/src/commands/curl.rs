use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

use super::curl_db::{
    CurlDb, CurlFolder, CurlHistoryDraft, CurlHistoryEntry, CurlProject, CurlRequest,
    CurlRequestDraft, CurlWorkspace,
};

const MAX_RESPONSE_BODY_BYTES: usize = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_SECS: u64 = 60;

pub struct CurlState {
    pub db: Arc<CurlDb>,
}

impl CurlState {
    pub fn new(app: &AppHandle) -> Self {
        let data_dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| std::env::temp_dir().join("nimbletools"));
        let _ = std::fs::create_dir_all(&data_dir);
        let db_path = data_dir.join("curl.db");
        let db = CurlDb::open(&db_path).expect("Failed to open curl database");
        Self { db: Arc::new(db) }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct KeyValueRow {
    pub enabled: bool,
    pub key: String,
    pub value: String,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct CurlRequestInput {
    pub method: String,
    pub url: String,
    pub headers: Vec<KeyValueRow>,
    pub query: Vec<KeyValueRow>,
    pub body_type: String,
    pub body: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SaveCurlRequestPayload {
    pub id: Option<i64>,
    pub project_id: i64,
    pub folder_id: Option<i64>,
    pub name: String,
    pub method: String,
    pub url: String,
    pub headers: Vec<KeyValueRow>,
    pub query: Vec<KeyValueRow>,
    pub body_type: String,
    pub body: String,
}

#[derive(Serialize)]
pub struct CurlSendResponse {
    pub status: Option<u16>,
    pub duration_ms: u128,
    pub headers: Vec<KeyValueRow>,
    pub body: String,
    pub body_truncated: bool,
    pub error: Option<String>,
    pub history_id: i64,
}

#[derive(Serialize)]
pub struct ImportedCurlRequest {
    pub name: String,
    pub method: String,
    pub url: String,
    pub headers: Vec<KeyValueRow>,
    pub query: Vec<KeyValueRow>,
    pub body_type: String,
    pub body: String,
}

#[tauri::command]
pub fn get_curl_workspace(state: State<'_, CurlState>) -> Result<CurlWorkspace, String> {
    state.db.list_workspace()
}

#[tauri::command]
pub fn create_curl_project(
    name: String,
    state: State<'_, CurlState>,
) -> Result<CurlProject, String> {
    validate_name(&name)?;
    state.db.create_project(name.trim())
}

#[tauri::command]
pub fn rename_curl_project(
    id: i64,
    name: String,
    state: State<'_, CurlState>,
) -> Result<CurlProject, String> {
    validate_name(&name)?;
    state.db.rename_project(id, name.trim())
}

#[tauri::command]
pub fn delete_curl_project(id: i64, state: State<'_, CurlState>) -> Result<(), String> {
    state.db.delete_project(id)
}

#[tauri::command]
pub fn create_curl_folder(
    project_id: i64,
    parent_id: Option<i64>,
    name: String,
    state: State<'_, CurlState>,
) -> Result<CurlFolder, String> {
    validate_name(&name)?;
    state.db.create_folder(project_id, parent_id, name.trim())
}

#[tauri::command]
pub fn rename_curl_folder(
    id: i64,
    name: String,
    state: State<'_, CurlState>,
) -> Result<CurlFolder, String> {
    validate_name(&name)?;
    state.db.rename_folder(id, name.trim())
}

#[tauri::command]
pub fn delete_curl_folder(id: i64, state: State<'_, CurlState>) -> Result<(), String> {
    state.db.delete_folder(id)
}

#[tauri::command]
pub fn save_curl_request(
    payload: SaveCurlRequestPayload,
    state: State<'_, CurlState>,
) -> Result<CurlRequest, String> {
    validate_name(&payload.name)?;
    validate_method(&payload.method)?;
    let draft = CurlRequestDraft {
        project_id: payload.project_id,
        folder_id: payload.folder_id,
        name: payload.name.trim().to_string(),
        method: payload.method.to_uppercase(),
        url: payload.url,
        headers_json: serde_json::to_string(&payload.headers).map_err(|e| e.to_string())?,
        query_json: serde_json::to_string(&payload.query).map_err(|e| e.to_string())?,
        body_type: payload.body_type,
        body: payload.body,
    };
    state.db.save_request(payload.id, draft)
}

#[tauri::command]
pub fn rename_curl_request(
    id: i64,
    name: String,
    state: State<'_, CurlState>,
) -> Result<CurlRequest, String> {
    validate_name(&name)?;
    state.db.rename_request(id, name.trim())
}

#[tauri::command]
pub fn delete_curl_request(id: i64, state: State<'_, CurlState>) -> Result<(), String> {
    state.db.delete_request(id)
}

#[tauri::command]
pub fn import_curl_command(command: String) -> Result<ImportedCurlRequest, String> {
    let parsed = parse_curl_command(&command)?;
    Ok(ImportedCurlRequest {
        name: imported_name_from_url(&parsed.url),
        method: parsed.method,
        url: parsed.url,
        headers: parsed.headers,
        query: parsed.query,
        body_type: parsed.body_type,
        body: parsed.body,
    })
}

#[tauri::command]
pub fn export_curl_command_command(request: CurlRequestInput) -> Result<String, String> {
    export_curl_command(request)
}

#[tauri::command]
pub fn get_curl_history(
    request_id: Option<i64>,
    limit: Option<usize>,
    state: State<'_, CurlState>,
) -> Result<Vec<CurlHistoryEntry>, String> {
    state.db.list_history(request_id, limit.unwrap_or(50))
}

#[tauri::command]
pub fn clear_curl_history(
    request_id: Option<i64>,
    state: State<'_, CurlState>,
) -> Result<(), String> {
    state.db.clear_history(request_id)
}

#[tauri::command]
pub async fn send_curl_request(
    request_id: Option<i64>,
    request: CurlRequestInput,
    state: State<'_, CurlState>,
) -> Result<CurlSendResponse, String> {
    validate_method(&request.method)?;
    let start = Instant::now();
    let result = execute_request(&request).await;
    let duration_ms = start.elapsed().as_millis();
    let (status, headers, body, body_truncated, error) = match result {
        Ok(response) => (
            Some(response.status),
            response.headers,
            response.body,
            response.body_truncated,
            None,
        ),
        Err(err) => (None, vec![], String::new(), false, Some(err)),
    };

    let history = state.db.insert_history(CurlHistoryDraft {
        request_id,
        name: request_id
            .and_then(|id| state.db.get_request(id).ok())
            .map(|request| request.name)
            .unwrap_or_else(|| imported_name_from_url(&request.url)),
        method: request.method.to_uppercase(),
        url: build_url_string(&request.url, &request.query).unwrap_or_else(|_| request.url.clone()),
        status,
        duration_ms,
        request_snapshot_json: serde_json::to_string(&request).map_err(|e| e.to_string())?,
        response_headers_json: serde_json::to_string(&headers).map_err(|e| e.to_string())?,
        response_body: body.clone(),
        error: error.clone(),
    })?;

    Ok(CurlSendResponse {
        status,
        duration_ms,
        headers,
        body,
        body_truncated,
        error,
        history_id: history.id,
    })
}

struct ExecutedResponse {
    status: u16,
    headers: Vec<KeyValueRow>,
    body: String,
    body_truncated: bool,
}

async fn execute_request(request: &CurlRequestInput) -> Result<ExecutedResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| e.to_string())?;
    let method = reqwest::Method::from_bytes(request.method.to_uppercase().as_bytes())
        .map_err(|_| format!("invalid method: {}", request.method))?;
    let url = build_request_url(request)?;
    let mut builder = client.request(method, url);

    for header in request
        .headers
        .iter()
        .filter(|row| row.enabled && !row.key.trim().is_empty())
    {
        builder = builder.header(header.key.trim(), header.value.as_str());
    }

    builder = match request.body_type.as_str() {
        "none" => builder,
        "json" => {
            let has_content_type = request
                .headers
                .iter()
                .any(|row| row.enabled && row.key.eq_ignore_ascii_case("content-type"));
            let builder = if has_content_type {
                builder
            } else {
                builder.header("Content-Type", "application/json")
            };
            builder.body(request.body.clone())
        }
        "raw" => builder.body(request.body.clone()),
        "form" => {
            let rows: Vec<KeyValueRow> = serde_json::from_str(&request.body)
                .map_err(|e| format!("invalid form body: {}", e))?;
            let form: Vec<(String, String)> = rows
                .into_iter()
                .filter(|row| row.enabled && !row.key.trim().is_empty())
                .map(|row| (row.key, row.value))
                .collect();
            builder.form(&form)
        }
        other => return Err(format!("unsupported body type: {}", other)),
    };

    let response = builder.send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .map(|(key, value)| KeyValueRow {
            enabled: true,
            key: key.to_string(),
            value: value.to_str().unwrap_or("").to_string(),
        })
        .collect::<Vec<_>>();
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    let body_truncated = bytes.len() > MAX_RESPONSE_BODY_BYTES;
    let body_bytes = if body_truncated {
        &bytes[..MAX_RESPONSE_BODY_BYTES]
    } else {
        &bytes[..]
    };
    let body = String::from_utf8_lossy(body_bytes).to_string();
    Ok(ExecutedResponse {
        status,
        headers,
        body,
        body_truncated,
    })
}

pub fn parse_curl_command(command: &str) -> Result<CurlRequestInput, String> {
    let tokens = tokenize_curl(command)?;
    if tokens.is_empty() {
        return Err("curl command is empty".into());
    }
    if tokens[0] != "curl" {
        return Err("command must start with curl".into());
    }

    let mut method: Option<String> = None;
    let mut url: Option<String> = None;
    let mut headers = Vec::new();
    let mut body = String::new();
    let mut body_type = "none".to_string();
    let mut data_values = Vec::new();
    let mut use_get_data = false;
    let mut i = 1;

    while i < tokens.len() {
        let token = &tokens[i];
        match token.as_str() {
            "-X" | "--request" => {
                i += 1;
                method = Some(next_token(&tokens, i, token)?.to_uppercase());
            }
            flag if flag.starts_with("-X") && flag.len() > 2 => {
                method = Some(flag[2..].to_uppercase());
            }
            "-H" | "--header" => {
                i += 1;
                headers.push(parse_header(next_token(&tokens, i, token)?)?);
            }
            flag if flag.starts_with("-H") && flag.len() > 2 => {
                headers.push(parse_header(&flag[2..])?);
            }
            "-d" | "--data" | "--data-raw" | "--data-binary" | "--data-ascii" => {
                i += 1;
                data_values.push(next_token(&tokens, i, token)?.to_string());
            }
            flag if flag.starts_with("-d") && flag.len() > 2 => {
                data_values.push(flag[2..].to_string());
            }
            "--url" => {
                i += 1;
                url = Some(next_token(&tokens, i, token)?.to_string());
            }
            "-G" | "--get" => {
                use_get_data = true;
            }
            "-F" | "--form" | "--form-string" => {
                return Err("multipart form upload is not supported in this version".into());
            }
            "--compressed" | "-s" | "-S" | "-L" | "--location" | "-i" | "--include" => {}
            flag if flag.starts_with('-') => {
                if flag_requires_value(flag) {
                    i += 1;
                    let _ = next_token(&tokens, i, token)?;
                }
            }
            value => {
                if url.is_none() {
                    url = Some(value.to_string());
                }
            }
        }
        i += 1;
    }

    if !data_values.is_empty() {
        body = data_values.join("&");
        body_type = infer_body_type(&headers, &body);
        if method.is_none() && !use_get_data {
            method = Some("POST".into());
        }
    }

    let mut url = url.ok_or_else(|| "curl command is missing a URL".to_string())?;
    let query = Vec::new();
    if use_get_data && !data_values.is_empty() {
        append_query_data(&mut url, &data_values.join("&"))?;
    }
    Ok(CurlRequestInput {
        method: method.unwrap_or_else(|| "GET".into()),
        url,
        headers,
        query,
        body_type,
        body,
    })
}

pub fn export_curl_command(request: CurlRequestInput) -> Result<String, String> {
    let url = build_url_string(&request.url, &request.query)?;
    let mut lines = vec![format!(
        "curl -X {} '{}'",
        request.method.to_uppercase(),
        shell_single_quote_inner(&url)
    )];
    for header in request
        .headers
        .iter()
        .filter(|row| row.enabled && !row.key.trim().is_empty())
    {
        lines.push(format!(
            "  -H '{}'",
            shell_single_quote_inner(&format!("{}: {}", header.key.trim(), header.value))
        ));
    }
    if request.body_type != "none" && !request.body.is_empty() {
        lines.push(format!(
            "  --data-raw '{}'",
            shell_single_quote_inner(&request.body)
        ));
    }
    Ok(lines.join(" \\\n"))
}

fn tokenize_curl(command: &str) -> Result<Vec<String>, String> {
    let normalized = command.replace("\\\r\n", " ").replace("\\\n", " ");
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut chars = normalized.chars().peekable();
    let mut quote: Option<char> = None;

    while let Some(ch) = chars.next() {
        match quote {
            Some(q) => {
                if ch == q {
                    quote = None;
                } else if q == '"' && ch == '\\' {
                    if let Some(next) = chars.next() {
                        current.push(next);
                    }
                } else {
                    current.push(ch);
                }
            }
            None => {
                if ch == '\'' || ch == '"' {
                    quote = Some(ch);
                } else if ch.is_whitespace() {
                    if !current.is_empty() {
                        tokens.push(std::mem::take(&mut current));
                    }
                } else if ch == '\\' {
                    if let Some(next) = chars.next() {
                        current.push(next);
                    }
                } else {
                    current.push(ch);
                }
            }
        }
    }

    if let Some(q) = quote {
        return Err(format!("unterminated {} quote", q));
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    Ok(tokens)
}

fn next_token<'a>(tokens: &'a [String], index: usize, flag: &str) -> Result<&'a str, String> {
    tokens
        .get(index)
        .map(|token| token.as_str())
        .ok_or_else(|| format!("{} requires a value", flag))
}

fn parse_header(value: &str) -> Result<KeyValueRow, String> {
    let Some((key, value)) = value.split_once(':') else {
        return Err(format!("invalid header: {}", value));
    };
    Ok(KeyValueRow {
        enabled: true,
        key: key.trim().to_string(),
        value: value.trim().to_string(),
    })
}

fn infer_body_type(headers: &[KeyValueRow], body: &str) -> String {
    let content_type = headers
        .iter()
        .find(|header| header.key.eq_ignore_ascii_case("content-type"))
        .map(|header| header.value.to_lowercase())
        .unwrap_or_default();
    if content_type.contains("application/json") || body.trim_start().starts_with('{') {
        "json".into()
    } else if content_type.contains("application/x-www-form-urlencoded") {
        "form".into()
    } else {
        "raw".into()
    }
}

fn flag_requires_value(flag: &str) -> bool {
    matches!(
        flag,
        "-A" | "--user-agent" | "-u" | "--user" | "-b" | "--cookie" | "-o" | "--output"
    )
}

fn append_query_data(url: &mut String, data: &str) -> Result<(), String> {
    if data.is_empty() {
        return Ok(());
    }
    let separator = if url.contains('?') { '&' } else { '?' };
    url.push(separator);
    url.push_str(data);
    Ok(())
}

fn build_url_string(base_url: &str, query: &[KeyValueRow]) -> Result<String, String> {
    if base_url.trim().is_empty() {
        return Err("URL is required".into());
    }
    let enabled: Vec<&KeyValueRow> = query
        .iter()
        .filter(|row| row.enabled && !row.key.trim().is_empty())
        .collect();
    if enabled.is_empty() {
        return Ok(base_url.to_string());
    }
    let separator = if base_url.contains('?') { '&' } else { '?' };
    let query_string = enabled
        .iter()
        .map(|row| {
            if row.value.is_empty() {
                row.key.trim().to_string()
            } else {
                format!("{}={}", row.key.trim(), row.value)
            }
        })
        .collect::<Vec<_>>()
        .join("&");
    Ok(format!("{}{}{}", base_url, separator, query_string))
}

fn build_request_url(request: &CurlRequestInput) -> Result<url::Url, String> {
    let combined = build_url_string(&request.url, &request.query)?;
    url::Url::parse(&combined).map_err(|e| format!("invalid URL: {}", e))
}

fn validate_name(name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("name is required".into());
    }
    if name.chars().count() > 120 {
        return Err("name is too long".into());
    }
    Ok(())
}

fn validate_method(method: &str) -> Result<(), String> {
    let allowed = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
    let method = method.to_uppercase();
    if allowed.contains(&method.as_str()) {
        Ok(())
    } else {
        Err(format!("unsupported method: {}", method))
    }
}

fn imported_name_from_url(value: &str) -> String {
    if let Ok(url) = url::Url::parse(value) {
        let path = url.path().trim_matches('/');
        if path.is_empty() {
            url.host_str().unwrap_or("Imported request").to_string()
        } else {
            path.rsplit('/')
                .next()
                .unwrap_or("Imported request")
                .to_string()
        }
    } else {
        "Imported request".into()
    }
}

fn shell_single_quote_inner(value: &str) -> String {
    value.replace('\'', "'\\''")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_post_json_curl() {
        let parsed = parse_curl_command(
            "curl -X POST 'https://api.example.test/users?page=1' -H 'Content-Type: application/json' -H 'Accept: application/json' --data-raw '{\"name\":\"Jean\"}'"
        ).unwrap();

        assert_eq!(parsed.method, "POST");
        assert_eq!(parsed.url, "https://api.example.test/users?page=1");
        assert_eq!(parsed.body_type, "json");
        assert_eq!(parsed.body, "{\"name\":\"Jean\"}");
        assert!(parsed
            .headers
            .iter()
            .any(|h| h.key == "Content-Type" && h.value == "application/json"));
    }

    #[test]
    fn rejects_multipart_file_upload_for_mvp() {
        let err = parse_curl_command("curl -F 'file=@/tmp/a.png' https://example.test/upload")
            .unwrap_err();
        assert!(err.contains("multipart"));
    }

    #[test]
    fn exports_request_to_reusable_curl() {
        let request = CurlRequestInput {
            method: "POST".into(),
            url: "https://api.example.test/users".into(),
            headers: vec![KeyValueRow {
                enabled: true,
                key: "Content-Type".into(),
                value: "application/json".into(),
            }],
            query: vec![KeyValueRow {
                enabled: true,
                key: "page".into(),
                value: "1".into(),
            }],
            body_type: "json".into(),
            body: "{\"name\":\"Jean\"}".into(),
        };

        let command = export_curl_command(request).unwrap();

        assert!(command.contains("curl"));
        assert!(command.contains("-X POST"));
        assert!(command.contains("Content-Type: application/json"));
        assert!(command.contains("page=1"));
        assert!(command.contains("--data-raw"));
    }

    #[test]
    fn builds_url_with_enabled_query_params_only() {
        let input = CurlRequestInput {
            method: "GET".into(),
            url: "https://api.example.test/users".into(),
            headers: vec![],
            query: vec![
                KeyValueRow {
                    enabled: true,
                    key: "page".into(),
                    value: "1".into(),
                },
                KeyValueRow {
                    enabled: false,
                    key: "ignored".into(),
                    value: "yes".into(),
                },
            ],
            body_type: "none".into(),
            body: String::new(),
        };

        let url = build_request_url(&input).unwrap();

        assert_eq!(url.as_str(), "https://api.example.test/users?page=1");
    }
}
