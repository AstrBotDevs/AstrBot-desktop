use std::fmt;

pub(crate) const DESKTOP_SESSION_SECRET_ENV: &str = "ASTRBOT_DESKTOP_SESSION_SECRET";
pub(crate) const DESKTOP_SESSION_HEADER: &str = "X-AstrBot-Desktop-Session";
pub(crate) const DESKTOP_SESSION_ENDPOINT: &str = "/api/v1/auth/desktop-session";

pub(crate) struct DesktopSessionSecret(String);

impl DesktopSessionSecret {
    pub(crate) fn generate() -> Result<Self, getrandom::Error> {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes)?;

        let mut secret = String::with_capacity(bytes.len() * 2);
        for byte in bytes {
            use std::fmt::Write as _;
            write!(&mut secret, "{byte:02x}").expect("writing to a String cannot fail");
        }
        Ok(Self(secret))
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for DesktopSessionSecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DesktopSessionSecret([redacted])")
    }
}

pub(crate) struct DesktopAuthSession {
    pub(crate) token: String,
    pub(crate) username: String,
}

#[cfg(test)]
mod tests {
    use super::DesktopSessionSecret;

    #[test]
    fn generated_secret_has_256_bits_encoded_as_lowercase_hex() {
        let secret = DesktopSessionSecret::generate().expect("secret generation should succeed");

        assert_eq!(secret.as_str().len(), 64);
        assert!(secret
            .as_str()
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)));
    }

    #[test]
    fn debug_output_does_not_reveal_secret() {
        let secret = DesktopSessionSecret::generate().expect("secret generation should succeed");
        let debug_output = format!("{secret:?}");

        assert_eq!(debug_output, "DesktopSessionSecret([redacted])");
        assert!(!debug_output.contains(secret.as_str()));
    }
}
