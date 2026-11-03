# SocialStream Studio

Cross-platform personal desktop application (**Windows** & **macOS**) built with **Electron 35**, **React 19**, **Tailwind CSS**, and **Native Node SQLite (`node:sqlite`)** for scheduling and uploading large videos and posts to **YouTube** and **Facebook Pages**.

## Key Architecture Highlights

- **Zero-Plaintext Credential Vault (`electron/security/secureVault.ts`)**: Encrypts OAuth `access_token`, `refresh_token`, Facebook Page tokens, and Client Secrets using Electron's native `safeStorage` (**macOS Keychain** on macOS, **Windows DPAPI** on Windows).
- **Main-Process-Only API Boundary**: Strict `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, and `Content-Security-Policy` block renderer network access to external APIs. All Google and Meta API calls execute exclusively inside the Electron Main process.
- **RFC 8252 Loopback OAuth 2.0 (`electron/auth/oauthManager.ts`)**: Opens the system default browser, validates PKCE (`S256`) + cryptographic `state` on a temporary `127.0.0.1` loopback listener (`http://localhost:53682/oauth/<provider>/callback`), auto-refreshes Google offline tokens, and upgrades Facebook tokens into 60-day User & Long-Lived Page Access Tokens.
- **Resumable Chunked Video Uploads**:
  - **YouTube Data API v3 (`electron/uploaders/youtubeUploader.ts`)**: Streams fixed `8 MB` (`32 × 256 KB`) chunks directly from disk with HTTP `308 Resume Incomplete` byte-range tracking and automatic session offset recovery on transient `5xx`/`429`/network interruptions.
  - **Facebook Graph Video API v21.0 (`electron/uploaders/facebookUploader.ts`)**: Implements the 3-phase resumable upload protocol (`start` -> `transfer` -> `finish`) plus Page Feed text status posts.
- **Native Zero-Rebuild SQLite (`electron/db/sqlite.ts`)**: Uses Node's built-in `node:sqlite` (`DatabaseSync`) in WAL mode with independent per-platform target tracking (`job_targets`), startup crash recovery, and smart single-target retry.
- **System Tray Background Execution (`electron/tray/trayManager.ts` & `electron/scheduler/uploadScheduler.ts`)**: Continues running `node-cron` when closed/minimized to the System Tray and prevents OS sleep mid-upload using `powerSaveBlocker`.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Optional: copy .env.example to .env (or configure keys inside the app's "API Credentials" modal)
cp .env.example .env

# 3. Run in development mode (Vite HMR + TypeScript Electron watcher)
npm run dev
```

## Production Packaging

```bash
# Build macOS .dmg & .zip
npm run dist:mac

# Build Windows NSIS .exe installer
npm run dist:win
```

