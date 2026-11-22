//! Herdr 2 (herdr-core) support. herdlingd joins a running core and never starts one.
//! The core terminals appear in the herdr 1 shapes of the app RPC, with plain ids (`ids`), so
//! older apps show them and allow every action. See `docs/protocol.md`, "Herdr 2 (herdr-core)".

pub mod actions;
pub mod attach;
pub mod client;
pub mod endpoint;
pub mod events;
pub mod frame;
pub mod groups;
pub mod ids;
pub mod live;
pub mod project;
pub mod repos;
pub mod route;
pub mod screen;
pub mod start;
pub mod stream;
pub mod submit;
pub mod term_watch;
pub mod typing;
pub mod tracker;
pub mod vt;
