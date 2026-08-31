use tauri::{AppHandle, Manager};
use url::Url;

const DASHBOARD_CACHE_QUERY_KEY: &str = "astrbot_bundle";

fn backend_dashboard_url(backend_url: &str, cache_version: Option<&str>) -> Result<String, String> {
    let Some(cache_version) = cache_version
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(backend_url.to_string());
    };
    let mut url = Url::parse(backend_url)
        .map_err(|error| format!("Invalid backend dashboard URL {backend_url:?}: {error}"))?;
    let existing_pairs = url
        .query_pairs()
        .filter(|(key, _)| key.as_ref() != DASHBOARD_CACHE_QUERY_KEY)
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<Vec<_>>();
    url.set_query(None);
    {
        let mut query = url.query_pairs_mut();
        for (key, value) in existing_pairs {
            query.append_pair(&key, &value);
        }
        query.append_pair(DASHBOARD_CACHE_QUERY_KEY, cache_version);
    }
    Ok(url.to_string())
}

pub fn show_main_window<F>(app_handle: &AppHandle, log: F)
where
    F: Fn(&str),
{
    let Some(window) = app_handle.get_webview_window("main") else {
        log("show_main_window skipped: main window not found");
        return;
    };

    if let Err(error) = window.unminimize() {
        log(&format!("failed to unminimize main window: {error}"));
    }
    if let Err(error) = window.show() {
        log(&format!("failed to show main window: {error}"));
    }
    if let Err(error) = window.set_focus() {
        log(&format!("failed to focus main window: {error}"));
    }
}

pub fn hide_main_window<F>(app_handle: &AppHandle, log: F)
where
    F: Fn(&str),
{
    let Some(window) = app_handle.get_webview_window("main") else {
        log("hide_main_window skipped: main window not found");
        return;
    };
    if let Err(error) = window.hide() {
        log(&format!("failed to hide main window: {error}"));
    }
}

pub fn reload_main_window<F>(app_handle: &AppHandle, log: F)
where
    F: Fn(&str),
{
    let Some(window) = app_handle.get_webview_window("main") else {
        log("reload_main_window skipped: main window not found");
        return;
    };
    if let Err(error) = window.reload() {
        log(&format!("failed to reload main window: {error}"));
    }
}

pub fn navigate_main_window_to_backend(
    app_handle: &AppHandle,
    backend_url: &str,
    cache_version: Option<&str>,
) -> Result<(), String> {
    let backend_url = backend_dashboard_url(backend_url, cache_version)?;
    let backend_url_json =
        serde_json::to_string(&backend_url).unwrap_or_else(|_| "\"/\"".to_string());
    let Some(window) = app_handle.get_webview_window("main") else {
        return Err("Main window is unavailable after backend startup.".to_string());
    };

    let js = format!("window.location.replace({backend_url_json});");
    window
        .eval(&js)
        .map_err(|error| format!("Failed to navigate to backend dashboard: {error}"))
}

#[cfg(test)]
mod tests {
    use super::backend_dashboard_url;

    #[test]
    fn dashboard_cache_version_is_stable_and_preserves_query_and_fragment() {
        let input = "http://127.0.0.1:6185/dashboard?locale=zh-CN&astrbot_bundle=stale#settings";
        let version = "desktop-4.27.4-core-4.27.4";

        let first = backend_dashboard_url(input, Some(version)).expect("build dashboard URL");
        let second = backend_dashboard_url(input, Some(version)).expect("build dashboard URL");

        assert_eq!(first, second);
        assert_eq!(
            first,
            "http://127.0.0.1:6185/dashboard?locale=zh-CN&astrbot_bundle=desktop-4.27.4-core-4.27.4#settings"
        );
        assert_eq!(
            backend_dashboard_url("http://127.0.0.1:6185/", Some(version))
                .expect("build default dashboard URL"),
            "http://127.0.0.1:6185/?astrbot_bundle=desktop-4.27.4-core-4.27.4"
        );
    }

    #[test]
    fn dashboard_url_is_unchanged_without_a_packaged_cache_version() {
        let input = "http://127.0.0.1:6185/?locale=en-US#chat";

        assert_eq!(
            backend_dashboard_url(input, None).expect("keep dashboard URL"),
            input
        );
    }
}
