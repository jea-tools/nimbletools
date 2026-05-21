# NimbleTools for macOS

> NimbleTools is a privacy-first desktop utility toolbox for macOS.
> For the Windows version, visit: [nimbletools.jea.ink](https://nimbletools.jea.ink/)

[中文说明](./README.zh.md) | [Privacy Policy](./PRIVACY.en.md) | [隐私说明](./PRIVACY.md)

## Current Status

This repository currently targets **macOS** only. No ready-to-install package is provided here.

For now, run the app from the command line:

```bash
npm install
npm run tauri dev
```

## What It Is

NimbleTools is a local desktop utility toolbox built with Tauri 2, React, TypeScript, and Rust. It collects common tools for image processing, file operations, text encoding, screenshot annotation, clipboard history, and curl request debugging in one desktop app.

Default design principles:

- Process data locally whenever possible.
- No account system.
- No built-in telemetry, analytics, or ad SDK.
- No automatic upload of clipboard content, screenshots, or local files.

The important exception: the `Curl` tool will make network requests to URLs you enter when you explicitly send a request. Opening external links, OCR, file selection, clipboard access, and screenshot capture also rely on the relevant system APIs.

## Features

### Image Tools

- Format conversion: JPG, PNG, WebP, BMP.
- Resize by pixels or percentage.
- JPEG quality compression.
- Horizontal or vertical image merge.
- Text watermarking.

### File Tools

- Split files by size or number of parts.
- Merge split files with optional CRC32 verification.
- Batch rename with prefixes, suffixes, find/replace, regex, numbering, and live preview.

### Text and Encoding

- OCR through Apple Vision on macOS.
- Base64 encode/decode.
- JSON / XML format, minify, and validation.
- URL encode/decode.
- Regex tester.
- Text statistics.

### Utilities

- QR code generator.
- Unit converter.
- Color picker.
- Timestamp converter.
- Hash calculator.
- UUID generator.
- Password generator.
- Number base converter.
- Curl request workspace.
- Clipboard history.

### Screenshot Annotation

- Screen capture.
- Region selection.
- Annotation editor: pen, rectangle, ellipse, arrow, line, and text.
- Save or copy annotated screenshots.

Some macOS features require system permissions:

- Clipboard history and quick paste may require clipboard and accessibility-related permissions.
- Screenshot capture requires screen recording permission.
- OCR uses the Apple Vision Framework.

## Requirements

- macOS 12.3 or later.
- Node.js 18 or later.
- Rust stable.
- Tauri 2 system prerequisites.

Check your environment:

```bash
node --version
npm --version
rustc --version
cargo --version
```

## Run Locally

```bash
git clone git@github.com:jea-tools/nimbletools.git
cd nimbletools
npm install
npm run tauri dev
```

This repository does not currently provide a one-click installer. `npm run tauri dev` starts both Vite and the Tauri development process.

## Build

Build on macOS:

```bash
npm install
npm run tauri build
```

Bundle output is generated under `src-tauri/target/release/bundle/`.

## Tech Stack

- Tauri 2
- React 19
- TypeScript
- Vite
- Rust
- rusqlite
- reqwest
- arboard
- lucide-react
- react-i18next

## Data and Privacy

See [PRIVACY.en.md](./PRIVACY.en.md).

Short version:

- Clipboard history is stored locally in a SQLite database under the app data directory.
- Curl projects, requests, and history are stored locally in a SQLite database under the app data directory.
- Screenshot, image, and file operations use local files plus system temp/cache directories.
- The app has no built-in telemetry, advertising, or account system.

## Before Publishing Source

Do not commit:

- `node_modules/`
- `dist/`
- `src-tauri/target/`
- local `.env*` files
- databases, logs, screenshot caches, packaged release artifacts
- certificates, signing files, private keys, release credentials

The root `.gitignore` excludes these by default.

## License

MIT
