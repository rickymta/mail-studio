//! Opening a sign-in page in a small window of its own in the user's default browser — the
//! fallback of the sign-in window when a provider refuses embedded webviews. On Windows the
//! window gets the sign-in window's size and is closed again once the sign-in is over.

use tauri_plugin_opener::OpenerExt;

/// Size of the browser's sign-in window in logical pixels, the same as the in-app one.
#[cfg_attr(not(windows), allow(dead_code))]
pub const WIDTH: f64 = 520.0;
#[cfg_attr(not(windows), allow(dead_code))]
pub const HEIGHT: f64 = 720.0;

/// Open `url` (https only) in a window of its own in the default browser where we know how to
/// ask for one; otherwise the ordinary way, which usually means a new tab.
pub fn open_in_new_window(app: &tauri::AppHandle, url: &str) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Only https links can be opened for sign-in".into());
    }
    #[cfg(windows)]
    if windows::open(app, url) {
        return Ok(());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Close the browser window opened for the sign-in, if we opened one and it is still there.
pub fn close_opened_window() {
    #[cfg(windows)]
    windows::close_opened();
}

/// Browser families we know how to open a separate window in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(not(windows), allow(dead_code))]
enum Family {
    Chromium,
    Firefox,
}

#[cfg_attr(not(windows), allow(dead_code))]
impl Family {
    fn of(exe: &str) -> Option<Self> {
        let name = exe.rsplit(['\\', '/']).next()?.to_ascii_lowercase();
        match name.as_str() {
            // Chrome, Edge, Brave, Vivaldi, Opera, Chromium, Cốc Cốc / Yandex.
            "chrome.exe" | "msedge.exe" | "brave.exe" | "vivaldi.exe" | "opera.exe"
            | "launcher.exe" | "chromium.exe" | "browser.exe" => Some(Self::Chromium),
            "firefox.exe" | "librewolf.exe" | "waterfox.exe" => Some(Self::Firefox),
            _ => None,
        }
    }

    /// Arguments that open `url` in a window of its own: a Chromium "app" window (no tabs, no
    /// address bar, nothing else in it) or a new Firefox window.
    fn args(self, url: &str) -> Vec<String> {
        match self {
            Self::Chromium => vec![format!("--app={url}")],
            Self::Firefox => vec!["-new-window".into(), url.into()],
        }
    }

    /// Win32 class of the browser's top-level windows.
    fn window_class(self) -> &'static str {
        match self {
            Self::Chromium => "Chrome_WidgetWin_1",
            Self::Firefox => "MozillaWindowClass",
        }
    }
}

/// The program of a shell command line such as `"C:\…\msedge.exe" --single-argument %1`.
#[cfg_attr(not(windows), allow(dead_code))]
fn executable(command: &str) -> Option<String> {
    let command = command.trim();
    let exe = if let Some(rest) = command.strip_prefix('"') {
        &rest[..rest.find('"')?]
    } else {
        let end = command.to_ascii_lowercase().find(".exe")? + ".exe".len();
        &command[..end]
    };
    (!exe.is_empty()).then(|| exe.to_string())
}

/// Whether a window whose process runs `program` belongs to the browser started as `browser`:
/// the program sits in the browser's folder or below it (Opera's launcher.exe starts opera.exe
/// from a version subfolder). Other apps reuse the same window class as Chromium browsers
/// (VS Code, Slack, Electron apps…), so the class alone does not tell the browser's windows apart.
#[cfg_attr(not(windows), allow(dead_code))]
fn belongs_to(browser: &str, program: &str) -> bool {
    let norm = |p: &str| p.replace('/', "\\").to_lowercase();
    let browser = norm(browser);
    let Some((dir, _)) = browser.rsplit_once('\\') else {
        return false;
    };
    norm(program)
        .strip_prefix(dir)
        .is_some_and(|rest| rest.starts_with('\\'))
}

#[cfg(windows)]
mod windows {
    use std::process::Command;
    use std::sync::Mutex;
    use std::thread;
    use std::time::{Duration, Instant};

    use tauri::Manager;

    use super::{Family, HEIGHT, WIDTH, belongs_to, executable};
    use crate::win32::{self, Window};

    /// The browser window opened for the current sign-in. Only a Chromium app window is kept:
    /// it holds nothing but the sign-in, so closing it cannot take anything else with it.
    static OPENED: Mutex<Option<Window>> = Mutex::new(None);

    pub fn open(app: &tauri::AppHandle, url: &str) -> bool {
        let Some((exe, family)) = default_browser() else {
            return false;
        };
        let class = family.window_class();
        let before = win32::windows_of_class(class);
        if Command::new(&exe).args(family.args(url)).spawn().is_err() {
            return false;
        }
        let bounds = bounds(app);
        // The browser process we start hands the request to the running one and exits, so the
        // new window is found by what appeared, not by process id; but only among the browser's
        // own windows, never another app's that happens to open meanwhile.
        thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(10);
            while Instant::now() < deadline {
                let new = win32::windows_of_class(class).into_iter().find(|w| {
                    !before.contains(w) && win32::program(*w).is_some_and(|p| belongs_to(&exe, &p))
                });
                if let Some(w) = new {
                    if let Some((x, y, width, height)) = bounds {
                        win32::set_bounds(w, x, y, width, height);
                        // The browser may still apply a size it remembered; settle it again.
                        thread::sleep(Duration::from_millis(500));
                        win32::set_bounds(w, x, y, width, height);
                    }
                    if family == Family::Chromium
                        && let Ok(mut opened) = OPENED.lock()
                    {
                        *opened = Some(w);
                    }
                    return;
                }
                thread::sleep(Duration::from_millis(100));
            }
        });
        true
    }

    pub fn close_opened() {
        let Some(w) = OPENED.lock().ok().and_then(|mut o| o.take()) else {
            return;
        };
        // Leave the "Signed in" page up for a moment so the user sees how it ended.
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(1500));
            win32::close(w);
        });
    }

    /// The sign-in size at the main window's scale, centred on the main window.
    fn bounds(app: &tauri::AppHandle) -> Option<(i32, i32, i32, i32)> {
        let main = app.get_webview_window("main")?;
        let scale = main.scale_factor().ok()?;
        let pos = main.outer_position().ok()?;
        let size = main.outer_size().ok()?;
        let width = (WIDTH * scale).round() as i32;
        let height = (HEIGHT * scale).round() as i32;
        Some((
            pos.x + (size.width as i32 - width) / 2,
            pos.y + (size.height as i32 - height) / 2,
            width,
            height,
        ))
    }

    /// The default browser for https links, from the registry.
    fn default_browser() -> Option<(String, Family)> {
        let prog_id = windows_registry::CURRENT_USER
            .open(r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice")
            .ok()?
            .get_string("ProgId")
            .ok()?;
        let command = windows_registry::CLASSES_ROOT
            .open(format!(r"{prog_id}\shell\open\command"))
            .ok()?
            .get_string("")
            .ok()?;
        let exe = executable(&command)?;
        let family = Family::of(&exe)?;
        Some((exe, family))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn executable_from_quoted_and_bare_commands() {
        assert_eq!(
            executable(
                r#""C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --single-argument %1"#
            )
            .as_deref(),
            Some(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
        );
        assert_eq!(
            executable(r"C:\Firefox\FIREFOX.EXE -osint -url %1").as_deref(),
            Some(r"C:\Firefox\FIREFOX.EXE")
        );
        assert_eq!(executable(r#""""#), None);
        assert_eq!(executable("rundll32 url.dll"), None);
    }

    #[test]
    fn browser_family_and_arguments() {
        assert_eq!(Family::of(r"C:\x\msedge.exe"), Some(Family::Chromium));
        assert_eq!(
            Family::of(r"C:\x\Google\Chrome\Application\CHROME.EXE"),
            Some(Family::Chromium)
        );
        assert_eq!(
            Family::of(r"C:\x\Mozilla Firefox\firefox.exe"),
            Some(Family::Firefox)
        );
        assert_eq!(Family::of(r"C:\x\iexplore.exe"), None);
        assert_eq!(
            Family::Chromium.args("https://a.example/?x=1&y=2"),
            ["--app=https://a.example/?x=1&y=2"]
        );
        assert_eq!(
            Family::Firefox.args("https://a.example/"),
            ["-new-window", "https://a.example/"]
        );
    }

    #[test]
    fn only_the_browsers_own_windows() {
        let chrome = r"C:\Program Files\Google\Chrome\Application\chrome.exe";
        assert!(belongs_to(
            chrome,
            r"C:\PROGRAM FILES\Google\Chrome\Application\chrome.exe"
        ));
        assert!(belongs_to(
            chrome,
            "C:/Program Files/Google/Chrome/Application/chrome.exe"
        ));
        // Opera's launcher starts the browser from a version folder below it.
        assert!(belongs_to(
            r"C:\Users\u\AppData\Local\Programs\Opera\launcher.exe",
            r"C:\Users\u\AppData\Local\Programs\Opera\115.0\opera.exe"
        ));
        // Same window class, other apps.
        assert!(!belongs_to(
            chrome,
            r"C:\Users\u\AppData\Local\Programs\Microsoft VS Code\Code.exe"
        ));
        assert!(!belongs_to(
            chrome,
            r"C:\Users\u\AppData\Local\AnthropicClaude\claude.exe"
        ));
        assert!(!belongs_to(
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            chrome
        ));
        // A folder that only starts with the browser's folder name.
        assert!(!belongs_to(
            chrome,
            r"C:\Program Files\Google\Chrome\ApplicationX\evil.exe"
        ));
        assert!(!belongs_to("chrome.exe", chrome));
    }
}
