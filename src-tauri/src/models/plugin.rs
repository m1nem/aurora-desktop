use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRecord {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub file_path: String,
    pub enabled_state: bool,
    pub owner_id: String,
    pub owner_name: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityPlugin {
    #[serde(flatten)]
    pub record: PluginRecord,
    pub source: String,
    pub enabled: bool,
    pub can_delete: bool,
    pub file_url: String,
}

impl CommunityPlugin {
    pub fn from_record(record: PluginRecord, enabled: bool, can_delete: bool) -> Self {
        let file_url = format!("/api/marketplace/plugins/{}/file", record.id);
        Self {
            record,
            source: "uploaded".to_string(),
            enabled,
            can_delete,
            file_url,
        }
    }
}
