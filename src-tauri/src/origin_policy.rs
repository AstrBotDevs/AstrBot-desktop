use std::net::IpAddr;
use url::Url;

#[derive(Debug, Clone, Copy)]
pub struct TrayOriginDecision {
    pub uses_backend_origin: bool,
}

fn same_origin(left: &Url, right: &Url) -> bool {
    left.scheme() == right.scheme()
        && left.host_str() == right.host_str()
        && left.port_or_known_default() == right.port_or_known_default()
}

fn is_loopback_host(host: Option<&str>) -> bool {
    match host {
        Some("localhost") => true,
        Some(raw) => raw.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback()),
        None => false,
    }
}

pub fn tray_origin_decision(backend_url: &Url, window_url: &Url) -> TrayOriginDecision {
    if same_origin(backend_url, window_url) {
        return TrayOriginDecision {
            uses_backend_origin: true,
        };
    }
    let backend_scheme = backend_url.scheme();
    let window_scheme = window_url.scheme();
    if !matches!(backend_scheme, "http" | "https") || !matches!(window_scheme, "http" | "https") {
        return TrayOriginDecision {
            uses_backend_origin: false,
        };
    }

    let loopback_http =
        is_loopback_host(backend_url.host_str()) && is_loopback_host(window_url.host_str());
    if !loopback_http {
        return TrayOriginDecision {
            uses_backend_origin: false,
        };
    }

    let same_port = backend_url.port_or_known_default() == window_url.port_or_known_default();
    TrayOriginDecision {
        uses_backend_origin: same_port,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_origin_decision_accepts_same_origin() {
        let backend = Url::parse("http://127.0.0.1:6185/api").expect("parse backend url");
        let page = Url::parse("http://127.0.0.1:6185/dashboard").expect("parse page url");
        let decision = tray_origin_decision(&backend, &page);
        assert!(decision.uses_backend_origin);
    }

    #[test]
    fn tray_origin_decision_rejects_non_http_scheme() {
        let backend = Url::parse("ws://127.0.0.1:6185").expect("parse backend url");
        let page = Url::parse("http://127.0.0.1:6185").expect("parse page url");
        let decision = tray_origin_decision(&backend, &page);
        assert!(!decision.uses_backend_origin);
    }

    #[test]
    fn tray_origin_decision_accepts_loopback_with_same_port() {
        let backend = Url::parse("http://127.0.0.1:6185").expect("parse backend url");
        let page = Url::parse("http://localhost:6185/index").expect("parse page url");
        let decision = tray_origin_decision(&backend, &page);
        assert!(decision.uses_backend_origin);
    }

    #[test]
    fn tray_origin_decision_rejects_different_ports() {
        let backend = Url::parse("http://127.0.0.1:6185").expect("parse backend url");
        let page = Url::parse("http://localhost:3000").expect("parse page url");
        let decision = tray_origin_decision(&backend, &page);
        assert!(!decision.uses_backend_origin);
    }
}
