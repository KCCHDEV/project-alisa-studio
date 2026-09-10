use std::sync::{Arc, Mutex};
use std::process::{Child, Command};
use std::net::TcpStream;
use std::time::Duration;
use tauri::{Manager, Window};

#[derive(Clone)]
struct ServerProcess(Arc<Mutex<Option<Child>>>);

fn is_port_open(port: u16) -> bool {
    TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(300),
    ).is_ok()
}

#[tauri::command]
fn minimize_window(window: Window) {
    let _ = window.minimize();
}

#[tauri::command]
fn toggle_maximize_window(window: Window) {
    if let Ok(is_max) = window.is_maximized() {
        if is_max {
            let _ = window.unmaximize();
        } else {
            let _ = window.maximize();
        }
    }
}

#[tauri::command]
fn close_window(window: Window) {
    let _ = window.close();
}

#[tauri::command]
fn is_server_running() -> bool {
    is_port_open(3001)
}

#[tauri::command]
async fn open_folder_dialog() -> Result<Option<String>, String> {
    let folder = rfd::AsyncFileDialog::new()
        .set_title("Select Project Workspace Folder")
        .pick_folder()
        .await;

    Ok(folder.map(|f| f.path().to_string_lossy().to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let server_handle = Arc::new(Mutex::new(None));
    let server_handle_for_setup = server_handle.clone();

    tauri::Builder::default()
        .manage(ServerProcess(server_handle))
        .invoke_handler(tauri::generate_handler![
            minimize_window,
            toggle_maximize_window,
            close_window,
            is_server_running,
            open_folder_dialog,
        ])
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Development uses beforeDevCommand; packaged builds own their backend.
            if !cfg!(debug_assertions) {
                if is_port_open(3001) {
                    return Err("Port 3001 is occupied. Close the other Alisa backend before starting.".into());
                }
                let resource_dir = app.path().resource_dir()?;
                let data_dir = app.path().app_data_dir()?;
                std::fs::create_dir_all(&data_dir)?;
                let name = if cfg!(windows) { "alisa-server.exe" } else { "alisa-server" };
                let mut cmd = Command::new(resource_dir.join("binaries").join(name));
                cmd.current_dir(&data_dir)
                    .env("ALISA_CONFIG_DIR", &data_dir)
                    .env("ALISA_RESOURCES_DIR", &resource_dir);
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    cmd.creation_flags(0x08000000);
                }
                let child = cmd.spawn()?;
                *server_handle_for_setup.lock().map_err(|_| "Backend process lock failed")? = Some(child);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle();
                if let Some(state) = app.try_state::<ServerProcess>() {
                    if let Ok(mut lock) = state.0.lock() {
                        if let Some(mut child) = lock.take() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
