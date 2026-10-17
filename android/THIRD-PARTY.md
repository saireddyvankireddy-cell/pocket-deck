# Android third-party components

- Kotlin: Apache-2.0, https://github.com/JetBrains/kotlin
- OkHttp/Okio: Apache-2.0, https://github.com/square/okhttp and https://github.com/square/okio
- ONNX Runtime: MIT, https://github.com/microsoft/onnxruntime
- CLIP models: MIT, https://github.com/openai/CLIP and https://huggingface.co/Xenova/clip-vit-base-patch32
- Shared vendor FaceAPI/Tesseract files retain their license files in `vendor/` and the packaged APK.

The model-source.json pins the revision and hashes. AI model files are generated assets, not included in source ZIPs; the APK includes them for offline inference.
