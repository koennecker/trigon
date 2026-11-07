# Workflows

Continuous integration for this repository. Each workflow is a single
YAML file in this directory; the runner configuration lives in the
file itself.

## Files

- `desktop-release.yml` — Builds the desktop app on the Windows and
  macOS runners and uploads the artifacts to the GitHub Release for
  the tag. The matrix is `macos-latest` and `windows-latest`. macOS
  builds target arm64 and are unsigned. Triggered by pushing a
  version tag (`v*`), or by manual dispatch with a `tag` input to
  attach builds to the release for that tag. The workflow runs with
  `contents: write` permission, which the release upload requires.
  Linux artifacts are built on the developer machine and attached to
  the release separately; see `desktop/README.md`.

## Conventions

- One workflow per file, named for the job it performs.
- The release tag is the only input. The desktop version is set in
  `desktop/src-tauri/Cargo.toml` and
  `desktop/src-tauri/tauri.conf.json`, together.
