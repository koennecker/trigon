# Desktop (Tauri)

Trigon as a desktop app: a thin Tauri 2 wrapper around the Trigon web
app in `../site/`, running in the system webview, with profiles,
settings, and saved charts stored in SQLite instead of
IndexedDB/localStorage. There is no separate desktop repo: this
directory lives in the Trigon repo, and the desktop release follows
each major Trigon update.

- Web app: https://trigon.pages.dev
- Desktop version: `0.0.1` — GitHub Releases in the Trigon repo carry
  the desktop builds (see Release process below).

## What the wrapper owns, and nothing else

Rust owns a window, a SQLite database, and an ephemeris directory on
disk. It owns no astrology.

- **SQLite** (`trigon.db` in the app data dir): one table, `kv(store,
  key, value TEXT as JSON)`, over the stores `settings`, `profiles`,
  `charts`, `meta`. The frontend's persistence layer is already a
  key-value abstraction over those stores, so the SQLite backend maps
  onto it with no logic change in the app.
- **Ephemeris files**: `.se1` files live under `<app data>/ephe/`,
  not in SQLite blobs and not in IndexedDB. Transferred base64 over
  Tauri invoke, since commands are JSON.
- **Ephemeris computation: none.** The Swiss Ephemeris runs in WASM
  (`swe.wasm`) exactly as on the web, and searches keep their Web
  Worker parallelization. That parallelization is the speedup; a
  second, Rust-native ephemeris would be a second source of truth
  for no non-trivial gain. (Blake decision, 2026-11-07.)

## Layout

- `src-tauri/` — the Rust wrapper: `src/main.rs` (the six commands
  `kv_get`/`kv_put`/`kv_delete`/`kv_get_all`/`ephe_get`/`ephe_put`),
  `tauri.conf.json` (product `Trigon`, version `0.0.1`, identifier
  `com.koennecker.trigon`, `frontendDist` `../../site` — relative to
  `src-tauri/`, where the config file lives),
  `capabilities/`, `build.rs`, `icons/icon.png` (generated from the
  Trigon logo).
- `../site/desktop.js` — the only frontend file that knows about
  Tauri. `isDesktop()` checks `window.__TAURI__` (enabled by
  `withGlobalTauri` in `tauri.conf.json`); `createTauriBackend()`
  implements the `persistence.js` backend interface over the Rust
  `kv_*` commands; `epheGetDesktop`/`ephePutDesktop` do the same for
  `.se1` files over `ephe_*`. Safe to import on the web: nothing
  Tauri is touched unless `isDesktop()` is true. `../site/app.js`
  selects the SQLite backend when under Tauri and IndexedDB
  otherwise; `../site/ephe-store.js` branches the same way for
  `.se1` files and skips the Cache API migration on desktop.
  `../site/test/desktop.test.js` covers the adapter against a mocked
  invoke layer and runs in the repo's `./test.sh`.

## Build

Prerequisites: Rust (stable, under `~/.cargo`), Tauri Linux system
libraries (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`,
`libayatana-appindicator3-dev`, `librsvg2-dev`, `libsoup-3.0-dev` on
Ubuntu/Debian). The Tauri CLI is installed with
`cargo install tauri-cli --version "^2"`.

```bash
./test.sh                      # repo root: node tests + tsc, includes desktop.test.js
cargo tauri build              # from desktop/; bundles in src-tauri/target/release/bundle/
```

The Linux bundle targets are `.deb` and `.AppImage`. macOS and Windows
builds need their own runners; the Rust code is platform-independent
and the frontend is unchanged.

To run a dev build under Xvfb:

```bash
xvfb-run cargo tauri dev
```

## Data

- SQLite file: `<app data>/trigon.db` — `~/.local/share/com.koennecker.trigon/trigon.db`
  on Linux, the equivalent app data dir on macOS/Windows. One table:
  `kv(store TEXT, key TEXT, value TEXT, PRIMARY KEY(store, key))`.
- Ephemeris files: `<app data>/ephe/*.se1`, downloaded on demand
  from `raw.githubusercontent.com` exactly as on the web, then cached.
- Web data does not migrate automatically: a desktop install is a
  fresh profile. Moving web IndexedDB data into desktop SQLite needs
  an explicit export/import, which does not exist yet.
- If the Tauri bridge is absent, the app behaves exactly as the web
  app (IndexedDB), so the same `site/` ships to Pages and desktop.

## Release process

Desktop releases live on GitHub Releases in the Trigon repo,
versioned independently of the web app. The first release is `v0.0.1`.

1. A major Trigon update lands on the web (the usual pipeline:
   feature commit, source-zip rebuild, perf run, deploy).
2. Bump the desktop version in `src-tauri/Cargo.toml` and
   `src-tauri/tauri.conf.json` together, rebuild, and smoke-test
   under Xvfb (create a profile, save a named chart, quit, relaunch,
   confirm it persisted in SQLite).
3. Commit and push (one logical change per push, same message locally
   and to `gh-push`).
4. Create the GitHub Release `vX.Y.Z` with the built Linux artifacts
   (`.deb`, `.AppImage`) attached.
5. Future major updates repeat steps 1–4; minor desktop-only fixes
   bump the patch version and release the same way.
