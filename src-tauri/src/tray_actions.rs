pub const TRAY_MENU_TOGGLE_WINDOW: &str = "tray_toggle_window";
pub const TRAY_MENU_RELOAD_WINDOW: &str = "tray_reload_window";
pub const TRAY_MENU_RESTART_BACKEND: &str = "tray_restart_backend";
pub const TRAY_MENU_QUIT: &str = "tray_quit";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayMenuAction {
    ToggleWindow,
    ReloadWindow,
    RestartBackend,
    Quit,
}

pub fn action_from_menu_id(menu_id: &str) -> Option<TrayMenuAction> {
    match menu_id {
        TRAY_MENU_TOGGLE_WINDOW => Some(TrayMenuAction::ToggleWindow),
        TRAY_MENU_RELOAD_WINDOW => Some(TrayMenuAction::ReloadWindow),
        TRAY_MENU_RESTART_BACKEND => Some(TrayMenuAction::RestartBackend),
        TRAY_MENU_QUIT => Some(TrayMenuAction::Quit),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_from_menu_id_maps_all_known_actions() {
        assert_eq!(
            action_from_menu_id(TRAY_MENU_TOGGLE_WINDOW),
            Some(TrayMenuAction::ToggleWindow)
        );
        assert_eq!(
            action_from_menu_id(TRAY_MENU_RELOAD_WINDOW),
            Some(TrayMenuAction::ReloadWindow)
        );
        assert_eq!(
            action_from_menu_id(TRAY_MENU_RESTART_BACKEND),
            Some(TrayMenuAction::RestartBackend)
        );
        assert_eq!(
            action_from_menu_id(TRAY_MENU_QUIT),
            Some(TrayMenuAction::Quit)
        );
    }

    #[test]
    fn action_from_menu_id_returns_none_for_unknown_menu_id() {
        assert_eq!(action_from_menu_id("unknown-menu"), None);
    }
}
