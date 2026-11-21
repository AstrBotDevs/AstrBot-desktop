use std::{
    mem::{size_of, zeroed},
    ptr::null_mut,
    sync::atomic::AtomicBool,
};

use tauri::{AppHandle, Manager, Window};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};
use windows_sys::{
    core::w,
    Win32::UI::{
        Controls::{
            TaskDialogIndirect, TASKDIALOGCONFIG, TASKDIALOG_BUTTON, TDF_ALLOW_DIALOG_CANCELLATION,
        },
        WindowsAndMessaging::{IDCANCEL, IDNO, IDYES},
    },
};

use crate::{
    app_types::AtomicFlagGuard,
    append_desktop_log,
    desktop_settings::{self, CloseAction},
    runtime_paths, shell_locale, BackendState, DesktopSettingsCache, DEFAULT_SHELL_LOCALE,
};

static PROMPT_OPEN: AtomicBool = AtomicBool::new(false);

fn is_english() -> bool {
    shell_locale::resolve_shell_locale(
        DEFAULT_SHELL_LOCALE,
        runtime_paths::default_packaged_root_dir(),
    ) == "en-US"
}

fn task_dialog(window: &Window, english: bool) -> Result<Option<(CloseAction, bool)>, String> {
    let [question, tray, exit, cancel, remember] = if english {
        [
            w!("Close AstrBot?"),
            w!("Minimize to Tray"),
            w!("Quit"),
            w!("Cancel"),
            w!("Remember my choice"),
        ]
    } else {
        [
            w!("关闭 AstrBot？"),
            w!("最小化到托盘"),
            w!("退出"),
            w!("取消"),
            w!("记住我的选择"),
        ]
    };
    let buttons =
        [(IDYES, tray), (IDNO, exit), (IDCANCEL, cancel)].map(|(id, text)| TASKDIALOG_BUTTON {
            nButtonID: id,
            pszButtonText: text,
        });
    let owner = window.hwnd().map_err(|error| error.to_string())?;
    let config = TASKDIALOGCONFIG {
        cbSize: size_of::<TASKDIALOGCONFIG>() as u32,
        hwndParent: owner.0,
        dwFlags: TDF_ALLOW_DIALOG_CANCELLATION,
        pszWindowTitle: w!("AstrBot"),
        pszMainInstruction: question,
        cButtons: buttons.len() as u32,
        pButtons: buttons.as_ptr(),
        nDefaultButton: IDCANCEL,
        pszVerificationText: remember,
        // SAFETY: Unused fields are null pointers, zero flags/counts, or an absent callback.
        ..unsafe { zeroed() }
    };
    let (mut button, mut checked) = (0, 0);
    // SAFETY: The owner is a Tauri window and all buffers live through the synchronous call.
    // https://learn.microsoft.com/en-us/windows/win32/api/commctrl/nf-commctrl-taskdialogindirect
    let result = unsafe { TaskDialogIndirect(&config, &mut button, null_mut(), &mut checked) };
    if result < 0 {
        return Err(format!("TaskDialogIndirect failed: {result:#010x}"));
    }
    Ok(match button {
        IDYES => Some((CloseAction::HideToTray, checked != 0)),
        IDNO => Some((CloseAction::Exit, checked != 0)),
        _ => None,
    })
}

fn save_choice(app: &AppHandle, choice: Option<CloseAction>) -> Result<(), String> {
    let root = runtime_paths::default_packaged_root_dir();
    app.state::<DesktopSettingsCache>()
        .update(|_| desktop_settings::write_windows_close_action(root.as_deref(), choice))
}

fn preference_error_text(english: bool) -> &'static str {
    if english {
        "The close preference could not be saved. Your previous preference is unchanged."
    } else {
        "无法保存关闭偏好，原有设置未更改。"
    }
}

pub(crate) fn reset_choice(app: &AppHandle) {
    if let Err(error) = save_choice(app, None) {
        append_desktop_log(&format!("failed to reset Windows close choice: {error}"));
        app.dialog()
            .message(preference_error_text(is_english()))
            .show(|_| {});
    }
}

pub(crate) fn show(window: &Window) {
    let Some(guard) = AtomicFlagGuard::try_set(&PROMPT_OPEN) else {
        return;
    };
    let window = window.clone();
    // Let the close handler return before the modal dialog starts sending messages to its owner.
    tauri::async_runtime::spawn_blocking(move || {
        let app = window.app_handle();
        let english = is_english();
        let choice = match task_dialog(&window, english) {
            Ok(choice) => choice,
            Err(error) => {
                append_desktop_log(&format!("failed to show Windows close prompt: {error}"));
                let message = if english {
                    "Minimize AstrBot to the tray? Choose No to quit."
                } else {
                    "将 AstrBot 最小化到托盘？选择「否」退出。"
                };
                match app
                    .dialog()
                    .message(message)
                    .parent(&window)
                    .buttons(MessageDialogButtons::YesNoCancel)
                    .blocking_show_with_result()
                {
                    MessageDialogResult::Yes => Some((CloseAction::HideToTray, false)),
                    MessageDialogResult::No => Some((CloseAction::Exit, false)),
                    _ => None,
                }
            }
        };
        let Some((choice, remember)) =
            choice.filter(|_| !app.state::<BackendState>().is_quitting())
        else {
            return;
        };
        if remember {
            if let Err(error) = save_choice(app, Some(choice)) {
                append_desktop_log(&format!("failed to remember Windows close choice: {error}"));
                app.dialog()
                    .message(preference_error_text(english))
                    .parent(&window)
                    .blocking_show();
            }
        }
        let handle = app.clone();
        if let Err(error) = app.run_on_main_thread(move || {
            let _guard = guard;
            if !handle.state::<BackendState>().is_quitting() {
                super::actions::apply_close_action(&handle, choice);
            }
        }) {
            append_desktop_log(&format!("failed to apply Windows close choice: {error}"));
        }
    });
}
