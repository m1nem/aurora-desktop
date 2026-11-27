use hmac::{Hmac, Mac};
use sha1::Sha1;

use crate::auth::password::{constant_time_eq, random_bytes};

const BASE32_ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

pub fn base32_encode(bytes: &[u8]) -> String {
    let mut bits = 0u32;
    let mut value = 0u32;
    let mut output = String::new();

    for byte in bytes {
        value = (value << 8) | *byte as u32;
        bits += 8;
        while bits >= 5 {
            output.push(BASE32_ALPHABET[((value >> (bits - 5)) & 31) as usize] as char);
            bits -= 5;
        }
        // Drop consumed bits so the accumulator cannot overflow in debug
        // builds (20 random bytes would otherwise shift past 32 bits).
        value &= if bits == 0 { 0 } else { (1 << bits) - 1 };
    }

    if bits > 0 {
        output.push(BASE32_ALPHABET[((value << (5 - bits)) & 31) as usize] as char);
    }

    output
}

pub fn base32_decode(input: &str) -> Vec<u8> {
    let mut bits = 0u32;
    let mut value = 0u32;
    let mut output = Vec::new();

    for ch in input.to_uppercase().chars() {
        let Some(index) = BASE32_ALPHABET.iter().position(|item| *item == ch as u8) else {
            continue;
        };
        value = (value << 5) | index as u32;
        bits += 5;
        if bits >= 8 {
            output.push(((value >> (bits - 8)) & 0xff) as u8);
            bits -= 8;
        }
        value &= if bits == 0 { 0 } else { (1 << bits) - 1 };
    }

    output
}

pub fn generate_totp_secret() -> String {
    base32_encode(&random_bytes(20))
}

pub fn generate_totp_code(secret: &str, for_time_ms: i64) -> Option<String> {
    let key = base32_decode(secret);
    if key.is_empty() {
        return None;
    }
    let counter = (for_time_ms / 1000 / 30) as u64;
    let mut mac = Hmac::<Sha1>::new_from_slice(&key).ok()?;
    mac.update(&counter.to_be_bytes());
    let digest = mac.finalize().into_bytes();

    let offset = (digest[digest.len() - 1] & 0x0f) as usize;
    let binary = ((digest[offset] & 0x7f) as u32) << 24
        | (digest[offset + 1] as u32) << 16
        | (digest[offset + 2] as u32) << 8
        | digest[offset + 3] as u32;

    Some(format!("{:06}", binary % 1_000_000))
}

pub fn verify_totp_code(secret: &str, code: &str) -> bool {
    let normalised: String = code.chars().filter(|ch| !ch.is_whitespace()).collect();
    if normalised.len() != 6 || !normalised.chars().all(|ch| ch.is_ascii_digit()) {
        return false;
    }

    let now = crate::database::now_ms();
    for offset in -1i64..=1 {
        if let Some(expected) = generate_totp_code(secret, now + offset * 30_000) {
            if constant_time_eq(expected.as_bytes(), normalised.as_bytes()) {
                return true;
            }
        }
    }
    false
}

pub fn generate_email_code() -> String {
    use rand::Rng;
    let value: u32 = rand::thread_rng().gen_range(0..1_000_000);
    format!("{value:06}")
}

pub fn hash_email_code(challenge_id: &str, code: &str) -> String {
    crate::auth::password::sha256_hex(&format!("{}:{}", challenge_id, code.trim()))
}

pub fn verify_email_code(challenge_id: &str, stored_hash: &str, code: &str) -> bool {
    let candidate = hash_email_code(challenge_id, code);
    constant_time_eq(candidate.as_bytes(), stored_hash.as_bytes())
}

pub fn build_otpauth_url(secret: &str, username: &str, issuer: &str) -> String {
    let label = format!("{issuer}:{username}");
    format!(
        "otpauth://totp/{}?secret={}&issuer={}&algorithm=SHA1&digits=6&period=30",
        urlencoding::encode(&label),
        secret,
        urlencoding::encode(issuer)
    )
}

pub fn qr_data_url(content: &str) -> Option<String> {
    use base64::Engine;
    use qrcode::render::svg;

    let code = qrcode::QrCode::new(content.as_bytes()).ok()?;
    let image = code
        .render::<svg::Color>()
        .min_dimensions(240, 240)
        .dark_color(svg::Color("#22c55e"))
        .light_color(svg::Color("#060906"))
        .build();
    Some(format!(
        "data:image/svg+xml;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(image)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base32_round_trips_random_bytes() {
        for length in [1usize, 2, 5, 10, 16, 20, 32] {
            let bytes = random_bytes(length);
            let encoded = base32_encode(&bytes);
            assert_eq!(base32_decode(&encoded), bytes, "length {length}");
        }
    }

    #[test]
    fn base32_matches_rfc4648_vectors() {
        assert_eq!(base32_encode(b"foobar"), "MZXW6YTBOI");
        assert_eq!(base32_decode("MZXW6YTBOI"), b"foobar");
    }

    #[test]
    fn totp_matches_rfc6238_sha1_vector() {
        // RFC 6238 appendix B, SHA-1, secret "12345678901234567890".
        let secret = base32_encode(b"12345678901234567890");
        let code = generate_totp_code(&secret, 59_000).expect("code");
        assert_eq!(code, "287082");
    }

    #[test]
    fn generated_totp_secret_is_32_base32_chars() {
        let secret = generate_totp_secret();
        assert_eq!(secret.len(), 32);
        assert!(
            secret
                .chars()
                .all(|ch| BASE32_ALPHABET.contains(&(ch as u8)))
        );
    }

    #[test]
    fn email_code_hash_is_challenge_bound() {
        let hash = hash_email_code("2fa-abc", "123456");
        assert!(verify_email_code("2fa-abc", &hash, "123456"));
        assert!(!verify_email_code("2fa-other", &hash, "123456"));
        assert!(!verify_email_code("2fa-abc", &hash, "654321"));
    }
}
