fn main() {
    // On Windows the app needs the Common Controls v6 manifest (comctl32 entry points used by the
    // webview / dialogs). tauri-build embeds it only into the app binary, so the unit-test binary
    // of this crate dies at start with STATUS_ENTRYPOINT_NOT_FOUND. Embed the same manifest through
    // the MSVC linker instead: `rustc-link-arg` applies to every linked target (bins and tests).
    let windows_msvc = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    let mut attributes = tauri_build::Attributes::new();
    if windows_msvc {
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        let manifest = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }
    tauri_build::try_build(attributes).expect("tauri-build failed");
}
