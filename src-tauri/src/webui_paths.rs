use std::path::{Path, PathBuf};

pub fn packaged_fallback_webui_probe_dir(
    root_dir: Option<&Path>,
    packaged_root_dir: Option<PathBuf>,
) -> Option<PathBuf> {
    match root_dir {
        Some(root) => Some(root.join("data").join("dist")),
        None => packaged_root_dir.map(|root| root.join("data").join("dist")),
    }
}

pub fn packaged_fallback_webui_dir(
    root_dir: Option<&Path>,
    packaged_root_dir: Option<PathBuf>,
) -> Option<PathBuf> {
    let candidate = packaged_fallback_webui_probe_dir(root_dir, packaged_root_dir)?;
    if candidate.join("index.html").is_file() {
        Some(candidate)
    } else {
        None
    }
}

pub fn packaged_fallback_webui_index_display(
    root_dir: Option<&Path>,
    packaged_root_dir: Option<PathBuf>,
) -> String {
    packaged_fallback_webui_probe_dir(root_dir, packaged_root_dir)
        .map(|path| path.join("index.html").display().to_string())
        .unwrap_or_else(|| "<unresolved>".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn packaged_fallback_prefers_explicit_root_dir() {
        let temp_dir = std::env::temp_dir().join("astrbot-webui-paths-explicit");
        let _ = fs::remove_dir_all(&temp_dir);
        let probe_dir = temp_dir.join("data").join("dist");
        fs::create_dir_all(&probe_dir).expect("create probe dir");
        fs::write(probe_dir.join("index.html"), "<html></html>").expect("write index");

        let resolved = packaged_fallback_webui_dir(Some(&temp_dir), None);
        assert_eq!(resolved, Some(probe_dir));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn packaged_fallback_display_unresolved_when_no_root_available() {
        let display = packaged_fallback_webui_index_display(None, None);
        assert_eq!(display, "<unresolved>");
    }
}
