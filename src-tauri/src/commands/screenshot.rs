use image::{
    codecs::png::{CompressionType, FilterType, PngEncoder},
    ImageEncoder,
};
use serde::Serialize;
use std::fs::File;
use std::io::BufWriter;
use std::path::Path;

#[derive(Serialize)]
pub struct ScreenshotResult {
    pub success: bool,
    pub path: String,
    pub message: String,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct RectF {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub(crate) fn map_pixel_selection_to_display_rect(
    display_bounds: RectF,
    image_width: u32,
    image_height: u32,
    selection_x: u32,
    selection_y: u32,
    selection_width: u32,
    selection_height: u32,
) -> Option<RectF> {
    if image_width == 0 || image_height == 0 || selection_width == 0 || selection_height == 0 {
        return None;
    }

    let scale_x = display_bounds.width / image_width as f64;
    let scale_y = display_bounds.height / image_height as f64;

    Some(RectF {
        x: display_bounds.x + selection_x as f64 * scale_x,
        y: display_bounds.y + selection_y as f64 * scale_y,
        width: selection_width as f64 * scale_x,
        height: selection_height as f64 * scale_y,
    })
}

pub(crate) fn save_rgba_png(
    output_path: &Path,
    width: u32,
    height: u32,
    rgba_data: Vec<u8>,
) -> Result<(), String> {
    let expected_len = width as usize * height as usize * 4;
    if rgba_data.len() != expected_len {
        return Err(format!(
            "Invalid RGBA buffer length: expected {}, got {}",
            expected_len,
            rgba_data.len()
        ));
    }

    let file = File::create(output_path).map_err(|e| format!("Failed to create file: {}", e))?;
    let writer = BufWriter::new(file);
    let encoder = PngEncoder::new_with_quality(writer, CompressionType::Fast, FilterType::NoFilter);
    encoder
        .write_image(&rgba_data, width, height, image::ExtendedColorType::Rgba8)
        .map_err(|e| format!("Failed to save PNG: {}", e))
}

#[tauri::command]
pub fn save_screenshot_canvas(
    output_path: String,
    width: u32,
    height: u32,
    rgba_data: Vec<u8>,
) -> Result<(), String> {
    save_rgba_png(Path::new(&output_path), width, height, rgba_data)
}

#[tauri::command]
pub fn copy_screenshot_file(source_path: String, output_path: String) -> Result<(), String> {
    std::fs::copy(&source_path, &output_path)
        .map(|_| ())
        .map_err(|e| format!("Failed to copy screenshot: {}", e))
}

/// 平台适配的屏幕截图
#[tauri::command]
pub fn take_screenshot(output_path: String) -> ScreenshotResult {
    #[cfg(target_os = "macos")]
    {
        macos_screenshot(&output_path)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = output_path;
        ScreenshotResult {
            success: false,
            path: String::new(),
            message: "Screenshot is currently supported on macOS only".into(),
        }
    }
}

pub fn capture_preview(output_path: &str) -> ScreenshotResult {
    #[cfg(target_os = "macos")]
    {
        capture_display_preview(output_path)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = output_path;
        ScreenshotResult {
            success: false,
            path: String::new(),
            message: "Screenshot is currently supported on macOS only".into(),
        }
    }
}

pub fn capture_region_to_file(
    output_path: &str,
    source_image_width: u32,
    source_image_height: u32,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> bool {
    #[cfg(target_os = "macos")]
    {
        capture_display_region(
            output_path,
            source_image_width,
            source_image_height,
            x,
            y,
            width,
            height,
        )
        .success
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (
            output_path,
            source_image_width,
            source_image_height,
            x,
            y,
            width,
            height,
        );
        false
    }
}

fn capture_with_backend_fallback(
    screen_capture_kit: impl FnOnce() -> ScreenshotResult,
    core_graphics: impl FnOnce() -> ScreenshotResult,
) -> ScreenshotResult {
    let screen_capture_kit_result = screen_capture_kit();
    if screen_capture_kit_result.success {
        return screen_capture_kit_result;
    }

    let core_graphics_result = core_graphics();
    if core_graphics_result.success {
        return core_graphics_result;
    }

    ScreenshotResult {
        success: false,
        path: String::new(),
        message: format!(
            "ScreenCaptureKit failed: {}; CoreGraphics failed: {}",
            screen_capture_kit_result.message, core_graphics_result.message
        ),
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn capture_display_preview(output_path: &str) -> ScreenshotResult {
    capture_with_backend_fallback(
        || macos_screen_capture_kit_preview(output_path),
        || macos_core_graphics_screenshot_preview(output_path),
    )
}

#[cfg(target_os = "macos")]
pub(crate) fn capture_display_region(
    output_path: &str,
    source_image_width: u32,
    source_image_height: u32,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> ScreenshotResult {
    capture_with_backend_fallback(
        || {
            macos_screen_capture_kit_region(
                output_path,
                source_image_width,
                source_image_height,
                x,
                y,
                width,
                height,
            )
        },
        || {
            macos_core_graphics_capture_region_to_file(
                output_path,
                source_image_width,
                source_image_height,
                x,
                y,
                width,
                height,
            )
        },
    )
}

fn screen_capture_permission_result(
    has_access: bool,
    request_access: impl FnOnce() -> bool,
) -> Option<ScreenshotResult> {
    if has_access || request_access() {
        None
    } else {
        Some(ScreenshotResult {
            success: false,
            path: String::new(),
            message: "需要屏幕录制权限。请在系统弹窗中允许 NimbleTools；如果没有弹窗，请到 System Settings > Privacy & Security > Screen Recording / Screen & System Audio Recording 中开启 NimbleTools，然后重启应用。".into(),
        })
    }
}

#[cfg(target_os = "macos")]
fn has_screen_capture_access() -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
    }

    unsafe { CGPreflightScreenCaptureAccess() }
}

#[cfg(target_os = "macos")]
fn request_screen_capture_access() -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGRequestScreenCaptureAccess() -> bool;
    }

    unsafe { CGRequestScreenCaptureAccess() }
}

#[cfg(target_os = "macos")]
fn save_cgimage_as_file(
    output_path: &str,
    image: *mut std::ffi::c_void,
    image_type_identifier: &[u8],
) -> Result<(), String> {
    use std::ffi::c_void;

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *mut c_void);
    }

    #[link(name = "ImageIO", kind = "framework")]
    extern "C" {
        fn CGImageDestinationCreateWithURL(
            url: *const c_void,
            image_type: *const c_void,
            count: usize,
            options: *const c_void,
        ) -> *mut c_void;
        fn CGImageDestinationAddImage(
            dest: *mut c_void,
            image: *const c_void,
            properties: *const c_void,
        );
        fn CGImageDestinationFinalize(dest: *mut c_void) -> bool;
    }

    extern "C" {
        fn objc_getClass(name: *const u8) -> *mut c_void;
        fn sel_registerName(name: *const u8) -> *mut c_void;
        fn objc_msgSend();
    }

    unsafe {
        type Fn1 = unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void) -> *mut c_void;
        let s1: Fn1 = std::mem::transmute(objc_msgSend as *const ());

        let ns_str = objc_getClass(b"NSString\0".as_ptr());
        let str_sel = sel_registerName(b"stringWithUTF8String:\0".as_ptr());
        let path_c = std::ffi::CString::new(output_path).unwrap();
        let ns_path = s1(ns_str, str_sel, path_c.as_ptr() as *mut c_void);

        let nsurl_cls = objc_getClass(b"NSURL\0".as_ptr());
        let file_url_sel = sel_registerName(b"fileURLWithPath:\0".as_ptr());
        let url = s1(nsurl_cls, file_url_sel, ns_path);
        let image_type = s1(
            ns_str,
            str_sel,
            image_type_identifier.as_ptr() as *mut c_void,
        );

        let dest = CGImageDestinationCreateWithURL(url, image_type, 1, std::ptr::null());
        if dest.is_null() {
            return Err("Failed to create image destination".into());
        }

        CGImageDestinationAddImage(dest, image, std::ptr::null());
        let ok = CGImageDestinationFinalize(dest);
        CFRelease(dest);

        if ok {
            Ok(())
        } else {
            Err("Failed to save screenshot".into())
        }
    }
}

/// macOS: CGWindowListCreateImage 截取全屏（公开 API）
/// 需要"屏幕录制"权限，与 screencapture 命令所需权限相同
#[cfg(target_os = "macos")]
fn macos_screenshot(output_path: &str) -> ScreenshotResult {
    use std::ffi::c_void;

    if let Some(result) =
        screen_capture_permission_result(has_screen_capture_access(), request_screen_capture_access)
    {
        return result;
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGMainDisplayID() -> u32;
        fn CGDisplayBounds(display: u32) -> CGRect;
        fn CGDisplayPixelsHigh(display: u32) -> usize;
        fn CGWindowListCreateImage(
            bounds: CGRect,
            list_option: u32,
            window_id: u32,
            image_option: u32,
        ) -> *mut c_void;
        fn CGGetDisplaysWithPoint(
            point: CGPoint,
            max_displays: u32,
            displays: *mut u32,
            matching_display_count: *mut u32,
        ) -> i32;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *mut c_void);
    }

    extern "C" {
        fn objc_getClass(name: *const u8) -> *mut c_void;
        fn sel_registerName(name: *const u8) -> *mut c_void;
        fn objc_msgSend();
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGSize {
        width: f64,
        height: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }

    // 常量
    const CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY: u32 = 1;
    const CG_WINDOW_IMAGE_DEFAULT: u32 = 0;
    const K_CG_NULL_WINDOW_ID: u32 = 0;

    unsafe {
        // 1. 获取鼠标位置（NSEvent.mouseLocation，Cocoa 坐标系：左下角原点）
        type MsgFn = unsafe extern "C" fn(*mut c_void, *mut c_void) -> CGPoint;
        let msg: MsgFn = std::mem::transmute(objc_msgSend as *const ());
        let ns_event_cls = objc_getClass(b"NSEvent\0".as_ptr());
        let mouse_loc_sel = sel_registerName(b"mouseLocation\0".as_ptr());
        let mouse_cocoa = msg(ns_event_cls, mouse_loc_sel);

        // Cocoa 坐标 → CG 坐标（翻转 Y 轴：CG 以左上角为原点）
        let main_display = CGMainDisplayID();
        let main_height = CGDisplayPixelsHigh(main_display) as f64;
        let mouse_cg = CGPoint {
            x: mouse_cocoa.x,
            y: main_height - mouse_cocoa.y,
        };

        // 2. 找到鼠标所在的显示器
        let mut display_id: u32 = 0;
        let mut display_count: u32 = 0;
        CGGetDisplaysWithPoint(mouse_cg, 1, &mut display_id, &mut display_count);

        let display = if display_count > 0 {
            display_id
        } else {
            main_display
        };
        let bounds = CGDisplayBounds(display);

        // 2. 截取整个屏幕
        let image = CGWindowListCreateImage(
            bounds,
            CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY,
            K_CG_NULL_WINDOW_ID,
            CG_WINDOW_IMAGE_DEFAULT,
        );

        if image.is_null() {
            return ScreenshotResult {
                success: false,
                path: String::new(),
                message: "Screenshot failed. Please grant Screen Recording permission: System Settings > Privacy & Security > Screen Recording".into(),
            };
        }

        let saved = save_cgimage_as_file(output_path, image, b"public.png\0");
        CFRelease(image);

        if saved.is_ok() {
            ScreenshotResult {
                success: true,
                path: output_path.to_string(),
                message: "Screenshot captured (CGWindowListCreateImage)".into(),
            }
        } else {
            ScreenshotResult {
                success: false,
                path: String::new(),
                message: saved.unwrap_err(),
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn macos_screen_capture_kit_preview(_output_path: &str) -> ScreenshotResult {
    ScreenshotResult {
        success: false,
        path: String::new(),
        message: "ScreenCaptureKit backend is not implemented in this build".into(),
    }
}

#[cfg(target_os = "macos")]
fn macos_screen_capture_kit_region(
    _output_path: &str,
    _source_image_width: u32,
    _source_image_height: u32,
    _x: u32,
    _y: u32,
    _width: u32,
    _height: u32,
) -> ScreenshotResult {
    ScreenshotResult {
        success: false,
        path: String::new(),
        message: "ScreenCaptureKit backend is not implemented in this build".into(),
    }
}

#[cfg(target_os = "macos")]
fn macos_core_graphics_screenshot_preview(output_path: &str) -> ScreenshotResult {
    use std::ffi::c_void;

    if let Some(result) =
        screen_capture_permission_result(has_screen_capture_access(), request_screen_capture_access)
    {
        return result;
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGMainDisplayID() -> u32;
        fn CGDisplayBounds(display: u32) -> CGRect;
        fn CGDisplayPixelsHigh(display: u32) -> usize;
        fn CGWindowListCreateImage(
            bounds: CGRect,
            list_option: u32,
            window_id: u32,
            image_option: u32,
        ) -> *mut c_void;
        fn CGGetDisplaysWithPoint(
            point: CGPoint,
            max_displays: u32,
            displays: *mut u32,
            matching_display_count: *mut u32,
        ) -> i32;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *mut c_void);
    }

    extern "C" {
        fn objc_getClass(name: *const u8) -> *mut c_void;
        fn sel_registerName(name: *const u8) -> *mut c_void;
        fn objc_msgSend();
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGSize {
        width: f64,
        height: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }

    const CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY: u32 = 1;
    const CG_WINDOW_IMAGE_DEFAULT: u32 = 0;
    const K_CG_NULL_WINDOW_ID: u32 = 0;

    unsafe {
        type MsgFn = unsafe extern "C" fn(*mut c_void, *mut c_void) -> CGPoint;
        let msg: MsgFn = std::mem::transmute(objc_msgSend as *const ());
        let ns_event_cls = objc_getClass(b"NSEvent\0".as_ptr());
        let mouse_loc_sel = sel_registerName(b"mouseLocation\0".as_ptr());
        let mouse_cocoa = msg(ns_event_cls, mouse_loc_sel);

        let main_display = CGMainDisplayID();
        let main_height = CGDisplayPixelsHigh(main_display) as f64;
        let mouse_cg = CGPoint {
            x: mouse_cocoa.x,
            y: main_height - mouse_cocoa.y,
        };

        let mut display_id: u32 = 0;
        let mut display_count: u32 = 0;
        CGGetDisplaysWithPoint(mouse_cg, 1, &mut display_id, &mut display_count);

        let display = if display_count > 0 {
            display_id
        } else {
            main_display
        };
        let bounds = CGDisplayBounds(display);
        let image = CGWindowListCreateImage(
            bounds,
            CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY,
            K_CG_NULL_WINDOW_ID,
            CG_WINDOW_IMAGE_DEFAULT,
        );

        if image.is_null() {
            return ScreenshotResult {
                success: false,
                path: String::new(),
                message: "Screenshot preview failed".into(),
            };
        }

        let saved = save_cgimage_as_file(output_path, image, b"public.png\0");
        CFRelease(image);

        if saved.is_ok() {
            ScreenshotResult {
                success: true,
                path: output_path.to_string(),
                message: "Screenshot preview captured (CoreGraphics fallback)".into(),
            }
        } else {
            ScreenshotResult {
                success: false,
                path: String::new(),
                message: saved.unwrap_err(),
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn macos_core_graphics_capture_region_to_file(
    output_path: &str,
    source_image_width: u32,
    source_image_height: u32,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> ScreenshotResult {
    use std::ffi::c_void;

    if let Some(result) =
        screen_capture_permission_result(has_screen_capture_access(), request_screen_capture_access)
    {
        return result;
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGMainDisplayID() -> u32;
        fn CGDisplayBounds(display: u32) -> CGRect;
        fn CGDisplayPixelsHigh(display: u32) -> usize;
        fn CGWindowListCreateImage(
            bounds: CGRect,
            list_option: u32,
            window_id: u32,
            image_option: u32,
        ) -> *mut c_void;
        fn CGGetDisplaysWithPoint(
            point: CGPoint,
            max_displays: u32,
            displays: *mut u32,
            matching_display_count: *mut u32,
        ) -> i32;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *mut c_void);
    }

    extern "C" {
        fn objc_getClass(name: *const u8) -> *mut c_void;
        fn sel_registerName(name: *const u8) -> *mut c_void;
        fn objc_msgSend();
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGSize {
        width: f64,
        height: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }

    const CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY: u32 = 1;
    const CG_WINDOW_IMAGE_DEFAULT: u32 = 0;
    const K_CG_NULL_WINDOW_ID: u32 = 0;

    unsafe {
        type MsgFn = unsafe extern "C" fn(*mut c_void, *mut c_void) -> CGPoint;
        let msg: MsgFn = std::mem::transmute(objc_msgSend as *const ());
        let ns_event_cls = objc_getClass(b"NSEvent\0".as_ptr());
        let mouse_loc_sel = sel_registerName(b"mouseLocation\0".as_ptr());
        let mouse_cocoa = msg(ns_event_cls, mouse_loc_sel);

        let main_display = CGMainDisplayID();
        let main_height = CGDisplayPixelsHigh(main_display) as f64;
        let mouse_cg = CGPoint {
            x: mouse_cocoa.x,
            y: main_height - mouse_cocoa.y,
        };

        let mut display_id: u32 = 0;
        let mut display_count: u32 = 0;
        CGGetDisplaysWithPoint(mouse_cg, 1, &mut display_id, &mut display_count);

        let display = if display_count > 0 {
            display_id
        } else {
            main_display
        };
        let display_bounds = CGDisplayBounds(display);
        let Some(region) = map_pixel_selection_to_display_rect(
            RectF {
                x: display_bounds.origin.x,
                y: display_bounds.origin.y,
                width: display_bounds.size.width,
                height: display_bounds.size.height,
            },
            source_image_width,
            source_image_height,
            x,
            y,
            width,
            height,
        ) else {
            return ScreenshotResult {
                success: false,
                path: String::new(),
                message: "Invalid region selection".into(),
            };
        };

        let image = CGWindowListCreateImage(
            CGRect {
                origin: CGPoint {
                    x: region.x,
                    y: region.y,
                },
                size: CGSize {
                    width: region.width,
                    height: region.height,
                },
            },
            CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY,
            K_CG_NULL_WINDOW_ID,
            CG_WINDOW_IMAGE_DEFAULT,
        );

        if image.is_null() {
            return ScreenshotResult {
                success: false,
                path: String::new(),
                message: "Region screenshot failed".into(),
            };
        }

        let saved = save_cgimage_as_file(output_path, image, b"public.png\0");
        CFRelease(image);

        if saved.is_ok() {
            ScreenshotResult {
                success: true,
                path: output_path.to_string(),
                message: "Region screenshot captured (CoreGraphics fallback)".into(),
            }
        } else {
            ScreenshotResult {
                success: false,
                path: String::new(),
                message: saved.unwrap_err(),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        capture_with_backend_fallback, map_pixel_selection_to_display_rect, save_rgba_png,
        screen_capture_permission_result, RectF, ScreenshotResult,
    };
    use image::GenericImageView;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_png_path(name: &str) -> std::path::PathBuf {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("nimbletools_{}_{}.png", name, ts))
    }

    fn fake_capture(success: bool, path: &str, message: &str) -> ScreenshotResult {
        ScreenshotResult {
            success,
            path: path.to_string(),
            message: message.to_string(),
        }
    }

    #[test]
    fn capture_backend_prefers_screen_capture_kit_when_available() {
        let result = capture_with_backend_fallback(
            || fake_capture(true, "/tmp/sck.png", "ScreenCaptureKit captured"),
            || fake_capture(true, "/tmp/cg.png", "CoreGraphics captured"),
        );

        assert!(result.success);
        assert_eq!(result.path, "/tmp/sck.png");
        assert_eq!(result.message, "ScreenCaptureKit captured");
    }

    #[test]
    fn capture_backend_falls_back_to_core_graphics_when_screen_capture_kit_fails() {
        let result = capture_with_backend_fallback(
            || fake_capture(false, "", "ScreenCaptureKit unavailable"),
            || fake_capture(true, "/tmp/cg.png", "CoreGraphics captured"),
        );

        assert!(result.success);
        assert_eq!(result.path, "/tmp/cg.png");
        assert_eq!(result.message, "CoreGraphics captured");
    }

    #[test]
    fn capture_backend_reports_both_failures_when_no_backend_succeeds() {
        let result = capture_with_backend_fallback(
            || fake_capture(false, "", "ScreenCaptureKit unavailable"),
            || fake_capture(false, "", "CoreGraphics permission denied"),
        );

        assert!(!result.success);
        assert_eq!(result.path, "");
        assert!(result.message.contains("ScreenCaptureKit unavailable"));
        assert!(result.message.contains("CoreGraphics permission denied"));
    }

    #[test]
    fn save_rgba_png_rejects_mismatched_buffer_length() {
        let path = temp_png_path("bad_rgba");

        let result = save_rgba_png(&path, 2, 2, vec![255, 0, 0, 255]);

        assert!(result.is_err());
        assert!(!path.exists());
    }

    #[test]
    fn save_rgba_png_writes_png_with_requested_dimensions() {
        let path = temp_png_path("rgba");

        save_rgba_png(&path, 2, 1, vec![255, 0, 0, 255, 0, 255, 0, 255]).unwrap();

        let img = image::open(&path).unwrap();
        assert_eq!(img.dimensions(), (2, 1));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn maps_image_pixel_selection_to_display_points() {
        let rect = map_pixel_selection_to_display_rect(
            RectF {
                x: 100.0,
                y: 50.0,
                width: 1728.0,
                height: 1117.0,
            },
            3456,
            2234,
            200,
            100,
            800,
            600,
        )
        .unwrap();

        assert_eq!(
            rect,
            RectF {
                x: 200.0,
                y: 100.0,
                width: 400.0,
                height: 300.0,
            }
        );
    }

    #[test]
    fn requests_screen_recording_permission_before_reporting_missing_access() {
        let mut requested = false;
        let result = screen_capture_permission_result(false, || {
            requested = true;
            false
        })
        .unwrap();

        assert!(requested);
        assert!(!result.success);
        assert_eq!(result.path, "");
        assert!(result.message.contains("Screen Recording"));
    }

    #[test]
    fn continues_capture_when_screen_recording_permission_exists() {
        let mut requested = false;

        assert!(screen_capture_permission_result(true, || {
            requested = true;
            false
        })
        .is_none());
        assert!(!requested);
    }
}
