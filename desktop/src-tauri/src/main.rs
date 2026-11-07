// main.rs — the thin desktop wrapper. Rust owns three things:
// a window (the webview), a SQLite database, and an ephe/ directory
// on disk. It owns no astrology.
//
//   - SQLite: one kv table, (store, key, value TEXT as JSON).
//     The frontend's persistence layer (persistence.js) is already a
//     kv abstraction over the stores settings/profiles/charts/meta,
//     so the SQLite backend in frontend/desktop.js maps onto these
//     four commands with no logic change in the app.
//   - Ephemeris files: .se1 files live under the app data dir, not
//     in SQLite blobs and not in IndexedDB. Transferred base64 over
//     invoke, since Tauri commands are JSON.
//   - Ephemeris computation: none. The Swiss Ephemeris runs in WASM
//     (swe.wasm) exactly as on the web, and searches keep their
//     Web Worker parallelization. A second, Rust-native ephemeris
//     would be a second source of truth for no non-trivial gain.
//     (Blake decision, 2026-11-07.)

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

struct DbState {
    conn: Mutex<Connection>,
    ephe_dir: PathBuf,
}

fn valid_store(store: &str) -> bool {
    matches!(store, "settings" | "profiles" | "charts" | "meta")
}

fn valid_ephe_name(name: &str) -> bool {
    // .se1 file names only: no directories, no traversal.
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
        && name.ends_with(".se1")
        && !name.contains("..")
}

#[tauri::command]
fn kv_get(state: State<DbState>, store: String, key: String) -> Result<Option<String>, String> {
    if !valid_store(&store) {
        return Err(format!("unknown store: {store}"));
    }
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT value FROM kv WHERE store = ?1 AND key = ?2")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![store, key]).map_err(|e| e.to_string())?;
    match rows.next().map_err(|e| e.to_string())? {
        Some(row) => Ok(Some(row.get::<_, String>(0).map_err(|e| e.to_string())?)),
        None => Ok(None),
    }
}

#[tauri::command]
fn kv_put(state: State<DbState>, store: String, key: String, value: String) -> Result<(), String> {
    if !valid_store(&store) {
        return Err(format!("unknown store: {store}"));
    }
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO kv (store, key, value) VALUES (?1, ?2, ?3)
         ON CONFLICT(store, key) DO UPDATE SET value = excluded.value",
        params![store, key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn kv_delete(state: State<DbState>, store: String, key: String) -> Result<(), String> {
    if !valid_store(&store) {
        return Err(format!("unknown store: {store}"));
    }
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM kv WHERE store = ?1 AND key = ?2",
        params![store, key],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
struct KvRow {
    key: String,
    value: String,
}

#[tauri::command]
fn kv_get_all(state: State<DbState>, store: String) -> Result<Vec<KvRow>, String> {
    if !valid_store(&store) {
        return Err(format!("unknown store: {store}"));
    }
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT key, value FROM kv WHERE store = ?1 ORDER BY key")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![store], |row| {
            Ok(KvRow {
                key: row.get(0)?,
                value: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
fn ephe_get(state: State<DbState>, name: String) -> Result<Option<String>, String> {
    if !valid_ephe_name(&name) {
        return Err(format!("invalid ephemeris file name: {name}"));
    }
    let path = state.ephe_dir.join(&name);
    match fs::read(&path) {
        Ok(bytes) => Ok(Some(B64.encode(bytes))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn ephe_put(state: State<DbState>, name: String, data: String) -> Result<(), String> {
    if !valid_ephe_name(&name) {
        return Err(format!("invalid ephemeris file name: {name}"));
    }
    let bytes = B64.decode(data.as_bytes()).map_err(|e| e.to_string())?;
    fs::write(state.ephe_dir.join(&name), bytes).map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| e.to_string())?;
            fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
            let ephe_dir = data_dir.join("ephe");
            fs::create_dir_all(&ephe_dir).map_err(|e| e.to_string())?;
            let conn = Connection::open(data_dir.join("trigon.db"))
                .map_err(|e| e.to_string())?;
            conn.execute_batch(
                "PRAGMA journal_mode = WAL;
                 CREATE TABLE IF NOT EXISTS kv (
                   store TEXT NOT NULL,
                   key TEXT NOT NULL,
                   value TEXT NOT NULL,
                   PRIMARY KEY (store, key)
                 );",
            )
            .map_err(|e| e.to_string())?;
            app.manage(DbState {
                conn: Mutex::new(conn),
                ephe_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            kv_get, kv_put, kv_delete, kv_get_all, ephe_get, ephe_put
        ])
        .run(tauri::generate_context!())
        .expect("error while running Trigon");
}
