use std::{
    io::{ErrorKind, Read, Write},
    net::{SocketAddr, TcpStream, ToSocketAddrs},
    time::{Duration, Instant},
};

use url::{Host, Url};

use crate::{
    backend::http_response,
    desktop_auth::{DesktopAuthSession, DESKTOP_SESSION_ENDPOINT, DESKTOP_SESSION_HEADER},
    BackendState, DESKTOP_AUTH_REQUEST_TIMEOUT_MS, GRACEFUL_RESTART_START_TIME_TIMEOUT_MS,
};

const MAX_BACKEND_HTTP_HEADER_BYTES: usize = 64 * 1024;
const MAX_BACKEND_HTTP_BODY_BYTES: usize = 32 * 1024 * 1024;

/// Require refused connections on every resolved address before permitting a respawn.
fn confirm_backend_endpoint_available_with_resolver<F>(
    backend_url: &str,
    timeout: Duration,
    resolve: F,
) -> Result<(), String>
where
    F: FnOnce(String, u16) -> std::io::Result<Vec<SocketAddr>> + Send + 'static,
{
    let inconclusive = |reason: &str| {
        format!(
            "Cannot confirm backend endpoint {backend_url} is available: {reason}. Refusing to start another backend."
        )
    };
    let deadline = Instant::now()
        .checked_add(timeout)
        .ok_or_else(|| inconclusive("invalid probe timeout"))?;
    let parsed =
        Url::parse(backend_url).map_err(|error| inconclusive(&format!("invalid URL: {error}")))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(inconclusive("unsupported backend URL scheme"));
    }
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| inconclusive("URL has no port"))?;
    let addrs = match parsed.host() {
        Some(Host::Ipv4(ip)) => vec![SocketAddr::from((ip, port))],
        Some(Host::Ipv6(ip)) => vec![SocketAddr::from((ip, port))],
        Some(Host::Domain(host)) => {
            let host = host.to_string();
            let (sender, receiver) = std::sync::mpsc::sync_channel(1);
            // The OS resolver cannot be cancelled. Bound the caller's wait and let a
            // late worker discard its result after the receiver has been dropped.
            std::thread::Builder::new()
                .name("backend-endpoint-resolver".to_string())
                .spawn(move || {
                    let _ = sender.send(resolve(host, port));
                })
                .map_err(|error| {
                    inconclusive(&format!("could not start name resolution: {error}"))
                })?;
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .filter(|remaining| !remaining.is_zero())
                .ok_or_else(|| inconclusive("probe timed out during name resolution"))?;
            receiver
                .recv_timeout(remaining)
                .map_err(|error| inconclusive(&format!("name resolution did not finish: {error}")))?
                .map_err(|error| inconclusive(&format!("name resolution failed: {error}")))?
        }
        None => return Err(inconclusive("URL has no host")),
    };
    if addrs.is_empty() {
        return Err(inconclusive("name resolution returned no addresses"));
    }

    for address in addrs {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .filter(|remaining| !remaining.is_zero())
            .ok_or_else(|| inconclusive("probe timed out"))?;
        match TcpStream::connect_timeout(&address, remaining) {
            Ok(_) => {
                return Err(format!(
                    "Backend endpoint {backend_url} is already answering. Stop the existing backend before starting another."
                ));
            }
            Err(error) if error.kind() == ErrorKind::ConnectionRefused => {}
            Err(error) => {
                return Err(inconclusive(&format!(
                    "connection to {address} failed: {error}"
                )));
            }
        }
    }
    Ok(())
}

trait ResponseReader: Read {
    fn set_response_read_timeout(&self, timeout: Duration) -> std::io::Result<()>;
}

impl ResponseReader for TcpStream {
    fn set_response_read_timeout(&self, timeout: Duration) -> std::io::Result<()> {
        self.set_read_timeout(Some(timeout))
    }
}

#[derive(Default)]
struct BackendRequestOptions<'a> {
    auth_token: Option<&'a str>,
    desktop_session_secret: Option<&'a str>,
    require_loopback: bool,
}

impl BackendState {
    pub(crate) fn confirm_backend_endpoint_available(&self, timeout_ms: u64) -> Result<(), String> {
        confirm_backend_endpoint_available_with_resolver(
            &self.backend_url,
            Duration::from_millis(timeout_ms.max(1)),
            |host, port| {
                (host.as_str(), port)
                    .to_socket_addrs()
                    .map(Iterator::collect)
            },
        )
    }

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
        let deadline = Instant::now().checked_add(timeout)?;
        let addrs = (host, port).to_socket_addrs().ok()?;
        let mut stream = addrs.into_iter().find_map(|address| {
            if options.require_loopback && !is_loopback_socket_address(&address) {
                return None;
            }
            let remaining = deadline.checked_duration_since(Instant::now())?;
            if remaining.is_zero() {
                return None;
            }
            TcpStream::connect_timeout(&address, remaining).ok()
        })?;
        let write_timeout = deadline.checked_duration_since(Instant::now())?;
        if write_timeout.is_zero() {
            return None;
        }
        let _ = stream.set_write_timeout(Some(write_timeout));

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
            .and_then(sanitize_desktop_session_secret)
            .map(|secret| format!("{DESKTOP_SESSION_HEADER}: {secret}\r\n"))
            .unwrap_or_default();
        let request = format!(
            "{method} {request_target} HTTP/1.1\r\n\
Host: {host}\r\n\
Accept: application/json\r\n\
Accept-Encoding: identity\r\n\
Cache-Control: no-cache\r\n\
Pragma: no-cache\r\n\
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

        read_http_response_bytes(&mut stream, deadline)
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

fn sanitize_desktop_session_secret(value: &str) -> Option<&str> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return None;
    }
    Some(value)
}

fn response_exceeds_limits(raw: &[u8]) -> bool {
    let Some(header_end) = raw.windows(4).position(|window| window == b"\r\n\r\n") else {
        return raw.len() > MAX_BACKEND_HTTP_HEADER_BYTES;
    };
    let header_length = header_end + 4;
    if header_length > MAX_BACKEND_HTTP_HEADER_BYTES {
        return true;
    }

    let body_length = raw.len().saturating_sub(header_length);
    if body_length > MAX_BACKEND_HTTP_BODY_BYTES {
        return true;
    }

    let header_text = String::from_utf8_lossy(&raw[..header_length]);
    header_text
        .lines()
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.trim().eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.trim().parse::<usize>().ok())
        .is_some_and(|declared| declared > MAX_BACKEND_HTTP_BODY_BYTES)
}

fn read_http_response_bytes<R: ResponseReader>(
    reader: &mut R,
    deadline: Instant,
) -> Option<Vec<u8>> {
    let mut response = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let remaining = deadline.checked_duration_since(Instant::now())?;
        if remaining.is_zero() {
            return None;
        }
        reader.set_response_read_timeout(remaining).ok()?;
        match reader.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => {
                response.extend_from_slice(&chunk[..read]);
                if Instant::now() >= deadline || response_exceeds_limits(&response) {
                    return None;
                }
                if is_complete_http_response(&response) {
                    break;
                }
            }
            Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
                return None;
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
    fn restart_endpoint_probe_rejects_invalid_urls() {
        let state = BackendState {
            backend_url: "not a backend URL".to_string(),
            ..BackendState::default()
        };

        assert!(
            state.confirm_backend_endpoint_available(50).is_err(),
            "an invalid endpoint must not authorize a replacement backend"
        );
    }

    #[test]
    fn restart_endpoint_probe_rejects_a_listening_backend() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind listener");
        let state = BackendState {
            backend_url: format!(
                "http://{}/",
                listener.local_addr().expect("listener address")
            ),
            ..BackendState::default()
        };

        let error = state
            .confirm_backend_endpoint_available(200)
            .expect_err("an answering endpoint must block a respawn");
        assert!(error.contains("already answering"));
    }

    #[test]
    fn restart_endpoint_probe_accepts_refused_loopback_connections() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind listener");
        let address = listener.local_addr().expect("listener address");
        drop(listener);

        let result = confirm_backend_endpoint_available_with_resolver(
            &format!("http://{address}/"),
            Duration::from_millis(200),
            |_, _| panic!("numeric addresses must not invoke DNS"),
        );
        assert!(
            result.is_ok(),
            "a refused connection must permit respawn: {result:?}"
        );
    }

    #[test]
    fn restart_endpoint_probe_does_not_treat_resolution_errors_as_available() {
        let error = confirm_backend_endpoint_available_with_resolver(
            "http://backend.invalid:6185/",
            Duration::from_millis(200),
            |_, _| Err(std::io::Error::from(ErrorKind::PermissionDenied)),
        )
        .expect_err("an inconclusive resolution must block a respawn");

        assert!(error.contains("Cannot confirm backend endpoint"));
        assert!(error.contains("name resolution failed"));
    }

    #[test]
    fn restart_endpoint_probe_rejects_empty_resolution_results() {
        assert!(confirm_backend_endpoint_available_with_resolver(
            "http://backend.invalid:6185/",
            Duration::from_millis(200),
            |_, _| Ok(Vec::new()),
        )
        .is_err());
    }

    #[test]
    fn restart_endpoint_probe_bounds_hostname_resolution_by_the_total_deadline() {
        let (release, blocked) = std::sync::mpsc::channel();
        let (finished, completed) = std::sync::mpsc::channel();
        let start = Instant::now();
        let result = confirm_backend_endpoint_available_with_resolver(
            "http://backend.invalid:6185/",
            Duration::from_millis(100),
            move |_, _| {
                let _ = blocked.recv_timeout(Duration::from_secs(2));
                let _ = finished.send(());
                Err(std::io::Error::from(ErrorKind::TimedOut))
            },
        );
        let elapsed = start.elapsed();
        let _ = release.send(());
        completed
            .recv_timeout(Duration::from_secs(1))
            .expect("resolver worker must finish after being released");

        assert!(result.is_err(), "a timed-out probe must block a respawn");
        assert!(
            elapsed < Duration::from_secs(1),
            "DNS must share the probe deadline instead of blocking for {elapsed:?}"
        );
    }

    #[test]
    fn restart_endpoint_probe_checks_every_resolved_address() {
        let available_listener =
            std::net::TcpListener::bind("127.0.0.1:0").expect("bind available address");
        let available = available_listener.local_addr().expect("available address");
        let occupied_listener =
            std::net::TcpListener::bind("127.0.0.1:0").expect("bind occupied address");
        let occupied = occupied_listener.local_addr().expect("occupied address");
        drop(available_listener);

        let error = confirm_backend_endpoint_available_with_resolver(
            "http://backend.invalid:6185/",
            Duration::from_millis(200),
            move |_, _| Ok(vec![available, occupied]),
        )
        .expect_err("one answering address must block a respawn");
        assert!(error.contains("already answering"));
    }

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
    fn sanitize_desktop_session_secret_requires_256_bit_lowercase_hex() {
        let secret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

        assert_eq!(sanitize_desktop_session_secret(secret), Some(secret));
        assert_eq!(sanitize_desktop_session_secret(""), None);
        assert_eq!(sanitize_desktop_session_secret("abc123"), None);
        assert_eq!(
            sanitize_desktop_session_secret(
                "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF"
            ),
            None
        );
        assert_eq!(
            sanitize_desktop_session_secret(
                "0123456789abcdef0123456789abcdef\r\nInjected: true!!!!!!!!!!!!!!!"
            ),
            None
        );
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
    fn read_http_response_bytes_rejects_partial_data_on_timeout() {
        struct TimeoutReader {
            chunks: Vec<Result<&'static [u8], std::io::ErrorKind>>,
            index: usize,
        }

        impl ResponseReader for TimeoutReader {
            fn set_response_read_timeout(&self, _timeout: Duration) -> std::io::Result<()> {
                Ok(())
            }
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
        assert!(
            read_http_response_bytes(&mut reader, Instant::now() + Duration::from_secs(1))
                .is_none()
        );
    }

    #[test]
    fn response_limits_reject_oversized_headers_bodies_and_content_length() {
        assert!(response_exceeds_limits(&vec![
            b'a';
            MAX_BACKEND_HTTP_HEADER_BYTES
                + 1
        ]));

        let oversized_length = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n",
            MAX_BACKEND_HTTP_BODY_BYTES + 1
        );
        assert!(response_exceeds_limits(oversized_length.as_bytes()));

        let mut oversized_body = b"HTTP/1.1 200 OK\r\n\r\n".to_vec();
        oversized_body.resize(oversized_body.len() + MAX_BACKEND_HTTP_BODY_BYTES + 1, b'x');
        assert!(response_exceeds_limits(&oversized_body));
    }

    #[test]
    fn read_http_response_bytes_enforces_an_absolute_deadline_across_trickle_reads() {
        struct TrickleReader {
            chunks: Vec<&'static [u8]>,
            index: usize,
        }

        impl ResponseReader for TrickleReader {
            fn set_response_read_timeout(&self, _timeout: Duration) -> std::io::Result<()> {
                Ok(())
            }
        }

        impl Read for TrickleReader {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                if self.index >= self.chunks.len() {
                    return Ok(0);
                }
                std::thread::sleep(Duration::from_millis(35));
                let bytes = self.chunks[self.index];
                self.index += 1;
                buf[..bytes.len()].copy_from_slice(bytes);
                Ok(bytes.len())
            }
        }

        let mut reader = TrickleReader {
            chunks: vec![b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\n", b"test"],
            index: 0,
        };
        assert!(
            read_http_response_bytes(&mut reader, Instant::now() + Duration::from_millis(50))
                .is_none()
        );
    }
}
