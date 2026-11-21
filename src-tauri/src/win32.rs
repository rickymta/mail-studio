//! The few Win32 calls the sign-in fallback needs: find the browser window it opened, give it a
//! sign-in size, close it afterwards. The only module of the workspace allowed `unsafe`.
#![allow(unsafe_code)]

use windows_sys::Win32::Foundation::{CloseHandle, HWND, LPARAM};
use windows_sys::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetWindowThreadProcessId, IsWindow, IsWindowVisible, PostMessageW,
    SWP_NOZORDER, SetWindowPos, WM_CLOSE,
};
use windows_sys::core::BOOL;

/// A top-level window, remembered with its process so a reused handle is never mistaken for it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Window {
    hwnd: isize,
    pid: u32,
}

/// Visible top-level windows of the given window class, outside this process.
pub fn windows_of_class(class: &str) -> Vec<Window> {
    let mut all: Vec<(Window, String)> = Vec::new();
    // SAFETY: `collect` only runs inside this call, while `all` is alive and borrowed by nobody
    // else; it receives exactly the pointer passed here.
    unsafe {
        EnumWindows(
            Some(collect),
            &mut all as *mut Vec<(Window, String)> as LPARAM,
        )
    };
    let me = std::process::id();
    all.into_iter()
        .filter(|(w, c)| c == class && w.pid != me)
        .map(|(w, _)| w)
        .collect()
}

unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
    // SAFETY: `lparam` is the `&mut Vec` handed to `EnumWindows` above.
    let all = unsafe { &mut *(lparam as *mut Vec<(Window, String)>) };
    // SAFETY: plain queries on a handle the system just gave us; the buffers outlive the calls.
    unsafe {
        if IsWindowVisible(hwnd) != 0 {
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, &mut pid);
            let mut buf = [0u16; 128];
            let len = GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32).max(0) as usize;
            let class = String::from_utf16_lossy(&buf[..len]);
            all.push((
                Window {
                    hwnd: hwnd as isize,
                    pid,
                },
                class,
            ));
        }
    }
    1 // keep enumerating
}

/// Whether `w` still exists and still belongs to the same process.
pub fn alive(w: Window) -> bool {
    let hwnd = w.hwnd as HWND;
    let mut pid = 0u32;
    // SAFETY: both calls accept any handle value, valid or not.
    unsafe { IsWindow(hwnd) != 0 && GetWindowThreadProcessId(hwnd, &mut pid) != 0 && pid == w.pid }
}

/// Full path of the program that owns `w`, e.g. `C:\…\Application\chrome.exe`.
pub fn program(w: Window) -> Option<String> {
    // SAFETY: OpenProcess accepts any pid; a null handle (no such process / no access) is
    // checked before use, and the handle is closed on every path after it was opened. The
    // buffer outlives the call and `len` tells it the buffer's size in UTF-16 units.
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, w.pid);
        if process.is_null() {
            return None;
        }
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok =
            QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len);
        CloseHandle(process);
        (ok != 0).then(|| String::from_utf16_lossy(&buf[..len as usize]))
    }
}

/// Move and size `w` (physical pixels).
pub fn set_bounds(w: Window, x: i32, y: i32, width: i32, height: i32) {
    if alive(w) {
        // SAFETY: the handle was checked just above; a stale one only makes the call fail.
        unsafe {
            SetWindowPos(
                w.hwnd as HWND,
                std::ptr::null_mut(),
                x,
                y,
                width,
                height,
                SWP_NOZORDER,
            )
        };
    }
}

/// Ask `w` to close, as its own close button would.
pub fn close(w: Window) {
    if alive(w) {
        // SAFETY: as above; WM_CLOSE takes no parameters.
        unsafe { PostMessageW(w.hwnd as HWND, WM_CLOSE, 0, 0) };
    }
}
