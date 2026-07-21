mod commands;

use commands::clipboard::{
    check_accessibility_permission, clear_clipboard_history, close_clipboard_popup,
    copy_annotated_screenshot_to_clipboard, copy_clipboard_item, copy_image_to_clipboard,
    get_clipboard_history, open_accessibility_settings, paste_clipboard_item,
    remove_clipboard_item, set_clipboard_max_history, show_clipboard_popup,
    toggle_pin_clipboard_item, write_to_clipboard, ClipboardState,
};
use commands::curl::{
    clear_curl_history, create_curl_folder, create_curl_project, delete_curl_folder,
    delete_curl_project, delete_curl_request, export_curl_command_command, get_curl_history,
    get_curl_workspace, import_curl_command, rename_curl_folder, rename_curl_project,
    rename_curl_request, save_curl_request, send_curl_request, CurlState,
};
use commands::file::{apply_rename, merge_files, preview_rename, split_file};
use commands::hash::{calculate_file_hash, calculate_text_hash};
use commands::hotkey::{
    cancel_region_selector, close_screenshot_editor, crop_and_open_editor, get_hotkey,
    update_hotkey, HotkeyState,
};
use commands::image::{
    compress_images, convert_images, get_image_info, merge_images, resize_images,
};
use commands::ocr::extract_text_from_image;
use commands::screenshot::{copy_screenshot_file, save_screenshot_canvas, take_screenshot};
use commands::watermark::add_watermark;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hotkey_state = HotkeyState::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(hotkey_state)
        .setup(|app| {
            let handle = app.handle().clone();

            // 剪贴板状态：使用 AppHandle 获取应用数据与缓存路径
            let clipboard_state = ClipboardState::new(&handle);
            commands::clipboard::start_clipboard_monitor(&clipboard_state);
            handle.manage(clipboard_state);

            let curl_state = CurlState::new(&handle);
            handle.manage(curl_state);

            // 快捷键
            let state = handle.state::<HotkeyState>();
            commands::hotkey::init_hotkeys(&handle, &state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 图片处理
            convert_images,
            resize_images,
            compress_images,
            merge_images,
            get_image_info,
            add_watermark,
            // 文件工具
            split_file,
            merge_files,
            preview_rename,
            apply_rename,
            // Hash
            calculate_file_hash,
            calculate_text_hash,
            // OCR
            extract_text_from_image,
            // 截图
            take_screenshot,
            save_screenshot_canvas,
            copy_screenshot_file,
            // 剪贴板
            get_clipboard_history,
            clear_clipboard_history,
            remove_clipboard_item,
            toggle_pin_clipboard_item,
            set_clipboard_max_history,
            write_to_clipboard,
            copy_clipboard_item,
            paste_clipboard_item,
            close_clipboard_popup,
            show_clipboard_popup,
            copy_image_to_clipboard,
            copy_annotated_screenshot_to_clipboard,
            check_accessibility_permission,
            open_accessibility_settings,
            // Curl 工作台
            get_curl_workspace,
            create_curl_project,
            rename_curl_project,
            delete_curl_project,
            create_curl_folder,
            rename_curl_folder,
            delete_curl_folder,
            save_curl_request,
            rename_curl_request,
            delete_curl_request,
            send_curl_request,
            import_curl_command,
            export_curl_command_command,
            get_curl_history,
            clear_curl_history,
            // 快捷键
            update_hotkey,
            get_hotkey,
            close_screenshot_editor,
            cancel_region_selector,
            crop_and_open_editor,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // 点击 Dock 图标时恢复主窗口
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}
