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
| Unit + contract | `node --test scripts/*.test.mjs` | 112 |
| Android instrumented | `connectedReleaseAndroidTest` | 25 |
| CDP end-to-end harness | `node /tmp/sai-cdp.mjs` | 104 |
| AI/search harness | `node /tmp/sai-ai-check.mjs` | 13 |
| Deep interaction regression | `node /tmp/sai-deep-regress.mjs` | 19 |
| Web smoke | `node /tmp/sai-web-smoke.mjs` | OK |

Harness setup after a release: `adb install -r ~/Downloads/Sai-Photos-Android-<ver>.apk`, launch `com.saiphotos.mobile/.MainActivity`, then `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`. Harnesses talk to `http://127.0.0.1:9222`. Gotcha: don't name a harness variable `pill` (it shadows an existing global and breaks the script). Deep-regress script needs `awaitPromise: true` with a large timeout (it runs ~40s).

## 6. Current status (latest release)

- **Version: v1.28.5** (commit `b2a6ea2`, pushed to both remotes).
- APK: `~/Downloads/Sai-Photos-Android-Latest.apk` = `Sai-Photos-Android-v1.28.5.apk` (221,538,212 bytes, SHA-256 `f64f037ca42df4982098cefbe11e9398a677c50b572932e32132613394427869`).
- Direct download (Samsung on the same Wi-Fi): **http://192.168.88.6:8099/Sai-Photos-Android-Latest.apk** — served by `python3 -m http.server 8099 --directory ~/Downloads` on the Mac. Stops when the Mac sleeps/reboots; restart the command if the link dies.
- Regression for v1.28.5: 112 unit, 25 Android, 104 + 13 + 19 harness checks, web smoke OK, 0 crashes/ANRs/JS errors.

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
