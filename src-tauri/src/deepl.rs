use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::ffi::c_void;
use std::ptr;
use std::slice;
use std::time::Duration;
use tokio::time::sleep;

const CREDENTIAL_TARGET: &str = "com.github.yusufozmen01.kikitan.deepl";
const CREDENTIAL_USER: &str = "Kikitan Translator";
const CRED_TYPE_GENERIC: u32 = 1;
const CRED_PERSIST_LOCAL_MACHINE: u32 = 2;
const ERROR_NOT_FOUND: u32 = 1168;

#[repr(C)]
#[allow(non_snake_case)]
struct FileTime {
    dwLowDateTime: u32,
    dwHighDateTime: u32,
}

#[repr(C)]
#[allow(non_snake_case)]
struct CredentialW {
    Flags: u32,
    Type: u32,
    TargetName: *mut u16,
    Comment: *mut u16,
    LastWritten: FileTime,
    CredentialBlobSize: u32,
    CredentialBlob: *mut u8,
    Persist: u32,
    AttributeCount: u32,
    Attributes: *mut c_void,
    TargetAlias: *mut u16,
    UserName: *mut u16,
}

#[link(name = "Advapi32")]
extern "system" {
    fn CredWriteW(credential: *const CredentialW, flags: u32) -> i32;
    fn CredReadW(
        target_name: *const u16,
        credential_type: u32,
        flags: u32,
        credential: *mut *mut CredentialW,
    ) -> i32;
    fn CredDeleteW(target_name: *const u16, credential_type: u32, flags: u32) -> i32;
    fn CredFree(buffer: *mut c_void);
}

#[link(name = "Kernel32")]
extern "system" {
    fn GetLastError() -> u32;
}

#[derive(Debug, Serialize)]
pub struct DeepLError {
    code: String,
    message: String,
    status: Option<u16>,
}

impl DeepLError {
    fn new(code: &str, message: &str, status: Option<u16>) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            status,
        }
    }
}

#[derive(Serialize)]
pub struct DeepLKeyStatus {
    configured: bool,
}

#[derive(Serialize)]
pub struct DeepLTranslation {
    text: String,
    detected_source_language: Option<String>,
}

#[derive(Deserialize)]
struct DeepLResponse {
    translations: Vec<DeepLResponseItem>,
}

#[derive(Deserialize)]
struct DeepLResponseItem {
    text: String,
    detected_source_language: Option<String>,
}

#[derive(Deserialize)]
struct DeepLApiError {
    message: Option<String>,
}

#[derive(Serialize)]
struct TranslateRequest<'a> {
    text: [&'a str; 1],
    target_lang: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_lang: Option<&'a str>,
}

fn wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn read_api_key() -> Result<String, DeepLError> {
    let target = wide_null(CREDENTIAL_TARGET);
    let mut credential: *mut CredentialW = ptr::null_mut();
    let success = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) };
    if success == 0 || credential.is_null() {
        return Err(DeepLError::new(
            "api_key_missing",
            "A DeepL API key has not been saved.",
            None,
        ));
    }

    let bytes = unsafe {
        let value = &*credential;
        slice::from_raw_parts(value.CredentialBlob, value.CredentialBlobSize as usize).to_vec()
    };
    unsafe { CredFree(credential.cast()) };

    String::from_utf8(bytes).map_err(|_| {
        DeepLError::new(
            "credential_store",
            "The saved DeepL API key is invalid.",
            None,
        )
    })
}

fn endpoint(api_plan: &str) -> Result<&'static str, DeepLError> {
    match api_plan {
        "free" => Ok("https://api-free.deepl.com"),
        "pro" => Ok("https://api.deepl.com"),
        _ => Err(DeepLError::new(
            "invalid_api_plan",
            "The DeepL API plan must be Free or Pro.",
            None,
        )),
    }
}

async fn error_from_response(response: reqwest::Response) -> DeepLError {
    let status = response.status();
    let api_message = response
        .json::<DeepLApiError>()
        .await
        .ok()
        .and_then(|body| body.message);

    let (code, message) = match status.as_u16() {
        403 => (
            "authentication",
            "The DeepL API key is invalid or is being used with the wrong Free/Pro endpoint.",
        ),
        429 => (
            "rate_limited",
            "DeepL is temporarily rate limiting requests.",
        ),
        456 => (
            "quota_exceeded",
            "The DeepL API character quota has been exceeded.",
        ),
        400 => ("bad_request", "DeepL rejected the translation request."),
        _ if status.is_server_error() => (
            "deepl_unavailable",
            "The DeepL service is temporarily unavailable.",
        ),
        _ => ("http_error", "DeepL returned an unexpected HTTP error."),
    };

    DeepLError::new(
        code,
        api_message.as_deref().unwrap_or(message),
        Some(status.as_u16()),
    )
}

#[tauri::command]
pub fn save_deepl_api_key(api_key: String) -> Result<(), DeepLError> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err(DeepLError::new(
            "api_key_missing",
            "The DeepL API key cannot be empty.",
            None,
        ));
    }

    let mut target = wide_null(CREDENTIAL_TARGET);
    let mut user = wide_null(CREDENTIAL_USER);
    let mut secret = trimmed.as_bytes().to_vec();
    let credential = CredentialW {
        Flags: 0,
        Type: CRED_TYPE_GENERIC,
        TargetName: target.as_mut_ptr(),
        Comment: ptr::null_mut(),
        LastWritten: FileTime {
            dwLowDateTime: 0,
            dwHighDateTime: 0,
        },
        CredentialBlobSize: secret.len() as u32,
        CredentialBlob: secret.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        AttributeCount: 0,
        Attributes: ptr::null_mut(),
        TargetAlias: ptr::null_mut(),
        UserName: user.as_mut_ptr(),
    };

    let success = unsafe { CredWriteW(&credential, 0) };
    secret.fill(0);
    if success == 0 {
        Err(DeepLError::new(
            "credential_store",
            "The DeepL API key could not be saved to Windows Credential Manager.",
            None,
        ))
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn delete_deepl_api_key() -> Result<(), DeepLError> {
    let target = wide_null(CREDENTIAL_TARGET);
    let success = unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) };
    if success != 0 || unsafe { GetLastError() } == ERROR_NOT_FOUND {
        Ok(())
    } else {
        Err(DeepLError::new(
            "credential_store",
            "The DeepL API key could not be deleted from Windows Credential Manager.",
            None,
        ))
    }
}

#[tauri::command]
pub fn deepl_api_key_status() -> Result<DeepLKeyStatus, DeepLError> {
    let configured = read_api_key().is_ok();
    Ok(DeepLKeyStatus { configured })
}

#[tauri::command]
pub async fn check_deepl_connection(api_plan: String) -> Result<(), DeepLError> {
    let api_key = read_api_key()?;
    let url = format!("{}/v2/usage", endpoint(&api_plan)?);
    let response = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| DeepLError::new("client", "The HTTP client could not be created.", None))?
        .get(url)
        .header("Authorization", format!("DeepL-Auth-Key {api_key}"))
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                DeepLError::new("timeout", "The DeepL connection timed out.", None)
            } else {
                DeepLError::new("network", "DeepL could not be reached.", None)
            }
        })?;

    if response.status().is_success() {
        Ok(())
    } else {
        Err(error_from_response(response).await)
    }
}

#[tauri::command]
pub async fn translate_deepl(
    text: String,
    source_lang: Option<String>,
    target_lang: String,
    api_plan: String,
) -> Result<DeepLTranslation, DeepLError> {
    let text = text.trim();
    if text.is_empty() {
        return Err(DeepLError::new(
            "empty_text",
            "Empty text is not sent to DeepL.",
            None,
        ));
    }

    let api_key = read_api_key()?;
    let url = format!("{}/v2/translate", endpoint(&api_plan)?);
    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| DeepLError::new("client", "The HTTP client could not be created.", None))?;
    let request = TranslateRequest {
        text: [text],
        source_lang: source_lang.as_deref(),
        target_lang: &target_lang,
    };

    for attempt in 0..3 {
        let response = client
            .post(&url)
            .header("Authorization", format!("DeepL-Auth-Key {api_key}"))
            .json(&request)
            .send()
            .await;

        match response {
            Ok(response)
                if (response.status() == StatusCode::TOO_MANY_REQUESTS
                    || response.status().is_server_error())
                    && attempt < 2 =>
            {
                sleep(Duration::from_millis([250, 500, 1_000][attempt])).await;
            }
            Ok(response) if response.status().is_success() => {
                let mut body = response.json::<DeepLResponse>().await.map_err(|_| {
                    DeepLError::new(
                        "invalid_response",
                        "DeepL returned an invalid response.",
                        None,
                    )
                })?;
                let translation = body.translations.drain(..).next().ok_or_else(|| {
                    DeepLError::new("empty_translation", "DeepL returned no translation.", None)
                })?;
                if translation.text.trim().is_empty() {
                    return Err(DeepLError::new(
                        "empty_translation",
                        "DeepL returned an empty translation.",
                        None,
                    ));
                }
                return Ok(DeepLTranslation {
                    text: translation.text,
                    detected_source_language: translation.detected_source_language,
                });
            }
            Ok(response) => return Err(error_from_response(response).await),
            Err(error) if error.is_timeout() => {
                return Err(DeepLError::new(
                    "timeout",
                    "The DeepL translation request timed out.",
                    None,
                ));
            }
            Err(_) if attempt < 2 => {
                sleep(Duration::from_millis([250, 500, 1_000][attempt])).await;
            }
            Err(_) => {
                return Err(DeepLError::new(
                    "network",
                    "DeepL could not be reached.",
                    None,
                ));
            }
        }
    }

    Err(DeepLError::new(
        "network",
        "DeepL could not be reached after retrying.",
        None,
    ))
}
