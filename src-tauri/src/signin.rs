//! The OAuth sign-in window: a plain webview showing the provider's consent page. It has no
//! access to the app's commands (capabilities only cover the main window). Its one menu item
//! hands the same sign-in to the default browser, for providers that refuse embedded webviews
//! (Google often does). The backend's loopback listener receives the redirect either way.

use tauri::menu::{Menu, MenuItem};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::browser;

const LABEL: &str = "sign-in";
const OPEN_IN_BROWSER: &str = "open-in-browser";
/// Sent to the main window when the user closes the sign-in window themselves.
const CLOSED_EVENT: &str = "sign-in-closed";

/// Show `url` (https only) in the sign-in window, replacing one that is still open.
pub fn open(app: &AppHandle, url: &str, title: &str, open_in_browser: &str) -> Result<(), String> {
    let parsed: tauri::Url = url
        .parse()
        .map_err(|_| "Invalid sign-in link".to_string())?;
    if parsed.scheme() != "https" {
        return Err("Only https links can be opened for sign-in".into());
    }
    close(app);
    if cfg!(target_os = "macos") {
        // A window menu is the app-wide menu bar on macOS: the fallback item would replace the
        // main window's Edit menu (copy / paste). Use the browser there instead.
        return browser::open_in_new_window(app, url);
    }

    let item = MenuItem::with_id(app, OPEN_IN_BROWSER, open_in_browser, true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let menu = Menu::with_items(app, &[&item]).map_err(|e| e.to_string())?;
    let mut builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(parsed))
        .title(title)
        .inner_size(520.0, 720.0)
        .min_inner_size(400.0, 500.0)
        .center()
        .menu(menu);
    if let Some(main) = app.get_webview_window("main") {
        builder = builder.parent(&main).map_err(|e| e.to_string())?;
    }
    let window = builder.build().map_err(|e| e.to_string())?;

    // The fallback restarts from the original link: state and PKCE stay valid and the loopback
    // listener is still waiting, wherever the page had got to.
    let url = url.to_string();
    window.on_menu_event(move |w, event| {
        if event.id() == OPEN_IN_BROWSER {
            if let Err(e) = browser::open_in_new_window(w.app_handle(), &url) {
                eprintln!("could not open the sign-in in the browser: {e}");
                return;
            }
            // `destroy` (unlike `close`) raises no CloseRequested: the sign-in goes on.
            let _ = w.destroy();
        }
    });
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { .. } = event {
            let _ = handle.emit_to("main", CLOSED_EVENT, ());
        }
    });
    Ok(())
}

/// Close the sign-in window, if open, without reporting it as cancelled — and the browser window
/// the sign-in may have moved to.
pub fn close(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.destroy();
    }
    browser::close_opened_window();
}
