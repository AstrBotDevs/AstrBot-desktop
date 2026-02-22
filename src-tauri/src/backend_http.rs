use std::{
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    time::Duration,
};

use url::Url;

use crate::{http_response, BackendState, GRACEFUL_RESTART_START_TIME_TIMEOUT_MS};

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
        let base = Url::parse(&self.backend_url).ok()?;
        let request_url = base.join(api_path).ok()?;
        if request_url.scheme() != "http" {
            return None;
        }

        let host = request_url.host_str()?;
        let port = request_url.port_or_known_default().unwrap_or(80);
        let timeout = Duration::from_millis(timeout_ms.max(50));
        let addrs = (host, port).to_socket_addrs().ok()?;
        let mut stream = addrs
            .into_iter()
            .find_map(|address| TcpStream::connect_timeout(&address, timeout).ok())?;
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
        let authorization_header = auth_token
            .map(str::trim)
            .filter(|token| !token.is_empty())
            .map(|token| format!("Authorization: Bearer {token}\\r\\n"))
            .unwrap_or_default();
        let request = format!(
            "{method} {request_target} HTTP/1.1\\r\\n\
Host: {host}\\r\\n\
Accept: application/json\\r\\n\
Accept-Encoding: identity\\r\\n\
Connection: close\\r\\n\
{authorization_header}\
Content-Type: application/json\\r\\n\
Content-Length: {}\\r\\n\
\\r\\n\
{}",
            payload.len(),
            payload
        );
        if stream.write_all(request.as_bytes()).is_err() {
            return None;
        }

        let mut response = Vec::new();
        if stream.read_to_end(&mut response).is_err() {
            return None;
        }

        Some(response)
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
}
