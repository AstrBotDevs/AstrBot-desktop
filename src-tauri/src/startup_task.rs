use std::sync::Mutex;

use tauri::{AppHandle, Manager};

use crate::{navigate_main_window_to_backend, ui_dispatch, BackendState};

#[derive(Default)]
pub(crate) enum StartupPage {
    #[default]
    Waiting,
    WaitingForDashboard {
        committed: bool,
    },
    Loaded,
    NativeError,
}

impl StartupPage {
    pub(crate) fn dashboard_committed(&mut self) {
        if let Self::WaitingForDashboard { committed } = self {
            *committed = true;
        }
    }

    pub(crate) fn finish(&mut self, is_dashboard: bool) -> bool {
        if matches!(self, Self::Waiting)
            || (matches!(self, Self::WaitingForDashboard { committed: true }) && is_dashboard)
        {
            *self = Self::Loaded;
            return true;
        }
        false
    }

    fn is_loaded(&self) -> bool {
        matches!(self, Self::Loaded)
    }

    fn navigate_from_shell(&mut self) -> bool {
        if self.is_loaded() {
            return true;
        }
        *self = Self::WaitingForDashboard { committed: false };
        false
    }

    fn error_in_shell(&mut self) -> bool {
        if self.is_loaded() {
            return true;
        }
        *self = Self::NativeError;
        false
    }
}

pub fn spawn_startup_task<F>(app_handle: AppHandle, log: F)
where
    F: Fn(&str) + Copy + Send + 'static,
{
    let startup_app_handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        let startup_worker_handle = startup_app_handle.clone();
        let startup_result = tauri::async_runtime::spawn_blocking(move || {
            let state = startup_worker_handle.state::<BackendState>();
            state.ensure_backend_ready(&startup_worker_handle)
        })
        .await
        .map_err(|error| format!("Backend startup task failed: {error}"))
        .and_then(|result| result);

        if let Err(error) = ui_dispatch::run_on_main_thread_dispatch(
            &startup_app_handle,
            "present backend startup result",
            move |app| {
                if app.state::<BackendState>().is_quitting() {
                    return;
                }
                let page = app.state::<Mutex<StartupPage>>();
                let result = startup_result.and_then(|cache_version| {
                    let startup_page_loaded = page.lock().unwrap().navigate_from_shell();
                    navigate_main_window_to_backend(
                        app,
                        cache_version.as_deref(),
                        startup_page_loaded,
                    )
                });
                if let Err(error) = result {
                    let use_shell = page.lock().unwrap().error_in_shell();
                    ui_dispatch::show_startup_error(app, &error, use_shell, log);
                }
            },
        ) {
            log(&error);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::StartupPage;

    #[test]
    fn a_late_startup_page_can_handle_backend_navigation_and_errors() {
        let mut page = StartupPage::default();
        assert!(!page.is_loaded());
        assert!(page.finish(false));
        assert!(page.navigate_from_shell());
        assert!(page.error_in_shell());
        assert!(!page.finish(true));
    }

    #[test]
    fn direct_navigation_keeps_window_hidden_until_dashboard_finishes() {
        let mut page = StartupPage::default();
        assert!(!page.navigate_from_shell());
        assert!(!page.finish(false));
        assert!(!page.finish(true));
        page.dashboard_committed();
        assert!(page.finish(true));
    }

    #[test]
    fn native_error_keeps_an_unfinished_window_hidden() {
        let mut page = StartupPage::default();
        assert!(!page.error_in_shell());
        assert!(!page.finish(false));
    }
}
