use image::{DynamicImage, ImageFormat, ImageReader};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct ProcessResult {
    pub success: bool,
    pub message: String,
    pub output_paths: Vec<String>,
}

#[derive(Deserialize)]
pub struct ConvertRequest {
    pub input_paths: Vec<String>,
    pub output_dir: String,
    pub target_format: String,
    pub quality: u8,
}

#[derive(Deserialize)]
pub struct ResizeRequest {
    pub input_paths: Vec<String>,
    pub output_dir: String,
    pub width: u32,
    pub height: u32,
    pub keep_aspect_ratio: bool,
    pub use_percentage: bool,
    pub percentage: f32,
}

#[derive(Deserialize)]
pub struct CompressRequest {
    pub input_paths: Vec<String>,
    pub output_dir: String,
    pub quality: u8,
}

#[derive(Deserialize)]
pub struct MergeRequest {
    pub input_paths: Vec<String>,
    pub output_path: String,
    pub direction: String, // "horizontal" | "vertical"
}

fn parse_format(format_str: &str) -> Option<ImageFormat> {
    match format_str.to_lowercase().as_str() {
        "jpg" | "jpeg" => Some(ImageFormat::Jpeg),
        "png" => Some(ImageFormat::Png),
        "webp" => Some(ImageFormat::WebP),
        "bmp" => Some(ImageFormat::Bmp),
        _ => None,
    }
}

fn format_extension(format: ImageFormat) -> &'static str {
    match format {
        ImageFormat::Jpeg => "jpg",
        ImageFormat::Png => "png",
        ImageFormat::WebP => "webp",
        ImageFormat::Bmp => "bmp",
        _ => "png",
    }
}

fn generate_output_path(input_path: &str, output_dir: &str, ext: &str, suffix: &str) -> PathBuf {
    let stem = Path::new(input_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    Path::new(output_dir).join(format!("{}{}.{}", stem, suffix, ext))
}

fn load_image(path: &str) -> Result<DynamicImage, String> {
    ImageReader::open(path)
        .map_err(|e| format!("Failed to open image: {}", e))?
        .decode()
        .map_err(|e| format!("Failed to decode image: {}", e))
}

fn save_image_with_quality(
    img: &DynamicImage,
    path: &Path,
    format: ImageFormat,
    quality: u8,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    match format {
        ImageFormat::Jpeg => {
            let rgb = img.to_rgb8();
            let mut buf = Cursor::new(Vec::new());
            let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality);
            encoder
                .encode_image(&rgb)
                .map_err(|e| format!("Failed to encode JPEG: {}", e))?;
            fs::write(path, buf.into_inner())
                .map_err(|e| format!("Failed to write file: {}", e))?;
        }
        _ => {
            img.save(path)
                .map_err(|e| format!("Failed to save image: {}", e))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn convert_images(request: ConvertRequest) -> ProcessResult {
    let format = match parse_format(&request.target_format) {
        Some(f) => f,
        None => {
            return ProcessResult {
                success: false,
                message: format!("Unsupported format: {}", request.target_format),
                output_paths: vec![],
            }
        }
    };

    let ext = format_extension(format);
    let mut output_paths = Vec::new();
    let mut errors = Vec::new();

    for input_path in &request.input_paths {
        match load_image(input_path) {
            Ok(img) => {
                let output_path = generate_output_path(input_path, &request.output_dir, ext, "");
                match save_image_with_quality(&img, &output_path, format, request.quality) {
                    Ok(()) => {
                        output_paths.push(output_path.to_string_lossy().to_string());
                    }
                    Err(e) => errors.push(e),
                }
            }
            Err(e) => errors.push(e),
        }
    }

    if errors.is_empty() {
        ProcessResult {
            success: true,
            message: format!("Converted {} images", output_paths.len()),
            output_paths,
        }
    } else {
        ProcessResult {
            success: false,
            message: errors.join("; "),
            output_paths,
        }
    }
}

#[tauri::command]
pub fn resize_images(request: ResizeRequest) -> ProcessResult {
    let mut output_paths = Vec::new();
    let mut errors = Vec::new();

    for input_path in &request.input_paths {
        match load_image(input_path) {
            Ok(img) => {
                let (new_w, new_h) = if request.use_percentage {
                    let scale = request.percentage / 100.0;
                    (
                        (img.width() as f32 * scale) as u32,
                        (img.height() as f32 * scale) as u32,
                    )
                } else if request.keep_aspect_ratio {
                    let ratio_w = request.width as f32 / img.width() as f32;
                    let ratio_h = request.height as f32 / img.height() as f32;
                    let ratio = ratio_w.min(ratio_h);
                    (
                        (img.width() as f32 * ratio) as u32,
                        (img.height() as f32 * ratio) as u32,
                    )
                } else {
                    (request.width, request.height)
                };

                let resized = img.resize_exact(
                    new_w.max(1),
                    new_h.max(1),
                    image::imageops::FilterType::Lanczos3,
                );

                let ext = Path::new(input_path)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("png");
                let output_path =
                    generate_output_path(input_path, &request.output_dir, ext, "_resized");

                let format = parse_format(ext).unwrap_or(ImageFormat::Png);
                match save_image_with_quality(&resized, &output_path, format, 90) {
                    Ok(()) => output_paths.push(output_path.to_string_lossy().to_string()),
                    Err(e) => errors.push(e),
                }
            }
            Err(e) => errors.push(e),
        }
    }

    ProcessResult {
        success: errors.is_empty(),
        message: if errors.is_empty() {
            format!("Resized {} images", output_paths.len())
        } else {
            errors.join("; ")
        },
        output_paths,
    }
}

#[tauri::command]
pub fn compress_images(request: CompressRequest) -> ProcessResult {
    let mut output_paths = Vec::new();
    let mut errors = Vec::new();

    for input_path in &request.input_paths {
        match load_image(input_path) {
            Ok(img) => {
                let output_path =
                    generate_output_path(input_path, &request.output_dir, "jpg", "_compressed");
                match save_image_with_quality(
                    &img,
                    &output_path,
                    ImageFormat::Jpeg,
                    request.quality,
                ) {
                    Ok(()) => output_paths.push(output_path.to_string_lossy().to_string()),
                    Err(e) => errors.push(e),
                }
            }
            Err(e) => errors.push(e),
        }
    }

    ProcessResult {
        success: errors.is_empty(),
        message: if errors.is_empty() {
            format!("Compressed {} images", output_paths.len())
        } else {
            errors.join("; ")
        },
        output_paths,
    }
}

#[tauri::command]
pub fn merge_images(request: MergeRequest) -> ProcessResult {
    if request.input_paths.len() < 2 {
        return ProcessResult {
            success: false,
            message: "Need at least 2 images to merge".into(),
            output_paths: vec![],
        };
    }

    let images: Vec<DynamicImage> = match request
        .input_paths
        .iter()
        .map(|p| load_image(p))
        .collect::<Result<Vec<_>, _>>()
    {
        Ok(imgs) => imgs,
        Err(e) => {
            return ProcessResult {
                success: false,
                message: e,
                output_paths: vec![],
            }
        }
    };

    let is_horizontal = request.direction == "horizontal";

    let (total_w, total_h) = if is_horizontal {
        (
            images.iter().map(|i| i.width()).sum::<u32>(),
            images.iter().map(|i| i.height()).max().unwrap_or(0),
        )
    } else {
        (
            images.iter().map(|i| i.width()).max().unwrap_or(0),
            images.iter().map(|i| i.height()).sum::<u32>(),
        )
    };

    let mut canvas = DynamicImage::new_rgba8(total_w, total_h);
    let mut offset = 0u32;

    for img in &images {
        if is_horizontal {
            image::imageops::overlay(&mut canvas, img, offset as i64, 0);
            offset += img.width();
        } else {
            image::imageops::overlay(&mut canvas, img, 0, offset as i64);
            offset += img.height();
        }
    }

    let output_path = Path::new(&request.output_path);
    let ext = output_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    let format = parse_format(ext).unwrap_or(ImageFormat::Png);

    match save_image_with_quality(&canvas, output_path, format, 95) {
        Ok(()) => ProcessResult {
            success: true,
            message: format!("Merged {} images", images.len()),
            output_paths: vec![request.output_path],
        },
        Err(e) => ProcessResult {
            success: false,
            message: e,
            output_paths: vec![],
        },
    }
}

/// 获取图片基本信息（用于前端预览）
#[tauri::command]
pub fn get_image_info(path: String) -> Result<ImageInfo, String> {
    let img = load_image(&path)?;
    let metadata =
        fs::metadata(&path).map_err(|e| format!("Failed to read file metadata: {}", e))?;

    Ok(ImageInfo {
        width: img.width(),
        height: img.height(),
        file_size: metadata.len(),
        format: Path::new(&path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("unknown")
            .to_uppercase(),
    })
}

#[derive(Serialize)]
pub struct ImageInfo {
    pub width: u32,
    pub height: u32,
    pub file_size: u64,
    pub format: String,
}
