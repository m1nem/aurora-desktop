use serde::Serialize;

/// Error type returned by every Tauri command. The frontend `api.ts` adapter
/// understands this exact `{ code, message, status }` shape.
#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[error("{message}")]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub status: u16,
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>, status: u16) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            status,
        }
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new("BAD_REQUEST", message, 400)
    }

    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::new("UNAUTHORIZED", message, 401)
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new("FORBIDDEN", message, 403)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new("NOT_FOUND", message, 404)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new("CONFLICT", message, 409)
    }

    pub fn too_large(message: impl Into<String>) -> Self {
        Self::new("PAYLOAD_TOO_LARGE", message, 413)
    }

    pub fn too_many(message: impl Into<String>) -> Self {
        Self::new("RATE_LIMITED", message, 429)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new("INTERNAL", message, 500)
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        Self::new("UNAVAILABLE", message, 503)
    }
}

impl From<sqlx::Error> for AppError {
    fn from(error: sqlx::Error) -> Self {
        log::error!("database error: {error}");
        Self::internal("The local database could not complete this request.")
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        log::error!("io error: {error}");
        Self::internal(format!("Local storage error: {error}"))
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        log::error!("json error: {error}");
        Self::internal("The stored data could not be read.")
    }
}
