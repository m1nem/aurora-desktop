use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPreferences {
    pub jam: bool,
    #[serde(rename = "lyricsOverlay")]
    pub lyrics_overlay: bool,
    pub equalizer: bool,
    /// Optional external yt-dlp integration. Disabled by default.
    #[serde(rename = "ytdlp")]
    pub yt_dlp: bool,
}

impl Default for PluginPreferences {
    fn default() -> Self {
        Self {
            jam: false,
            lyrics_overlay: true,
            equalizer: false,
            yt_dlp: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerCustomization {
    pub background: String,
    pub accent_color: String,
    pub font_size: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPreferences {
    pub theme: String,
    pub plugins: PluginPreferences,
    pub community_plugins: std::collections::HashMap<String, bool>,
    pub custom_css: String,
    pub player_customization: PlayerCustomization,
}

impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            theme: "green".to_string(),
            plugins: PluginPreferences::default(),
            community_plugins: std::collections::HashMap::new(),
            custom_css: String::new(),
            player_customization: PlayerCustomization {
                background: "#0a0e0a".to_string(),
                accent_color: "#22c55e".to_string(),
                font_size: 16,
            },
        }
    }
}
