let faceModel;
let ocrWorker;
async function faces() {
  if (!faceModel) faceModel = (async () => {
    const api = await import('./vendor/faceapi/face-api.esm.js');
    await api.tf.ready();
    await Promise.all([api.nets.tinyFaceDetector.loadFromUri('/vendor/faceapi/model'), api.nets.faceLandmark68Net.loadFromUri('/vendor/faceapi/model'), api.nets.faceRecognitionNet.loadFromUri('/vendor/faceapi/model')]);
    return api;
  })().catch(error => { faceModel = null; throw error; });
  return faceModel;
}
async function textWorker() {
  if (!ocrWorker) ocrWorker = (async () => {
    if (!window.Tesseract) await new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = '/vendor/tesseract/tesseract.min.js'; script.onload = resolve; script.onerror = reject; document.head.append(script);
    });
    return window.Tesseract.createWorker('eng', 1, { workerPath: '/vendor/tesseract/worker.min.js', corePath: '/vendor/tesseract/core', langPath: '/vendor/tesseract/lang', workerBlobURL: false, cacheMethod: 'none' });
  })().catch(error => { ocrWorker = null; throw error; });
  return ocrWorker;
}
export async function analyzePhoto(image) {
  const api = await faces();
  const results = await api.detectAllFaces(image, new api.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.45 })).withFaceLandmarks().withFaceDescriptors();
  const worker = await textWorker();
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  canvas.getContext('2d').drawImage(image, 0, 0);
  let text = '';
  try { const { data } = await worker.recognize(canvas); text = data.text.slice(0, 50000); }
  finally { canvas.width = 0; canvas.height = 0; }
  return {
    text,
    faces: results.slice(0, 100).map(result => ({ descriptor: Array.from(result.descriptor), box: [result.detection.box.x / image.naturalWidth, result.detection.box.y / image.naturalHeight, result.detection.box.width / image.naturalWidth, result.detection.box.height / image.naturalHeight].map(value => Math.max(0, Math.min(1, value))) }))
  };
}

export function resetPhotoWorker(){const previous=ocrWorker;ocrWorker=null;if(previous)previous.then(worker=>worker.terminate()).catch(()=>{});}
