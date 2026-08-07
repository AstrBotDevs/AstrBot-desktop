use std::{
    io::{ErrorKind, Read, Write},
    net::{TcpStream, ToSocketAddrs},
    time::Duration,
};

use url::Url;

use crate::{
    backend::http_response,
    desktop_auth::{DesktopAuthSession, DESKTOP_SESSION_ENDPOINT, DESKTOP_SESSION_HEADER},
    BackendState, DESKTOP_AUTH_REQUEST_TIMEOUT_MS, GRACEFUL_RESTART_START_TIME_TIMEOUT_MS,
};

#[derive(Default)]
struct BackendRequestOptions<'a> {
    auth_token: Option<&'a str>,
    desktop_session_secret: Option<&'a str>,
    require_loopback: bool,
}

impl BackendState {
    pub(crate) fn ping_backend(&self, timeout_ms: u64) -> bool {
        let parsed = match Url::parse(&self.backend_url) {
            Ok(url) => url,
            Err(_) => return false,
        };
        let host = match parsed.host_str() {
            Some(host) => host.to_string(),
            None => return false,
        };
        let port = parsed.port_or_known_default().unwrap_or(80);
        let timeout = Duration::from_millis(timeout_ms.max(50));

        let addrs = match (host.as_str(), port).to_socket_addrs() {
            Ok(addrs) => addrs.collect::<Vec<_>>(),
            Err(_) => return false,
        };
        addrs
            .iter()
            .any(|address| TcpStream::connect_timeout(address, timeout).is_ok())
    }

    pub(crate) fn request_backend_response_bytes(
        &self,
        method: &str,
        api_path: &str,
        timeout_ms: u64,
        body: Option<&str>,
        auth_token: Option<&str>,
    ) -> Option<Vec<u8>> {
        self.request_backend_response_bytes_internal(
            method,
            api_path,
            timeout_ms,
            body,
            BackendRequestOptions {
                auth_token,
                ..BackendRequestOptions::default()
            },
        )
    }

    fn request_backend_response_bytes_internal(
        &self,
        method: &str,
        api_path: &str,
        timeout_ms: u64,
        body: Option<&str>,
        options: BackendRequestOptions<'_>,
    ) -> Option<Vec<u8>> {
        let base = Url::parse(&self.backend_url).ok()?;
        let request_url = base.join(api_path).ok()?;
        if request_url.scheme() != "http" {
            return None;
        }

        let host = request_url.host_str()?;
        let port = request_url.port_or_known_default().unwrap_or(80);
        let timeout = Duration::from_millis(timeout_ms.max(50));
        let addrs = (host, port).to_socket_addrs().ok()?;
        let mut stream = addrs.into_iter().find_map(|address| {
            if options.require_loopback && !is_loopback_socket_address(&address) {
                return None;
            }
            TcpStream::connect_timeout(&address, timeout).ok()
        })?;
        let _ = stream.set_read_timeout(Some(timeout));
        let _ = stream.set_write_timeout(Some(timeout));

        let mut request_target = request_url.path().to_string();
        if let Some(query) = request_url.query() {
            request_target.push('?');
            request_target.push_str(query);
        }
        if request_target.is_empty() {
            request_target = "/".to_string();
        }

        let payload = body.unwrap_or("");
        let authorization_header = options
            .auth_token
            .and_then(sanitize_authorization_token)
            .map(|token| format!("Authorization: Bearer {token}\r\n"))
            .unwrap_or_default();
        let desktop_session_header = options
            .desktop_session_secret
            .and_then(sanitize_http_header_value)
            .map(|secret| format!("{DESKTOP_SESSION_HEADER}: {secret}\r\n"))
            .unwrap_or_default();
        let request = format!(
            "{method} {request_target} HTTP/1.1\r\n\
Host: {host}\r\n\
Accept: application/json\r\n\
Accept-Encoding: identity\r\n\
Connection: close\r\n\
{authorization_header}\
{desktop_session_header}\
Content-Type: application/json\r\n\
Content-Length: {}\r\n\
\r\n\
{}",
            payload.len(),
            payload
        );
        if stream.write_all(request.as_bytes()).is_err() {
            return None;
        }

        read_http_response_bytes(&mut stream)
    }

    pub(crate) fn request_backend_with<T, F>(
        &self,
        method: &str,
        api_path: &str,
        timeout_ms: u64,
        body: Option<&str>,
        auth_token: Option<&str>,
        parse: F,
    ) -> Option<T>
    where
        F: FnOnce(&[u8]) -> Option<T>,
    {
        let response =
            self.request_backend_response_bytes(method, api_path, timeout_ms, body, auth_token)?;
        parse(&response)
    }

    pub(crate) fn request_backend_json(
        &self,
        method: &str,
        api_path: &str,
        timeout_ms: u64,
        body: Option<&str>,
        auth_token: Option<&str>,
    ) -> Option<serde_json::Value> {
        self.request_backend_with(
            method,
            api_path,
            timeout_ms,
            body,
            auth_token,
            http_response::parse_http_json_response,
        )
    }

    pub(crate) fn request_backend_status_code(
        &self,
        method: &str,
        api_path: &str,
        timeout_ms: u64,
        body: Option<&str>,
        auth_token: Option<&str>,
    ) -> Option<u16> {
        self.request_backend_with(
            method,
            api_path,
            timeout_ms,
            body,
            auth_token,
            http_response::parse_http_status_code,
        )
    }

    pub(crate) fn fetch_backend_start_time(&self) -> Option<i64> {
        let payload = self.request_backend_json(
            "GET",
            "/api/stat/start-time",
            GRACEFUL_RESTART_START_TIME_TIMEOUT_MS,
            None,
            None,
        )?;
        http_response::parse_backend_start_time(&payload)
    }

    pub(crate) fn request_desktop_auth_session(&self) -> Option<DesktopAuthSession> {
        let response = self.request_backend_response_bytes_internal(
            "POST",
            DESKTOP_SESSION_ENDPOINT,
            DESKTOP_AUTH_REQUEST_TIMEOUT_MS,
            Some("{}"),
            BackendRequestOptions {
                desktop_session_secret: Some(self.desktop_session_secret.as_str()),
                require_loopback: true,
                ..BackendRequestOptions::default()
            },
        )?;
        let payload = http_response::parse_http_json_response(&response)?;
        parse_desktop_auth_session(&payload)
    }
}

fn is_loopback_socket_address(address: &std::net::SocketAddr) -> bool {
    match address.ip() {
        std::net::IpAddr::V4(ipv4) => ipv4.is_loopback(),
        std::net::IpAddr::V6(ipv6) => {
            ipv6.is_loopback() || ipv6.to_ipv4_mapped().is_some_and(|ipv4| ipv4.is_loopback())
        }
    }
}

fn parse_desktop_auth_session(payload: &serde_json::Value) -> Option<DesktopAuthSession> {
    if payload.get("status").and_then(|value| value.as_str()) != Some("ok") {
        return None;
    }

    let data = payload.get("data")?;
    let token = data
        .get("token")
        .and_then(|value| value.as_str())
        .and_then(sanitize_authorization_token)?
        .to_string();
    let username = data.get("username")?.as_str()?.trim();
    if username.is_empty() {
        return None;
    }

    Some(DesktopAuthSession {
        token,
        username: username.to_string(),
    })
}

fn is_complete_http_response(raw: &[u8]) -> bool {
    let Some(header_end) = raw.windows(4).position(|window| window == b"\r\n\r\n") else {
        return false;
    };
    let headers = &raw[..header_end + 4];
    let body = &raw[header_end + 4..];
    let header_text = String::from_utf8_lossy(headers).to_ascii_lowercase();

    if header_text.contains("transfer-encoding: chunked") {
        return body.windows(5).any(|window| window == b"0\r\n\r\n");
    }

    if let Some(content_length) = header_text
        .lines()
        .find_map(|line| line.strip_prefix("content-length:"))
        .and_then(|value| value.trim().parse::<usize>().ok())
    {
        return body.len() >= content_length;
    }

    false
}

fn sanitize_authorization_token(token: &str) -> Option<&str> {
    if token.contains('\r') || token.contains('\n') {
        return None;
    }
    let token = token.trim();
    if token.is_empty() {
        return None;
    }
    Some(token)
}

fn sanitize_http_header_value(value: &str) -> Option<&str> {
    if value.is_empty() || value.contains('\r') || value.contains('\n') {
        return None;
    }
    Some(value)
}

fn read_http_response_bytes<R: Read>(reader: &mut R) -> Option<Vec<u8>> {
    let mut response = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        match reader.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => {
                response.extend_from_slice(&chunk[..read]);
                if is_complete_http_response(&response) {
                    break;
                }
            }
            Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
                if response.is_empty() {
                    return None;
                }
                break;
            }
            Err(_) => return None,
        }
    }

    if response.is_empty() {
        None
    } else {
        Some(response)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_complete_http_response_respects_content_length() {
        let raw = b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\ntest";
        assert!(is_complete_http_response(raw));
    }

    #[test]
    fn desktop_secret_requests_only_accept_loopback_socket_addresses() {
        assert!(is_loopback_socket_address(
            &"127.0.0.1:6185".parse().expect("IPv4 address should parse")
        ));
        assert!(is_loopback_socket_address(
            &"[::1]:6185".parse().expect("IPv6 address should parse")
        ));
        assert!(is_loopback_socket_address(
            &"[::ffff:127.0.0.1]:6185"
                .parse()
                .expect("mapped IPv6 address should parse")
        ));
        assert!(!is_loopback_socket_address(
            &"192.168.1.10:6185"
                .parse()
                .expect("remote address should parse")
        ));
    }

    #[test]
    fn sanitize_authorization_token_rejects_crlf() {
        assert_eq!(sanitize_authorization_token("abc\r\ndef"), None);
    }

    #[test]
    fn sanitize_authorization_token_trims_and_accepts_normal_token() {
        assert_eq!(sanitize_authorization_token("  token  "), Some("token"));
    }

    #[test]
    fn sanitize_http_header_value_rejects_empty_and_crlf_values() {
        assert_eq!(sanitize_http_header_value(""), None);
        assert_eq!(sanitize_http_header_value("secret\r\nInjected: true"), None);
        assert_eq!(sanitize_http_header_value("secret"), Some("secret"));
    }

    #[test]
    fn parse_desktop_auth_session_requires_successful_complete_payload() {
        let payload = serde_json::json!({
            "status": "ok",
            "data": {
                "token": "desktop-jwt",
                "username": "astrbot"
            }
        });

        let session = parse_desktop_auth_session(&payload).expect("session should parse");
        assert_eq!(session.token, "desktop-jwt");
        assert_eq!(session.username, "astrbot");

        assert!(parse_desktop_auth_session(&serde_json::json!({
            "status": "error",
            "data": {"token": "desktop-jwt", "username": "astrbot"}
        }))
        .is_none());
        assert!(parse_desktop_auth_session(&serde_json::json!({
            "status": "ok",
            "data": {"token": "desktop-jwt"}
        }))
        .is_none());
    }

    #[test]
    fn read_http_response_bytes_keeps_partial_data_on_timeout() {
        struct TimeoutReader {
            chunks: Vec<Result<&'static [u8], std::io::ErrorKind>>,
            index: usize,
        }

        impl Read for TimeoutReader {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                if self.index >= self.chunks.len() {
                    return Ok(0);
                }
                let chunk = self.chunks[self.index];
                self.index += 1;
                match chunk {
                    Ok(bytes) => {
                        let n = bytes.len().min(buf.len());
                        buf[..n].copy_from_slice(&bytes[..n]);
                        Ok(n)
                    }
                    Err(kind) => Err(std::io::Error::from(kind)),
                }
            }
        }

        let mut reader = TimeoutReader {
            chunks: vec![
                Ok(b"HTTP/1.1 200 OK\r\n"),
                Err(std::io::ErrorKind::TimedOut),
            ],
            index: 0,
        };
        let bytes = read_http_response_bytes(&mut reader).expect("expected partial response");
        assert_eq!(bytes, b"HTTP/1.1 200 OK\r\n");
    }
}
