use std::{
    sync::{
        mpsc::{self, Receiver, RecvTimeoutError, SyncSender},
        Mutex,
    },
    time::Duration,
};

use tauri::{AppHandle, Manager};

use crate::{navigate_main_window_to_backend, ui_dispatch, BackendState};

const DASHBOARD_LOAD_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Default)]
pub(crate) enum StartupPage {
    #[default]
    Waiting,
    WaitingForDashboard {
        shell_loaded: bool,
        finished: SyncSender<()>,
    },
    Loaded,
    NativeError,
}

impl StartupPage {
    pub(crate) fn finish_shell(&mut self) -> bool {
        if matches!(self, Self::Waiting) {
            *self = Self::Loaded;
            return true;
        }
        false
    }

    pub(crate) fn finish_dashboard(&mut self, revision: u64, current_revision: u64) -> bool {
        if revision != current_revision {
            return false;
        }
        let show = match self {
            Self::WaitingForDashboard {
                shell_loaded,
                finished,
            } => {
                let _ = finished.try_send(());
                !*shell_loaded
            }
            _ => return false,
        };
        *self = Self::Loaded;
        show
    }

    fn is_loaded(&self) -> bool {
        matches!(self, Self::Loaded)
    }

    fn begin_dashboard_load(&mut self) -> (bool, Receiver<()>) {
        let shell_loaded = self.is_loaded();
        let (finished, completion) = mpsc::sync_channel(1);
        *self = Self::WaitingForDashboard {
            shell_loaded,
            finished,
        };
        (shell_loaded, completion)
    }

    fn error_in_shell(&mut self) -> bool {
        let use_shell = self.is_loaded()
            || matches!(
                self,
                Self::WaitingForDashboard {
                    shell_loaded: true,
                    ..
                }
            );
        *self = Self::NativeError;
        use_shell
    }
}

fn watch_dashboard_load(
    app: AppHandle,
    completion: Receiver<()>,
    log: impl Fn(&str) + Send + 'static,
) {
    tauri::async_runtime::spawn_blocking(move || {
        if completion.recv_timeout(DASHBOARD_LOAD_TIMEOUT) != Err(RecvTimeoutError::Timeout) {
            return;
        }
        let dispatch = ui_dispatch::run_on_main_thread_dispatch(
            &app,
            "report Dashboard load timeout",
            move |app| {
                let page = app.state::<Mutex<StartupPage>>();
                if matches!(
                    *page.lock().unwrap(),
                    StartupPage::WaitingForDashboard { .. }
                ) && !app.state::<BackendState>().is_quitting()
                {
                    ui_dispatch::show_startup_error(
                    app,
                    "The Dashboard did not finish loading. Restart AstrBot to try again.\n管理面板加载超时，请重启 AstrBot 后重试。",
                    false,
                    log,
                );
                }
            },
        );
        if let Err(error) = dispatch {
            crate::append_startup_log(&error);
        }
    });
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
                    let (shell_loaded, completion) = page.lock().unwrap().begin_dashboard_load();
                    navigate_main_window_to_backend(app, cache_version.as_deref(), shell_loaded)?;
                    watch_dashboard_load(app.clone(), completion, log);
                    Ok(())
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
        assert!(page.finish_shell());
        let (shell_loaded, _) = page.begin_dashboard_load();
        assert!(shell_loaded);
        assert!(page.error_in_shell());
        assert!(!page.finish_dashboard(1, 1));
    }

    #[test]
    fn dashboard_completion_cancels_timeout_without_reshowing_the_shell_window() {
        let mut page = StartupPage::default();
        assert!(page.finish_shell());
        let (shell_loaded, completion) = page.begin_dashboard_load();
        assert!(shell_loaded);
        assert!(!page.finish_dashboard(1, 1));
        assert_eq!(completion.try_recv(), Ok(()));
    }

    #[test]
    fn direct_navigation_keeps_window_hidden_until_dashboard_finishes() {
        let mut page = StartupPage::default();
        let (shell_loaded, completion) = page.begin_dashboard_load();
        assert!(!shell_loaded);
        assert!(!page.finish_shell());
        assert!(!page.finish_dashboard(1, 2));
        assert_eq!(
            completion.try_recv(),
            Err(std::sync::mpsc::TryRecvError::Empty)
        );
        assert!(page.finish_dashboard(2, 2));
        assert_eq!(completion.try_recv(), Ok(()));
    }

    #[test]
    fn native_error_keeps_an_unfinished_window_hidden() {
        let mut page = StartupPage::default();
        assert!(!page.error_in_shell());
        assert!(!page.finish_shell());
    }
}
