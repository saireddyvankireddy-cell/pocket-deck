# Release Notes - Sai Photos

## Version 2.0.0 (Performance & AI Update)

### 🚀 Performance & UX
- **Buttery Smooth Scrolling**: Implemented a Priority-Based Download Queue in `photo-cache.mjs`. Thumbnails now load with highest priority, followed by previews and originals, reducing UI stutter during fast scrolling.
- **Increased Concurrency**: Increased simultaneous download limit from 4 to 6 to better utilize network bandwidth.

### 🤖 AI & Organization
- **Enhanced Duplicate Detection**: Relaxed similarity thresholds in `photo-tools.mjs` to identify more "near-duplicate" photos (varying in crop or color) while keeping exact matches precise.
- **Improved Face Detection**: Increased `inputSize` to 512 and lowered `scoreThreshold` in `photo-ai.mjs` for more reliable face detection.
- **Smart Cleanup**: Improved visual matching logic to better group visually similar photos for easier library cleanup.

### 🛠️ Internal Fixes
- Improved memory management for cached blobs.
- Optimized visual index lookup speed.

