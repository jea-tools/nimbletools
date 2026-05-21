use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;

#[derive(Serialize)]
pub struct ProcessResult {
    pub success: bool,
    pub message: String,
    pub output_paths: Vec<String>,
}

#[derive(Deserialize)]
pub struct SplitRequest {
    pub input_path: String,
    pub output_dir: String,
    pub mode: String,       // "size" | "count"
    pub chunk_size_mb: f64, // used when mode == "size"
    pub chunk_count: u32,   // used when mode == "count"
}

#[derive(Deserialize)]
pub struct FileMergeRequest {
    pub input_paths: Vec<String>,
    pub output_path: String,
    pub verify_crc: bool,
}

#[derive(Deserialize)]
pub struct RenamePreviewRequest {
    pub file_paths: Vec<String>,
    pub prefix: String,
    pub suffix: String,
    pub find: String,
    pub replace: String,
    pub use_regex: bool,
    pub use_sequential: bool,
    pub start_number: u32,
    pub digits: u32,
}

#[derive(Serialize)]
pub struct RenamePreviewItem {
    pub original: String,
    pub renamed: String,
}

#[derive(Deserialize)]
pub struct RenameApplyRequest {
    pub items: Vec<RenameApplyItem>,
}

#[derive(Deserialize)]
pub struct RenameApplyItem {
    pub original_path: String,
    pub new_path: String,
}

#[tauri::command]
pub fn split_file(request: SplitRequest) -> ProcessResult {
    let input_path = Path::new(&request.input_path);
    let file_size = match fs::metadata(input_path) {
        Ok(m) => m.len(),
        Err(e) => {
            return ProcessResult {
                success: false,
                message: format!("Failed to read file: {}", e),
                output_paths: vec![],
            }
        }
    };

    let chunk_size: u64 = if request.mode == "size" {
        (request.chunk_size_mb * 1024.0 * 1024.0) as u64
    } else {
        (file_size as f64 / request.chunk_count as f64).ceil() as u64
    };

    if chunk_size == 0 {
        return ProcessResult {
            success: false,
            message: "Chunk size cannot be zero".into(),
            output_paths: vec![],
        };
    }

    let stem = input_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
    let ext = input_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    let mut file = match File::open(input_path) {
        Ok(f) => f,
        Err(e) => {
            return ProcessResult {
                success: false,
                message: format!("Failed to open file: {}", e),
                output_paths: vec![],
            }
        }
    };

    if let Err(e) = fs::create_dir_all(&request.output_dir) {
        return ProcessResult {
            success: false,
            message: format!("Failed to create output dir: {}", e),
            output_paths: vec![],
        };
    }

    let mut output_paths = Vec::new();
    let mut part_num = 1u32;
    let mut remaining = file_size;
    let buffer_size = 8 * 1024 * 1024; // 8MB buffer
    let mut buffer = vec![0u8; buffer_size];

    while remaining > 0 {
        let current_chunk = chunk_size.min(remaining);
        let part_name = if ext.is_empty() {
            format!("{}.part{}", stem, part_num)
        } else {
            format!("{}.{}.part{}", stem, ext, part_num)
        };
        let part_path = Path::new(&request.output_dir).join(&part_name);

        let mut part_file = match File::create(&part_path) {
            Ok(f) => f,
            Err(e) => {
                return ProcessResult {
                    success: false,
                    message: format!("Failed to create part file: {}", e),
                    output_paths,
                }
            }
        };

        let mut written = 0u64;
        while written < current_chunk {
            let to_read = ((current_chunk - written) as usize).min(buffer_size);
            match file.read(&mut buffer[..to_read]) {
                Ok(0) => break,
                Ok(n) => {
                    if let Err(e) = part_file.write_all(&buffer[..n]) {
                        return ProcessResult {
                            success: false,
                            message: format!("Write error: {}", e),
                            output_paths,
                        };
                    }
                    written += n as u64;
                }
                Err(e) => {
                    return ProcessResult {
                        success: false,
                        message: format!("Read error: {}", e),
                        output_paths,
                    }
                }
            }
        }

        output_paths.push(part_path.to_string_lossy().to_string());
        remaining = remaining.saturating_sub(current_chunk);
        part_num += 1;
    }

    ProcessResult {
        success: true,
        message: format!("Split into {} parts", output_paths.len()),
        output_paths,
    }
}

#[tauri::command]
pub fn merge_files(request: FileMergeRequest) -> ProcessResult {
    let output_path = Path::new(&request.output_path);
    if let Some(parent) = output_path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            return ProcessResult {
                success: false,
                message: format!("Failed to create output dir: {}", e),
                output_paths: vec![],
            };
        }
    }

    let mut output_file = match File::create(output_path) {
        Ok(f) => f,
        Err(e) => {
            return ProcessResult {
                success: false,
                message: format!("Failed to create output file: {}", e),
                output_paths: vec![],
            }
        }
    };

    let mut crc_hasher = if request.verify_crc {
        Some(crc32fast::Hasher::new())
    } else {
        None
    };

    let buffer_size = 8 * 1024 * 1024;
    let mut buffer = vec![0u8; buffer_size];

    for path in &request.input_paths {
        let mut file = match File::open(path) {
            Ok(f) => f,
            Err(e) => {
                return ProcessResult {
                    success: false,
                    message: format!("Failed to open {}: {}", path, e),
                    output_paths: vec![],
                }
            }
        };

        loop {
            match file.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    if let Err(e) = output_file.write_all(&buffer[..n]) {
                        return ProcessResult {
                            success: false,
                            message: format!("Write error: {}", e),
                            output_paths: vec![],
                        };
                    }
                    if let Some(ref mut hasher) = crc_hasher {
                        hasher.update(&buffer[..n]);
                    }
                }
                Err(e) => {
                    return ProcessResult {
                        success: false,
                        message: format!("Read error: {}", e),
                        output_paths: vec![],
                    }
                }
            }
        }
    }

    let crc_info = if let Some(hasher) = crc_hasher {
        format!(" (CRC32: {:08X})", hasher.finalize())
    } else {
        String::new()
    };

    ProcessResult {
        success: true,
        message: format!("Merged {} files{}", request.input_paths.len(), crc_info),
        output_paths: vec![request.output_path],
    }
}

#[tauri::command]
pub fn preview_rename(request: RenamePreviewRequest) -> Vec<RenamePreviewItem> {
    let regex_pattern = if request.use_regex && !request.find.is_empty() {
        regex::Regex::new(&request.find).ok()
    } else {
        None
    };

    request
        .file_paths
        .iter()
        .enumerate()
        .map(|(i, path)| {
            let p = Path::new(path);
            let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
            let parent = p.parent().unwrap_or(Path::new(""));

            let mut new_name = stem.to_string();

            // 查找替换
            if !request.find.is_empty() {
                if let Some(ref re) = regex_pattern {
                    new_name = re
                        .replace_all(&new_name, request.replace.as_str())
                        .to_string();
                } else {
                    new_name = new_name.replace(&request.find, &request.replace);
                }
            }

            // 序号命名
            if request.use_sequential {
                let num = request.start_number + i as u32;
                let formatted = format!("{:0>width$}", num, width = request.digits as usize);
                new_name = format!("{}{}", new_name, formatted);
            }

            // 前缀/后缀
            new_name = format!("{}{}{}", request.prefix, new_name, request.suffix);

            let new_filename = if ext.is_empty() {
                new_name
            } else {
                format!("{}.{}", new_name, ext)
            };

            let new_path = parent.join(&new_filename);

            RenamePreviewItem {
                original: path.clone(),
                renamed: new_path.to_string_lossy().to_string(),
            }
        })
        .collect()
}

#[tauri::command]
pub fn apply_rename(request: RenameApplyRequest) -> ProcessResult {
    let mut success_count = 0;
    let mut errors = Vec::new();

    for item in &request.items {
        match fs::rename(&item.original_path, &item.new_path) {
            Ok(()) => success_count += 1,
            Err(e) => errors.push(format!("{}: {}", item.original_path, e)),
        }
    }

    ProcessResult {
        success: errors.is_empty(),
        message: if errors.is_empty() {
            format!("Renamed {} files", success_count)
        } else {
            format!(
                "Renamed {}, {} errors: {}",
                success_count,
                errors.len(),
                errors.join("; ")
            )
        },
        output_paths: vec![],
    }
}
