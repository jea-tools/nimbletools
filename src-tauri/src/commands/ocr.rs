use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct OcrResult {
    pub success: bool,
    pub text: String,
    pub message: String,
}

/// macOS Vision OCR
#[tauri::command]
pub fn extract_text_from_image(image_path: String) -> OcrResult {
    if !Path::new(&image_path).exists() {
        return OcrResult {
            success: false,
            text: String::new(),
            message: "File not found".into(),
        };
    }

    #[cfg(target_os = "macos")]
    {
        macos_ocr(&image_path)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = image_path;
        OcrResult {
            success: false,
            text: String::new(),
            message: "OCR is currently supported on macOS only".into(),
        }
    }
}

/// macOS Vision Framework OCR — 原生 FFI，无外部命令依赖
#[cfg(target_os = "macos")]
fn macos_ocr(image_path: &str) -> OcrResult {
    use objc2::rc::Retained;
    use objc2::AnyThread;
    use objc2_app_kit::NSImage;
    use objc2_core_graphics::CGImage;
    use objc2_foundation::*;
    use objc2_vision::*;

    unsafe {
        // 1. 加载图片为 NSImage
        let path_str = NSString::from_str(image_path);
        let ns_image = match NSImage::initWithContentsOfFile(NSImage::alloc(), &path_str) {
            Some(img) => img,
            None => {
                return OcrResult {
                    success: false,
                    text: String::new(),
                    message: "Failed to load image via NSImage".into(),
                };
            }
        };

        // 2. NSImage → CGImage
        let cg_image: Retained<CGImage> =
            match ns_image.CGImageForProposedRect_context_hints(std::ptr::null_mut(), None, None) {
                Some(cg) => cg,
                None => {
                    return OcrResult {
                        success: false,
                        text: String::new(),
                        message: "Failed to convert NSImage to CGImage".into(),
                    };
                }
            };

        // 3. 创建 VNRecognizeTextRequest
        let request = VNRecognizeTextRequest::init(VNRecognizeTextRequest::alloc());
        request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
        request.setUsesLanguageCorrection(true);
        request.setAutomaticallyDetectsLanguage(true);

        // 4. 创建 handler 并执行
        let options: Retained<NSDictionary<NSString, objc2::runtime::AnyObject>> =
            NSDictionary::new();
        let handler = VNImageRequestHandler::initWithCGImage_options(
            VNImageRequestHandler::alloc(),
            &cg_image,
            &options,
        );

        let requests = NSArray::from_retained_slice(&[Retained::into_super(Retained::into_super(
            request.clone(),
        ))]);

        if let Err(e) = handler.performRequests_error(&requests) {
            return OcrResult {
                success: false,
                text: String::new(),
                message: format!("Vision OCR failed: {}", e),
            };
        }

        // 5. 提取识别结果
        let mut text = String::new();
        if let Some(results) = request.results() {
            for i in 0..results.count() {
                let obs: &VNRecognizedTextObservation = &results.objectAtIndex(i);
                let candidates = obs.topCandidates(1);
                if candidates.count() > 0 {
                    let candidate = &candidates.objectAtIndex(0);
                    text.push_str(&candidate.string().to_string());
                    text.push('\n');
                }
            }
        }

        OcrResult {
            success: true,
            text: text.trim().to_string(),
            message: "OCR completed (macOS Vision Framework)".into(),
        }
    }
}
