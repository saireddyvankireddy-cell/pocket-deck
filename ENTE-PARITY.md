# Ente source comparison — Sai Photos v1.10.0

Reviewed 14 October 2026 against Ente commit `3d8c60ca76bbf9690b958c7ecfe30f491da1501b` from https://github.com/ente/ente . This is a pCloud gallery adaptation, not a complete Ente fork or a pixel-perfect/full-feature clone. The request to keep pCloud as the only backend is preserved.

## Source files reviewed

- `mobile/apps/photos/lib/ui/home/home_bottom_nav_bar.dart`: navigation, selected-file behavior, SVG icons.
- `mobile/apps/photos/lib/ui/settings_page.dart`: settings groups, storage card, search, account/backup/security/appearance.
- `mobile/apps/photos/lib/ui/settings/appearance/appearance_settings_page.dart` and `gallery_settings_screen.dart`: theme/gallery preferences.
- `mobile/apps/photos/lib/ui/viewer/search_tab/search_tab.dart`, `people_section.dart`, `file_type_section.dart`, `magic_section.dart`: discovery and search.
- `mobile/apps/photos/lib/ui/home/memories/`: memory collections and viewer concepts.
- `mobile/apps/photos/lib/ui/tools/free_space_page.dart`: device storage management; Sai Photos currently manages its own caches, not the phone's original gallery.
- `mobile/apps/photos/lib/ui/settings/security/security_settings_page.dart`: local app lock versus Ente account services.
- `mobile/apps/photos/lib/ui/settings/ml/machine_learning_settings_page.dart`: device processing and cloud reuse.
- Gallery/viewer, album, trash and search source directories were inspected to identify remaining workflows.

Three navigation SVGs are copied with currentColor adaptation. Their AGPL-3.0 license and attribution are bundled in `vendor/ente-reference/`. Sai Photos source accompanies each APK release in pCloud. Ente branding and Ente account credentials are not used.

## Implemented or adapted

| Area | Sai Photos behavior | Difference from Ente |
| --- | --- | --- |
| Navigation | Home, Albums, Favorites, Search; People and cleanup within Search/Settings | Ente's latest source has an optional social Feed; Sai Photos keeps Favorites as requested in references |
| Gallery | Timeline, sizes, date/size/name sorting, 3/4/5 columns, 50/100 increment, themes | WebView grid rather than Flutter slivers; not pixel-perfect |
| Selection | Tap, held range drag, normal scrolling, edge scrolling, confirmed bulk deletion | Native gesture behavior tested on emulator; physical Samsung remains to test |
| Viewer | Fast cached previews, originals, pinch/zoom, swipe, heart, information, album membership, delete | No full editor, RAW decoding, paired Live Photos or filmstrip |
| Albums | Create, rename, bulk membership, remove membership without deleting original, smart albums | No collaborative/shared albums, archive/hidden/locked album semantics |
| People | Cropped faces, names, same-name merging, corrections, learned matching, cloud restore | Existing face-api models and heuristics, not Ente's exact ML implementation |
| Search | Filename/OCR/people/album text, visual AI, People discovery, Magic query buttons, folder/year/type facets | Dates come from pCloud metadata; no GPS map or EXIF extraction; no full Ente query language |
| Memories | On-this-day and year collections from known pCloud dates | No Ente curated memory model, music stories, video export or annual Wrapped |
| Cleanup | Duplicate/similar/large review, sizes/folders, largest-copy shortcut, selection of any copy | Still-photo visual similarity; no full Ente low-quality classifier |
| Suggestions | Explicit review of screenshots by filename and current low-contrast indexes; favorites excluded | Heuristic suggestions, never automatic deletion |
| Trash | Android reads pCloud Trash and restores a specific original; restore record reverses the deletion tombstone | No permanent-delete control; no deleted-file thumbnail service; web can use pCloud's Trash interface |
| Offline | Android original-photo downloads, version/account-scoped, 100 MB each / 512 MB quota; remove local copies | No offline videos or complete local-only phone gallery |
| Backup | Android system picker uploads up to 50 photos, 100 MB each, streaming with renamed conflicts | Foreground/manual only; no automatic camera backup, Wi-Fi scheduling, folder watcher or WorkManager |
| Settings | Storage usage, category search, appearance, gallery density/batch, ML, cache/offline, export, backup, security, release history | Ente's account/billing/family/referral screens are not connected |
| Local security | Android screen-lock confirmation for app lock; hides app on background/return; screenshots blocked while lock enabled | UI access protection, not end-to-end encryption of pCloud media |
| Record export | Android writes account records to Downloads/Sai Photos in bounded parts; web downloads JSON | Not an export of every original media file; originals remain downloadable through pCloud |
| Video | MP4/MOV/M4V/3GP/AVI/MKV library entries and streamed viewer; favorites/albums/delete available | Depends on pCloud transcoding and codecs; video-frame face/visual AI is not implemented |
| Sync/indexing | Existing pCloud journal and per-device caches; completed/current indexes reused | pCloud stores data, never executes the AI; no Ente server, feed or push service |

## Services that cannot be copied as functioning controls with this backend

Ente accounts, passkeys/2FA, email/password/recovery-key management, family plans, subscriptions/referrals, legacy contacts, private encrypted sharing, contact invitations, collaborative feed, Ente storage replication and Ente's end-to-end encryption rely on Ente protocols and services. They are not provided by pointing Ente's client at pCloud. No fake success screens or disconnected billing/security switches were added.

## Other remaining client work

Automatic/background device backup, native local-gallery ingestion, GPS/EXIF maps, RAW and paired Live Photos, complete editing, casts, hidden/archive albums, actual sharing integrations, contact/ritual workflows, curated AI memories, Ente-identical ML and full language/app-icon switching are not implemented. They should not be described as unavailable merely because pCloud is the storage provider; each needs additional client work and validation. This release does not satisfy literal 1:1 feature parity.

The active Mac server is intentionally not restarted while an indexing job may be active. The new Android app contains its own updated backend. Web UI improvements load immediately, but newly added web video handling requires restarting the Mac server after indexing finishes. Existing web photo/music endpoints and record writes keep working.

pCloud native Favorites remain separate from Sai Photos' shared favorites journal. No claim of native pCloud Favorites mirroring is made.
