//! Herdr 2 (herdr-core) support. herdlingd joins a running core and never starts one.
//! The core terminals appear in the herdr 1 shapes of the app RPC, with ids that start with
//! `hc:` and the field `backend: "core"`, so older apps show them too. See `docs/protocol.md`,
//! "Herdr 2 (herdr-core)".

pub mod client;
pub mod endpoint;
pub mod events;
pub mod live;
pub mod merge;
pub mod project;
pub mod route;
pub mod stream;
pub mod tracker;
