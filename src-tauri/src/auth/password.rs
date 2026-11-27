use base64::Engine;
use rand::RngCore;
use scrypt::{Params, scrypt};
use sha2::{Digest, Sha256};

pub const SCRYPT_N_LOG: u8 = 14; // N = 16384
pub const SCRYPT_R: u32 = 8;
pub const SCRYPT_P: u32 = 1;
pub const SCRYPT_KEYLEN: usize = 64;

pub fn hash_password(password: &str) -> String {
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    let params = Params::new(SCRYPT_N_LOG, SCRYPT_R, SCRYPT_P).expect("valid scrypt parameters");
    let mut output = [0u8; SCRYPT_KEYLEN];
    scrypt(password.as_bytes(), &salt, &params, &mut output).expect("scrypt hashing must succeed");
    format!(
        "scrypt$16384${SCRYPT_R}${SCRYPT_P}${}${}",
        hex::encode(salt),
        hex::encode(output)
    )
}

pub fn verify_password(password: &str, stored: &str) -> bool {
    let parts: Vec<&str> = stored.split('$').collect();
    if parts.len() != 6 || parts[0] != "scrypt" {
        return false;
    }

    let Ok(n) = parts[1].parse::<u32>() else {
        return false;
    };
    let log_n = match n {
        8192 => 13,
        16384 => 14,
        32768 => 15,
        65536 => 16,
        other if other.is_power_of_two() => other.trailing_zeros() as u8,
        _ => return false,
    };
    let Ok(r) = parts[2].parse::<u32>() else {
        return false;
    };
    let Ok(p) = parts[3].parse::<u32>() else {
        return false;
    };
    let Ok(salt) = hex::decode(parts[4]) else {
        return false;
    };
    let Ok(expected) = hex::decode(parts[5]) else {
        return false;
    };
    if expected.is_empty() || expected.len() > 64 {
        return false;
    }
    let Ok(params) = Params::new(log_n, r, p) else {
        return false;
    };

    let mut actual = vec![0u8; expected.len()];
    if scrypt(password.as_bytes(), &salt, &params, &mut actual).is_err() {
        return false;
    }

    constant_time_eq(&actual, &expected)
}

pub fn hash_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    hex::encode(digest)
}

pub fn new_session_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub fn random_bytes(len: usize) -> Vec<u8> {
    let mut bytes = vec![0u8; len];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes
}

pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (left, right) in a.iter().zip(b.iter()) {
        diff |= left ^ right;
    }
    diff == 0
}

pub fn generate_user_id() -> String {
    format!(
        "usr-{}",
        hex::encode(random_bytes(12))
            .chars()
            .take(24)
            .collect::<String>()
    )
}

pub fn generate_id(prefix: &str) -> String {
    format!("{prefix}-{}", hex::encode(random_bytes(12)))
}

pub fn sha256_hex(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_uses_original_scrypt_format_and_parameters() {
        let stored = hash_password("correct horse battery staple");
        let parts: Vec<&str> = stored.split('$').collect();
        assert_eq!(parts.len(), 6);
        assert_eq!(parts[0], "scrypt");
        assert_eq!(parts[1], "16384");
        assert_eq!(parts[2], "8");
        assert_eq!(parts[3], "1");
        assert_eq!(parts[4].len(), 32); // 16-byte salt
        assert_eq!(parts[5].len(), 128); // 64-byte key
        assert!(verify_password("correct horse battery staple", &stored));
        assert!(!verify_password("wrong password", &stored));
    }

    #[test]
    fn verifies_node_generated_hash() {
        // Generated with Node 22 crypto.scryptSync using the original
        // Aurora parameters (N=16384, r=8, p=1, keylen=64).
        let stored = "scrypt$16384$8$1$00112233445566778899aabbccddeeff$fcd5a58d5301bbc44e90fc9a53f156134baee795eb7735ed6473da86e34ba93009476236665814fe08f7bd38ad1f5a2709832fb447b93b94e1a4a94dc5d1442e";
        assert!(verify_password("correct horse battery staple", stored));
        assert!(!verify_password("correct horse battery stapl", stored));
    }

    #[test]
    fn rejects_malformed_hashes() {
        for stored in [
            "",
            "plaintext",
            "bcrypt$1$2$3$4$5",
            "scrypt$notanumber$8$1$00$00",
            "scrypt$16384$8$1$zz$00",
        ] {
            assert!(!verify_password("anything", stored), "{stored}");
        }
    }

    #[test]
    fn session_tokens_are_url_safe_and_hashed_with_sha256() {
        let token = new_session_token();
        assert!(!token.is_empty());
        assert!(!token.contains('='));
        assert!(
            token
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
        );
        assert_eq!(
            hash_token("test-token"),
            "4c5dc9b7708905f77f5e5d16316b5dfb425e68cb326dcd55a860e90a7707031e"
        );
    }

    #[test]
    fn generated_user_ids_match_legacy_shape() {
        let id = generate_user_id();
        assert!(id.starts_with("usr-"));
        assert_eq!(id.len(), 28);
        assert!(id[4..].chars().all(|ch| ch.is_ascii_hexdigit()));
    }
}
