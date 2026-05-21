# NimbleTools Privacy Policy

Last updated: 2026-05-21

NimbleTools is currently a locally run macOS desktop utility toolbox. This document describes the behavior of the app in this open-source repository.

## Principles

- No account system is built in.
- No telemetry, analytics, or advertising SDK is built in.
- The app does not automatically upload your clipboard content, screenshots, file contents, or curl request history.
- Most tools process data locally.

## Locally Stored Data

The following data may be stored on your machine:

- Clipboard history: text, file paths, cached image paths, and preview metadata.
- Clipboard image cache: images read from the clipboard may be written to the app cache directory.
- Curl workspace data: projects, folders, requests, headers, query parameters, request bodies, response headers, response bodies, errors, and history entries.
- App preferences: theme, language, hotkey configuration, and similar settings.

These files usually live under the operating-system app data and cache directories assigned to NimbleTools. The exact path is determined by Tauri and the operating system.

## Network Access

The app has no background telemetry or automatic reporting.

Network access can happen when:

- You explicitly send a request from the `Curl` tool.
- You open an external link from the app or documentation.
- Your development environment installs or builds dependencies, for example through `npm install` or Cargo.

The `Curl` tool sends requests using the URL, method, headers, query parameters, and body you provide. It stores request and response history locally in a SQLite database.

## System Permissions

Depending on the feature you use, macOS may ask for:

- Screen Recording permission for screenshots.
- Accessibility permission for quick paste automation.
- Clipboard access for clipboard history.
- File access for files you explicitly choose.

## Clearing Data

You can clear clipboard history or curl history inside the app. You can also remove NimbleTools data from the app data directory.

If you are not sure where the app data directory is, search the source:

```bash
rg "app_data_dir|app_cache_dir" src-tauri/src
```

Main data files:

- `clipboard.db`
- `curl.db`
- `clipboard_cache/`

## Source Release Privacy Boundary

The public repository should not include:

- Local databases.
- Build caches.
- Packaged release artifacts.
- Signing certificates.
- Private keys.
- `.env` files.
- Personal paths or internal planning notes.

The root `.gitignore` excludes these common files by default. A sensitive-data scan is still recommended before publishing.
