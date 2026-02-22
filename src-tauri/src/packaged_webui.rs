use std::path::{Path, PathBuf};

use crate::{runtime_paths, shell_locale, webui_paths};

fn packaged_webui_unavailable_error(locale: &str, embedded_index: Option<&Path>) -> String {
    if locale == "en-US" {
        if let Some(index) = embedded_index {
            return format!(
                "Packaged WebUI is unavailable. Missing embedded index at {} and fallback data/dist. Please reinstall AstrBot or download the matching dist.zip to data/dist.",
                index.display()
            );
        }
        return "Packaged WebUI directory is missing and fallback data/dist is unavailable. Please reinstall AstrBot or download the matching dist.zip to data/dist."
            .to_string();
    }

    if let Some(index) = embedded_index {
        return format!(
            "内置 WebUI 不可用。缺少内置入口文件：{}，且回退目录 data/dist 也不可用。请重装 AstrBot，或下载匹配版本的 dist.zip 到 data/dist。",
            index.display()
        );
    }

    "内置 WebUI 目录缺失，且回退目录 data/dist 也不可用。请重装 AstrBot，或下载匹配版本的 dist.zip 到 data/dist。".to_string()
}

pub fn resolve_packaged_webui_dir<F>(
    embedded_webui_dir: Option<PathBuf>,
    root_dir: Option<&Path>,
    default_shell_locale: &'static str,
    log: F,
) -> Result<PathBuf, String>
where
    F: Fn(&str),
{
    let locale = shell_locale::resolve_shell_locale(
        default_shell_locale,
        runtime_paths::default_packaged_root_dir(),
    );
    let fallback_webui_dir = webui_paths::packaged_fallback_webui_dir(
        root_dir,
        runtime_paths::default_packaged_root_dir(),
    );

    match embedded_webui_dir {
        Some(candidate) => {
            let embedded_index = candidate.join("index.html");
            if embedded_index.is_file() {
                return Ok(candidate);
            }

            log(&format!(
                "packaged webui index is missing at {}, trying fallback data/dist",
                embedded_index.display()
            ));

            if let Some(fallback) = fallback_webui_dir {
                log(&format!(
                    "using fallback webui directory: {}",
                    fallback.display()
                ));
                return Ok(fallback);
            }

            let fallback_index = webui_paths::packaged_fallback_webui_index_display(
                root_dir,
                runtime_paths::default_packaged_root_dir(),
            );
            log(&format!(
                "packaged webui resolution failed: embedded index missing at {}, fallback index missing at {}",
                embedded_index.display(),
                fallback_index
            ));

            Err(packaged_webui_unavailable_error(
                locale,
                Some(&embedded_index),
            ))
        }
        None => {
            if let Some(fallback) = fallback_webui_dir {
                log(&format!(
                    "embedded webui directory not found, using fallback webui directory: {}",
                    fallback.display()
                ));
                return Ok(fallback);
            }

            let fallback_index = webui_paths::packaged_fallback_webui_index_display(
                root_dir,
                runtime_paths::default_packaged_root_dir(),
            );
            log(&format!(
                "packaged webui resolution failed: embedded webui directory is missing, fallback index missing at {}",
                fallback_index
            ));

            Err(packaged_webui_unavailable_error(locale, None))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packaged_webui_unavailable_error_renders_english_message() {
        let message = packaged_webui_unavailable_error("en-US", None);
        assert!(message.contains("Packaged WebUI directory is missing"));
    }
}
