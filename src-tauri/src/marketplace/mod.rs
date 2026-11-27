//! Marketplace-facing helpers. Uploads are stored as community plugins; the
//! catalog itself is compiled into the frontend and backend.

pub use crate::plugins::{delete, list, plugin_catalog, read_source, upload};
