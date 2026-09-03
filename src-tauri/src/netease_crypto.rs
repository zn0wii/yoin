//! NetEase Cloud Music `weapi` request encryption.
//!
//! Reverse-engineered constants and algorithm verified against the real
//! `NeteaseCloudMusicApi` npm package (v4.32.0) source, and cross-checked by
//! running its `weapi()` in Node against this module's Rust output for the
//! same fixed inputs (see dev notes — not committed, verification only).
//!
//! `weapi` wraps a JSON payload in two layers of AES-128-CBC/PKCS7:
//!   1. AES(text, presetKey, iv)
//!   2. AES(that, randomSecretKey, iv)             -> `params`
//! then RSA-encrypts the reversed secretKey with **no padding** (raw
//! `c = m^e mod n`, left-padded with zeros to the modulus byte length)
//! against NetEase's fixed 1024-bit public key                -> `encSecKey`.

use aes::Aes128;
#[cfg(test)]
use cbc::cipher::BlockDecryptMut;
use cbc::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyInit, KeyIvInit};
use base64::{engine::general_purpose::STANDARD, Engine};
use num_bigint_dig::BigUint;
use num_traits::Num;
use rand::Rng;

type Aes128CbcEnc = cbc::Encryptor<Aes128>;
#[cfg(test)]
type Aes128CbcDec = cbc::Decryptor<Aes128>;

const IV: &[u8] = b"0102030405060708";
const PRESET_KEY: &[u8] = b"0CoJUm6Qyw8W8jud";
const EAPI_KEY: &[u8] = b"e82ckenh8dichen8";
const BASE62: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/// NetEase's fixed 1024-bit RSA public key, as `(n, e)` in hex — parsed
/// ahead of time from the PEM key embedded in the reference implementation
/// so this module needs no ASN.1/PEM parser.
const RSA_N_HEX: &str = "e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7";
const RSA_E_HEX: &str = "10001";

fn aes_cbc_encrypt(plaintext: &[u8], key: &[u8], iv: &[u8]) -> Vec<u8> {
    let enc = Aes128CbcEnc::new(key.into(), iv.into());
    // Output needs room for up to one extra padding block.
    let mut buf = vec![0u8; plaintext.len() + 16];
    buf[..plaintext.len()].copy_from_slice(plaintext);
    let len = enc
        .encrypt_padded_mut::<Pkcs7>(&mut buf, plaintext.len())
        .expect("buffer sized for one extra padding block")
        .len();
    buf.truncate(len);
    buf
}

#[cfg(test)]
fn aes_cbc_decrypt(ciphertext: &[u8], key: &[u8], iv: &[u8]) -> Result<Vec<u8>, String> {
    let dec = Aes128CbcDec::new(key.into(), iv.into());
    let mut buf = ciphertext.to_vec();
    let len = dec
        .decrypt_padded_mut::<Pkcs7>(&mut buf)
        .map_err(|e| format!("aes decrypt failed: {e}"))?
        .len();
    buf.truncate(len);
    Ok(buf)
}

/// Raw (unpadded) RSA encryption: treats `data` as a big-endian integer,
/// computes `c = m^e mod n`, and left-pads the result with zero bytes to
/// the modulus size (128 bytes for this 1024-bit key) — matching
/// `node-forge`'s `encrypt(str, 'NONE')`.
fn rsa_encrypt_none_padding(data: &[u8]) -> Vec<u8> {
    let n = BigUint::from_str_radix(RSA_N_HEX, 16).expect("valid RSA modulus");
    let e = BigUint::from_str_radix(RSA_E_HEX, 16).expect("valid RSA exponent");
    let m = BigUint::from_bytes_be(data);
    let c = m.modpow(&e, &n);

    let modulus_len = n.to_bytes_be().len();
    let mut out = c.to_bytes_be();
    if out.len() < modulus_len {
        let mut padded = vec![0u8; modulus_len - out.len()];
        padded.append(&mut out);
        padded
    } else {
        out
    }
}

/// `params` + `encSecKey` for a `weapi` POST body.
pub struct WeapiPayload {
    pub params: String,
    pub enc_sec_key: String,
}

/// Encrypt a JSON-serializable payload the way `weapi()` does in the
/// reference implementation. `text` must already be the serialized JSON
/// string (with any required fields like `csrf_token` already merged in).
pub fn weapi(text: &str) -> WeapiPayload {
    let mut rng = rand::thread_rng();
    let secret_key: String = (0..16)
        .map(|_| {
            let idx = rng.gen_range(0..62);
            BASE62[idx] as char
        })
        .collect();

    let first_pass = aes_cbc_encrypt(text.as_bytes(), PRESET_KEY, IV);
    let first_pass_b64 = STANDARD.encode(&first_pass);
    let second_pass = aes_cbc_encrypt(first_pass_b64.as_bytes(), secret_key.as_bytes(), IV);
    let params = STANDARD.encode(&second_pass);

    let reversed_key: String = secret_key.chars().rev().collect();
    let enc_sec_key_bytes = rsa_encrypt_none_padding(reversed_key.as_bytes());
    let enc_sec_key = hex::encode(enc_sec_key_bytes);

    WeapiPayload {
        params,
        enc_sec_key,
    }
}

/// AES-128-ECB/PKCS7 signing used by `eapi`: `eapiKey` doubles as the ECB
/// key, no IV needed.
fn aes_ecb_encrypt(plaintext: &[u8], key: &[u8]) -> Vec<u8> {
    let enc = ecb::Encryptor::<Aes128>::new(key.into());
    let mut buf = vec![0u8; plaintext.len() + 16];
    buf[..plaintext.len()].copy_from_slice(plaintext);
    let len = enc
        .encrypt_padded_mut::<Pkcs7>(&mut buf, plaintext.len())
        .expect("buffer sized for one extra padding block")
        .len();
    buf.truncate(len);
    buf
}

/// `params` for an `eapi` POST body (the `/eapi/<uri>` request family used
/// by e.g. the song playback-url endpoint). Signs `url`+`text` with MD5,
/// then AES-128-ECB/PKCS7-encrypts `"{url}-36cd479b6b5-{text}-36cd479b6b5-{digest}"`.
/// `url` is the endpoint path as passed to the reference implementation,
/// e.g. `/api/song/enhance/player/url`. `text` is the JSON-serialized body
/// (already including the `header` field the caller must merge in).
pub fn eapi(url: &str, text: &str) -> String {
    let message = format!("nobody{url}use{text}md5forencrypt");
    let digest = md5::compute(message.as_bytes());
    let digest_hex = hex::encode(digest.0);
    let data = format!("{url}-36cd479b6b5-{text}-36cd479b6b5-{digest_hex}");
    hex::encode(aes_ecb_encrypt(data.as_bytes(), EAPI_KEY)).to_uppercase()
}

/// XOR-then-MD5-then-base64 device id fingerprint used by the anonymous
/// registration endpoint (`cloudmusic_dll_encode_id` in the reference impl).
fn encode_device_id_signature(device_id: &str) -> String {
    const XOR_KEY: &str = "3go8&$8*3*3h0k(2)2";
    let xor_key_bytes = XOR_KEY.as_bytes();
    let xored: Vec<u8> = device_id
        .bytes()
        .enumerate()
        .map(|(i, b)| b ^ xor_key_bytes[i % xor_key_bytes.len()])
        .collect();
    let digest = md5::compute(&xored);
    STANDARD.encode(digest.0)
}

/// Generates a random 52-hex-character device id, matching
/// `generateDeviceId()` in the reference implementation. Must be
/// **uppercase** hex — the real server rejects (`{"code":400}`) a
/// lowercase device id even though it's otherwise well-formed.
pub fn generate_device_id() -> String {
    let mut rng = rand::thread_rng();
    (0..52)
        .map(|_| {
            let v = rng.gen_range(0..16u8);
            std::char::from_digit(v as u32, 16)
                .unwrap()
                .to_ascii_uppercase()
        })
        .collect()
}

/// The `username` field body for `POST /api/register/anonimous`:
/// base64("<deviceId> <xor+md5+base64 signature of deviceId>").
pub fn anonymous_username(device_id: &str) -> String {
    let signature = encode_device_id_signature(device_id);
    STANDARD.encode(format!("{device_id} {signature}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The RSA "NONE padding" step must equal plain `m^e mod n` on the raw
    /// bytes — verified against real `node-forge` output for a fixed input
    /// during development. This regression test locks that behavior in.
    #[test]
    fn rsa_none_padding_matches_reference_vector() {
        // reversed("FFFFFFFFFFFFFFFF") == itself; reference ciphertext was
        // captured from `forge.pki.publicKeyFromPem(pubkey).encrypt(text,'NONE')`.
        let expected_hex = "257348aecb5e556c066de214e531faadd1c55d814f9be95fd06d6bff9f4c7a41f831f6394d5a3fd2e3881736d94a02ca919d952872e7d0a50ebfa1769a7a62d512f5f1ca21aec60bc3819a9c3ffca5eca9a0dba6d6f7249b06f5965ecfff3695b54e1c28f3f624750ed39e7de08fc8493242e26dbc4484a01c76f739e135637c";
        let out = rsa_encrypt_none_padding(b"FFFFFFFFFFFFFFFF");
        assert_eq!(hex::encode(out), expected_hex);
    }

    #[test]
    fn aes_cbc_round_trips() {
        let pt = b"hello weapi world";
        let ct = aes_cbc_encrypt(pt, PRESET_KEY, IV);
        let back = aes_cbc_decrypt(&ct, PRESET_KEY, IV).unwrap();
        assert_eq!(back, pt);
    }

    #[test]
    fn device_id_is_52_hex_chars() {
        let id = generate_device_id();
        assert_eq!(id.len(), 52);
        assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
    }

    /// Locks in the `eapi()` signing+encryption scheme against a fixed
    /// vector captured from the real reference implementation's
    /// `encrypt.eapi('/api/song/enhance/player/url', {...})`.
    #[test]
    fn eapi_matches_reference_vector() {
        let expected_hex = "FA90B329E9614F79E79598F37DC2EDB430F8378D2A2796338F0BFDEAEF824A22975CDA9D96D79E6DC4A59218CDB8199F6E08020A76A50DAED5B74A932D70447E643171E24B9CDC841D34EDB62FBD36CCE6BE0BB271191EFDD9D650FBEE78DED9AF5F5E963C4753B2A1F2B24A20EC7BB64A453EDED2B0C0905A6AA7AA2F6BCD9725A33C467922F6DAF98401165D6181BC";
        let text = r#"{"ids":"[123]","br":999000,"header":{"test":1}}"#;
        let out = eapi("/api/song/enhance/player/url", text);
        assert_eq!(out, expected_hex);
    }
}
