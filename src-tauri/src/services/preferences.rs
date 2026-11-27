use std::collections::HashMap;

use serde_json::{Map, Value};

use crate::models::preferences::{PlayerCustomization, PluginPreferences, UserPreferences};

const MAX_CUSTOM_CSS_LENGTH: usize = 50_000;
const MAX_COMMUNITY_PLUGIN_STATES: usize = 200;
const PLUGIN_ID_PATTERN: &str = "plg-";

const VALID_THEMES: [&str; 6] = ["green", "cool", "amber", "crimson", "violet", "paper"];

fn as_bool(value: Option<&Value>, fallback: bool) -> bool {
    value.and_then(Value::as_bool).unwrap_or(fallback)
}

fn hex_color(value: Option<&Value>, fallback: &str) -> String {
    let Some(text) = value.and_then(Value::as_str) else {
        return fallback.to_string();
    };
    let trimmed = text.trim();
    if is_hex_color(trimmed) {
        trimmed.to_string()
    } else {
        fallback.to_string()
    }
}

pub fn is_hex_color(value: &str) -> bool {
    let bytes = value.as_bytes();
    if !(bytes.len() == 4 || bytes.len() == 7) || bytes[0] != b'#' {
        return false;
    }
    bytes[1..].iter().all(|byte| byte.is_ascii_hexdigit())
}

fn normalize_theme(value: Option<&Value>, fallback: &str) -> String {
    let Some(raw) = value.and_then(Value::as_str) else {
        return fallback.to_string();
    };
    match raw {
        "dark" => "green".to_string(),
        "light" => "cool".to_string(),
        other if VALID_THEMES.contains(&other) => other.to_string(),
        _ => fallback.to_string(),
    }
}

/// Default palette values matching `src/lib/themes.ts`.
pub fn customization_for_theme(theme: &str) -> PlayerCustomization {
    let (background, accent) = match theme {
        "cool" => ("#0d1117", "#38bdf8"),
        "amber" => ("#120d08", "#f59e0b"),
        "crimson" => ("#100809", "#ef4444"),
        "violet" => ("#0c0914", "#a78bfa"),
        "paper" => ("#f5f2e8", "#0f766e"),
        _ => ("#0a0e0a", "#22c55e"),
    };
    PlayerCustomization {
        background: background.to_string(),
        accent_color: accent.to_string(),
        font_size: 16,
    }
}

fn normalize_plugins(value: Option<&Value>, fallback: &PluginPreferences) -> PluginPreferences {
    let raw = value.and_then(Value::as_object);
    PluginPreferences {
        jam: as_bool(raw.and_then(|map| map.get("jam")), fallback.jam),
        lyrics_overlay: as_bool(
            raw.and_then(|map| map.get("lyricsOverlay")),
            fallback.lyrics_overlay,
        ),
        equalizer: as_bool(raw.and_then(|map| map.get("equalizer")), fallback.equalizer),
        yt_dlp: as_bool(raw.and_then(|map| map.get("ytdlp")), fallback.yt_dlp),
    }
}

fn valid_plugin_id(id: &str) -> bool {
    if id.len() > 68 || !id.starts_with(PLUGIN_ID_PATTERN) {
        return false;
    }
    id[PLUGIN_ID_PATTERN.len()..]
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
}

fn normalize_community_plugins(
    value: Option<&Value>,
    fallback: &HashMap<String, bool>,
) -> HashMap<String, bool> {
    let mut next = fallback.clone();
    let Some(map) = value.and_then(Value::as_object) else {
        return next;
    };

    for (id, enabled) in map {
        let Some(enabled) = enabled.as_bool() else {
            continue;
        };
        if !valid_plugin_id(id) {
            continue;
        }
        if !next.contains_key(id) && next.len() >= MAX_COMMUNITY_PLUGIN_STATES {
            continue;
        }
        next.insert(id.clone(), enabled);
    }

    next
}

fn normalize_custom_css(value: Option<&Value>, fallback: &str) -> String {
    let Some(text) = value.and_then(Value::as_str) else {
        return fallback.to_string();
    };
    text.replace('\0', "")
        .chars()
        .take(MAX_CUSTOM_CSS_LENGTH)
        .collect()
}

fn normalize_customization(
    value: Option<&Value>,
    fallback: &PlayerCustomization,
) -> PlayerCustomization {
    let Some(map) = value.and_then(Value::as_object) else {
        return fallback.clone();
    };

    let default = customization_for_theme("green");
    let font_size = map
        .get("fontSize")
        .and_then(Value::as_f64)
        .map(|value| value.round().clamp(12.0, 20.0) as u32)
        .unwrap_or(fallback.font_size.clamp(12, 20));

    PlayerCustomization {
        background: hex_color(
            map.get("background"),
            if fallback.background.is_empty() {
                &default.background
            } else {
                &fallback.background
            },
        ),
        accent_color: hex_color(
            map.get("accentColor"),
            if fallback.accent_color.is_empty() {
                &default.accent_color
            } else {
                &fallback.accent_color
            },
        ),
        font_size,
    }
}

/// Mirrors `normalizePreferences(value, fallback)` from `src/lib/preferences.ts`.
pub fn normalize_preferences_with_fallback(
    input: &Value,
    fallback: &UserPreferences,
) -> UserPreferences {
    let raw = input.as_object();
    let theme = normalize_theme(raw.and_then(|map| map.get("theme")), &fallback.theme);
    let customization_fallback = if raw.and_then(|map| map.get("theme")).is_some()
        && raw.and_then(|map| map.get("playerCustomization")).is_none()
    {
        customization_for_theme(&theme)
    } else {
        fallback.player_customization.clone()
    };

    UserPreferences {
        theme,
        plugins: normalize_plugins(raw.and_then(|map| map.get("plugins")), &fallback.plugins),
        community_plugins: normalize_community_plugins(
            raw.and_then(|map| map.get("communityPlugins")),
            &fallback.community_plugins,
        ),
        custom_css: normalize_custom_css(
            raw.and_then(|map| map.get("customCss")),
            &fallback.custom_css,
        ),
        player_customization: normalize_customization(
            raw.and_then(|map| map.get("playerCustomization")),
            &customization_fallback,
        ),
    }
}

pub fn normalize_preferences_json(input: &Value) -> UserPreferences {
    normalize_preferences_with_fallback(input, &UserPreferences::default())
}

/// Serializes preferences as a stable JSON object accepted by the frontend.
pub fn preferences_to_value(preferences: &UserPreferences) -> Value {
    serde_json::to_value(preferences).unwrap_or(Value::Object(Map::new()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalizes_legacy_themes_and_colors() {
        let prefs = normalize_preferences_json(&json!({
            "theme": "dark",
            "playerCustomization": {
                "background": "not-a-color",
                "accentColor": "#123456",
                "fontSize": 99
            }
        }));
        assert_eq!(prefs.theme, "green");
        assert_eq!(prefs.player_customization.background, "#0a0e0a");
        assert_eq!(prefs.player_customization.accent_color, "#123456");
        assert_eq!(prefs.player_customization.font_size, 20);

        let light = normalize_preferences_json(&json!({"theme": "light"}));
        assert_eq!(light.theme, "cool");
    }

    #[test]
    fn truncates_css_and_filters_unknown_plugins() {
        let css = "x".repeat(70_000);
        let mut community = serde_json::Map::new();
        community.insert("plg-valid".into(), json!(true));
        community.insert("invalid id".into(), json!(true));
        community.insert("plg-bool".into(), json!("not bool"));
        let prefs = normalize_preferences_json(&json!({
            "customCss": css,
            "communityPlugins": community
        }));
        assert_eq!(prefs.custom_css.len(), 50_000);
        assert_eq!(prefs.community_plugins.get("plg-valid"), Some(&true));
        assert!(!prefs.community_plugins.contains_key("invalid id"));
        assert!(!prefs.community_plugins.contains_key("plg-bool"));
    }

    #[test]
    fn fallback_is_preserved_for_absent_fields() {
        let fallback = normalize_preferences_json(&json!({
            "theme": "amber",
            "plugins": { "jam": true, "lyricsOverlay": false, "equalizer": true }
        }));
        let merged = normalize_preferences_with_fallback(&json!({ "theme": "crimson" }), &fallback);
        assert_eq!(merged.theme, "crimson");
        assert!(merged.plugins.jam);
        assert!(!merged.plugins.lyrics_overlay);
        assert!(merged.plugins.equalizer);
    }
}
