use tauri::{webview::PageLoadEvent, RunEvent};

use crate::desktop_settings::CloseAction;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MainWindowAction {
    None,
    PreventClose(CloseAction),
    ShowClosePrompt,
    HideIfMinimized,
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum MainWindowEvent {
    CloseRequested(Option<CloseAction>),
    FocusLost { minimized: bool },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PageLoadAction {
    None,
    InjectDesktopBridge,
    ApplyStartupLoadingMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RunEventAction {
    None,
    #[cfg(target_os = "macos")]
    ShowMainWindow,
    HandleExitRequested,
    HandleExit,
}

pub(crate) fn main_window_action(
    window_label: &str,
    is_quitting: bool,
    is_windows: bool,
    event: MainWindowEvent,
) -> MainWindowAction {
    if window_label != "main" || is_quitting {
        return MainWindowAction::None;
    }

    match event {
        MainWindowEvent::CloseRequested(Some(choice)) => MainWindowAction::PreventClose(choice),
        MainWindowEvent::CloseRequested(None) => MainWindowAction::ShowClosePrompt,
        MainWindowEvent::FocusLost { minimized: true } if !is_windows => {
            MainWindowAction::HideIfMinimized
        }
        _ => MainWindowAction::None,
    }
}

pub(crate) fn page_load_action(
    event: PageLoadEvent,
    should_inject_bridge: bool,
    should_apply_startup_loading: bool,
) -> PageLoadAction {
    match event {
        PageLoadEvent::Started | PageLoadEvent::Finished if should_inject_bridge => {
            PageLoadAction::InjectDesktopBridge
        }
        PageLoadEvent::Finished if should_apply_startup_loading => {
            PageLoadAction::ApplyStartupLoadingMode
        }
        _ => PageLoadAction::None,
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn reopen_event_action(has_visible_windows: bool) -> RunEventAction {
    if has_visible_windows {
        RunEventAction::None
    } else {
        RunEventAction::ShowMainWindow
    }
}

pub(crate) fn run_event_action(event: &RunEvent) -> RunEventAction {
    match event {
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows,
            ..
        } => reopen_event_action(*has_visible_windows),
        RunEvent::ExitRequested { .. } => RunEventAction::HandleExitRequested,
        RunEvent::Exit => RunEventAction::HandleExit,
        _ => RunEventAction::None,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        main_window_action, page_load_action, run_event_action, MainWindowAction, MainWindowEvent,
        PageLoadAction, RunEventAction,
    };
    use tauri::{webview::PageLoadEvent, RunEvent};

    use crate::desktop_settings::CloseAction;

    #[cfg(target_os = "macos")]
    use super::reopen_event_action;

    #[test]
    fn main_window_action_ignores_non_main_windows() {
        assert_eq!(
            main_window_action(
                "settings",
                false,
                false,
                MainWindowEvent::CloseRequested(Some(CloseAction::HideToTray)),
            ),
            MainWindowAction::None
        );
    }

    #[test]
    fn main_window_action_hides_on_close_when_not_quitting() {
        for is_windows in [false, true] {
            assert_eq!(
                main_window_action(
                    "main",
                    false,
                    is_windows,
                    MainWindowEvent::CloseRequested(Some(CloseAction::HideToTray)),
                ),
                MainWindowAction::PreventClose(CloseAction::HideToTray)
            );
        }
    }

    #[test]
    fn main_window_action_exits_when_exit_is_configured() {
        for is_windows in [false, true] {
            assert_eq!(
                main_window_action(
                    "main",
                    false,
                    is_windows,
                    MainWindowEvent::CloseRequested(Some(CloseAction::Exit)),
                ),
                MainWindowAction::PreventClose(CloseAction::Exit)
            );
        }
    }

    #[test]
    fn windows_minimized_focus_loss_keeps_the_window_on_the_taskbar() {
        assert_eq!(
            main_window_action(
                "main",
                false,
                true,
                MainWindowEvent::FocusLost { minimized: true }
            ),
            MainWindowAction::None
        );
    }

    #[test]
    fn close_without_a_saved_choice_prompts_unless_already_quitting() {
        let event = MainWindowEvent::CloseRequested(None);
        assert_eq!(
            main_window_action("main", false, true, event),
            MainWindowAction::ShowClosePrompt
        );
        assert_eq!(
            main_window_action("main", true, true, event),
            MainWindowAction::None
        );
    }

    #[test]
    fn non_windows_minimized_focus_loss_still_hides_the_window() {
        assert_eq!(
            main_window_action(
                "main",
                false,
                false,
                MainWindowEvent::FocusLost { minimized: true }
            ),
            MainWindowAction::HideIfMinimized
        );
    }

    #[test]
    fn page_load_action_injects_bridge_when_requested() {
        assert_eq!(
            page_load_action(PageLoadEvent::Started, true, false),
            PageLoadAction::InjectDesktopBridge
        );
    }

    #[test]
    fn page_load_action_applies_startup_loading_only_on_finished() {
        assert_eq!(
            page_load_action(PageLoadEvent::Finished, false, true),
            PageLoadAction::ApplyStartupLoadingMode
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn reopen_event_action_shows_main_window_only_when_no_window_is_visible() {
        assert_eq!(reopen_event_action(false), RunEventAction::ShowMainWindow);
        assert_eq!(reopen_event_action(true), RunEventAction::None);
    }

    #[test]
    fn run_event_action_maps_exit_events() {
        assert_eq!(
            run_event_action(&RunEvent::Exit),
            RunEventAction::HandleExit
        );
    }
}
