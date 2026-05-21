use arboard::Clipboard;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

use super::clipboard_db::{ClipboardDb, DbClipboardEntry};

const POLL_INTERVAL_MS: u64 = 500;

// ─── 状态管理 ───

pub struct ClipboardState {
    pub db: Arc<ClipboardDb>,
    last_text: Arc<Mutex<String>>,
    last_image_hash: Arc<Mutex<u64>>,
    last_file_paths: Arc<Mutex<String>>,
    cache_dir: PathBuf,
    pub main_was_focused: Arc<Mutex<bool>>,
    pub previous_frontmost_app_pid: Arc<Mutex<Option<i32>>>,
}

impl ClipboardState {
    /// 使用 AppHandle 获取应用数据与缓存路径
    pub fn new(app: &AppHandle) -> Self {
        let data_dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| std::env::temp_dir().join("nimbletools"));
        let _ = std::fs::create_dir_all(&data_dir);

        let cache_dir = app
            .path()
            .app_cache_dir()
            .unwrap_or_else(|_| std::env::temp_dir().join("nimbletools"))
            .join("clipboard_cache");
        let _ = std::fs::create_dir_all(&cache_dir);

        let db_path = data_dir.join("clipboard.db");
        let db = ClipboardDb::open(&db_path).expect("Failed to open clipboard database");

        Self {
            db: Arc::new(db),
            last_text: Arc::new(Mutex::new(String::new())),
            last_image_hash: Arc::new(Mutex::new(0)),
            last_file_paths: Arc::new(Mutex::new(String::new())),
            cache_dir,
            main_was_focused: Arc::new(Mutex::new(false)),
            previous_frontmost_app_pid: Arc::new(Mutex::new(None)),
        }
    }
}

// ─── 后台监控 ───

/// Pastebot 式监控：用 NSPasteboard.changeCount 检测变化，原生 API 读取内容
pub fn start_clipboard_monitor(state: &ClipboardState) {
    let db = state.db.clone();
    let last_text = state.last_text.clone();
    let last_image_hash = state.last_image_hash.clone();
    let last_file_paths = state.last_file_paths.clone();
    let cache_dir = state.cache_dir.clone();

    std::thread::spawn(move || {
        #[cfg(target_os = "macos")]
        let mut last_change_count: isize = pasteboard_native::get_change_count();

        loop {
            std::thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));

            #[cfg(target_os = "macos")]
            {
                let current_count = pasteboard_native::get_change_count();
                if current_count == last_change_count {
                    continue;
                }
                last_change_count = current_count;
            }

            let now = now_secs();

            // 1. 检测文件
            if let Some(files) = clipboard_files::get_file_urls() {
                let key = serde_json::to_string(&files).unwrap_or_default();
                let mut last = last_file_paths.lock().unwrap();
                if *last != key {
                    *last = key;
                    drop(last);
                    *last_text.lock().unwrap() = String::new();
                    *last_image_hash.lock().unwrap() = 0;

                    let preview = if files.len() == 1 {
                        file_name_from_path(&files[0])
                    } else {
                        format!("{} 个文件", files.len())
                    };
                    let content = serde_json::to_string(&files).unwrap_or_default();
                    let _ = db.insert("files", &content, &preview, now);
                    continue;
                }
            }

            // 2. 检测图片
            #[cfg(target_os = "macos")]
            {
                if let Some(raw_bytes) = pasteboard_native::get_image_bytes() {
                    let hash = bytes_hash(&raw_bytes);
                    let mut last = last_image_hash.lock().unwrap();
                    if *last != hash {
                        *last = hash;
                        drop(last);
                        *last_text.lock().unwrap() = String::new();
                        *last_file_paths.lock().unwrap() = String::new();

                        if let Some((path, w, h)) = save_raw_image(&cache_dir, &raw_bytes) {
                            let preview = format!("图片 {}×{}", w, h);
                            if let Ok((_id, purged)) = db.insert("image", &path, &preview, now) {
                                cleanup_image_files(&purged, &cache_dir);
                            }
                        }
                        continue;
                    }
                }
            }

            #[cfg(not(target_os = "macos"))]
            {
                if let Some((rgba, width, height)) = get_portable_image() {
                    let hash = bytes_hash(&rgba);
                    let mut last = last_image_hash.lock().unwrap();
                    if *last != hash {
                        *last = hash;
                        drop(last);
                        *last_text.lock().unwrap() = String::new();
                        *last_file_paths.lock().unwrap() = String::new();

                        if let Some((path, w, h)) = save_rgba_image(&cache_dir, width, height, rgba)
                        {
                            let preview = format!("图片 {}×{}", w, h);
                            if let Ok((_id, purged)) = db.insert("image", &path, &preview, now) {
                                cleanup_image_files(&purged, &cache_dir);
                            }
                        }
                        continue;
                    }
                }
            }

            // 3. 检测文本 — 多类型回退读取
            let text = {
                #[cfg(target_os = "macos")]
                {
                    pasteboard_native::get_string()
                }
                #[cfg(not(target_os = "macos"))]
                {
                    get_portable_string()
                }
            };

            if let Some(text) = text {
                if text.is_empty() {
                    continue;
                }
                let mut last = last_text.lock().unwrap();
                if *last == text {
                    continue;
                }
                *last = text.clone();
                drop(last);
                *last_image_hash.lock().unwrap() = 0;
                *last_file_paths.lock().unwrap() = String::new();

                let (content, preview) = prepare_text_history_entry(&text);
                let _ = db.insert("text", &content, &preview, now);
            }
        }
    });
}

// ─── API 命令 ───

#[derive(Serialize)]
pub struct ClipboardHistoryResponse {
    pub entries: Vec<DbClipboardEntry>,
    pub max_history: usize,
}

#[tauri::command]
pub fn get_clipboard_history(state: State<'_, ClipboardState>) -> ClipboardHistoryResponse {
    let max = state.db.get_max_history();
    ClipboardHistoryResponse {
        entries: state.db.list(max),
        max_history: max,
    }
}

#[tauri::command]
pub fn clear_clipboard_history(state: State<'_, ClipboardState>) {
    let purged = state.db.clear_all();
    cleanup_image_files(&purged, &state.cache_dir);
}

#[tauri::command]
pub fn remove_clipboard_item(state: State<'_, ClipboardState>, id: i64) {
    if let Some((content_type, content)) = state.db.remove(id) {
        if content_type == "image" {
            cleanup_image_files(&[content], &state.cache_dir);
        }
    }
}

#[tauri::command]
pub fn toggle_pin_clipboard_item(state: State<'_, ClipboardState>, id: i64) -> bool {
    state.db.toggle_pin(id)
}

#[tauri::command]
pub fn set_clipboard_max_history(state: State<'_, ClipboardState>, max: usize) {
    state.db.set_setting("max_history", &max.to_string());
}

/// 安全清理图片缓存文件
/// 安全措施：1) 路径必须在 cache_dir 内 2) 文件名必须匹配 clip_*.png 3) 只删文件不删目录
fn cleanup_image_files(paths: &[String], cache_dir: &PathBuf) {
    use std::path::Path;

    for path_str in paths {
        let path = Path::new(path_str);

        // 安全校验 1：必须在预期缓存目录内
        if !path.starts_with(cache_dir) {
            eprintln!("[Cleanup] SKIP: path outside cache_dir: {}", path_str);
            continue;
        }

        // 安全校验 2：文件名必须匹配 clip_*.png
        let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !file_name.starts_with("clip_") || !file_name.ends_with(".png") {
            eprintln!("[Cleanup] SKIP: unexpected filename: {}", file_name);
            continue;
        }

        // 安全校验 3：必须是文件不是目录
        if path.is_file() {
            match std::fs::remove_file(path) {
                Ok(()) => println!("[Cleanup] Deleted: {}", file_name),
                Err(e) => eprintln!("[Cleanup] Failed to delete {}: {}", file_name, e),
            }
        }
    }
}

#[tauri::command]
pub fn write_to_clipboard(text: String, state: State<'_, ClipboardState>) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(&text).map_err(|e| e.to_string())?;
    if let Ok(mut last) = state.last_text.lock() {
        *last = text;
    }
    Ok(())
}

fn write_clipboard_item(
    clipboard: &mut Clipboard,
    state: &ClipboardState,
    content_type: &str,
    content: &str,
) -> Result<(), String> {
    match content_type {
        "text" => {
            clipboard.set_text(content).map_err(|e| e.to_string())?;
            *state.last_text.lock().unwrap() = content.to_string();
        }
        "image" => {
            let img = image::open(content).map_err(|e| e.to_string())?;
            let rgba = img.to_rgba8();
            let (w, h) = rgba.dimensions();
            clipboard
                .set_image(arboard::ImageData {
                    width: w as usize,
                    height: h as usize,
                    bytes: std::borrow::Cow::Owned(rgba.into_raw()),
                })
                .map_err(|e| e.to_string())?;
            *state.last_image_hash.lock().unwrap() = 0;
        }
        "files" => {
            clipboard_files::set_file_urls(content)?;
            *state.last_file_paths.lock().unwrap() = content.to_string();
        }
        _ => return Err(format!("Unknown content type: {}", content_type)),
    }

    if state.db.find_by_content(content).is_some() {
        let _ = state.db.insert(content_type, content, "", now_secs());
    }

    Ok(())
}

#[tauri::command]
pub fn copy_clipboard_item(
    content_type: String,
    content: String,
    state: State<'_, ClipboardState>,
) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    write_clipboard_item(&mut clipboard, state.inner(), &content_type, &content)
}

#[tauri::command]
pub fn copy_image_to_clipboard(
    width: usize,
    height: usize,
    rgba_data: Vec<u8>,
) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    let img = arboard::ImageData {
        width,
        height,
        bytes: std::borrow::Cow::Owned(rgba_data),
    };
    clipboard.set_image(img).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationPoint {
    x: f64,
    y: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotAnnotation {
    #[serde(rename = "type")]
    kind: String,
    color: String,
    line_width: f64,
    points: Option<Vec<AnnotationPoint>>,
    start_x: Option<f64>,
    start_y: Option<f64>,
    end_x: Option<f64>,
    end_y: Option<f64>,
    text: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotTextPatch {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    rgba_data: Vec<u8>,
}

#[tauri::command]
pub fn copy_annotated_screenshot_to_clipboard(
    source_path: String,
    actions: Vec<ScreenshotAnnotation>,
    text_patches: Option<Vec<ScreenshotTextPatch>>,
) -> Result<(), String> {
    let (width, height, rgba_data) =
        render_screenshot_annotations(&source_path, &actions, text_patches.as_deref())?;
    copy_image_to_clipboard(width, height, rgba_data)
}

fn render_screenshot_annotations(
    source_path: &str,
    actions: &[ScreenshotAnnotation],
    text_patches: Option<&[ScreenshotTextPatch]>,
) -> Result<(usize, usize, Vec<u8>), String> {
    let has_text = actions
        .iter()
        .any(|action| action.kind == "text" || action.text.is_some());
    let text_patches = text_patches.unwrap_or(&[]);
    if has_text && text_patches.is_empty() {
        return Err("Text annotations require text patches".into());
    }

    let mut image = image::open(source_path)
        .map_err(|e| format!("Failed to open screenshot: {}", e))?
        .to_rgba8();
    let width = image.width();
    let height = image.height();

    let mut text_patch_iter = text_patches.iter();
    for action in actions {
        if action.kind == "text" || action.text.is_some() {
            if let Some(patch) = text_patch_iter.next() {
                overlay_text_patch(&mut image, patch)?;
            }
        } else {
            draw_screenshot_annotation(&mut image, action);
        }
    }

    Ok((width as usize, height as usize, image.into_raw()))
}

fn overlay_text_patch(
    image: &mut image::RgbaImage,
    patch: &ScreenshotTextPatch,
) -> Result<(), String> {
    let expected_len = patch.width as usize * patch.height as usize * 4;
    if patch.rgba_data.len() != expected_len {
        return Err(format!(
            "Invalid text patch RGBA buffer length: expected {}, got {}",
            expected_len,
            patch.rgba_data.len()
        ));
    }

    for patch_y in 0..patch.height {
        let target_y = patch.y.saturating_add(patch_y);
        if target_y >= image.height() {
            continue;
        }
        for patch_x in 0..patch.width {
            let target_x = patch.x.saturating_add(patch_x);
            if target_x >= image.width() {
                continue;
            }
            let idx = ((patch_y * patch.width + patch_x) * 4) as usize;
            let alpha = patch.rgba_data[idx + 3] as f32 / 255.0;
            if alpha <= 0.0 {
                continue;
            }
            let dst = image.get_pixel_mut(target_x, target_y);
            for channel in 0..3 {
                dst.0[channel] = (patch.rgba_data[idx + channel] as f32 * alpha
                    + dst.0[channel] as f32 * (1.0 - alpha))
                    .round() as u8;
            }
            dst.0[3] = 255;
        }
    }

    Ok(())
}

fn draw_screenshot_annotation(image: &mut image::RgbaImage, action: &ScreenshotAnnotation) {
    let Some(color) = parse_hex_rgba(&action.color) else {
        return;
    };
    let line_width = action.line_width.max(1.0).round() as i32;

    match action.kind.as_str() {
        "pen" => {
            if let Some(points) = &action.points {
                for pair in points.windows(2) {
                    draw_line(
                        image, pair[0].x, pair[0].y, pair[1].x, pair[1].y, line_width, color,
                    );
                }
            }
        }
        "rect" => {
            if let Some((x1, y1, x2, y2)) = action_bounds(action) {
                draw_line(image, x1, y1, x2, y1, line_width, color);
                draw_line(image, x2, y1, x2, y2, line_width, color);
                draw_line(image, x2, y2, x1, y2, line_width, color);
                draw_line(image, x1, y2, x1, y1, line_width, color);
            }
        }
        "circle" => {
            if let Some((x1, y1, x2, y2)) = action_bounds(action) {
                draw_ellipse_outline(image, x1, y1, x2, y2, line_width, color);
            }
        }
        "arrow" | "line" => {
            if let Some((x1, y1, x2, y2)) = action_bounds(action) {
                draw_line(image, x1, y1, x2, y2, line_width, color);
                if action.kind == "arrow" {
                    draw_arrow_head(image, x1, y1, x2, y2, line_width, color);
                }
            }
        }
        "text" => {}
        _ => {}
    }
}

fn action_bounds(action: &ScreenshotAnnotation) -> Option<(f64, f64, f64, f64)> {
    Some((
        action.start_x?,
        action.start_y?,
        action.end_x?,
        action.end_y?,
    ))
}

fn parse_hex_rgba(color: &str) -> Option<image::Rgba<u8>> {
    let hex = color.strip_prefix('#')?;
    if hex.len() != 6 {
        return None;
    }

    let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
    let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
    let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
    Some(image::Rgba([r, g, b, 255]))
}

fn draw_line(
    image: &mut image::RgbaImage,
    x1: f64,
    y1: f64,
    x2: f64,
    y2: f64,
    line_width: i32,
    color: image::Rgba<u8>,
) {
    let dx = x2 - x1;
    let dy = y2 - y1;
    let steps = dx.abs().max(dy.abs()).ceil().max(1.0) as i32;

    for i in 0..=steps {
        let t = i as f64 / steps as f64;
        let x = x1 + dx * t;
        let y = y1 + dy * t;
        draw_brush(image, x.round() as i32, y.round() as i32, line_width, color);
    }
}

fn draw_arrow_head(
    image: &mut image::RgbaImage,
    from_x: f64,
    from_y: f64,
    to_x: f64,
    to_y: f64,
    line_width: i32,
    color: image::Rgba<u8>,
) {
    let head_len = line_width as f64 * 4.0;
    let angle = (to_y - from_y).atan2(to_x - from_x);
    let left_x = to_x - head_len * (angle - std::f64::consts::PI / 6.0).cos();
    let left_y = to_y - head_len * (angle - std::f64::consts::PI / 6.0).sin();
    let right_x = to_x - head_len * (angle + std::f64::consts::PI / 6.0).cos();
    let right_y = to_y - head_len * (angle + std::f64::consts::PI / 6.0).sin();

    draw_line(image, to_x, to_y, left_x, left_y, line_width, color);
    draw_line(image, to_x, to_y, right_x, right_y, line_width, color);
}

fn draw_ellipse_outline(
    image: &mut image::RgbaImage,
    x1: f64,
    y1: f64,
    x2: f64,
    y2: f64,
    line_width: i32,
    color: image::Rgba<u8>,
) {
    let rx = (x2 - x1).abs() / 2.0;
    let ry = (y2 - y1).abs() / 2.0;
    if rx <= 0.0 || ry <= 0.0 {
        return;
    }

    let cx = x1 + (x2 - x1) / 2.0;
    let cy = y1 + (y2 - y1) / 2.0;
    let circumference = 2.0 * std::f64::consts::PI * rx.max(ry);
    let steps = circumference.ceil().max(24.0) as i32;
    let mut prev = None;

    for i in 0..=steps {
        let theta = i as f64 / steps as f64 * std::f64::consts::PI * 2.0;
        let x = cx + rx * theta.cos();
        let y = cy + ry * theta.sin();
        if let Some((prev_x, prev_y)) = prev {
            draw_line(image, prev_x, prev_y, x, y, line_width, color);
        }
        prev = Some((x, y));
    }
}

fn draw_brush(
    image: &mut image::RgbaImage,
    center_x: i32,
    center_y: i32,
    line_width: i32,
    color: image::Rgba<u8>,
) {
    let radius = (line_width / 2).max(1);
    let radius_squared = radius * radius;

    for y in center_y - radius..=center_y + radius {
        for x in center_x - radius..=center_x + radius {
            if (x - center_x).pow(2) + (y - center_y).pow(2) > radius_squared {
                continue;
            }
            if x < 0 || y < 0 {
                continue;
            }
            let (x, y) = (x as u32, y as u32);
            if x < image.width() && y < image.height() {
                image.put_pixel(x, y, color);
            }
        }
    }
}

/// 检查辅助功能权限（前端可调用，用于引导 UI）
#[tauri::command]
pub fn check_accessibility_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        platform::is_accessibility_granted()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// 打开系统辅助功能设置页面
#[tauri::command]
pub fn open_accessibility_settings() {
    #[cfg(target_os = "macos")]
    platform::open_accessibility_settings();
}

/// 粘贴条目（文本/图片/文件）
#[tauri::command]
pub fn paste_clipboard_item(
    content_type: String,
    content: String,
    app: tauri::AppHandle,
    state: State<'_, ClipboardState>,
) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    write_clipboard_item(&mut clipboard, state.inner(), &content_type, &content)?;

    // 隐藏弹窗 + 模拟粘贴。保留 WebView 以避免下次唤起重新加载样式和 React。
    let main_was_focused = *state.main_was_focused.lock().unwrap();
    let previous_app_pid = *state.previous_frontmost_app_pid.lock().unwrap();
    let focus_action =
        paste_focus_action_before_simulated_paste(main_was_focused, previous_app_pid);
    let ui_transition_done =
        schedule_clipboard_paste_ui_transition(&app, focus_action).map_err(|e| e.to_string())?;

    std::thread::spawn(move || {
        let _ = ui_transition_done.recv_timeout(Duration::from_millis(180));
        std::thread::sleep(Duration::from_millis(
            paste_delay_before_simulated_paste_ms(focus_action),
        ));
        platform::simulate_paste();
    });
    Ok(())
}

#[derive(Debug, Clone, Copy)]
enum PasteFocusAction {
    FocusMain,
    ReturnToPreviousApp { pid: Option<i32> },
}

fn paste_focus_action_before_simulated_paste(
    main_was_focused: bool,
    previous_app_pid: Option<i32>,
) -> PasteFocusAction {
    if main_was_focused {
        PasteFocusAction::FocusMain
    } else {
        PasteFocusAction::ReturnToPreviousApp {
            pid: previous_app_pid,
        }
    }
}

fn paste_delay_before_simulated_paste_ms(action: PasteFocusAction) -> u64 {
    match action {
        PasteFocusAction::FocusMain => 60,
        PasteFocusAction::ReturnToPreviousApp { .. } => 120,
    }
}

fn schedule_clipboard_paste_ui_transition(
    app: &AppHandle,
    action: PasteFocusAction,
) -> tauri::Result<mpsc::Receiver<()>> {
    let (done_tx, done_rx) = mpsc::channel();
    let app_for_ui = app.clone();
    app.run_on_main_thread(move || {
        apply_clipboard_paste_ui_transition(&app_for_ui, action);
        let _ = done_tx.send(());
    })?;
    Ok(done_rx)
}

fn apply_clipboard_paste_ui_transition(app: &AppHandle, action: PasteFocusAction) {
    crate::commands::hotkey::hide_clipboard_popup_window(app);

    match action {
        PasteFocusAction::FocusMain => {
            if let Some(main_win) = app.get_webview_window("main") {
                let _ = main_win.show();
                let _ = main_win.set_focus();
            }
        }
        PasteFocusAction::ReturnToPreviousApp { pid } => {
            let restored = pid.map(platform::activate_app_by_pid).unwrap_or(false);
            if !restored {
                platform::deactivate_app();
            }
        }
    }
}

#[tauri::command]
pub fn close_clipboard_popup(app: tauri::AppHandle, state: State<'_, ClipboardState>) {
    let _ = state;
    crate::commands::hotkey::hide_clipboard_popup(&app);
}

#[tauri::command]
pub fn show_clipboard_popup(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("clipboard-popup") {
        crate::commands::hotkey::show_and_focus_clipboard_popup(&window);
    }
}

// ─── 工具函数 ───

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

/// 安全截断字符串，避免切到 UTF-8 多字节字符中间
fn safe_truncate(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    // 找到不超过 max_bytes 的最后一个字符边界
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

fn truncate_preview(text: &str, max: usize) -> String {
    let single = text
        .replace('\n', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if single.len() > max {
        let truncated = safe_truncate(&single, max);
        format!("{}…", truncated)
    } else {
        single
    }
}

fn prepare_text_history_entry(text: &str) -> (String, String) {
    let content = text.to_string();
    let preview = truncate_preview(text, 120);
    (content, preview)
}

fn file_name_from_path(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

fn bytes_hash(data: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    data.len().hash(&mut hasher);
    let sample = data.len().min(4096);
    data[..sample].hash(&mut hasher);
    hasher.finish()
}

/// 保存原始图片数据（TIFF/PNG），转为 PNG 并返回 (路径, 宽, 高)
fn save_raw_image(cache_dir: &PathBuf, raw: &[u8]) -> Option<(String, u32, u32)> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let path = cache_dir.join(format!("clip_{}.png", ts));

    // 用 image crate 自动检测格式（TIFF/PNG/JPEG 都支持）
    let img = image::load_from_memory(raw).ok()?;
    let (w, h) = (img.width(), img.height());
    img.save(&path).ok()?;
    Some((path.to_string_lossy().to_string(), w, h))
}

#[cfg(any(not(target_os = "macos"), test))]
fn save_rgba_image(
    cache_dir: &PathBuf,
    width: usize,
    height: usize,
    rgba: Vec<u8>,
) -> Option<(String, u32, u32)> {
    if width == 0 || height == 0 || rgba.len() != width.checked_mul(height)?.checked_mul(4)? {
        return None;
    }

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis();
    let path = cache_dir.join(format!("clip_{}.png", ts));
    let img = image::RgbaImage::from_raw(width as u32, height as u32, rgba)?;
    img.save(&path).ok()?;
    Some((
        path.to_string_lossy().to_string(),
        width as u32,
        height as u32,
    ))
}

#[cfg(not(target_os = "macos"))]
fn get_portable_string() -> Option<String> {
    let mut clipboard = Clipboard::new().ok()?;
    clipboard.get_text().ok()
}

#[cfg(not(target_os = "macos"))]
fn get_portable_image() -> Option<(Vec<u8>, usize, usize)> {
    let mut clipboard = Clipboard::new().ok()?;
    let image = clipboard.get_image().ok()?;
    Some((image.bytes.into_owned(), image.width, image.height))
}

#[cfg(test)]
mod tests {
    use super::{
        paste_delay_before_simulated_paste_ms, paste_focus_action_before_simulated_paste,
        prepare_text_history_entry, render_screenshot_annotations, save_rgba_image,
        PasteFocusAction, ScreenshotAnnotation, ScreenshotTextPatch,
    };
    use crate::commands::clipboard_db::ClipboardDb;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn save_rgba_image_rejects_mismatched_pixel_buffer() {
        let dir = std::env::temp_dir();

        let saved = save_rgba_image(&dir, 2, 2, vec![255, 0, 0, 255]);

        assert!(saved.is_none());
    }

    #[test]
    fn render_screenshot_annotations_draws_line_on_source_image() {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "nimbletools_annotation_test_{}.png",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let img = image::RgbaImage::from_pixel(5, 5, image::Rgba([255, 255, 255, 255]));
        img.save(&path).unwrap();

        let action = ScreenshotAnnotation {
            kind: "line".into(),
            color: "#ef4444".into(),
            line_width: 1.0,
            points: None,
            start_x: Some(0.0),
            start_y: Some(2.0),
            end_x: Some(4.0),
            end_y: Some(2.0),
            text: None,
        };

        let (width, height, rgba) =
            render_screenshot_annotations(&path.to_string_lossy(), &[action], None).unwrap();

        assert_eq!((width, height), (5, 5));
        let center_pixel = &rgba[(2 * 5 + 2) * 4..(2 * 5 + 3) * 4];
        assert_eq!(center_pixel, &[0xef, 0x44, 0x44, 0xff]);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn render_screenshot_annotations_requires_patches_for_text_annotations() {
        let action = ScreenshotAnnotation {
            kind: "text".into(),
            color: "#ef4444".into(),
            line_width: 4.0,
            points: None,
            start_x: Some(0.0),
            start_y: Some(0.0),
            end_x: None,
            end_y: None,
            text: Some("hello".into()),
        };

        let result = render_screenshot_annotations("/missing.png", &[action], None);

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Text annotations require text patches");
    }

    #[test]
    fn render_screenshot_annotations_overlays_text_patch() {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "nimbletools_text_patch_test_{}.png",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let img = image::RgbaImage::from_pixel(4, 4, image::Rgba([255, 255, 255, 255]));
        img.save(&path).unwrap();

        let action = ScreenshotAnnotation {
            kind: "text".into(),
            color: "#000000".into(),
            line_width: 4.0,
            points: None,
            start_x: Some(1.0),
            start_y: Some(1.0),
            end_x: None,
            end_y: None,
            text: Some("A".into()),
        };
        let patch = ScreenshotTextPatch {
            x: 1,
            y: 1,
            width: 2,
            height: 1,
            rgba_data: vec![0, 0, 0, 255, 255, 0, 0, 0],
        };

        let (_, _, rgba) =
            render_screenshot_annotations(&path.to_string_lossy(), &[action], Some(&[patch]))
                .unwrap();

        let first_patch_pixel = &rgba[(4 + 1) * 4..(4 + 2) * 4];
        let second_patch_pixel = &rgba[(4 + 2) * 4..(4 + 3) * 4];
        assert_eq!(first_patch_pixel, &[0, 0, 0, 255]);
        assert_eq!(second_patch_pixel, &[255, 255, 255, 255]);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn text_history_keeps_full_clipboard_text_beyond_previous_byte_limit() {
        let text = format!("  {}\n", "一二三四五六七八九十".repeat(1200));

        let (content, preview) = prepare_text_history_entry(&text);

        assert_eq!(content, text);
        assert!(preview.len() <= 123);
    }

    #[test]
    fn db_round_trip_keeps_full_text_history_content() {
        let mut db_path = std::env::temp_dir();
        db_path.push(format!(
            "nimbletools_clipboard_test_{}.db",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let db = ClipboardDb::open(&db_path).unwrap();
        let text = "A".repeat(11_251);
        let (content, preview) = prepare_text_history_entry(&text);

        db.insert("text", &content, &preview, 1).unwrap();
        let entries = db.list(10);

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].content.len(), 11_251);
        assert_eq!(entries[0].content, text);

        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn history_paste_focuses_main_only_when_main_was_original_target() {
        assert!(matches!(
            paste_focus_action_before_simulated_paste(true, Some(123)),
            PasteFocusAction::FocusMain
        ));
        assert!(matches!(
            paste_focus_action_before_simulated_paste(false, Some(123)),
            PasteFocusAction::ReturnToPreviousApp { pid: Some(123) }
        ));
        assert!(matches!(
            paste_focus_action_before_simulated_paste(false, None),
            PasteFocusAction::ReturnToPreviousApp { pid: None }
        ));
    }

    #[test]
    fn history_paste_keeps_short_focus_transition_delays() {
        assert_eq!(
            paste_delay_before_simulated_paste_ms(PasteFocusAction::FocusMain),
            60
        );
        assert_eq!(
            paste_delay_before_simulated_paste_ms(PasteFocusAction::ReturnToPreviousApp {
                pid: Some(123),
            }),
            120
        );
    }
}

// ─── 原生 NSPasteboard 读取（Pastebot 方案） ───

mod pasteboard_native {
    use std::ffi::c_void;

    type Id = *mut c_void;

    extern "C" {
        fn objc_getClass(name: *const u8) -> Id;
        fn sel_registerName(name: *const u8) -> Id;
        fn objc_msgSend();
    }

    type Fn0 = unsafe extern "C" fn(Id, Id) -> Id;
    type Fn1 = unsafe extern "C" fn(Id, Id, Id) -> Id;
    type FnInt = unsafe extern "C" fn(Id, Id) -> isize;

    /// 获取剪贴板变化计数
    pub fn get_change_count() -> isize {
        #[cfg(target_os = "macos")]
        unsafe {
            let s0: Fn0 = std::mem::transmute(objc_msgSend as *const ());
            let si: FnInt = std::mem::transmute(objc_msgSend as *const ());
            let pb = s0(
                objc_getClass(b"NSPasteboard\0".as_ptr()),
                sel_registerName(b"generalPasteboard\0".as_ptr()),
            );
            si(pb, sel_registerName(b"changeCount\0".as_ptr()))
        }
        #[cfg(not(target_os = "macos"))]
        0
    }

    /// 尝试多种类型读取文本（兼容微信等各种来源）
    pub fn get_string() -> Option<String> {
        #[cfg(target_os = "macos")]
        return macos_get_string();
        #[cfg(not(target_os = "macos"))]
        return None;
    }

    /// 原生读取剪贴板图片原始数据（TIFF/PNG 格式）
    pub fn get_image_bytes() -> Option<Vec<u8>> {
        #[cfg(target_os = "macos")]
        return macos_get_image_bytes();
        #[cfg(not(target_os = "macos"))]
        return None;
    }

    #[cfg(target_os = "macos")]
    fn macos_get_string() -> Option<String> {
        // 微信等应用可能只写入部分类型，按优先级依次尝试
        const TEXT_TYPES: &[&[u8]] = &[
            b"public.utf8-plain-text\0",  // NSPasteboardTypeString（标准纯文本）
            b"NSStringPboardType\0",      // 旧版类型（部分应用仍使用）
            b"public.utf16-plain-text\0", // UTF-16 文本
        ];

        unsafe {
            let s0: Fn0 = std::mem::transmute(objc_msgSend as *const ());
            let s1: Fn1 = std::mem::transmute(objc_msgSend as *const ());

            let pb = s0(
                objc_getClass(b"NSPasteboard\0".as_ptr()),
                sel_registerName(b"generalPasteboard\0".as_ptr()),
            );
            let ns_str_cls = objc_getClass(b"NSString\0".as_ptr());
            let str_sel = sel_registerName(b"stringWithUTF8String:\0".as_ptr());
            let for_type_sel = sel_registerName(b"stringForType:\0".as_ptr());
            let utf8_sel = sel_registerName(b"UTF8String\0".as_ptr());

            for type_name in TEXT_TYPES {
                let type_str = s1(ns_str_cls, str_sel, type_name.as_ptr() as Id);
                let result = s1(pb, for_type_sel, type_str);
                if result.is_null() {
                    continue;
                }
                let utf8: *const u8 = std::mem::transmute(s0(result, utf8_sel));
                if utf8.is_null() {
                    continue;
                }
                let s = std::ffi::CStr::from_ptr(utf8 as *const i8)
                    .to_string_lossy()
                    .to_string();
                if !s.is_empty() {
                    return Some(s);
                }
            }
            None
        }
    }

    /// 直接从 NSPasteboard 读取图片原始字节（TIFF/PNG）
    #[cfg(target_os = "macos")]
    fn macos_get_image_bytes() -> Option<Vec<u8>> {
        const IMAGE_TYPES: &[&[u8]] = &[b"public.tiff\0", b"public.png\0"];

        unsafe {
            let s0: Fn0 = std::mem::transmute(objc_msgSend as *const ());
            let s1: Fn1 = std::mem::transmute(objc_msgSend as *const ());
            let si: FnInt = std::mem::transmute(objc_msgSend as *const ());

            let pb = s0(
                objc_getClass(b"NSPasteboard\0".as_ptr()),
                sel_registerName(b"generalPasteboard\0".as_ptr()),
            );
            let ns_str_cls = objc_getClass(b"NSString\0".as_ptr());
            let str_sel = sel_registerName(b"stringWithUTF8String:\0".as_ptr());
            let data_sel = sel_registerName(b"dataForType:\0".as_ptr());

            for type_name in IMAGE_TYPES {
                let type_str = s1(ns_str_cls, str_sel, type_name.as_ptr() as Id);
                let data = s1(pb, data_sel, type_str);
                if data.is_null() {
                    continue;
                }

                // NSData -> Vec<u8>
                let length = si(data, sel_registerName(b"length\0".as_ptr())) as usize;
                if length == 0 {
                    continue;
                }
                let bytes_ptr: *const u8 =
                    std::mem::transmute(s0(data, sel_registerName(b"bytes\0".as_ptr())));
                if bytes_ptr.is_null() {
                    continue;
                }
                return Some(std::slice::from_raw_parts(bytes_ptr, length).to_vec());
            }
            None
        }
    }
}

// ─── 文件剪贴板（macOS） ───

pub(crate) mod clipboard_files {
    pub fn get_file_urls() -> Option<Vec<String>> {
        #[cfg(target_os = "macos")]
        return macos_get_file_urls();
        #[cfg(not(target_os = "macos"))]
        return None;
    }

    pub fn set_file_urls(json_paths: &str) -> Result<(), String> {
        let paths: Vec<String> = serde_json::from_str(json_paths).map_err(|e| e.to_string())?;
        #[cfg(target_os = "macos")]
        return macos_set_file_urls(&paths);
        #[cfg(not(target_os = "macos"))]
        {
            let _ = paths;
            Err("Not supported".into())
        }
    }

    #[cfg(target_os = "macos")]
    fn macos_get_file_urls() -> Option<Vec<String>> {
        use std::ffi::c_void;
        type Id = *mut c_void;
        extern "C" {
            fn objc_getClass(name: *const u8) -> Id;
            fn sel_registerName(name: *const u8) -> Id;
            fn objc_msgSend();
        }
        type Fn0 = unsafe extern "C" fn(Id, Id) -> Id;
        type Fn1 = unsafe extern "C" fn(Id, Id, Id) -> Id;
        type FnIdx = unsafe extern "C" fn(Id, Id, usize) -> Id;

        unsafe {
            let s0: Fn0 = std::mem::transmute(objc_msgSend as *const ());
            let s1: Fn1 = std::mem::transmute(objc_msgSend as *const ());
            let si: FnIdx = std::mem::transmute(objc_msgSend as *const ());

            let pb = s0(
                objc_getClass(b"NSPasteboard\0".as_ptr()),
                sel_registerName(b"generalPasteboard\0".as_ptr()),
            );
            let ns_str = objc_getClass(b"NSString\0".as_ptr());
            let type_str = s1(
                ns_str,
                sel_registerName(b"stringWithUTF8String:\0".as_ptr()),
                b"NSFilenamesPboardType\0".as_ptr() as Id,
            );
            let plist = s1(
                pb,
                sel_registerName(b"propertyListForType:\0".as_ptr()),
                type_str,
            );
            if plist.is_null() {
                return None;
            }

            let count: usize =
                std::mem::transmute(s0(plist, sel_registerName(b"count\0".as_ptr())));
            if count == 0 {
                return None;
            }

            let mut paths = Vec::new();
            for i in 0..count {
                let item = si(plist, sel_registerName(b"objectAtIndex:\0".as_ptr()), i);
                let c: *const u8 =
                    std::mem::transmute(s0(item, sel_registerName(b"UTF8String\0".as_ptr())));
                if !c.is_null() {
                    paths.push(
                        std::ffi::CStr::from_ptr(c as *const i8)
                            .to_string_lossy()
                            .to_string(),
                    );
                }
            }
            if paths.is_empty() {
                None
            } else {
                Some(paths)
            }
        }
    }

    #[cfg(target_os = "macos")]
    fn macos_set_file_urls(paths: &[String]) -> Result<(), String> {
        use std::ffi::c_void;
        type Id = *mut c_void;
        extern "C" {
            fn objc_getClass(name: *const u8) -> Id;
            fn sel_registerName(name: *const u8) -> Id;
            fn objc_msgSend();
        }
        type Fn0 = unsafe extern "C" fn(Id, Id) -> Id;
        type Fn1 = unsafe extern "C" fn(Id, Id, Id) -> Id;
        type Fn2 = unsafe extern "C" fn(Id, Id, Id, Id) -> bool;

        unsafe {
            let s0: Fn0 = std::mem::transmute(objc_msgSend as *const ());
            let s1: Fn1 = std::mem::transmute(objc_msgSend as *const ());
            let s2: Fn2 = std::mem::transmute(objc_msgSend as *const ());

            let pb = s0(
                objc_getClass(b"NSPasteboard\0".as_ptr()),
                sel_registerName(b"generalPasteboard\0".as_ptr()),
            );
            s0(pb, sel_registerName(b"clearContents\0".as_ptr()));

            let arr = s0(
                objc_getClass(b"NSMutableArray\0".as_ptr()),
                sel_registerName(b"array\0".as_ptr()),
            );
            let ns_str = objc_getClass(b"NSString\0".as_ptr());
            let str_sel = sel_registerName(b"stringWithUTF8String:\0".as_ptr());
            let add_sel = sel_registerName(b"addObject:\0".as_ptr());

            for p in paths {
                let c = std::ffi::CString::new(p.as_str()).map_err(|e| e.to_string())?;
                s1(arr, add_sel, s1(ns_str, str_sel, c.as_ptr() as Id));
            }

            let type_str = s1(ns_str, str_sel, b"NSFilenamesPboardType\0".as_ptr() as Id);
            if s2(
                pb,
                sel_registerName(b"setPropertyList:forType:\0".as_ptr()),
                arr,
                type_str,
            ) {
                Ok(())
            } else {
                Err("Failed to set file URLs".into())
            }
        }
    }
}

// ─── 平台原生 ───

#[cfg(target_os = "macos")]
pub(crate) mod platform {
    use std::ffi::c_void;
    const KEYCODE_V: u16 = 9;
    const FLAG_CMD: u64 = 1 << 20;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventCreateKeyboardEvent(src: *const c_void, k: u16, down: bool) -> *mut c_void;
        fn CGEventSetFlags(e: *mut c_void, f: u64);
        fn CGEventPost(tap: u32, e: *mut c_void);
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *mut c_void);
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }

    /// 检查是否已获得辅助功能权限
    pub fn is_accessibility_granted() -> bool {
        unsafe { AXIsProcessTrusted() }
    }

    /// 打开系统设置的辅助功能权限页面
    pub fn open_accessibility_settings() {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn();
    }

    /// 模拟 Cmd+V 粘贴（需辅助功能权限，无权限时静默跳过）
    pub fn simulate_paste() {
        if !is_accessibility_granted() {
            eprintln!("[Paste] Accessibility permission not granted, skipping simulate_paste");
            return;
        }
        unsafe {
            let d = CGEventCreateKeyboardEvent(std::ptr::null(), KEYCODE_V, true);
            CGEventSetFlags(d, FLAG_CMD);
            CGEventPost(0, d);
            let u = CGEventCreateKeyboardEvent(std::ptr::null(), KEYCODE_V, false);
            CGEventSetFlags(u, FLAG_CMD);
            CGEventPost(0, u);
            CFRelease(d);
            CFRelease(u);
        }
    }

    pub fn deactivate_app() {
        extern "C" {
            fn objc_getClass(name: *const u8) -> *mut c_void;
            fn sel_registerName(name: *const u8) -> *mut c_void;
            fn objc_msgSend();
        }
        type F0 = unsafe extern "C" fn(*mut c_void, *mut c_void) -> *mut c_void;
        type FVoid = unsafe extern "C" fn(*mut c_void, *mut c_void);
        unsafe {
            let s0: F0 = std::mem::transmute(objc_msgSend as *const ());
            let sv: FVoid = std::mem::transmute(objc_msgSend as *const ());
            let app = s0(
                objc_getClass(b"NSApplication\0".as_ptr()),
                sel_registerName(b"sharedApplication\0".as_ptr()),
            );
            sv(app, sel_registerName(b"deactivate\0".as_ptr()));
        }
    }

    pub fn frontmost_app_pid() -> Option<i32> {
        extern "C" {
            fn objc_getClass(name: *const u8) -> *mut c_void;
            fn sel_registerName(name: *const u8) -> *mut c_void;
            fn objc_msgSend();
        }
        type F0 = unsafe extern "C" fn(*mut c_void, *mut c_void) -> *mut c_void;
        type FI32 = unsafe extern "C" fn(*mut c_void, *mut c_void) -> i32;

        unsafe {
            let s0: F0 = std::mem::transmute(objc_msgSend as *const ());
            let si32: FI32 = std::mem::transmute(objc_msgSend as *const ());
            let workspace = s0(
                objc_getClass(b"NSWorkspace\0".as_ptr()),
                sel_registerName(b"sharedWorkspace\0".as_ptr()),
            );
            if workspace.is_null() {
                return None;
            }

            let app = s0(
                workspace,
                sel_registerName(b"frontmostApplication\0".as_ptr()),
            );
            if app.is_null() {
                return None;
            }

            let pid = si32(app, sel_registerName(b"processIdentifier\0".as_ptr()));
            if pid <= 0 || pid == std::process::id() as i32 {
                None
            } else {
                Some(pid)
            }
        }
    }

    pub fn activate_app_by_pid(pid: i32) -> bool {
        extern "C" {
            fn objc_getClass(name: *const u8) -> *mut c_void;
            fn sel_registerName(name: *const u8) -> *mut c_void;
            fn objc_msgSend();
        }
        type FWithPid = unsafe extern "C" fn(*mut c_void, *mut c_void, i32) -> *mut c_void;
        type FBoolU64 = unsafe extern "C" fn(*mut c_void, *mut c_void, u64) -> bool;
        type FVoid = unsafe extern "C" fn(*mut c_void, *mut c_void);

        const ACTIVATE_ALL_WINDOWS: u64 = 1 << 0;
        const ACTIVATE_IGNORING_OTHER_APPS: u64 = 1 << 1;

        unsafe {
            let app_for_pid: FWithPid = std::mem::transmute(objc_msgSend as *const ());
            let activate: FBoolU64 = std::mem::transmute(objc_msgSend as *const ());
            let unhide: FVoid = std::mem::transmute(objc_msgSend as *const ());

            let running_app = app_for_pid(
                objc_getClass(b"NSRunningApplication\0".as_ptr()),
                sel_registerName(b"runningApplicationWithProcessIdentifier:\0".as_ptr()),
                pid,
            );
            if running_app.is_null() {
                return false;
            }

            unhide(running_app, sel_registerName(b"unhide\0".as_ptr()));
            activate(
                running_app,
                sel_registerName(b"activateWithOptions:\0".as_ptr()),
                ACTIVATE_ALL_WINDOWS | ACTIVATE_IGNORING_OTHER_APPS,
            )
        }
    }
}

#[cfg(target_os = "linux")]
pub(crate) mod platform {
    pub fn simulate_paste() {
        let _ = std::process::Command::new("xdotool")
            .args(["key", "ctrl+v"])
            .output();
    }
    pub fn deactivate_app() {}
    pub fn frontmost_app_pid() -> Option<i32> {
        None
    }
    pub fn activate_app_by_pid(_pid: i32) -> bool {
        false
    }
}
