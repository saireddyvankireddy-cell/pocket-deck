# AI dependencies

Self-hosted assets, with no photo transmission to a model provider:
- @vladmandic/face-api 1.7.15 (MIT). Library and tiny face detector, 68-point landmarks and face recognition weights extracted from the official npm package. License included in faceapi/LICENSE.
- tesseract.js 6.0.1 (Apache-2.0) and tesseract.js-core 6.0.0 (Apache-2.0). License files included in their directories.
- English trained data from https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz, from the Tesseract project.

The face model produces similarity suggestions, not verified identities. Text recognition is English in this first version.
