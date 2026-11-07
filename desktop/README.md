# Desktop (Tauri)

Trigon as a desktop app: a thin Tauri 2 wrapper around the Trigon web
app in `../site/`, running in the system webview, with profiles,
settings, and saved charts stored in SQLite instead of
IndexedDB/localStorage. The desktop release follows each major Trigon
update.

- Web app: https://trigon.pages.dev
- Desktop version: set in `src-tauri/Cargo.toml` and
  `src-tauri/tauri.conf.json` together — GitHub Releases in the Trigon
  repo carry the desktop builds (see Release process below).

## What the wrapper owns, and nothing else

Rust owns a window, a SQLite database, and an ephemeris directory on
disk. It owns no astrology.

- **SQLite** (`trigon.db` in the app data dir): one table, `kv(store,
  key, value TEXT as JSON)`, over the stores `settings`, `profiles`,
  `charts`, `meta`. The frontend's persistence layer is a
  key-value abstraction over those stores, so the SQLite backend maps
  onto it with no logic change in the app.
- **Ephemeris files**: `.se1` files live under `<app data>/ephe/`,
  not in SQLite blobs and not in IndexedDB. Transferred base64 over
  Tauri invoke, since commands are JSON.
- **Ephemeris computation: none.** The Swiss Ephemeris runs in WASM
  (`swe.wasm`) exactly as on the web, and searches keep their Web
  Worker parallelization. That parallelization is the speedup; a
  second, Rust-native ephemeris would be a second source of truth
  for no non-trivial gain.

## Layout

- `src-tauri/` — the Rust wrapper:
  - `Cargo.toml` — package `trigon-desktop`, dependencies (Tauri 2
    with the `custom-protocol` feature, `rusqlite`, `serde`,
    `serde_json`, `base64`), release profile (LTO, single codegen unit).
  - `Cargo.lock` — pinned dependency tree.
  - `src/main.rs` — the six commands `kv_get`/`kv_put`/`kv_delete`/
    `kv_get_all`/`ephe_get`/`ephe_put`, the `kv` table, and the
    `ephe/` directory setup.
  - `tauri.conf.json` — product `Trigon`, identifier
    `com.koennecker.trigon`, `frontendDist` `../../site` (relative to
    `src-tauri/`, where the config file lives), window 1280×900,
    bundle targets `all`, the content-security policy, and the icon
    list.
  - `capabilities/default.json` — the capability set: `core:default`
    plus `core:window:allow-set-title`.
  - `build.rs` — the Tauri build script.
  - `icons/` — the platform bundle icons (`icon.png`, `icon.ico`,
    `icon.icns`, `32x32.png`, `128x128.png`, `128x128@2x.png`),
    matching the site logo.
  - `gen/` — Tauri-generated code, not checked in.
  - `target/` — the Cargo build directory, not checked in.
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

Prerequisites: Rust (stable), Tauri Linux system libraries
(`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`,
`libayatana-appindicator3-dev`, `librsvg2-dev`, `libsoup-3.0-dev` on
Ubuntu/Debian). The Tauri CLI is installed with
`cargo install tauri-cli --version "^2"`.

```bash
./test.sh                      # repo root: node tests + tsc, includes desktop.test.js
cargo tauri build              # from desktop/; bundles in src-tauri/target/release/bundle/
```

The Linux bundle targets are `.deb`, `.AppImage`, and `.rpm`
(`bundle.targets` is `all`). The `.rpm` needs the `rpm` tool
installed; without it, build Linux-only targets explicitly:

```bash
cargo tauri build --config '{"bundle":{"targets":["deb","appimage"]}}'
```

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
  an explicit export/import.
- If the Tauri bridge is absent, the app behaves exactly as the web
  app (IndexedDB), so the same `site/` ships to Pages and desktop.

## Release process

Desktop releases live on GitHub Releases in the Trigon repo,
versioned independently of the web app.

**Windows and macOS** build in CI (`.github/workflows/desktop-release.yml`):
the matrix is `macos-latest` and `windows-latest`. macOS builds target
arm64 and are unsigned, so the operating system shows its standard
security warning on first open. The workflow is triggered by pushing a
version tag (`v*`), which builds and attaches to that release (creating
it if it does not exist), or by manual dispatch with a `tag` input to
attach builds to the release for that tag.

**Linux** builds on the developer machine (`cargo tauri build` from
`desktop/`, `.deb` + `.AppImage` + `.rpm` since `bundle.targets` is
`all`; `rpm` must be installed for the local build — see Build above),
and the artifacts are attached to the release.

1. A major Trigon update lands on the web (the usual pipeline:
   feature commit, source-zip rebuild, perf run, deploy).
2. Bump the desktop version in `src-tauri/Cargo.toml` and
   `src-tauri/tauri.conf.json` together, rebuild, and smoke-test
   under Xvfb (create a profile, save a named chart, quit, relaunch,
   confirm it persisted in SQLite).
3. Commit and push, one logical change per push, with the same message
   on the local commit and the push.
4. Create the GitHub Release `vX.Y.Z` with the built Linux artifacts
   (`.deb`, `.AppImage`, `.rpm`) attached, and trigger the workflow
   for the Windows and macOS artifacts (or push the `vX.Y.Z` tag
   first and let the workflow create the release).
5. Major updates repeat steps 1–4; minor desktop-only fixes bump the
   patch version and release the same way.
