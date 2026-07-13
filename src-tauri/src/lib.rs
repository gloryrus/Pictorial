use std::{cmp::Ordering, path::{Path, PathBuf}};

use serde::{Deserialize, Serialize};

const MEDIA_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "bmp", "webp", "avif", "tif", "tiff", "svg",
    "mp4", "m4v", "webm", "mov", "mkv", "avi", "mpg", "mpeg", "ogv", "3gp", "ts", "m2ts",
];

#[derive(Serialize)]
struct FolderListing {
    files: Vec<String>,
    index: usize,
}

#[derive(Deserialize)]
struct HitRegionRect {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

fn is_supported_media(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| MEDIA_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (a, b) = (a.to_lowercase(), b.to_lowercase());
    let mut ai = a.chars().peekable();
    let mut bi = b.chars().peekable();

    loop {
        match (ai.peek().copied(), bi.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, _) => return Ordering::Less,
            (_, None) => return Ordering::Greater,
            (Some(ca), Some(cb)) if ca.is_ascii_digit() && cb.is_ascii_digit() => {
                let mut na = String::new();
                let mut nb = String::new();

                while let Some(c) = ai.peek().copied() {
                    if c.is_ascii_digit() { na.push(c); ai.next(); } else { break; }
                }
                while let Some(c) = bi.peek().copied() {
                    if c.is_ascii_digit() { nb.push(c); bi.next(); } else { break; }
                }

                match na.parse::<u128>().unwrap_or(0).cmp(&nb.parse::<u128>().unwrap_or(0)) {
                    Ordering::Equal => continue,
                    ordering => return ordering,
                }
            }
            (Some(ca), Some(cb)) => match ca.cmp(&cb) {
                Ordering::Equal => { ai.next(); bi.next(); }
                ordering => return ordering,
            },
        }
    }
}

#[tauri::command]
fn list_folder_media(path: String) -> Result<FolderListing, String> {
    let target = PathBuf::from(&path);
    let directory = target.parent().ok_or("Нет родительской папки")?;

    let mut files: Vec<PathBuf> = std::fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_file() && is_supported_media(path))
        .collect();

    files.sort_by(|a, b| {
        let a = a.file_name().and_then(|name| name.to_str()).unwrap_or_default();
        let b = b.file_name().and_then(|name| name.to_str()).unwrap_or_default();
        natural_cmp(a, b)
    });

    let files: Vec<String> = files
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect();

    let index = files.iter().position(|file| Path::new(file) == target).unwrap_or(0);
    Ok(FolderListing { files, index })
}

#[tauri::command]
fn startup_file() -> Option<String> {
    std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .find(|path| path.is_file() && is_supported_media(path))
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn disable_window_border(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return windows::disable_window_border(&window);

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        Ok(())
    }
}

#[tauri::command]
fn set_window_topmost_clean(window: tauri::WebviewWindow, topmost: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return windows::set_window_topmost_clean(&window, topmost);

    #[cfg(not(target_os = "windows"))]
    {
        window.set_always_on_top(topmost).map_err(|error| error.to_string())
    }
}

#[tauri::command]
fn set_window_bounds_clean(
    window: tauri::WebviewWindow,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    topmost: bool,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return windows::set_window_bounds_clean(&window, x, y, width, height, topmost);

    #[cfg(not(target_os = "windows"))]
    {
        use tauri::{PhysicalPosition, PhysicalSize};
        window.set_position(PhysicalPosition::new(x, y)).map_err(|error| error.to_string())?;
        window.set_size(PhysicalSize::new(width, height)).map_err(|error| error.to_string())?;
        window.set_always_on_top(topmost).map_err(|error| error.to_string())
    }
}

#[tauri::command]
fn set_window_hit_regions(
    window: tauri::WebviewWindow,
    rects: Vec<HitRegionRect>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return windows::set_window_hit_regions(&window, rects);

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        let _ = rects;
        Ok(())
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use super::HitRegionRect;
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::Graphics::Dwm::DwmSetWindowAttribute;
    use windows_sys::Win32::Graphics::Gdi::{
        CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, RGN_OR,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, GWL_STYLE,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER,
        SWP_NOSIZE, SWP_NOZORDER, WS_BORDER, WS_CAPTION,
        WS_DLGFRAME, WS_EX_APPWINDOW, WS_EX_CLIENTEDGE, WS_EX_DLGMODALFRAME, WS_EX_WINDOWEDGE,
        WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_SYSMENU, WS_THICKFRAME,
    };

    fn hwnd(window: &tauri::WebviewWindow) -> Result<HWND, String> {
        let handle = window.window_handle().map_err(|error| error.to_string())?;
        match handle.as_raw() {
            RawWindowHandle::Win32(handle) => Ok(handle.hwnd.get() as HWND),
            _ => Err("Окно не является Win32-окном".to_string()),
        }
    }

    fn clean_styles(hwnd: HWND) {
        unsafe {
            let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
            SetWindowLongPtrW(
                hwnd,
                GWL_STYLE,
                ((style & !(WS_CAPTION | WS_THICKFRAME | WS_BORDER | WS_DLGFRAME | WS_MAXIMIZEBOX))
                    | WS_SYSMENU
                    | WS_MINIMIZEBOX) as isize,
            );

            let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
            SetWindowLongPtrW(
                hwnd,
                GWL_EXSTYLE,
                ((ex_style & !(WS_EX_DLGMODALFRAME | WS_EX_CLIENTEDGE | WS_EX_WINDOWEDGE))
                    | WS_EX_APPWINDOW) as isize,
            );
        }
    }

    fn hide_dwm_border(hwnd: HWND) -> Result<(), String> {
        const DWMWA_BORDER_COLOR: u32 = 34;
        const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;
        let color = DWMWA_COLOR_NONE;
        let result = unsafe {
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_BORDER_COLOR,
                &color as *const u32 as *const std::ffi::c_void,
                std::mem::size_of::<u32>() as u32,
            )
        };

        if result < 0 { Err("DwmSetWindowAttribute failed".to_string()) } else { Ok(()) }
    }

    pub fn disable_window_border(window: &tauri::WebviewWindow) -> Result<(), String> {
        let hwnd = hwnd(window)?;
        clean_styles(hwnd);
        unsafe {
            SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
        hide_dwm_border(hwnd)
    }

    pub fn set_window_topmost_clean(window: &tauri::WebviewWindow, topmost: bool) -> Result<(), String> {
        let hwnd = hwnd(window)?;
        clean_styles(hwnd);
        let insert_after = if topmost { -1isize as HWND } else { -2isize as HWND };
        unsafe {
            SetWindowPos(
                hwnd,
                insert_after,
                0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOOWNERZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
        hide_dwm_border(hwnd)
    }

    pub fn set_window_bounds_clean(
        window: &tauri::WebviewWindow,
        x: i32,
        y: i32,
        width: u32,
        height: u32,
        topmost: bool,
    ) -> Result<(), String> {
        let hwnd = hwnd(window)?;
        clean_styles(hwnd);
        let insert_after = if topmost { -1isize as HWND } else { -2isize as HWND };
        unsafe {
            SetWindowPos(
                hwnd,
                insert_after,
                x,
                y,
                width as i32,
                height as i32,
                SWP_NOOWNERZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
        hide_dwm_border(hwnd)
    }

    pub fn set_window_hit_regions(
        window: &tauri::WebviewWindow,
        rects: Vec<HitRegionRect>,
    ) -> Result<(), String> {
        let hwnd = hwnd(window)?;

        unsafe {
            if rects.is_empty() {
                SetWindowRgn(hwnd, std::ptr::null_mut(), 1);
                return Ok(());
            }

            let combined = CreateRectRgn(0, 0, 0, 0);
            if combined.is_null() {
                return Err("Не удалось создать регион окна".to_string());
            }

            let mut added = 0;

            for rect in rects.into_iter().filter(|rect| rect.w > 0 && rect.h > 0) {
                let region = CreateRectRgn(
                    rect.x,
                    rect.y,
                    rect.x.saturating_add(rect.w),
                    rect.y.saturating_add(rect.h),
                );

                if region.is_null() {
                    continue;
                }

                CombineRgn(combined, combined, region, RGN_OR);
                DeleteObject(region);
                added += 1;
            }

            if added == 0 {
                DeleteObject(combined);
                SetWindowRgn(hwnd, std::ptr::null_mut(), 1);
                return Ok(());
            }

            if SetWindowRgn(hwnd, combined, 1) == 0 {
                DeleteObject(combined);
                return Err("SetWindowRgn failed".to_string());
            }
        }

        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::Manager;

            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                let _ = windows::disable_window_border(&window);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            disable_window_border,
            list_folder_media,
            set_window_topmost_clean,
            set_window_bounds_clean,
            set_window_hit_regions,
            startup_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
