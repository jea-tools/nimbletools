use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalPosition, Manager, Position, State, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const CONFIG_FILENAME: &str = "hotkeys.json";

/// 持久化的快捷键配置
#[derive(Serialize, Deserialize, Clone, Default)]
struct HotkeyConfig {
    clipboard: Option<String>,
    screenshot: Option<String>,
}

pub struct HotkeyState {
    clipboard: Mutex<String>,
    screenshot: Mutex<String>,
    config_path: Mutex<PathBuf>,
}

impl HotkeyState {
    pub fn new() -> Self {
        Self {
            clipboard: Mutex::new(String::new()),
            screenshot: Mutex::new(String::new()),
            config_path: Mutex::new(PathBuf::new()),
        }
    }
}

/// 获取配置文件路径
fn resolve_config_path(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = fs::create_dir_all(&dir);
    dir.join(CONFIG_FILENAME)
}

/// 从文件读取已保存的快捷键
fn load_config(path: &PathBuf) -> HotkeyConfig {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// 保存快捷键配置到文件
fn save_config(path: &PathBuf, config: &HotkeyConfig) {
    if let Ok(json) = serde_json::to_string_pretty(config) {
        let _ = fs::write(path, json);
    }
}

/// app setup 阶段调用：读取配置并注册已保存的快捷键
pub fn init_hotkeys(app: &AppHandle, state: &HotkeyState) {
    let config_path = resolve_config_path(app);
    let config = load_config(&config_path);

    // 保存路径供后续使用
    *state.config_path.lock().unwrap() = config_path;

    // 仅当用户已设置快捷键时才注册
    if let Some(ref shortcut) = config.clipboard {
        if !shortcut.is_empty() {
            register_clipboard_shortcut(app, shortcut);
            *state.clipboard.lock().unwrap() = shortcut.clone();
        }
    }
    if let Some(ref shortcut) = config.screenshot {
        if !shortcut.is_empty() {
            register_screenshot_shortcut(app, shortcut);
            *state.screenshot.lock().unwrap() = shortcut.clone();
        }
    }
}

fn register_clipboard_shortcut(app: &AppHandle, shortcut: &str) {
    let handle = app.clone();
    let result = app
        .global_shortcut()
        .on_shortcut(shortcut, move |_app, _sc, event| {
            if event.state == ShortcutState::Pressed {
                toggle_clipboard_popup(&handle);
            }
        });
    match &result {
        Ok(()) => println!("[Hotkey] Clipboard: '{}' registered", shortcut),
        Err(e) => eprintln!("[Hotkey] Clipboard '{}' failed: {}", shortcut, e),
    }
}

fn register_screenshot_shortcut(app: &AppHandle, shortcut: &str) {
    let handle = app.clone();
    let result = app
        .global_shortcut()
        .on_shortcut(shortcut, move |_app, _sc, event| {
            if event.state == ShortcutState::Pressed {
                take_screenshot_from_hotkey(&handle);
            }
        });
    match &result {
        Ok(()) => println!("[Hotkey] Screenshot: '{}' registered", shortcut),
        Err(e) => eprintln!("[Hotkey] Screenshot '{}' failed: {}", shortcut, e),
    }
}

/// 获取鼠标当前所在显示器的中心坐标，用于定位弹窗
/// 返回逻辑坐标（与 builder.position() 一致）
fn cursor_centered_position(
    app: &AppHandle,
    win_width: f64,
    win_height: f64,
) -> Option<(f64, f64)> {
    // CGEventGetLocation 返回的是逻辑坐标（points）
    let (cursor_x, cursor_y) = get_cursor_position()?;

    let monitors = app.available_monitors().ok()?;
    // 遍历显示器：把物理像素转为逻辑坐标再与光标比较
    let target_monitor = monitors.iter().find(|m| {
        let scale = m.scale_factor();
        let pos = m.position();
        let size = m.size();
        let lx = pos.x as f64 / scale;
        let ly = pos.y as f64 / scale;
        let lw = size.width as f64 / scale;
        let lh = size.height as f64 / scale;
        cursor_x >= lx && cursor_x < lx + lw && cursor_y >= ly && cursor_y < ly + lh
    });

    let monitor = target_monitor.or_else(|| monitors.first())?;
    let scale = monitor.scale_factor();
    let pos = monitor.position();
    let size = monitor.size();

    // 显示器的逻辑矩形
    let mon_lx = pos.x as f64 / scale;
    let mon_ly = pos.y as f64 / scale;
    let mon_lw = size.width as f64 / scale;
    let mon_lh = size.height as f64 / scale;

    // 窗口居中的逻辑坐标
    let center_x = mon_lx + (mon_lw - win_width) / 2.0;
    let center_y = mon_ly + (mon_lh - win_height) / 2.0;

    Some((center_x, center_y))
}

/// 获取鼠标当前屏幕坐标
#[cfg(target_os = "macos")]
fn get_cursor_position() -> Option<(f64, f64)> {
    use std::ffi::c_void;

    #[repr(C)]
    struct CGPoint {
        x: f64,
        y: f64,
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventCreate(source: *const c_void) -> *mut c_void;
        fn CGEventGetLocation(event: *mut c_void) -> CGPoint;
        fn CFRelease(cf: *mut c_void);
    }

    unsafe {
        let event = CGEventCreate(std::ptr::null());
        if event.is_null() {
            return None;
        }
        let point = CGEventGetLocation(event);
        CFRelease(event);
        // macOS Quartz 坐标已经是左上角原点（和 Tauri 一致）
        Some((point.x, point.y))
    }
}

#[cfg(not(target_os = "macos"))]
fn get_cursor_position() -> Option<(f64, f64)> {
    // 非 macOS 平台暂不支持
    None
}

fn toggle_clipboard_popup(app: &AppHandle) {
    let (win_w, win_h) = (620.0, 520.0);

    if let Some(window) = app.get_webview_window("clipboard-popup") {
        let is_visible = window.is_visible().unwrap_or(false);
        let is_focused = window.is_focused().unwrap_or(false);
        if should_close_clipboard_popup_on_toggle(is_visible, is_focused) {
            hide_clipboard_popup(app);
            return;
        }

        if should_prepare_clipboard_popup_open(is_visible) {
            prepare_clipboard_popup_open(app);
        }
        position_clipboard_popup(app, &window, win_w, win_h);
        show_and_focus_clipboard_popup(&window);
        let _ = window.emit("clipboard-popup-refresh", ());
        let _ = window.emit("clipboard-popup-focus-search", ());
        return;
    }

    prepare_clipboard_popup_open(app);

    let url = tauri::WebviewUrl::App("/?window=clipboard-popup".into());
    let mut builder = tauri::WebviewWindowBuilder::new(app, "clipboard-popup", url)
        .title("Clipboard History")
        .inner_size(win_w, win_h)
        .decorations(false)
        .always_on_top(true)
        .focused(clipboard_popup_should_use_tauri_focus())
        .focusable(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(clipboard_popup_should_be_visible_when_built());

    // 定位到光标所在显示器中心，失败则 fallback 到 center()
    if let Some((cx, cy)) = cursor_centered_position(app, win_w, win_h) {
        builder = builder.position(cx, cy);
    } else {
        builder = builder.center();
    }

    match builder.build() {
        Ok(window) => {
            show_and_focus_clipboard_popup(&window);
            let _ = window.emit("clipboard-popup-refresh", ());
            let _ = window.emit("clipboard-popup-focus-search", ());
        }
        Err(err) => eprintln!("[Hotkey] Failed to open clipboard popup: {}", err),
    }
}

pub(crate) fn should_hide_main_for_clipboard_popup() -> bool {
    true
}

fn clipboard_popup_should_be_visible_when_built() -> bool {
    cfg!(not(target_os = "macos"))
}

fn clipboard_popup_should_use_tauri_focus() -> bool {
    cfg!(not(target_os = "macos"))
}

fn should_restore_main_after_clipboard_popup_close(main_was_focused: bool) -> bool {
    main_was_focused
}

fn should_restore_previous_app_after_clipboard_popup_close(main_was_focused: bool) -> bool {
    !main_was_focused
}

fn should_close_clipboard_popup_on_toggle(is_visible: bool, is_focused: bool) -> bool {
    is_visible && is_focused
}

fn should_prepare_clipboard_popup_open(is_visible: bool) -> bool {
    !is_visible
}

fn should_notify_main_when_screenshot_capture_fails(success: bool) -> bool {
    !success
}

pub(crate) fn should_hide_main_for_screenshot_hotkey() -> bool {
    false
}

fn screenshot_capture_delay_ms() -> u64 {
    if should_hide_main_for_screenshot_hotkey() {
        200
    } else {
        0
    }
}

fn region_selector_elevate_delay_ms() -> u64 {
    30
}

fn prepare_clipboard_popup_open(app: &AppHandle) {
    // 记录主窗口是否聚焦（仅「正在使用」才算，后台可见不算）
    let main_focused = app
        .get_webview_window("main")
        .map(|w| w.is_focused().unwrap_or(false))
        .unwrap_or(false);

    if let Some(state) = app.try_state::<crate::commands::clipboard::ClipboardState>() {
        *state.main_was_focused.lock().unwrap() = main_focused;
        let previous_app_pid = if main_focused {
            None
        } else {
            crate::commands::clipboard::platform::frontmost_app_pid()
        };
        *state.previous_frontmost_app_pid.lock().unwrap() = previous_app_pid;
    }

    if should_hide_main_for_clipboard_popup() {
        if let Some(main_win) = app.get_webview_window("main") {
            let _ = main_win.hide();
        }
    }
}

fn position_clipboard_popup(app: &AppHandle, window: &WebviewWindow, win_w: f64, win_h: f64) {
    if let Some((cx, cy)) = cursor_centered_position(app, win_w, win_h) {
        let _ = window.set_position(Position::Logical(LogicalPosition { x: cx, y: cy }));
    }
}

pub(crate) fn hide_clipboard_popup(app: &AppHandle) {
    hide_clipboard_popup_window(app);

    let main_was_focused = app
        .try_state::<crate::commands::clipboard::ClipboardState>()
        .map(|state| *state.main_was_focused.lock().unwrap())
        .unwrap_or(false);
    let previous_app_pid = app
        .try_state::<crate::commands::clipboard::ClipboardState>()
        .and_then(|state| *state.previous_frontmost_app_pid.lock().unwrap());

    if should_restore_main_after_clipboard_popup_close(main_was_focused) {
        if let Some(main_win) = app.get_webview_window("main") {
            let _ = main_win.show();
            let _ = main_win.set_focus();
        }
    } else if should_restore_previous_app_after_clipboard_popup_close(main_was_focused) {
        if !previous_app_pid
            .map(crate::commands::clipboard::platform::activate_app_by_pid)
            .unwrap_or(false)
        {
            crate::commands::clipboard::platform::deactivate_app();
        }
    }
}

pub(crate) fn hide_clipboard_popup_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("clipboard-popup") {
        let _ = window.hide();
    }
}

pub(crate) fn show_and_focus_clipboard_popup(window: &WebviewWindow) {
    let _ = window.set_always_on_top(true);
    let _ = window.set_skip_taskbar(true);
    let _ = window.set_focusable(true);
    focus_clipboard_popup_once(window);
    schedule_clipboard_popup_focus_retries(window);
}

fn clipboard_popup_focus_retry_delays_ms() -> &'static [u64] {
    &[40, 120, 240, 360]
}

fn schedule_clipboard_popup_focus_retries(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    let label = window.label().to_string();

    std::thread::spawn(move || {
        for delay_ms in clipboard_popup_focus_retry_delays_ms() {
            std::thread::sleep(std::time::Duration::from_millis(*delay_ms));
            let app_for_ui = app.clone();
            let label_for_ui = label.clone();
            let _ = app.run_on_main_thread(move || {
                if let Some(window) = app_for_ui.get_webview_window(&label_for_ui) {
                    if window.is_visible().unwrap_or(false) {
                        focus_clipboard_popup_once(&window);
                    }
                }
            });
        }
    });
}

fn focus_clipboard_popup_once(window: &WebviewWindow) {
    let _ = window.set_always_on_top(true);
    let _ = window.set_skip_taskbar(true);
    let _ = window.set_focusable(true);
    focus_clipboard_popup_once_platform(window);
}

#[cfg(target_os = "macos")]
fn focus_clipboard_popup_once_platform(window: &WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();

    let window = window.clone();
    let _ = window.with_webview(move |webview| unsafe {
        configure_and_focus_macos_clipboard_panel(webview.ns_window(), webview.inner());
    });
}

#[cfg(target_os = "macos")]
unsafe fn configure_and_focus_macos_clipboard_panel(
    ns_window: *mut std::ffi::c_void,
    webview: *mut std::ffi::c_void,
) {
    extern "C" {
        fn objc_getClass(name: *const u8) -> *mut std::ffi::c_void;
        fn sel_registerName(name: *const u8) -> *mut std::ffi::c_void;
        fn objc_msgSend();
    }

    if ns_window.is_null() {
        return;
    }

    type IdFn =
        unsafe extern "C" fn(*mut std::ffi::c_void, *mut std::ffi::c_void) -> *mut std::ffi::c_void;
    type BoolFn = unsafe extern "C" fn(*mut std::ffi::c_void, *mut std::ffi::c_void, bool);
    type UsizeFn = unsafe extern "C" fn(*mut std::ffi::c_void, *mut std::ffi::c_void) -> usize;
    type SetUsizeFn = unsafe extern "C" fn(*mut std::ffi::c_void, *mut std::ffi::c_void, usize);
    type SetI64Fn = unsafe extern "C" fn(*mut std::ffi::c_void, *mut std::ffi::c_void, i64);
    type IdArgFn =
        unsafe extern "C" fn(*mut std::ffi::c_void, *mut std::ffi::c_void, *mut std::ffi::c_void);
    type BoolIdFn = unsafe extern "C" fn(
        *mut std::ffi::c_void,
        *mut std::ffi::c_void,
        *mut std::ffi::c_void,
    ) -> bool;

    let id_msg: IdFn = std::mem::transmute(objc_msgSend as *const ());
    let bool_msg: BoolFn = std::mem::transmute(objc_msgSend as *const ());
    let usize_msg: UsizeFn = std::mem::transmute(objc_msgSend as *const ());
    let set_usize_msg: SetUsizeFn = std::mem::transmute(objc_msgSend as *const ());
    let set_i64_msg: SetI64Fn = std::mem::transmute(objc_msgSend as *const ());
    let id_arg_msg: IdArgFn = std::mem::transmute(objc_msgSend as *const ());
    let bool_id_msg: BoolIdFn = std::mem::transmute(objc_msgSend as *const ());

    const NS_FLOATING_WINDOW_LEVEL: i64 = 3;
    const NS_WINDOW_STYLE_MASK_UTILITY_WINDOW: usize = 1 << 4;
    const NS_WINDOW_STYLE_MASK_FULL_SIZE_CONTENT_VIEW: usize = 1 << 15;

    let style = usize_msg(ns_window, sel_registerName(b"styleMask\0".as_ptr()));
    set_usize_msg(
        ns_window,
        sel_registerName(b"setStyleMask:\0".as_ptr()),
        style | NS_WINDOW_STYLE_MASK_UTILITY_WINDOW | NS_WINDOW_STYLE_MASK_FULL_SIZE_CONTENT_VIEW,
    );
    bool_msg(
        ns_window,
        sel_registerName(b"setHidesOnDeactivate:\0".as_ptr()),
        false,
    );
    bool_msg(
        ns_window,
        sel_registerName(b"setReleasedWhenClosed:\0".as_ptr()),
        false,
    );
    set_i64_msg(
        ns_window,
        sel_registerName(b"setLevel:\0".as_ptr()),
        NS_FLOATING_WINDOW_LEVEL,
    );

    let ns_app = id_msg(
        objc_getClass(b"NSApplication\0".as_ptr()),
        sel_registerName(b"sharedApplication\0".as_ptr()),
    );
    if !ns_app.is_null() {
        bool_msg(
            ns_app,
            sel_registerName(b"activateIgnoringOtherApps:\0".as_ptr()),
            true,
        );
    }

    id_arg_msg(
        ns_window,
        sel_registerName(b"makeKeyAndOrderFront:\0".as_ptr()),
        std::ptr::null_mut(),
    );

    if !webview.is_null() {
        let _ = bool_id_msg(
            ns_window,
            sel_registerName(b"makeFirstResponder:\0".as_ptr()),
            webview,
        );
    }
}

#[cfg(not(target_os = "macos"))]
fn focus_clipboard_popup_once_platform(window: &WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
}

fn take_screenshot_from_hotkey(app: &AppHandle) {
    if should_hide_main_for_screenshot_hotkey() {
        if let Some(main_win) = app.get_webview_window("main") {
            let _ = main_win.hide();
        }
    }
    if let Some(editor) = app.get_webview_window("screenshot-editor") {
        let _ = editor.close();
    }
    if let Some(selector) = app.get_webview_window("region-selector") {
        let _ = selector.close();
    }

    let app_clone = app.clone();
    let temp_dir = app.path().temp_dir().unwrap_or_default();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let output_path = temp_dir.join(format!("nimbletools_screenshot_{}_preview.jpg", ts));
    let output_str = output_path.to_string_lossy().to_string();
    let capture_delay_ms = screenshot_capture_delay_ms();

    // 1. 先截全屏 2. 打开区域选择器让用户框选
    std::thread::spawn(move || {
        if capture_delay_ms > 0 {
            std::thread::sleep(std::time::Duration::from_millis(capture_delay_ms));
        }

        let capture = super::screenshot::capture_preview(&output_str);

        if capture.success && std::path::Path::new(&output_str).exists() {
            println!("[Screenshot] Preview captured: {}", output_str);
            open_region_selector(&app_clone, &output_str);
        } else {
            cleanup_screenshot_temp(&output_str);
            eprintln!("[Screenshot] Capture failed: {}", capture.message);
            if should_notify_main_when_screenshot_capture_fails(capture.success) {
                notify_screenshot_capture_failed(&app_clone, &capture.message);
            }
        }
    });
}

fn notify_screenshot_capture_failed(app: &AppHandle, message: &str) {
    if let Some(main_win) = app.get_webview_window("main") {
        let _ = main_win.show();
        let _ = main_win.set_focus();
        let _ = main_win.emit("screenshot-capture-failed", message.to_string());
    }
}

/// 打开区域选择器窗口（覆盖鼠标所在显示器，不使用系统全屏）
fn open_region_selector(app: &AppHandle, image_path: &str) {
    let url_str = format!(
        "/?window=region-selector&image={}",
        urlencoding::encode(image_path)
    );
    let url = tauri::WebviewUrl::App(url_str.into());

    let (pos_x, pos_y, mon_w, mon_h) =
        get_cursor_monitor_bounds(app).unwrap_or((0.0, 0.0, 1920.0, 1080.0));

    let _ = tauri::WebviewWindowBuilder::new(app, "region-selector", url)
        .title("")
        .position(pos_x, pos_y)
        .inner_size(mon_w, mon_h)
        .decorations(false)
        .always_on_top(true)
        .focused(true)
        .build();

    // 启动 ESC 按键检测线程（轮询 CGEventSourceKeyState，不依赖窗口焦点）
    start_esc_monitor(app, image_path.to_string());

    // macOS: 延迟后在主线程提升窗口层级（覆盖菜单栏）
    #[cfg(target_os = "macos")]
    {
        let app2 = app.clone();
        let elevate_delay_ms = region_selector_elevate_delay_ms();
        std::thread::spawn(move || {
            if elevate_delay_ms > 0 {
                std::thread::sleep(std::time::Duration::from_millis(elevate_delay_ms));
            }
            let _ = app2.run_on_main_thread(|| {
                elevate_window_on_main_thread();
            });
        });
    }
}

/// 轮询 ESC 按键状态，直接关闭区域选择器，并 emit 事件给前端作为兼容路径
/// macOS: 用 CGEventSourceKeyState 检测，不需要窗口焦点
fn start_esc_monitor(app: &AppHandle, source_path: String) {
    use tauri::Emitter;

    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut was_pressed = false;
        loop {
            // 窗口关了就退出
            if app2.get_webview_window("region-selector").is_none() {
                break;
            }

            let pressed = is_esc_key_pressed();

            // 检测按下边沿（从 false→true），每次按下只 emit 一次
            if should_handle_esc_press(pressed, was_pressed) {
                let _ = app2.emit_to("region-selector", "esc-pressed", ());
                if let Some(selector) = app2.get_webview_window("region-selector") {
                    if selector.close().is_ok() {
                        cleanup_screenshot_temp(&source_path);
                    }
                }
                break;
            }
            was_pressed = pressed;

            std::thread::sleep(std::time::Duration::from_millis(30));
        }
    });
}

fn should_handle_esc_press(pressed: bool, was_pressed: bool) -> bool {
    pressed && !was_pressed
}

/// 通过 CGEventSourceKeyState 检测 Escape 键是否被按下
#[cfg(target_os = "macos")]
fn is_esc_key_pressed() -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceKeyState(state_id: i32, key: u16) -> bool;
    }

    const COMBINED_SESSION_STATE: i32 = 0;
    const ESCAPE_KEY_CODE: u16 = 53;

    unsafe { CGEventSourceKeyState(COMBINED_SESSION_STATE, ESCAPE_KEY_CODE) }
}

#[cfg(not(target_os = "macos"))]
fn is_esc_key_pressed() -> bool {
    // Non-macOS: focus restoration is not implemented in this macOS-first build.
    false
}

#[cfg(test)]
mod tests {
    use super::{
        clipboard_popup_should_be_visible_when_built, clipboard_popup_should_use_tauri_focus,
        region_selector_elevate_delay_ms, screenshot_capture_delay_ms, should_handle_esc_press,
        should_hide_main_for_clipboard_popup, should_hide_main_for_screenshot_hotkey,
        should_restore_main_after_clipboard_popup_close,
        should_restore_previous_app_after_clipboard_popup_close,
    };

    #[test]
    fn handles_escape_only_on_key_down_edge() {
        assert!(should_handle_esc_press(true, false));
        assert!(!should_handle_esc_press(true, true));
        assert!(!should_handle_esc_press(false, true));
        assert!(!should_handle_esc_press(false, false));
    }

    #[test]
    fn clipboard_popup_hides_main_but_screenshot_overlay_keeps_it_visible() {
        assert!(should_hide_main_for_clipboard_popup());
        assert!(!should_hide_main_for_screenshot_hotkey());
    }

    #[test]
    fn clipboard_popup_opens_as_focused_independent_panel() {
        assert_eq!(
            clipboard_popup_should_be_visible_when_built(),
            cfg!(not(target_os = "macos"))
        );
        assert_eq!(
            clipboard_popup_should_use_tauri_focus(),
            cfg!(not(target_os = "macos"))
        );
        assert!(should_restore_main_after_clipboard_popup_close(true));
        assert!(!should_restore_main_after_clipboard_popup_close(false));
        assert!(!should_restore_previous_app_after_clipboard_popup_close(
            true
        ));
        assert!(should_restore_previous_app_after_clipboard_popup_close(
            false
        ));
    }

    #[test]
    fn clipboard_popup_toggle_closes_only_when_visible_and_focused() {
        assert!(super::should_close_clipboard_popup_on_toggle(true, true));
        assert!(!super::should_close_clipboard_popup_on_toggle(true, false));
        assert!(!super::should_close_clipboard_popup_on_toggle(false, true));
        assert!(!super::should_close_clipboard_popup_on_toggle(false, false));
    }

    #[test]
    fn clipboard_popup_reuses_original_target_when_visible_but_unfocused() {
        assert!(!super::should_prepare_clipboard_popup_open(true));
        assert!(super::should_prepare_clipboard_popup_open(false));
    }

    #[test]
    fn clipboard_popup_retries_focus_during_activation_race() {
        assert_eq!(
            super::clipboard_popup_focus_retry_delays_ms(),
            &[40, 120, 240, 360]
        );
    }

    #[test]
    fn screenshot_hotkey_has_no_capture_delay_when_main_stays_visible() {
        assert_eq!(screenshot_capture_delay_ms(), 0);
        assert_eq!(region_selector_elevate_delay_ms(), 30);
    }

    #[test]
    fn screenshot_capture_failure_notifies_main_window() {
        assert!(super::should_notify_main_when_screenshot_capture_fails(
            false
        ));
        assert!(!super::should_notify_main_when_screenshot_capture_fails(
            true
        ));
    }

    #[test]
    fn cleanup_accepts_screenshot_jpeg_preview_files() {
        let path = std::env::temp_dir().join(format!(
            "nimbletools_screenshot_{}_preview.jpg",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::write(&path, b"preview").unwrap();

        super::cleanup_screenshot_temp(&path.to_string_lossy());

        assert!(!path.exists());
    }
}

#[cfg(target_os = "macos")]
fn elevate_window_on_main_thread() {
    use std::ffi::c_void;

    extern "C" {
        fn objc_getClass(name: *const u8) -> *mut c_void;
        fn sel_registerName(name: *const u8) -> *mut c_void;
        fn objc_msgSend();
    }

    const ABOVE_MENU_BAR_LEVEL: i64 = 25;

    unsafe {
        type IdFn = unsafe extern "C" fn(*mut c_void, *mut c_void) -> *mut c_void;
        type SetI64Fn = unsafe extern "C" fn(*mut c_void, *mut c_void, i64);
        type SetIdFn = unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void);

        let id_msg: IdFn = std::mem::transmute(objc_msgSend as *const ());
        let i64_msg: SetI64Fn = std::mem::transmute(objc_msgSend as *const ());
        let id_arg_msg: SetIdFn = std::mem::transmute(objc_msgSend as *const ());

        let ns_app = id_msg(
            objc_getClass(b"NSApplication\0".as_ptr()),
            sel_registerName(b"sharedApplication\0".as_ptr()),
        );

        // 获取所有窗口，找到最后一个（刚创建的 region-selector）
        let windows = id_msg(ns_app, sel_registerName(b"windows\0".as_ptr()));
        type CountFn = unsafe extern "C" fn(*mut c_void, *mut c_void) -> usize;
        let count_fn: CountFn = std::mem::transmute(objc_msgSend as *const ());
        let count = count_fn(windows, sel_registerName(b"count\0".as_ptr()));

        if count == 0 {
            return;
        }

        // 遍历找窗口（keyWindow 在后台线程创建时可能为 null，用遍历更可靠）
        type ObjAtFn = unsafe extern "C" fn(*mut c_void, *mut c_void, usize) -> *mut c_void;
        let obj_at: ObjAtFn = std::mem::transmute(objc_msgSend as *const ());

        let last_win = obj_at(
            windows,
            sel_registerName(b"objectAtIndex:\0".as_ptr()),
            count - 1,
        );

        if last_win.is_null() {
            return;
        }

        // 提升层级覆盖菜单栏
        i64_msg(
            last_win,
            sel_registerName(b"setLevel:\0".as_ptr()),
            ABOVE_MENU_BAR_LEVEL,
        );
        // 获取键盘焦点
        id_arg_msg(
            last_win,
            sel_registerName(b"makeKeyAndOrderFront:\0".as_ptr()),
            std::ptr::null_mut(),
        );

        // 将 webview（contentView）设为 firstResponder，键盘事件才能到 JS
        type BoolIdFn = unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void) -> bool;
        let bool_id_msg: BoolIdFn = std::mem::transmute(objc_msgSend as *const ());
        let content_view = id_msg(last_win, sel_registerName(b"contentView\0".as_ptr()));
        if !content_view.is_null() {
            bool_id_msg(
                last_win,
                sel_registerName(b"makeFirstResponder:\0".as_ptr()),
                content_view,
            );
        }
    }
}

/// 获取鼠标所在显示器的逻辑坐标和尺寸
fn get_cursor_monitor_bounds(app: &AppHandle) -> Option<(f64, f64, f64, f64)> {
    let (cursor_x, cursor_y) = get_cursor_position()?;
    let monitors = app.available_monitors().ok()?;

    let target = monitors.iter().find(|m| {
        let scale = m.scale_factor();
        let pos = m.position();
        let size = m.size();
        let lx = pos.x as f64 / scale;
        let ly = pos.y as f64 / scale;
        let lw = size.width as f64 / scale;
        let lh = size.height as f64 / scale;
        cursor_x >= lx && cursor_x < lx + lw && cursor_y >= ly && cursor_y < ly + lh
    });

    let monitor = target.or_else(|| monitors.first())?;
    let scale = monitor.scale_factor();
    let pos = monitor.position();
    let size = monitor.size();

    Some((
        pos.x as f64 / scale,
        pos.y as f64 / scale,
        size.width as f64 / scale,
        size.height as f64 / scale,
    ))
}

/// 裁剪全屏截图到用户选择的区域，然后打开编辑器
#[tauri::command]
pub fn crop_and_open_editor(
    app: AppHandle,
    source_path: String,
    source_width: Option<u32>,
    source_height: Option<u32>,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    // 先关掉区域选择器窗口（ESC 检测线程会自动退出）
    if let Some(selector) = app.get_webview_window("region-selector") {
        let _ = selector.close();
    }

    // 保存到新临时文件
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let temp_dir = app.path().temp_dir().unwrap_or_default();
    let cropped_path = temp_dir.join(format!("nimbletools_screenshot_{}.png", ts));

    let (img_w, img_h) = match (source_width, source_height) {
        (Some(w), Some(h)) if w > 0 && h > 0 => (w, h),
        _ => image::image_dimensions(&source_path)
            .map_err(|e| format!("Failed to read image dimensions: {}", e))?,
    };

    // 裁剪坐标边界保护
    let crop_x = x.min(img_w.saturating_sub(1));
    let crop_y = y.min(img_h.saturating_sub(1));
    let crop_w = width.min(img_w - crop_x);
    let crop_h = height.min(img_h - crop_y);

    let cropped_with_region_capture = super::screenshot::capture_region_to_file(
        &cropped_path.to_string_lossy(),
        img_w,
        img_h,
        crop_x,
        crop_y,
        crop_w,
        crop_h,
    );

    if !cropped_with_region_capture {
        let img = image::open(&source_path).map_err(|e| format!("Failed to open image: {}", e))?;
        let cropped = img.crop_imm(crop_x, crop_y, crop_w, crop_h).to_rgba8();
        super::screenshot::save_rgba_png(&cropped_path, crop_w, crop_h, cropped.into_raw())?;
    }

    // 清理全屏原始文件
    cleanup_screenshot_temp(&source_path);

    let cropped_str = cropped_path.to_string_lossy().to_string();
    println!(
        "[Screenshot] Cropped to: {} ({}x{})",
        cropped_str, crop_w, crop_h
    );

    open_screenshot_editor(&app, &cropped_str);
    Ok(())
}

/// 打开截图标注编辑器窗口（定位到光标所在显示器）
fn open_screenshot_editor(app: &AppHandle, image_path: &str) {
    let (win_w, win_h) = (900.0, 700.0);
    let url_str = format!(
        "/?window=screenshot-editor&image={}",
        urlencoding::encode(image_path)
    );
    let url = tauri::WebviewUrl::App(url_str.into());
    let mut builder = tauri::WebviewWindowBuilder::new(app, "screenshot-editor", url)
        .title("截图标注")
        .inner_size(win_w, win_h)
        .decorations(false)
        .always_on_top(true)
        .focused(true)
        .resizable(true);

    if let Some((cx, cy)) = cursor_centered_position(app, win_w, win_h) {
        builder = builder.position(cx, cy);
    } else {
        builder = builder.center();
    }

    let _ = builder.build();
}

/// 关闭截图编辑器并清理临时文件
#[tauri::command]
pub fn close_screenshot_editor(app: AppHandle) {
    if let Some(window) = app.get_webview_window("screenshot-editor") {
        // 从 URL 参数提取临时文件路径并清理
        if let Ok(url) = window.url() {
            let query = url.query().unwrap_or("");
            for pair in query.split('&') {
                if let Some(encoded_path) = pair.strip_prefix("image=") {
                    if let Ok(path_str) = urlencoding::decode(encoded_path) {
                        cleanup_screenshot_temp(&path_str);
                    }
                }
            }
        }
        let _ = window.close();
    }
}

/// 安全清理截图临时文件
/// 安全措施：1) 文件名必须匹配 nimbletools_screenshot_*.png/.jpg 2) 只删文件
fn cleanup_screenshot_temp(path_str: &str) {
    use std::path::Path;
    let path = Path::new(path_str);

    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if !file_name.starts_with("nimbletools_screenshot_")
        || !(file_name.ends_with(".png") || file_name.ends_with(".jpg"))
    {
        return;
    }

    if path.is_file() {
        match std::fs::remove_file(path) {
            Ok(()) => println!("[Cleanup] Deleted temp screenshot: {}", file_name),
            Err(e) => eprintln!("[Cleanup] Failed to delete {}: {}", file_name, e),
        }
    }
}

/// 前端调用：更新快捷键（注册 + 持久化）
#[tauri::command]
pub fn update_hotkey(
    app: AppHandle,
    state: State<'_, HotkeyState>,
    hotkey_type: String,
    new_shortcut: String,
) -> Result<(), String> {
    let gs = app.global_shortcut();

    let mutex = match hotkey_type.as_str() {
        "clipboard" => &state.clipboard,
        "screenshot" => &state.screenshot,
        _ => return Err(format!("Unknown hotkey type: {}", hotkey_type)),
    };

    // 注销旧快捷键
    let old = mutex.lock().unwrap().clone();
    if !old.is_empty() {
        let _ = gs.unregister(old.as_str());
    }

    // 注册新快捷键（空字符串表示清除）
    if !new_shortcut.is_empty() {
        match hotkey_type.as_str() {
            "clipboard" => register_clipboard_shortcut(&app, &new_shortcut),
            "screenshot" => register_screenshot_shortcut(&app, &new_shortcut),
            _ => {}
        }
    }

    *mutex.lock().unwrap() = new_shortcut.clone();

    // 持久化到文件
    let config_path = state.config_path.lock().unwrap().clone();
    let mut config = load_config(&config_path);
    match hotkey_type.as_str() {
        "clipboard" => config.clipboard = Some(new_shortcut),
        "screenshot" => config.screenshot = Some(new_shortcut),
        _ => {}
    }
    save_config(&config_path, &config);

    Ok(())
}

/// 前端调用：读取已保存的快捷键
#[tauri::command]
pub fn get_hotkey(state: State<'_, HotkeyState>, hotkey_type: String) -> Result<String, String> {
    match hotkey_type.as_str() {
        "clipboard" => Ok(state.clipboard.lock().unwrap().clone()),
        "screenshot" => Ok(state.screenshot.lock().unwrap().clone()),
        _ => Err(format!("Unknown hotkey type: {}", hotkey_type)),
    }
}
