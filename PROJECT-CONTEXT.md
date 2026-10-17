# Sai Photos — project context

Living reference for everything Sai Photos: what the app is, how to build/test/release it, current status, and the gotchas. Update this file whenever a release ships. The dated decision log lives in `AGENTS.md`; user-facing change history lives in `RELEASE_NOTES.md` and `settings.mjs` (`RELEASES`).

## 1. What this is

Sai Photos is a hybrid gallery + music app:

- **Web UI** — plain ES modules (`app.js`, `photo-library.mjs`, `music-player.mjs`, `settings.mjs`, `smart-features.mjs`, `assistant.mjs`, …) served by a small Node dev server. No framework, no bundler.
- **Android app** — a thin Kotlin shell (`android/app/src/main/java/com/saiphotos/mobile/`) hosting the same web UI in a WebView, plus native bridges for pCloud, speech, contacts, notifications, battery and local indexing.
- **Backend** — Netlify-style functions under `netlify/functions/` call the pCloud API. All media and app records live in the user's **pCloud** account; there is no Sai Photos server-side storage.
- **Android runs "Photos-only"** (`SAI_PHOTOS_ONLY`) with music enabled: bottom nav is **Library, Albums, Music, Search**.

## 2. Locations and environment

- Active source: `/Users/saireddy/Downloads/Documents/Sai Photos` (work here; always pass an explicit working directory).
- Node binary used by tooling: `/Users/saireddy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`
- Android toolchain: `Downloads/Documents/Codex/2026-10-13/ca/work/android-toolchain` — `JAVA_HOME=amazon-corretto-17.jdk/Contents/Home`, `ANDROID_HOME=sdk`, Gradle `gradle-8.13/bin/gradle`. Release env file: `/tmp/sai-release-env.sh`.
- ADB: `android-toolchain/sdk/platform-tools/adb`. Emulator AVD: `sai-test` (no pCloud account — indexing/real sync can't be validated there).
- Build outputs must stay outside synced Documents: `SAI_ANDROID_BUILD_DIR=/tmp/sai-photos-next-android-build`.
- Web dev server / Mac indexing server: `http://localhost:4173` (also reachable on the LAN, e.g. `http://192.168.88.6:4173`). Launchd agents: `com.saireddy.sai-site.plist`, `com.saireddy.sai-index.plist`; logs in `~/Library/Logs/sai-{site,index}.log`.

## 3. Build / test / release commands

```bash
# Unit + contract tests (fast, the main gate)
node --test scripts/*.test.mjs

# ESM syntax check when editing a browser module
cp app.js /tmp/app-check.mjs && node --check /tmp/app-check.mjs

# Full Android release (build + unit tests + device tests + pCloud backups)
source /tmp/sai-release-env.sh
export SAI_ANDROID_BUILD_DIR=/tmp/sai-photos-next-android-build
export SAI_ANDROID_OUTPUT=/Users/saireddy/Downloads
export SAI_ANDROID_DEVICE_TEST=true
nohup node scripts/android-release.mjs > /tmp/sai-vX.Y.Z-release.log 2>&1 &
# ~2–3 min warm; copies APK + source to ~/pCloud Drive/Sai Photos Ente/Android App/{Releases,Build Code}/

# Android instrumented tests only (25 tests)
source /tmp/sai-release-env.sh
export SAI_ANDROID_BUILD_DIR=/tmp/sai-photos-next-android-build
./android/gradlew -p android :app:connectedReleaseAndroidTest --max-workers=2 --console=plain
```

## 4. Version bump checklist (every user-visible release)

1. `settings.mjs` — `APP_VERSION` and a new `RELEASES[0]` entry (`version`, `date`, `time`, `title`, `changes`).
2. `package.json` — `version`.
3. `sw.js` — `CACHE_NAME` (bump `sai-photos-vNN`).
4. `android/app/build.gradle.kts` — `versionName` (match) and `versionCode` (+1).
5. `android/.../MainActivity.kt` — user-agent `SaiPhotosAndroid/<version>`.
6. Harnesses: `/tmp/sai-cdp.mjs` and `/tmp/sai-ai-check.mjs` version/time strings.
7. `build.mjs` enforces `APP_VERSION === package.json === RELEASES[0].version`.

## 5. Test suites

| Suite | Command | Expected |
|---|---|---|
| Unit + contract | `node --test scripts/*.test.mjs` | 115 |
| Android instrumented | `connectedReleaseAndroidTest` | 25 |
| CDP end-to-end harness | `node /tmp/sai-cdp.mjs` | 104 |
| AI/search harness | `node /tmp/sai-ai-check.mjs` | 13 |
| Deep interaction regression | `node /tmp/sai-deep-regress.mjs` | 19 |
| Web smoke | `node /tmp/sai-web-smoke.mjs` | OK |

Harness setup after a release: `adb install -r ~/Downloads/Sai-Photos-Android-<ver>.apk`, launch `com.saiphotos.mobile/.MainActivity`, then `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`. Harnesses talk to `http://127.0.0.1:9222`. Gotcha: don't name a harness variable `pill` (it shadows an existing global and breaks the script). Deep-regress script needs `awaitPromise: true` with a large timeout (it runs ~40s).

## 6. Current status (latest release)

- **Sai Photos — Version: v1.28.6** (deep-link API for Sai AI). APK: `~/Downloads/Sai-Photos-Android-Latest.apk` = `Sai-Photos-Android-v1.28.6.apk` (221,539,004 bytes, SHA-256 `c19f9699bb52ecd255cbe19f1c9db6d53f4d6abc76833128facca9feedb4fee0`).
- **Sai AI — Version: v1.0.0** (first release, standalone app, package `com.saireddy.saiai`). APK: `~/Downloads/Sai-AI-Android-Latest.apk` = `Sai-AI-Android-v1.0.0.apk` (50,390,122 bytes, SHA-256 `74462c924a1ec66fa385bb2a3e79636af36a8f7c7a68d2542ccca9f28f365c05`).
- Direct download (Samsung on the same Wi-Fi): **http://192.168.88.6:8099/Sai-Photos-Android-Latest.apk** and **http://192.168.88.6:8099/Sai-AI-Android-Latest.apk** — served by `python3 -m http.server 8099 --directory ~/Downloads` on the Mac. Stops when the Mac sleeps/reboots; restart the command if the link dies.
- Regression for v1.28.6: 115 unit/contract (incl. 3 new deep-link contract tests), 25 Android, 104 + 13 + 19 harness checks, deep-link handler verified on emulator (albums/favorites/photos/search/home → ok, missing album/person/photo → clear errors, cold-start queue applies). Sai AI: 15 core CDP + 9/9 Photos/pCloud/deep-link CDP checks. 0 crashes/ANRs/JS errors.

### What v1.28.6 changed

- **Deep-link API (`saiphotos://open`)** so another app (Sai AI) can open Sai Photos straight to the right place: `view=photos|albums|favorites|search`, `&q=<query>`, `&album=<name>`, `&person=<name>`, `&photo=<id>`.
- Manifest gains a `saiphotos://open` intent-filter; `MainActivity.kt` parses the launch intent in `onCreate` and `onNewIntent`, queues links that arrive before the page loads (`pendingDeepLink`), and flushes them in `onPageFinished`; the web layer exposes `window.saiDeepLink(payload)` in `app.js`.
- Links carry only a view name, search phrase, album/person name or photo id — never media, login or tokens. All permissions unchanged.
- Used by Sai AI: open albums, jump to search, or open a specific pCloud photo in Sai Photos.

### What v1.28.5 changed

- **Search is unified.** The AI tab is gone. Type in the Search bar (or press the mic) to ask anything — greetings, real answers, indexing status, music. Search covers photo filenames, AI index text, faces/People names, and music by filename, liked songs and recently played, each in its own labelled section.
- **Albums.** Three compact cards per row; no Hide/Delete on cards. Open an album for **Hide album / Rename album / Delete album**. Hide keeps originals in pCloud and is restorable in Settings → Hidden.
- **Smaller, calmer type** across titles, chips, buttons, bottom bar and Settings.
- **Apple Photos–style Library.** The folder card, indexing buttons and status lines moved into Settings → Indexing; empty status lines take no vertical space. Library is just photos.
- **Navigation** always lands at the top of the target page; Back returns to the top of the albums list.
- All Android permissions unchanged (microphone, notifications, photos/media).

## 7. Architecture notes worth remembering

- **Assistant merge.** One `#search` input plus `#aiAskMic` micro in `.tools`. `openSearchView()` clicks `#navSearch` when search is hidden. `window.saiAssistantOpen` is called by `smart-features` `navigate('search')`. Enter in `#search` asks; the ask path clears the bar and resets `searchQuery`/`semanticScores`.
- **`renderSearchExtras()`** (in `app.js`, just before `appendPhotoCards`) fills `#searchExtras` with People chips and music sections, and controls `#aiSearchExtras` (the chat log) visibility. Search-view detection uses the gallery page title.
- **Album cards** (`photo-library.mjs` `sections()`) — the click handler must stay intact: virtual-collection branch sets `filters={ids:collection.photos}`; otherwise `this.focus = collection.id`, then render + scroll to top.
- **Music API**: `musicPlayer.allTracks()` → Map; `items(query)` view-filtered; `play(track, list)`. Likes/history in `photoLibrary.meta.musicLikes` / `musicHistory`.
- **Indexing** runs locally on the device (`LocalAI.kt` + ClipEngine) and on the Mac; both write the same per-photo records to pCloud, so completed indexes are reused and skipped across devices.
- **New modules** must be added to `scripts/build.mjs`, `scripts/dev.mjs` (assets set) and `sw.js` (`ASSETS`); a regression test serves every `sw.js` asset.
- **Kotlin gotchas**: local `fun` inside a lambda is not allowed; `catch{}reply` needs a `;`; `SpeechRecognizer.ERROR_PERMISSIONS` doesn't exist (use literal `9`).
- **Emulator**: grant permissions with `adb shell pm grant` and dismiss leftover system dialogs before screenshots/harnesses.

## 8. Known blockers / pending user actions

- **Mac indexing claim** (one-time): on the Mac, open `http://localhost:4173`, sign in to pCloud, then open `http://localhost:4173/.netlify/functions/mac-index-claim` once. Writes `~/.sai-index-session`. Until done, the Mac index agent idles.
- **pCloud OAuth redirect** `pcloud-oauth://com.saiphotos` must be registered in the pCloud dev console; the web "Connect pCloud" may still need the token fallback.
- **Emulator has no pCloud account**, so indexing/full-sync is only truly validatable on the user's Samsung.
- No cloud hosting/HTTPS set up yet, so the web app works only while the Mac is on.

## 9. Repos and backups

- Git remotes: `origin` → `saireddyvankireddy-cell/pocket-deck`, `saisource` → `vankireddysai-source/SaiPhotos`, branch `main`. Commit style `v<ver>: …`; push both.
- pCloud backups (written by the release script): `Sai Photos Ente/Android App/Releases/v<ver>-<ISO>` (APK) and `.../Build Code/v<ver>-<ISO>` (source). Preserve older snapshots.
- Never commit `.env`, credentials, session cookies, personal media, `.ai-cache`, `node_modules`, or the signing key.

## 10. Paused: backup + "own storage" plan (decided 17 October 2026)

Sai Photos development is **on hold**. This section records the storage/backup decisions so they are not lost.

**Decision / plan**
- User already has Google **5 TB** for ~1.5 more years and is willing to buy a **pCloud 2 TB lifetime** plan. Existing pCloud plan in use.
- **Next backup step (later, ~1 week out, user to confirm):** clone pCloud → Google Drive. User will first delete duplicates in pCloud, then report the total size. Tool: **rclone** (`brew install rclone`), two remotes (`pcloud:`, `gdrive:`) configured with the user's own browser sign-in. Use `rclone copy` (never destructive `sync`) with `--transfers 16 --checkers 16 --fast-list --progress`, log to `~/Library/Logs/sai-gdrive-backup.log`; optionally schedule daily via launchd.
- Speed: cannot exceed provider limits — the real cap is **Google Drive's ~750 GB/day upload limit** plus home upload bandwidth, so a multi-TB library takes several days. Parallel transfers help; rclone resumes and verifies checksums.
- 3-2-1: pCloud (primary) + Google Drive (mirror) + an external HDD copy.

**"Own storage" options researched (2026 prices, approximate)**
- Object storage (S3-compatible, pay-as-you-go — "pay for what you use"):
  - Backblaze B2 — **$6.95/TB/mo**, 10 GB free, egress free up to 3× stored then $0.01/GB.
  - Cloudflare R2 — **$0.015/GB/mo ($15/TB)**, **$0 egress**, request fees only, 10 GB free.
  - Wasabi — $7.99/TB/mo, no egress fee (fair-use ratio), 1 TB + 90-day minimums.
  - Hetzner Object Storage — ~€6.49/mo incl. 1 TB. Hetzner Storage Box — €3.20/mo for 1 TB (SFTP/rsync/WebDAV).
  - AWS S3 — **$0.023/GB/mo** + **$0.09/GB egress** (expensive; avoid for a photo app). Azure/GCS similar.
- Lifetime plans (one-time payment): pCloud 500 GB $199 / 2 TB $399–499 / 10 TB $1190–1499; Icedrive, Koofr, Internxt similar but smaller companies (riskier). No mainstream provider other than these offers true "forever".
- Self-hosted: NAS/mini-PC + HDD + Nextcloud/MinIO — one-time hardware, you maintain it.

**Key concept recorded:** a "bucket" is raw object storage with an API — it is **not** an app like pCloud (no gallery UI, no sync client). pCloud = storage + apps; a bucket = storage only, used via rclone/Cyberduck/the provider console, or an app you build. To make Sai Photos read from a bucket we must add an **S3/WebDAV storage adapter** (backend today is pCloud-only), and optionally host the backend on a server (Cloudflare Workers / small VPS / Lambda) so it is always-on. That work is **not started** and stays on hold.

## 11. Sai AI (standalone app, v1.0.0) — started 17 October 2026

- **Location:** `Sai Photos/Sai AI/` (own Gradle project; `applicationId`/namespace `com.saireddy.saiai`, versionCode 1, versionName `1.0.0`).
- **Toolchain:** AGP `8.9.2`, Gradle `8.13`, Kotlin plugin `2.4.0` (pulled by `litertlm-android 0.17.1`), `compileSdk=35`, `minSdk=26`, `targetSdk=35`, release debug-signed, `largeHeap`. `kotlin { compilerOptions { jvmTarget = JVM_17 } }` — Kotlin 2.4 rejects `kotlinOptions`. Build: `"$SAI_ANDROID_GRADLE_BIN" --no-daemon -p . :app:assembleRelease` with `SAI_ANDROID_BUILD_DIR=/tmp/sai-ai-build`.
- **Deps:** `com.google.ai.edge.litertlm:litertlm-android:0.17.1`, `com.squareup.okhttp3:okhttp:4.12.0`.
- **Brains:** offline on-device LiteRT-LM (`LlmEngine.kt`) using `Engine.setNativeMinLogSeverity`, `EngineConfig(modelPath, backend=Backend.CPU(), cacheDir)`, `createConversation(ConversationConfig(systemInstruction=Contents.of(prompt)))`, `sendMessageAsync(text, MessageCallback)`. Extract text with `message.contents.toString()` — `Message` has **no** `.text`. Cloud brain: OpenRouter free tier, `baseUrl=https://openrouter.ai/api/v1`, `model=deepseek/deepseek-v4-flash:free` (OpenAI-compatible function calling drives the agent).
- **UI:** WebView, 5 tabs (chat/photos/models/agent/settings), same bridge conventions as Sai Photos (`SaiNative.request(id, action, bodyJson)`, `saiNativeReply`, `saiAIEvent`). Photos tab shows a pCloud connect UI + search grid; agent tools include `search_pcloud_photos` and `open_in_saiphotos`.
- **Photos + deep links:** copied pCloud client (`PCloudApi/PCloudOAuth/Credentials/MediaRules`, package-renamed) and added `connected()`/`disconnect()`. Bridge actions: `pcloud-start/token/status/disconnect/library/thumb`, `open-in-saiphotos`, `pcloud-tool`. Manifest has `<queries>` for `com.saiphotos.mobile` (Android 11+ package visibility) and a `pcloud-oauth://com.saiphotos` intent-filter. Deep links into Sai Photos use `saiphotos://open?...` (v1.28.6 API).
- **Model catalog (HF `litert-community`):** `qwen3-0.6b` default (497,516,544 B, ungated Apache-2.0), `qwen2.5-1.5b` (1,597,913,616 B, ungated), `gemma3-1b` (~584 MB gated), `gemma4-e2b` (~2,588 MB).
- **Blocker:** emulator `emulator-5554` (arm64, Android 15/SDK 35) exposes `svei8mm` but not plain NEON `i8mm` → LiteRT `nativeCreateEngine` raises `SIGILL`. API usage is correct; on-device inference must be validated on the user's real Samsung arm64 device. Model **download** is verified end-to-end on the emulator (foreground service + live progress). Emulator also has no pCloud account, so live pCloud search/library/thumbnails are only error-path verified.
- **Regression (v1.0.0):** 15/15 core CDP checks + 9/9 Photos/pCloud/deep-link CDP checks on emulator; media-permission agent tools verified (`list_albums`, `list_photos`, `photo_info`).


