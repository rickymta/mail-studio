//! Tauri shell: one `call` command that forwards to `mailstudio_core::dispatch`, plus the one
//! thing the core cannot do itself (handing a saved attachment to the OS).

use serde_json::Value;
use tauri::{Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_opener::OpenerExt;

/// Share of the screen the main window covers when the app starts.
const START_FRACTION: f64 = 0.85;

#[tauri::command]
async fn call(cmd: String, args: Value) -> Result<Value, mailstudio_core::Error> {
    mailstudio_core::dispatch(&cmd, args).await
}

/// Open an attachment with its default application. Only files the backend itself wrote into
/// its attachments folder are accepted, so the webview cannot make the OS open arbitrary paths.
#[tauri::command]
async fn open_attachment(
    app: tauri::AppHandle,
    id: i64,
    index: usize,
) -> Result<(), mailstudio_core::Error> {
    let args = serde_json::json!({ "id": id, "index": index });
    let path = mailstudio_core::dispatch("attachment.open", args).await?;
    let path = path.as_str().unwrap_or_default().to_string();
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| mailstudio_core::Error::Invalid(format!("Could not open the attachment: {e}")))
}

/// Size the main window to 85% of the monitor's work area, centred, then show it
/// (it starts hidden so it never flashes at the configured size).
fn fit_to_screen(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    if let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) {
        let area = monitor.work_area();
        let w = (area.size.width as f64 * START_FRACTION).round() as u32;
        let h = (area.size.height as f64 * START_FRACTION).round() as u32;
        window.set_size(PhysicalSize::new(w, h))?;
        window.set_position(PhysicalPosition::new(
            area.position.x + ((area.size.width - w) / 2) as i32,
            area.position.y + ((area.size.height - h) / 2) as i32,
        ))?;
    }
    window.show()?;
    window.set_focus()?;
    Ok(())
}

/// Bring the already-running main window to the front (a second launch lands here
/// instead of opening another window).
#[cfg(desktop)]
fn focus_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Status bar (macOS) / notification area (Windows, Linux) icon: a click brings the main window
/// back, the menu offers the same plus Quit.
#[cfg(desktop)]
fn install_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    let open = MenuItemBuilder::with_id("open", "Open MailStudio").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&open)
        .separator()
        .item(&quit)
        .build()?;
    TrayIconBuilder::with_id("main")
        .icon(icon)
        // macOS draws template icons from their alpha channel alone, so the white glyph
        // follows a light or dark menu bar by itself.
        .icon_as_template(true)
        .tooltip("MailStudio")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => focus_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                focus_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Must be the first plugin: a second launch hands its arguments to the running
    // instance and exits before anything else starts.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        focus_main(app)
    }));
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main")
                && fit_to_screen(&window).is_err()
            {
                let _ = window.show();
            }
            // The app is fully usable without a tray (some Linux desktops have none).
            #[cfg(desktop)]
            if let Err(e) = install_tray(app.handle()) {
                eprintln!("tray icon unavailable: {e}");
            }
            tauri::async_runtime::spawn(mailstudio_core::background_loop());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![call, open_attachment])
        .run(tauri::generate_context!())
        .expect("error while running MailStudio");
}
