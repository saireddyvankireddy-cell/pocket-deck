# Restore Sai Photos on another Mac

This archive contains the current Sai Photos source, tests, dependency lockfile, and bundled face/OCR assets. It was backed up from the working project, including changes that have not been pushed to GitHub.

## 1. Restore the source

Download `Sai-Photos-Source.zip` from pCloud → Sai Photos → Sai Photos Build Code and unzip it. Move the extracted **Sai Photos** folder into Downloads/Documents. Keep the archive as an untouched backup.

## 2. Install tools and dependencies

Install Node.js 24 or newer and pnpm 11. The backup was verified with Node 24.19.0 and pnpm 11.25.0. In Terminal:

```sh
cd "$HOME/Downloads/Documents/Sai Photos"
pnpm install --frozen-lockfile
```

The dependency configuration includes native build approvals for sharp, onnxruntime-node, and protobufjs. An internet connection is needed to install dependencies. The CLIP model downloads when visual indexing/search is first used; its local cache is excluded from this source backup. Face/OCR assets are included under vendor/.

## 3. Create fresh private configuration

```sh
cp .env.example .env
chmod 600 .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Put the generated value in `SAI_PHOTOS_SESSION_KEY` in .env. Set `SAI_PHOTOS_ORIGIN` to the actual address used to open the app, including port 4173. For home Wi-Fi, set `SAI_PHOTOS_ALLOW_HTTP=true`. The Mac's IP may differ from the old Mac.

For token login, OAuth client ID/secret may stay empty; reconnect using your existing pCloud account token through the app. For OAuth login, enter the client ID and secret locally and update the registered pCloud callback to the new origin plus `/.netlify/functions/pcloud-auth?action=callback`. Do not put secrets into Git or share them in chat.

## 4. Check and run

```sh
pnpm test
pnpm build
SAI_PHOTOS_HOST=0.0.0.0 node scripts/dev.mjs
```

Open `http://YOUR-MAC-IP:4173/` on the Mac or iPhone on the same Wi-Fi. Keep the Mac awake. Connect to the same pCloud account. App records restore from **Sai Photos/Web/v1/Operations**, including favorites, likes, playlists, albums, people names and indexes. Only records that successfully synced can be restored. Offline song copies and Safari caches stay on their original device; download them again on a new device.

## What is excluded

.env and private credentials; .git; node_modules; dist; .netlify; .ai-cache; personal photos/music; device browser data and session cookies. Excluded dependencies and AI caches are rebuilt or downloaded. Originals and saved app records remain in pCloud and are not duplicated in the code backup.

## Integrity and GitHub

SOURCE-MANIFEST.json lists SHA-256 hashes for the archived source files. SHA256SUMS next to the archive verifies the ZIP itself. Restore instructions do not rely on the old Mac's Codex installation.

Original repository: https://github.com/saireddyvankireddy-cell/pocket-deck.git . This backup preserves the current working files; it does not push a new GitHub version or include Git history. You can initialize a new repository from the restored folder if needed.

## Smart features and later releases

Smart album rules, music title indexes, smart mixes and face-name corrections restore from the same pCloud account. Their results depend on the chosen folders and completed indexes. Reconnect first and allow restoration to finish.

For a new backup after a change, update the version/release notes, then run `pnpm release`. This builds and tests before creating a versioned source archive in mounted pCloud Drive. It requires the Mac's zip/unzip utilities and does not purchase hosting or make the website public. The included Dockerfile can be adapted to a compatible cloud Node host later; private settings and a persistent AI cache must be configured separately.

## Android companion

The `android/` folder contains Kotlin source. See `android/README.md` for JDK/SDK requirements, asset preparation and APK builds. Android and web share Sai Photos/Web/v1/Operations in pCloud; reconnect the same account. Generated APKs/models and private signing keys are excluded from source archives. Keep the signing key separately for compatible updates. Code archives are stored under Sai Photos/Web App/Build Code and Sai Photos/Android App/Build Code; APK releases go under Sai Photos/Android App/Releases.

## Sai Photos Ente gallery edition (v1.9.1)

This edition uses pCloud only. Versioned source backups are under Sai Photos Ente/Web App/Build Code and Sai Photos Ente/Android App/Build Code; APKs are under Sai Photos Ente/Android App/Releases. Shared app records remain under Sai Photos/Web/v1/Operations. The original v1.8.0 snapshots remain separate.

If Documents syncing creates duplicate generated files, set SAI_ANDROID_BUILD_DIR to an absolute temporary path such as /tmp/sai-photos-android-build before running pnpm release:android. Gradle and the release script both use this output directory. It contains generated files, while source remains in the project.

Gallery gestures: swipe to scroll even during selection; tap to select or deselect; hold for about half a second, then drag to select a range. Held selection near a screen edge scrolls the gallery. Install an updated APK over the existing app using the same signing certificate; avoid uninstalling if retaining device cache is important.

## v1.10.0 gallery expansion

See ENTE-PARITY.md for the pinned Ente reference, implemented workflows, remaining client work and backend differences. Android has manual photo upload, offline originals, pCloud Trash restore, record export and device screen-lock protection. Update all clients to v1.10.0 for restored:true deletion-tombstone reversal. Independent older Gemini/baseline code needs the same compatibility change. App lock is device-specific UI protection, not cloud encryption. New web video backend support needs a Mac server restart after any indexing job finishes. Android includes its native backend.

## Downloads workspace (14 October 2026)

The working source is now /Users/saireddy/Downloads/Documents/Sai Photos. All previous Documents contents were moved into Downloads/Documents, including the independent Gemini and original version copies. Documents/Codex is only a compatibility symlink for the active chat; actual workspace files are in Downloads. The web launcher is /Users/saireddy/Downloads/Start Sai Photos.command. Keep build tools and generated output outside iCloud-synced Documents.
