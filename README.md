# Sai Photos

A fresh two-tab pCloud browser: Photos and Music. Photos opens by default. Includes search, image previews, original viewing and a music player. Legacy import, playlists, access-code and settings screens have been removed. Original photos can be deleted from the viewer after explicit confirmation. Favorites, albums, person names, face embeddings and English OCR indexes are saved as versioned app-owned operation records in `/Sai Photos/Web/v1/Operations` in pCloud. The Android app folders are not overwritten.

In Music, choose **Choose folder**, browse pCloud, and press **Use this folder**. Songs in subfolders are included. This browser remembers the choice per pCloud account. **Use default music folders** restores the configured `/Music` source. No files are moved.

## Run

Node.js 22+:

```
node scripts/build.mjs
node scripts/dev.mjs
```

For home Wi-Fi use `SAI_PHOTOS_HOST=0.0.0.0 node scripts/dev.mjs`.
On this Mac, the Node executable is `/Users/saireddy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`.

## Connect pCloud OAuth

1. Open your application in https://docs.pcloud.com/my_apps/.
2. Register this exact callback for the current home preview:
   `http://192.168.88.11:4173/.netlify/functions/pcloud-auth?action=callback`
3. Enter your client ID and client secret in the private `.env` file on your Mac. Do not share the secret in chat or commit it. A random session encryption key has been generated locally.
4. Restart the server. Open `http://192.168.88.11:4173` on the iPhone and press Connect pCloud. Sign in and grant access on pCloud's own website.

The callback must be allowed by pCloud's app configuration; if HTTP LAN callbacks are rejected, use the hosted HTTPS address instead. The current Mac address may change. Update the registered callback and `SAI_PHOTOS_ORIGIN` together.

This implements server-side OAuth code flow with state validation and an encrypted HttpOnly session cookie. It accepts only the US/EU API hosts returned by pCloud. Tokens and client secrets are not saved in browser localStorage or frontend files. Sessions last up to 30 days and can expire earlier if revoked at pCloud. Disconnect removes this app's browser session; revoke access at pCloud to invalidate the provider token. Private media is not service-worker cached. HTTP is for the home preview only; use HTTPS in production.

## Hosting

Deploy the Git repository to Netlify using `netlify.toml`. Set the variables from `.env.example` in the hosting dashboard, change `SAI_PHOTOS_ORIGIN` to your HTTPS site URL, set `SAI_PHOTOS_ALLOW_HTTP=false`, and register the matching HTTPS callback in pCloud. Use a separate random session key for production. Do not publish `.env`.

Media proxying may exceed serverless time or response-size limits for large originals or music files. Validate those limits and real pCloud playback on the chosen host before relying on it. OAuth and media endpoints have automated mocked tests; real account login and physical iPhone media playback still require verification.

Source remains linked to the Pocket Deck Git repository. Local edits have not been pushed.

## Photo organization and AI

Open an image for the full-screen viewer. Use the heart to toggle favorites, the viewer dropdown to add it to an album, next/previous buttons or swipe to navigate, and pinch or +/- to zoom. Create albums in Photos.

Press **Start indexing** to analyze unprocessed photos. Keep the page open; indexing is sequential, resumable and cancellable. Browser inference uses self-hosted FaceAPI and Tesseract models, with no external AI service. It analyzes a larger pCloud preview rather than the full original, so small faces or text may be missed. OCR is English. People are similarity suggestions, not verified identities. Name suggested groups for name search; search also covers filenames, album names and recognized image text. This is an initial feature set, not full Apple Photos parity.

Indexes, favorites and albums are durable in pCloud. Safari IndexedDB caches account-scoped metadata, pending operations and bounded image blobs for faster repeat viewing, including the HTTP Wi-Fi preview. Cloud sync retries on reconnect and every 15 seconds while visible. A failed cloud write is visibly marked as pending; do not clear Safari data until pending changes finish syncing. Account caches are isolated; signed-out UI does not show cached photos. The image cache holds up to 160 thumbnails, 160 larger previews and 8 originals (originals under 30 MB). Safari may evict caches under storage pressure; synced data can be restored from pCloud.

The first metadata restore may take time. Cloud operations are paged, and subsequent sync downloads only missing operations. Very large operation histories will require future compaction for scalability. Live pCloud writes and physical-iPhone AI speed must be verified with your actual account.

## Delete original photos

Open a photo and press **Delete from pCloud**. A second dialog names the photo and asks for confirmation. The authenticated server checks the exact file ID and current filename, then uses pCloud `deletefile`. It does not clear Trash. Recovery is through pCloud Trash within the account retention period. Only photos are supported by this endpoint.

Deletion requires a connection and is not queued offline. The app removes the photo only after the server confirms deletion, purges that photo's local image cache, and queues cleanup of its active favorites, album memberships and AI index in app-owned pCloud metadata. If deletion cannot be confirmed, refresh the library before retrying; a network failure may happen after pCloud processed the request. Other devices need to refresh their libraries to see the removed original. Tests cover cancellation, confirmed deletion, permission denial, name changes, retrying a missing file, and navigation after deletion. No real user media was deleted during development.

## Music controls

Music includes All songs, Liked songs, Recently played and Playlists. Hearts toggle likes. Create playlists and use each song's dropdown to add it; Remove only removes playlist membership. Likes, playlist names/memberships, playback history, queue metadata, playback speed, shuffle/repeat settings and resume position sync via `/Sai Photos/Web/v1/Operations`. No provider credentials are included in these records.

The player supports next/previous, play/pause, shuffle, repeat all/one, speed from 0.5x to 2x, mute, Play next and a visible upcoming queue. Previous restarts the current song after three seconds. Playback stays active when switching library sections. The queue is bounded to 2,000 unique tracks; large lists render 200 songs at a time with Show more. Recently played is recorded on the media playing event, rather than merely selecting a track. Resume position is saved periodically (30 seconds) and on pause; exact background progress cannot be guaranteed.

**Cache this song** stores a track up to 25 MB in an account-scoped Safari IndexedDB cache (up to 12 songs). Cached tracks can replay faster on this device. This is not a promise of offline app startup: the current Wi-Fi preview still requires the Mac for startup/authentication and uncached media. Safari can evict local data. Large tracks stream instead. File-format support varies; verify your actual songs on iPhone, especially formats other than MP3/M4A.

Media Session handlers are registered where supported, but uninterrupted iPhone lock-screen/background playback and exact sleep timers are not guaranteed by a web app. The sleep timer is described below. This is a pCloud music player with familiar controls; it does not provide the Spotify catalog, Spotify subscriptions, DRM playback, crossfade or guaranteed gapless playback.

On mobile, the player is compact while browsing. Tap the upward chevron for full controls and tap it again to collapse. Sample-browser verification covered real muted audio playback, caching and replay after reload, like filtering, recent-play ordering, playlist creation and membership, speed changes, shuffle/repeat controls, continued playback while switching to Photos, and a 390-pixel-wide layout without horizontal page overflow. These tests used isolated fixtures, not personal music or a live pCloud account.

## Delete original music

Each song and the expanded player have **Delete from pCloud**, with a named confirmation dialog. The authenticated music-delete endpoint accepts only audio files, verifies the current filename and exact pCloud ID, and confirms provider deletion. Internet access is required; failures are not queued offline. Playlist Remove keeps the original song.

Confirmed deletion clears liked songs, history, playlist memberships, queue, resume and the local cached song. Deleting the playing song stops playback; deleting another song preserves playback. Cleanup records sync through the same app-owned pCloud operations folder. Six automated tests and an isolated browser fixture verify cancellation and both playback cases; personal pCloud files were not used for deletion tests.

## Connect using an existing token

Choose **Connect with token** (or **Change token** while signed in), select OAuth access token or account auth token, select the account's US/Europe region, and enter the token. This is a token, not an OAuth app client secret. The server validates it with a read-only userinfo request and uses access_token or auth consistently for subsequent pCloud calls. Token login requires the configured origin and session encryption key; OAuth app credentials are optional for this flow.

Tokens never enter localStorage, IndexedDB, Git, static assets or server log messages. The session cookie is encrypted, HttpOnly and SameSite=Lax, with Secure on HTTPS. Disconnect clears the session on this browser; it does not revoke the original token in pCloud. HTTP LAN preview is unencrypted, so enter tokens on the Mac or use HTTPS. Existing token permissions still apply; token login does not upgrade a read-only grant.

## Music search, sleep timer and offline downloads

Music has a separate search field matching words in song names and filenames across the selected section. **Download offline** first saves a device-specific download preference in `/Sai Photos/Web/v1/Operations`, then fetches and commits the audio blob to the device's IndexedDB songs store. Downloads are verified from actual local blobs, not inferred from cloud preferences. Original audio is already in pCloud and is not duplicated. Downloads are pinned against app cache eviction, with a 100 MB per-file and 500 MB total device limit; Safari can still evict browser storage. **Remove download** clears the device copy and queues the cloud preference update; it keeps the original song and current playback.

Playback checks the downloaded version before streaming. Downloads survive reloads and are shown in **Downloads**. When the server cannot be reached, the app restores the last account's cached metadata and local songs. Reopening the entire app offline requires HTTPS/service-worker support on iPhone. The existing LAN HTTP preview can play downloads while the page remains open but cannot guarantee offline reopening. Sign out clears the last-account marker; cached files remain account-separated.

The sleep timer uses an absolute deadline, 5–90 minutes, with cancellation and deadline checks on playback events, visibility changes and page restoration. Its duration preference syncs to pCloud, while the active deadline stays on this device. Safari may suspend background execution and delay pausing. An isolated browser test verified search, cloud-record-before-audio ordering, download persistence, cached playback with the test server stopped, and pausing after advancing a test clock past the deadline. Eight automated tests and the production build pass.

## Create and add to playlists

**Create playlist** is in the Music toolbar. Every song and the expanded player has **Add to playlist**, even before any playlists exist. The dialog offers existing playlists or a new playlist name. Names and memberships are confirmed in pCloud before showing success, then cached on this device. A failed song addition keeps the newly created playlist selected for retry. Playlist removal is also confirmed in pCloud and preserves the original file. New playlist edits require a connection and pCloud write access.

Sleep timer options include 10, 15 and 30 minutes, in the expanded player's **Stop music after** control. Expiry pauses the current audio and clears the timer. Safari suspension can delay expiry handling. Web Media Session has no supported like/favorite action, so Sai Photos cannot add a working heart to iPhone Lock Screen controls. The in-app heart saves to Liked songs and syncs to pCloud through the existing music-like operation. Photos and music Delete from pCloud use normal provider deletion into Trash and require delete permission; live personal-file deletion has not been performed during development.

## pCloud record sync and device changes

Likes, favorites, playlists, indexes, history and resume records live under `/Sai Photos/Web/v1/Operations`. Connecting restores those records from pCloud before completing the initial library load. Local caches stay separated by browser/device/origin. Offline downloads remain local to the device, as requested.

The visible pCloud save banner distinguishes saved records from pending uploads and failed restoration, with automatic retry. Changes are persisted to a local retry queue before upload; failed uploads keep the same operation ID for safe retries. Uploads are attempted before reads, so a restore failure cannot block new saves. The backend reads each newly uploaded record back before confirming it. Unreadable records are reported and skipped individually while other records restore. Concurrent attempts to save the same operation share one request.

If older likes never uploaded, open the old iPhone at its original address, refresh the app, reconnect to the same pCloud account, and keep the page open for automatic sync. Keep that device's website data until saving succeeds. The new phone cannot read the old phone's local cache. If both the cloud copy and original device cache are gone, the app cannot reconstruct those preferences. Tests cover empty-cache cloud restore, denied writes, persistence/retry, new changes during restoration and mismatched acknowledgements. A two-origin browser fixture verified restoration and recovery without touching real user records.

The pCloud stat endpoint may return 2055 for a nonexistent record. Metadata writes treat that response as a normal first-save condition and continue creating the app folders and uploading the record. A nonexistent app-records directory during restore is an empty journal. Other permission and provider failures remain errors. Playlist creation retries reuse the pending playlist and operation IDs to avoid duplicate playlists; the dialog now reports the provider's specific save-stage error.

## Mac indexing and shared visual search

Open the same Sai Photos URL on the Mac, connect to the same pCloud account, and press **Start indexing**. Keep the Mac awake and the browser tab open for face/OCR analysis. The Mac server separately runs a quantized CLIP model for image search and similarity. Model files download once and stay in the ignored `.ai-cache` directory. No paid AI subscription is required and personal photos are not sent to an external AI inference service.

Face, OCR, visual embeddings and verified duplicate fingerprints save as app records in `/Sai Photos/Web/v1/Operations`. Other devices restore these records automatically. Repeating indexing skips current saved versions. A stopped server needs indexing restarted; a fresh device must connect to the same pCloud account. Search is approximate and may miss images. English OCR and face groups need review.

Duplicates groups combine verified SHA-1 matches and conservative visual suggestions. Similar photos are suggestions, not proof of identical originals. Select smaller copies leaves the largest file unselected. Manual selection can include the largest file or all copies; confirmation warns when an entire group is selected. Large files can be reviewed separately. This implementation uses independently written hashing and vector comparison; no Ente source code was copied.

Favorites sync as Sai Photos records in pCloud. Mirroring into the native pCloud Favorites interface is not supported by the documented API used here. External pCloud changes appear on library refresh or when returning to the page. Visible pages poll app records automatically; failed saves retain their local pending records and retry without a Retry sync button.

Thumbnail reuse, preview caching and adjacent-photo prefetch reduce repeat loading. The viewer opens a preview first; **Load original** fetches full resolution on demand. Offline music copies stay on their device. HTTPS hosting is required for reliable offline app reopening on iPhone; the home HTTP address still needs the Mac awake and reachable.

## Choose a photo folder

Photos → **Choose folder** selects a pCloud folder and includes supported images in its subfolders. Select the top-level **pCloud** location to scan the entire account, or choose **Use default photo folders** to return to Pictures, Automatic Upload and Automatic Folder. The summary shows total files scanned, supported photo count and other files; video and RAW files are not photo entries. There is no 22,000-photo listing limit.

The photo-folder preference syncs to pCloud. Favorites, albums and indexes are keyed by original pCloud file ID and remain saved when the folder changes. Browsing, face/OCR indexing, visual indexing and duplicate review use the selected folder. Changing folder stops the previous indexing scope; wait for the old job to stop before starting again. Albums can retain members outside the current folder; their visible counts reflect only the selected folder.

## Name and combine people

After face indexing, use **People → Name person**. Giving another group the same name combines the groups into one People card; matching ignores case and extra spaces. Photos appear once, including photos containing multiple faces assigned to that name. **Rename person** updates all currently combined face assignments. The names and assignments save automatically in the pCloud operations journal and restore on other devices. Search by the person's name in Photos or People.

Newly indexed faces that match a named visual group inherit its name, and that inferred assignment is also saved. Visual recognition is approximate: review groups and give missed groups the same name to combine them. Use distinct names for different people who share a first name.

## Source backup

See RESTORE.md for recovery on a different Mac. Dated source archives are kept separately from app records under pCloud **Sai Photos/Sai Photos Build Code**. Private configuration and device caches are excluded.

Named matching uses several varied user-confirmed face examples rather than only the first face. Confident matches in existing or newly indexed photos receive cloud-saved inferred labels. Ambiguous matches and additional faces in a photo already containing that named person are left for review. Inferred matches do not become new training seeds. People cards crop the detected face so multiple people in one family photo are distinguishable.

## Settings and releases

Open **Settings** in the header for version 1.1.0, the feature guide, saved-record status, known limitations and release notes. Earlier development milestones are grouped under 1.0.0 because separate historical versions were not recorded. Update settings.mjs and package.json together for future releases. Settings does not purchase hosting or deploy the app; cloud hosting remains pending.

Duplicate, similar and large-file cards display their source folder alongside file size. Default-folder scans show the configured path; selecting a nested folder can show a path relative to that selected folder when pCloud does not supply its full path. Bulk-delete confirmation also lists folder, filename and size for up to the first 25 selected files.

## v1.4 smart features

**Smart album** saves a query such as roses, saree, a known person’s name, or favorites. Named-person queries use the actual named face group; favourites use heart records; other queries use text and saved visual indexes. New matching indexed photos appear automatically within the currently selected photo folder. Rules and query embeddings live in the pCloud journal. Smart albums cannot be edited by manually adding individual members.

In a named People group, **Not [name]** removes that photo’s face assignment without deleting the original. The face appears unnamed again and remains excluded from automatic name assignment until manually named. Corrections save to pCloud.

Music **For You** ranks your selected library using saved likes, play counts, title terms and title embeddings. **Most played** ranks by cloud-saved play counts. **Save smart mix** saves a dynamic rule in Playlists; it updates with your library and history, instead of freezing a list of songs. Smart mixes cannot accept manual membership additions/removals. Regular playlists still can. Search accepts filters such as “liked songs” and “recently played”; **Index song titles** enables additional AI title similarity search and recommendations. Title indexes save to pCloud. This is not audio/genre recognition, lyric search, verified artist metadata, or Spotify catalog access. Suggestions are approximate; unnamed/numeric filenames provide weak signals. No external paid AI service is added.

## Release and recovery workflow

Run `pnpm release` to build, test, and automatically create a dated vX.Y.Z source backup under the mounted **pCloud Drive/Sai Photos/Sai Photos Build Code** folder. Failed checks stop the release before backup. `pnpm backup` creates a snapshot without rerunning checks. No background schedule is created. ZIP creation uses zip/unzip, normally available on macOS. PCLOUD_BACKUP_PATH can point to a different existing backup destination. Files copied into pCloud Drive still need to finish syncing; verify the version folder on another device. The command does not deploy a running website or publish to GitHub.

The Dockerfile is a deployment starting point for a compatible long-running Node host; no cloud service has been purchased or deployed. Configure the private environment from .env.example through the host's secret settings, register its HTTPS origin/callback, and use a persistent volume for .ai-cache. Browser face/OCR work still needs an open browser tab. Test actual memory and streaming usage before selecting a paid hosting plan.

The real-model integration test runs when the pinned local text model is already cached; fresh restores skip that one test to avoid a large automatic download. Index song titles downloads the model as needed. All non-model tests run normally without personal account access.

## Android and web terminology

“App” means the Samsung Android client; “web app” means the iPhone browser served by the Mac. The Kotlin project is in `android/`. It connects directly to pCloud, uses Android Keystore for the account token, and includes on-device CLIP models with the shared Photos/Music interface. See `android/README.md` for build steps and first-release limitations. Both clients share pCloud app records; offline media is specific to each phone.

## v1.11.0 gallery and AI status

Android uses an Apple Photos-inspired presentation with original line icons, blue accents and labeled navigation. The backend remains pCloud. Settings → Machine learning separates current-version visual and face/OCR coverage. Exact checksums are candidate-based rather than required for every photo. New Mac and Android jobs process visual AI before checksums; an existing Mac process must finish or be paused before restarting to load server changes.

This is a tested personal-use release, not a claim of Apple Photos parity or production certification. Recognition is approximate. Background indexing, automatic camera backup, RAW/paired Live Photos, GPS extraction and video-frame AI remain incomplete. Native pCloud Favorites are separate from Sai Photos records.

### v1.11.1 Android sync recovery
Photos load while shared records restore in the background. The cloud badge shows Syncing, Saving or Sync issue; tap it for the error. Restored favorites, albums and indexes apply progressively. Indexing still waits for a successful restore to avoid unnecessary work. All-folder scans retain readable photos if another folder fails, with incomplete scans blocked from indexing. Install the update over the existing app to retain device records and credentials. Release-variant emulator tests use synthetic pCloud responses; verify the live account on Samsung after installation.

### Android v1.11.2 reliability baseline
Only the Android APK is released for this iteration. Failed Android refreshes preserve visible photos and display the scan failure. Account startup failures no longer route to hidden Music controls. Restoring a large journal reuses its directory listing for up to 30 seconds; local writes/reconnects invalidate it, while other-device writes can take that interval plus the automatic sync interval to appear. Cached record files are replaced atomically. A rejected replacement token preserves the prior login; successful credential persistence is checked. No new AI features were added. Physical Samsung validation with the real account remains a required next step before calling the app reliable.

### v1.11.3 shared indexing progress (web first)
Mac/web shows cloud-confirmed completed, pending and total counts per selected photo scope, separately for visual AI and faces/text. Restore shared pCloud records before resuming; current unchanged versions from either device are reused. Pending uploads do not count as cloud-completed. Running Mac jobs accept newly restored visual indexes so upcoming Samsung-completed items can be skipped. Synchronization is eventual, not a distributed processing lock: two devices may overlap on an already-started photo. Videos are excluded from still-image AI counts. Latest Android APK remains v1.11.2; an Android release is deferred until requested.

### Android v1.12.0: Music in the existing app
The user chose reuse of the existing Sai Photos Android package instead of a separate Sai Music installation. Music is a central bottom-navigation destination and the initial Android screen. Existing Photos functionality and account-scoped pCloud records remain. The Music destination reuses the web player: folder selection, title/filename search, likes, recent plays, playlists, smart mixes, preference-based recommendations, queue, shuffle/repeat, speed, sleep timer and device-only offline downloads. Music AI indexes song titles using local models; it does not listen to songs, recognize lyrics or access Spotify's catalogue. Music folder scans run independently of Photos. Supported default audio paths include /Music, /My Music and /Relax Music. Mac web indexing is retained separately; no iPhone app is built.
