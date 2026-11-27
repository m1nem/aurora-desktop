use serde_json::Value;
use tauri::State;

use crate::auth::service;
use crate::error::AppResult;
use crate::state::AppState;

#[tauri::command]
pub async fn login(
    state: State<'_, AppState>,
    identifier: String,
    password: String,
    method: Option<String>,
) -> AppResult<Value> {
    service::login(&state, &identifier, &password, method.as_deref()).await
}

#[tauri::command]
pub async fn register(
    state: State<'_, AppState>,
    email: String,
    username: String,
    password: String,
) -> AppResult<Value> {
    service::register(&state, &email, &username, &password).await
}

#[tauri::command]
pub async fn current_user(state: State<'_, AppState>) -> AppResult<Value> {
    service::current_user_response(&state).await
}

#[tauri::command]
pub async fn logout(state: State<'_, AppState>, all_devices: Option<bool>) -> AppResult<Value> {
    service::logout(&state, all_devices.unwrap_or(false)).await
}

#[tauri::command]
pub async fn totp_setup(state: State<'_, AppState>) -> AppResult<Value> {
    service::totp_setup(&state).await
}

#[tauri::command]
pub async fn totp_enable(state: State<'_, AppState>, code: String) -> AppResult<Value> {
    service::totp_enable(&state, &code).await
}

#[tauri::command]
pub async fn verify_two_factor(
    state: State<'_, AppState>,
    challenge_id: String,
    code: String,
) -> AppResult<Value> {
    service::verify_two_factor(&state, &challenge_id, &code).await
}

#[tauri::command]
pub async fn send_two_factor_email(
    state: State<'_, AppState>,
    challenge_id: String,
) -> AppResult<Value> {
    service::send_two_factor_email_code(&state, &challenge_id).await
}

#[tauri::command]
pub async fn set_email_two_factor(state: State<'_, AppState>, enabled: bool) -> AppResult<Value> {
    service::set_email_two_factor(&state, enabled).await
}

#[tauri::command]
pub async fn disable_two_factor(
    state: State<'_, AppState>,
    password: String,
    two_factor_code: String,
    challenge_id: Option<String>,
) -> AppResult<Value> {
    service::disable_two_factor(&state, &password, &two_factor_code, challenge_id.as_deref()).await
}

#[tauri::command]
pub async fn send_disable_two_factor_email(state: State<'_, AppState>) -> AppResult<Value> {
    service::send_disable_two_factor_email(&state).await
}
