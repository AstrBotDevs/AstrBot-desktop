use std::{
    sync::{
        mpsc::{self, Receiver, SyncSender},
        Mutex,
    },
    time::Duration,
};

use tauri::{
    webview::{PageLoadEvent, PageLoadPayload},
    Builder, Manager, RunEvent, WindowEvent,
};

#[cfg(target_os = "linux")]
mod linux_webkit_workaround {
    const APPIMAGE_ENV: &str = "APPIMAGE";
    const APPDIR_ENV: &str = "APPDIR";
    const GDK_BACKEND_ENV: &str = "GDK_BACKEND";
    const WEBKIT_DISABLE_DMABUF_RENDERER_ENV: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
    const WAYLAND_DISPLAY_ENV: &str = "WAYLAND_DISPLAY";

    fn should_set_gdk_backend_env(
        existing_value: Option<&std::ffi::OsStr>,
        wayland_display: Option<&std::ffi::OsStr>,
        appimage: Option<&std::ffi::OsStr>,
        appdir: Option<&std::ffi::OsStr>,
    ) -> bool {
        existing_value.is_none()
            && wayland_display.is_some()
            && (appimage.is_some() || appdir.is_some())
    }

    fn should_set_webkit_dmabuf_renderer_env(
        existing_value: Option<&std::ffi::OsStr>,
        wayland_display: Option<&std::ffi::OsStr>,
    ) -> bool {
        existing_value.is_none() && wayland_display.is_some()
    }

    pub(super) fn configure(log: impl Fn(&str)) {
        if should_set_gdk_backend_env(
            std::env::var_os(GDK_BACKEND_ENV).as_deref(),
            std::env::var_os(WAYLAND_DISPLAY_ENV).as_deref(),
            std::env::var_os(APPIMAGE_ENV).as_deref(),
            std::env::var_os(APPDIR_ENV).as_deref(),
        ) {
            std::env::set_var(GDK_BACKEND_ENV, "x11");
            log(&format!(
                "applied Linux AppImage WebKit workaround: set {GDK_BACKEND_ENV}=x11"
            ));
        }

        if should_set_webkit_dmabuf_renderer_env(
            std::env::var_os(WEBKIT_DISABLE_DMABUF_RENDERER_ENV).as_deref(),
            std::env::var_os(WAYLAND_DISPLAY_ENV).as_deref(),
        ) {
            std::env::set_var(WEBKIT_DISABLE_DMABUF_RENDERER_ENV, "1");
            log(&format!(
                "applied Linux WebKit workaround: set {WEBKIT_DISABLE_DMABUF_RENDERER_ENV}=1"
            ));
        }
    }

    #[cfg(test)]
    mod tests {
        use super::{should_set_gdk_backend_env, should_set_webkit_dmabuf_renderer_env};

        #[test]
        fn appimage_wayland_workaround_uses_x11_unless_overridden() {
            assert!(should_set_gdk_backend_env(
                None,
                Some(std::ffi::OsStr::new("wayland-0")),
                Some(std::ffi::OsStr::new("/tmp/.mount_AstrBot/AppRun")),
                None
            ));
            assert!(should_set_gdk_backend_env(
                None,
                Some(std::ffi::OsStr::new("wayland-0")),
                None,
                Some(std::ffi::OsStr::new("/tmp/.mount_AstrBot"))
            ));
            assert!(!should_set_gdk_backend_env(
                Some(std::ffi::OsStr::new("wayland")),
                Some(std::ffi::OsStr::new("wayland-0")),
                Some(std::ffi::OsStr::new("/tmp/.mount_AstrBot/AppRun")),
                None
            ));
            assert!(!should_set_gdk_backend_env(
                None,
                None,
                Some(std::ffi::OsStr::new("/tmp/.mount_AstrBot/AppRun")),
                None
            ));
            assert!(!should_set_gdk_backend_env(
                None,
                Some(std::ffi::OsStr::new("wayland-0")),
                None,
                None
            ));
        }

        #[test]
        fn webkit_dmabuf_workaround_is_set_only_for_wayland_without_override() {
            assert!(should_set_webkit_dmabuf_renderer_env(
                None,
                Some(std::ffi::OsStr::new("wayland-0"))
            ));
            assert!(!should_set_webkit_dmabuf_renderer_env(None, None));
            assert!(!should_set_webkit_dmabuf_renderer_env(
                Some(std::ffi::OsStr::new("0")),
                Some(std::ffi::OsStr::new("wayland-0"))
            ));
            assert!(!should_set_webkit_dmabuf_renderer_env(
                Some(std::ffi::OsStr::new("1")),
                Some(std::ffi::OsStr::new("wayland-0"))
            ));
            assert!(!should_set_webkit_dmabuf_renderer_env(
                Some(std::ffi::OsStr::new("0")),
                None
            ));
            assert!(!should_set_webkit_dmabuf_renderer_env(
                Some(std::ffi::OsStr::new("1")),
                None
            ));
        }
    }
}

use crate::{
    app_runtime_events, append_desktop_log, append_startup_log, bridge, desktop_settings,
    lifecycle, runtime_paths, startup_task, tray, window, BackendState, DesktopSettingsCache,
    DEFAULT_SHELL_LOCALE, DESKTOP_LOG_FILE, STARTUP_MODE_ENV,
};

fn configure_plugins(builder: Builder<tauri::Wry>) -> Builder<tauri::Wry> {
    builder
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            append_desktop_log("detected second instance launch, focusing existing main window");
            window::actions::show_main_window(app, DEFAULT_SHELL_LOCALE, append_desktop_log);
        }))
}

fn configure_window_events(builder: Builder<tauri::Wry>) -> Builder<tauri::Wry> {
    use app_runtime_events::{MainWindowAction, MainWindowEvent};

    builder.on_window_event(|window, event| {
        let app_handle = window.app_handle();
        let is_windows = cfg!(windows);
        let window_event = match event {
            WindowEvent::CloseRequested { .. } => MainWindowEvent::CloseRequested(
                app_handle
                    .state::<DesktopSettingsCache>()
                    .get()
                    .close_action(is_windows),
            ),
            // Do not turn Windows taskbar minimization into tray hiding.
            WindowEvent::Focused(false) if !is_windows => MainWindowEvent::FocusLost {
                minimized: window.is_minimized().unwrap_or(false),
            },
            _ => return,
        };
        let action = app_runtime_events::main_window_action(
            window.label(),
            app_handle.state::<BackendState>().is_quitting(),
            is_windows,
            window_event,
        );

        match action {
            MainWindowAction::PreventClose(choice) => {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    window::actions::apply_close_action(app_handle, choice);
                }
            }
            MainWindowAction::ShowClosePrompt => {
                #[cfg(windows)]
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    window::close_prompt::show(window);
                }
            }
            MainWindowAction::HideIfMinimized => {
                window::actions::hide_main_window(
                    window.app_handle(),
                    DEFAULT_SHELL_LOCALE,
                    append_desktop_log,
                );
            }
            MainWindowAction::None => {}
        }
    })
}

fn handle_page_load_started(webview: &tauri::Webview<tauri::Wry>, payload: &PageLoadPayload<'_>) {
    append_desktop_log(&format!("page-load started: {}", payload.url()));
    if webview.label() == "main" {
        webview
            .app_handle()
            .state::<bridge::desktop::StartupThemeWrites>()
            .advance();
    }
    let state = webview.app_handle().state::<BackendState>();
    let action = app_runtime_events::page_load_action(
        PageLoadEvent::Started,
        bridge::desktop::should_inject_desktop_bridge(&state.backend_url, payload.url()),
        false,
    );

    if action == app_runtime_events::PageLoadAction::InjectDesktopBridge {
        if webview.label() == "main" {
            // A canceled startup load can report Finished with the Dashboard URL before commit.
            webview
                .app_handle()
                .state::<Mutex<startup_task::StartupPage>>()
                .lock()
                .unwrap()
                .dashboard_committed();
        }
        crate::inject_desktop_bridge(webview);
    }
}

fn handle_page_load_finished(webview: &tauri::Webview<tauri::Wry>, payload: &PageLoadPayload<'_>) {
    append_desktop_log(&format!("page-load finished: {}", payload.url()));
    let state = webview.app_handle().state::<BackendState>();
    let action = app_runtime_events::page_load_action(
        PageLoadEvent::Finished,
        bridge::desktop::should_inject_desktop_bridge(&state.backend_url, payload.url()),
        window::startup_loading::should_apply_startup_loading_mode(
            webview.window().label(),
            payload.url(),
        ),
    );

    match action {
        app_runtime_events::PageLoadAction::InjectDesktopBridge => {
            crate::inject_desktop_bridge(webview);
        }
        app_runtime_events::PageLoadAction::ApplyStartupLoadingMode => {
            window::startup_loading::apply_startup_loading_mode(
                webview.app_handle(),
                webview,
                STARTUP_MODE_ENV,
                append_startup_log,
            );
        }
        app_runtime_events::PageLoadAction::None => {}
    }
}

fn configure_page_load_events(
    builder: Builder<tauri::Wry>,
    startup_page: SyncSender<()>,
) -> Builder<tauri::Wry> {
    builder.on_page_load(move |webview, payload| match payload.event() {
        PageLoadEvent::Started => handle_page_load_started(webview, payload),
        PageLoadEvent::Finished => {
            handle_page_load_finished(webview, payload);
            if webview.label() == "main" {
                let app = webview.app_handle();
                let backend = app.state::<BackendState>();
                let is_dashboard = bridge::desktop::should_inject_desktop_bridge(
                    &backend.backend_url,
                    payload.url(),
                );
                let show = app
                    .state::<Mutex<startup_task::StartupPage>>()
                    .lock()
                    .unwrap()
                    .finish(is_dashboard);
                if show && !backend.is_quitting() {
                    let settings = app.state::<DesktopSettingsCache>().get();
                    apply_startup_window_visibility(app, settings.silent_launch);
                }
                let _ = startup_page.try_send(());
            }
        }
    })
}

fn apply_startup_window_visibility(app_handle: &tauri::AppHandle, silent_launch: bool) {
    if silent_launch {
        append_startup_log("silent launch enabled, keeping main window hidden");
        window::actions::hide_main_window(app_handle, DEFAULT_SHELL_LOCALE, append_desktop_log);
    } else {
        append_startup_log("silent launch disabled, showing main window");
        window::actions::show_main_window(app_handle, DEFAULT_SHELL_LOCALE, append_desktop_log);
    }
}

fn configure_setup(
    builder: Builder<tauri::Wry>,
    startup_page: Receiver<()>,
) -> Builder<tauri::Wry> {
    builder.setup(move |app| {
        let app_handle = app.handle().clone();
        if let Err(error) = tray::setup::setup_tray(&app_handle) {
            append_startup_log(&format!("failed to initialize tray: {error}"));
        }
        crate::windows_shutdown::install(&app_handle);

        let desktop_settings = app_handle.state::<DesktopSettingsCache>().get();
        if desktop_settings.startup_theme() == desktop_settings::StartupTheme::System {
            if let Err(error) =
                window::startup_loading::apply_system_startup_background(&app_handle)
            {
                append_startup_log(&format!("failed to set system startup background: {error}"));
            }
        }

        tauri::async_runtime::spawn_blocking(move || {
            // Wait briefly for the themed page to avoid a flash, then recover if it never loads.
            let startup_page_loaded = startup_page.recv_timeout(Duration::from_secs(2)).is_ok();
            if !startup_page_loaded {
                append_startup_log(
                    "startup page did not finish loading; continuing backend startup",
                );
            }

            if let Err(error) = crate::ui_dispatch::run_on_main_thread_dispatch(
                &app_handle,
                "start backend",
                move |app| {
                    if app.state::<BackendState>().is_quitting() {
                        return;
                    }
                    startup_task::spawn_startup_task(app.clone(), append_startup_log);
                },
            ) {
                append_startup_log(&error);
            }
        });
        Ok(())
    })
}

fn handle_run_event(app_handle: &tauri::AppHandle, event: RunEvent) {
    match app_runtime_events::run_event_action(&event) {
        #[cfg(target_os = "macos")]
        app_runtime_events::RunEventAction::ShowMainWindow => {
            append_desktop_log("application reopen requested, showing main window");
            window::actions::show_main_window(app_handle, DEFAULT_SHELL_LOCALE, append_desktop_log);
        }
        app_runtime_events::RunEventAction::HandleExitRequested => {
            if let RunEvent::ExitRequested { api, .. } = event {
                lifecycle::events::handle_exit_requested(app_handle, &api);
            }
        }
        app_runtime_events::RunEventAction::HandleExit => {
            lifecycle::events::handle_exit_event(app_handle);
        }
        app_runtime_events::RunEventAction::None => {}
    }
}

#[cfg(target_os = "linux")]
pub(crate) fn configure_linux_webkit_workaround() {
    linux_webkit_workaround::configure(append_startup_log);
}

pub(crate) fn run() {
    append_startup_log("desktop process starting");
    append_startup_log(&format!(
        "desktop log path: {}",
        crate::logging::resolve_desktop_log_path(
            crate::runtime_paths::default_packaged_root_dir(),
            DESKTOP_LOG_FILE,
        )
        .display()
    ));
    let builder = tauri::Builder::default();
    let builder = configure_plugins(builder);
    let builder = configure_window_events(builder);
    let (startup_page_tx, startup_page_rx) = mpsc::sync_channel(1);
    let builder = configure_page_load_events(builder, startup_page_tx);
    let builder = configure_setup(builder, startup_page_rx);

    let settings = desktop_settings::read_desktop_settings(
        runtime_paths::default_packaged_root_dir().as_deref(),
    );
    let mut context = tauri::generate_context!();
    if let Some(main) = context
        .config_mut()
        .app
        .windows
        .iter_mut()
        .find(|window| window.label == "main")
    {
        window::startup_loading::configure_startup_theme(main, settings.startup_theme());
    }

    builder
        .manage(BackendState::default())
        .manage(Mutex::new(startup_task::StartupPage::default()))
        .manage(bridge::desktop::StartupThemeWrites::default())
        .manage(DesktopSettingsCache::new(settings))
        .manage(bridge::plugin_ui_extensions::PluginUiExtensionRuntimeState::default())
        .invoke_handler(tauri::generate_handler![
            crate::bridge::commands::desktop_bridge_is_desktop_runtime,
            crate::bridge::commands::desktop_bridge_get_backend_state,
            crate::bridge::commands::desktop_bridge_get_auth_token,
            crate::bridge::commands::desktop_bridge_set_auth_token,
            crate::bridge::commands::desktop_bridge_set_shell_locale,
            crate::bridge::commands::desktop_bridge_get_app_update_channel,
            crate::bridge::commands::desktop_bridge_set_app_update_channel,
            crate::bridge::commands::desktop_bridge_restart_backend,
            crate::bridge::commands::desktop_bridge_stop_backend,
            crate::bridge::commands::desktop_bridge_pick_directory,
            crate::bridge::commands::desktop_bridge_get_plugin_ui_extensions,
            crate::bridge::commands::desktop_bridge_request_plugin_ui_extension,
            crate::bridge::commands::desktop_bridge_open_external_url,
            crate::bridge::commands::desktop_bridge_open_repair_install,
            crate::bridge::commands::desktop_bridge_set_startup_theme,
            crate::bridge::commands::desktop_bridge_set_window_theme,
            crate::bridge::commands::desktop_bridge_minimize_window,
            crate::bridge::commands::desktop_bridge_toggle_maximize_window,
            crate::bridge::commands::desktop_bridge_close_window,
            crate::bridge::commands::desktop_bridge_check_app_update,
            crate::bridge::commands::desktop_bridge_install_app_update
        ])
        .build(context)
        .expect("error while building tauri application")
        .run(handle_run_event);
}
