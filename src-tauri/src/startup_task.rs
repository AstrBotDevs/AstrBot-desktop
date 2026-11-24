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
        committed: bool,
        finished: SyncSender<()>,
    },
    Loaded,
    NativeError,
}

impl StartupPage {
    pub(crate) fn dashboard_committed(&mut self) {
        if let Self::WaitingForDashboard { committed, .. } = self {
            *committed = true;
        }
    }

    pub(crate) fn finish(&mut self, is_dashboard: bool) -> bool {
        match self {
            Self::Waiting => {}
            Self::WaitingForDashboard {
                committed: true,
                finished,
            } if is_dashboard => {
                let _ = finished.try_send(());
            }
            _ => return false,
        }
        *self = Self::Loaded;
        true
    }

    fn is_loaded(&self) -> bool {
        matches!(self, Self::Loaded)
    }

    fn begin_dashboard_fallback(&mut self) -> Option<Receiver<()>> {
        if self.is_loaded() {
            return None;
        }
        let (finished, completion) = mpsc::sync_channel(1);
        *self = Self::WaitingForDashboard {
            committed: false,
            finished,
        };
        Some(completion)
    }

    fn error_in_shell(&mut self) -> bool {
        if self.is_loaded() {
            return true;
        }
        *self = Self::NativeError;
        false
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
                    let completion = page.lock().unwrap().begin_dashboard_fallback();
                    navigate_main_window_to_backend(
                        app,
                        cache_version.as_deref(),
                        completion.is_none(),
                    )?;
                    if let Some(completion) = completion {
                        watch_dashboard_load(app.clone(), completion, log);
                    }
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
        assert!(page.finish(false));
        assert!(page.begin_dashboard_fallback().is_none());
        assert!(page.error_in_shell());
        assert!(!page.finish(true));
    }

    #[test]
    fn direct_navigation_keeps_window_hidden_until_dashboard_finishes() {
        let mut page = StartupPage::default();
        let completion = page.begin_dashboard_fallback().unwrap();
        assert!(!page.finish(false));
        assert!(!page.finish(true));
        assert!(completion.try_recv().is_err());
        page.dashboard_committed();
        assert!(page.finish(true));
        assert_eq!(completion.try_recv(), Ok(()));
    }

    #[test]
    fn native_error_keeps_an_unfinished_window_hidden() {
        let mut page = StartupPage::default();
        assert!(!page.error_in_shell());
        assert!(!page.finish(false));
    }
}
