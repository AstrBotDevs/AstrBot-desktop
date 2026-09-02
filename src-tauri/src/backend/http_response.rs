use std::borrow::Cow;

pub fn parse_http_json_response(raw: &[u8]) -> Option<serde_json::Value> {
    let payload = parse_http_success_body(raw)?;
    serde_json::from_slice(&payload).ok()
}

pub fn parse_http_success_body(raw: &[u8]) -> Option<Vec<u8>> {
    let (header_text, body_bytes) = parse_http_response_parts(raw)?;
    let status_code = parse_http_status_code_from_headers(&header_text)?;
    if !(200..300).contains(&status_code) {
        return None;
    }

    let mut is_chunked = false;
    let mut content_length = None;
    for line in header_text.lines().skip(1) {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim();
        let value = value.trim();
        if name.eq_ignore_ascii_case("transfer-encoding")
            && value
                .split(',')
                .any(|encoding| encoding.trim().eq_ignore_ascii_case("chunked"))
        {
            is_chunked = true;
        }
        if name.eq_ignore_ascii_case("content-encoding")
            && !value.is_empty()
            && !value.eq_ignore_ascii_case("identity")
        {
            // The caller requests identity encoding so a content digest can be
            // compared with the exact packaged file bytes. Fail closed if an
            // intermediary ignores that request.
            return None;
        }
        if name.eq_ignore_ascii_case("content-length") {
            content_length = Some(value.parse::<usize>().ok()?);
        }
    }

    if is_chunked {
        return decode_chunked_body(body_bytes);
    }
    match content_length {
        Some(length) if body_bytes.len() >= length => Some(body_bytes[..length].to_vec()),
        Some(_) => None,
        None => Some(body_bytes.to_vec()),
    }
}

pub fn parse_http_status_code(raw: &[u8]) -> Option<u16> {
    let (header_text, _) = parse_http_response_parts(raw)?;
    parse_http_status_code_from_headers(&header_text)
}

pub fn parse_backend_start_time(payload: &serde_json::Value) -> Option<i64> {
    if payload.get("status").and_then(|value| value.as_str()) != Some("ok") {
        return None;
    }
    let start_time = payload.get("data")?.get("start_time")?;
    if let Some(value) = start_time.as_i64() {
        return Some(value);
    }
    start_time
        .as_u64()
        .and_then(|value| i64::try_from(value).ok())
}

fn parse_http_response_parts(raw: &[u8]) -> Option<(Cow<'_, str>, &[u8])> {
    let header_end = raw.windows(4).position(|window| window == b"\r\n\r\n")?;
    let (header_bytes, body_bytes) = raw.split_at(header_end + 4);
    Some((String::from_utf8_lossy(header_bytes), body_bytes))
}

fn parse_http_status_code_from_headers(header_text: &str) -> Option<u16> {
    header_text
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
}

fn decode_chunked_body(mut input: &[u8]) -> Option<Vec<u8>> {
    let mut output = Vec::new();

    loop {
        let header_end = input.windows(2).position(|window| window == b"\r\n")?;
        let chunk_size_line = std::str::from_utf8(&input[..header_end]).ok()?;
        let chunk_size_hex = chunk_size_line.split(';').next()?.trim();
        let chunk_size = usize::from_str_radix(chunk_size_hex, 16).ok()?;
        input = &input[header_end + 2..];

        if chunk_size == 0 {
            return Some(output);
        }
        let required_length = chunk_size.checked_add(2)?;
        if input.len() < required_length {
            return None;
        }

        output.extend_from_slice(&input[..chunk_size]);
        if &input[chunk_size..required_length] != b"\r\n" {
            return None;
        }
        input = &input[required_length..];
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_http_status_code_extracts_status_line() {
        let raw = b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n";
        assert_eq!(parse_http_status_code(raw), Some(204));
    }

    #[test]
    fn parse_http_json_response_reads_plain_json_body() {
        let raw = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"ok\":true}";
        let parsed = parse_http_json_response(raw).expect("expected json payload");
        assert_eq!(parsed["ok"], json!(true));
    }

    #[test]
    fn parse_http_json_response_reads_chunked_json_body() {
        let raw =
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nb\r\n{\"ok\":true}\r\n0\r\n\r\n";
        let parsed = parse_http_json_response(raw).expect("expected chunked json payload");
        assert_eq!(parsed["ok"], json!(true));
    }

    #[test]
    fn parse_http_success_body_returns_exact_identity_encoded_payload() {
        let raw = b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nContent-Encoding: identity\r\n\r\nindexignored";
        assert_eq!(parse_http_success_body(raw), Some(b"index".to_vec()));
    }

    #[test]
    fn parse_http_success_body_rejects_encoded_or_incomplete_payloads() {
        let encoded = b"HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\n\r\ncompressed";
        assert_eq!(parse_http_success_body(encoded), None);

        let incomplete = b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nabc";
        assert_eq!(parse_http_success_body(incomplete), None);
    }

    #[test]
    fn parse_http_json_response_rejects_non_success_status() {
        let raw = b"HTTP/1.1 500 Internal Server Error\r\nContent-Type: application/json\r\n\r\n{\"ok\":true}";
        assert!(parse_http_json_response(raw).is_none());
    }

    #[test]
    fn parse_http_json_response_rejects_invalid_chunk_payload() {
        let raw = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nabcde";
        assert!(parse_http_json_response(raw).is_none());
    }

    #[test]
    fn parse_http_success_body_rejects_overflowing_chunk_size_without_panicking() {
        let raw = format!(
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\nx",
            usize::MAX
        );

        let result = std::panic::catch_unwind(|| parse_http_success_body(raw.as_bytes()));

        assert!(matches!(result, Ok(None)));
    }

    #[test]
    fn parse_backend_start_time_accepts_i64_or_u64() {
        let signed = json!({
            "status": "ok",
            "data": { "start_time": -123i64 }
        });
        assert_eq!(parse_backend_start_time(&signed), Some(-123));

        let unsigned = json!({
            "status": "ok",
            "data": { "start_time": 123u64 }
        });
        assert_eq!(parse_backend_start_time(&unsigned), Some(123));
    }

    #[test]
    fn parse_backend_start_time_rejects_non_ok_status() {
        let payload = json!({
            "status": "error",
            "data": { "start_time": 123 }
        });
        assert_eq!(parse_backend_start_time(&payload), None);
    }
}
