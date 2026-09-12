use serde::Serialize;
use std::time::{Duration, Instant};

pub(crate) const APP_UPDATE_PROGRESS_EVENT: &str = "astrbot://app-update-progress";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUpdateProgress {
    pub phase: &'static str,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
}

impl AppUpdateProgress {
    pub fn stage(phase: &'static str) -> Self {
        Self {
            phase,
            downloaded_bytes: 0,
            total_bytes: None,
        }
    }
}

pub(crate) struct DownloadProgress {
    downloaded_bytes: u64,
    last_emitted_at: Option<Instant>,
}

impl DownloadProgress {
    pub fn new() -> Self {
        Self {
            downloaded_bytes: 0,
            last_emitted_at: None,
        }
    }

    pub fn chunk(
        &mut self,
        bytes: usize,
        total: Option<u64>,
        now: Instant,
    ) -> Option<AppUpdateProgress> {
        self.downloaded_bytes = self.downloaded_bytes.saturating_add(bytes as u64);
        let total_bytes = total.filter(|total| *total > 0);
        let finished = total_bytes.is_some_and(|total| self.downloaded_bytes >= total);
        if !finished
            && self
                .last_emitted_at
                .is_some_and(|last| now.duration_since(last) < Duration::from_millis(100))
        {
            return None;
        }
        self.last_emitted_at = Some(now);
        Some(AppUpdateProgress {
            phase: "downloading",
            downloaded_bytes: self.downloaded_bytes,
            total_bytes,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn throttled_chunks_still_count_toward_final_progress() {
        let mut progress = DownloadProgress::new();
        let now = Instant::now();
        assert_eq!(
            progress.chunk(10, Some(30), now).unwrap().downloaded_bytes,
            10
        );
        assert!(progress.chunk(10, Some(30), now).is_none());
        let finished = progress.chunk(10, Some(30), now).unwrap();
        assert_eq!(finished.downloaded_bytes, 30);
        assert_eq!(finished.total_bytes, Some(30));
    }

    #[test]
    fn missing_or_zero_length_keeps_reporting_bytes_without_a_total() {
        let mut progress = DownloadProgress::new();
        let now = Instant::now();
        assert_eq!(progress.chunk(10, None, now).unwrap().total_bytes, None);
        let next = progress
            .chunk(20, Some(0), now + Duration::from_millis(100))
            .unwrap();
        assert_eq!(next.downloaded_bytes, 30);
        assert_eq!(next.total_bytes, None);
    }

    #[test]
    fn progress_payload_uses_the_webui_contract() {
        let payload = serde_json::to_value(AppUpdateProgress::stage("installing")).unwrap();
        assert_eq!(
            payload,
            serde_json::json!({"phase": "installing", "downloadedBytes": 0, "totalBytes": null})
        );
    }
}
