fn main() {
    let binaries_dir = std::path::Path::new("binaries");
    if !binaries_dir.exists() {
        let _ = std::fs::create_dir_all(binaries_dir);
    }
    let is_empty = std::fs::read_dir(binaries_dir)
        .map(|mut entries| entries.next().is_none())
        .unwrap_or(true);
    if is_empty {
        let _ = std::fs::write(binaries_dir.join(".gitkeep"), "");
    }

    tauri_build::build();
}
