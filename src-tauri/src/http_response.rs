use std::borrow::Cow;

pub fn parse_http_json_response(raw: &[u8]) -> Option<serde_json::Value> {
    let (header_text, body_bytes) = parse_http_response_parts(raw)?;
    let status_code = parse_http_status_code_from_headers(&header_text)?;
    if !(200..300).contains(&status_code) {
        return None;
    }

    let is_chunked = header_text.lines().any(|line| {
        let line = line.trim().to_ascii_lowercase();
        line.starts_with("transfer-encoding:") && line.contains("chunked")
    });
    let payload = if is_chunked {
        decode_chunked_body(body_bytes)?
    } else {
        body_bytes.to_vec()
    };

    serde_json::from_slice(&payload).ok()
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
        if input.len() < chunk_size + 2 {
            return None;
        }

        output.extend_from_slice(&input[..chunk_size]);
        if &input[chunk_size..chunk_size + 2] != b"\r\n" {
            return None;
        }
        input = &input[chunk_size + 2..];
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
