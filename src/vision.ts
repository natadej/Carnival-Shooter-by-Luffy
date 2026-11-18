import { FaceLandmarker, FilesetResolver, ImageSegmenter, PoseLandmarker } from '@mediapipe/tasks-vision';

const BASE = import.meta.env.BASE_URL;
type Delegate = 'GPU' | 'CPU';
type Fileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

let fileset: Promise<Fileset> | null = null;
const getFileset = () => (fileset ??= FilesetResolver.forVisionTasks(BASE + 'wasm'));

function lazy<T>(make: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => {
    p ??= make().catch((e) => {
      p = null;
      throw e;
    });
    return p;
  };
}

async function withFallback<T>(make: (d: Delegate) => Promise<T>, prefer: Delegate): Promise<T> {
  try {
    return await make(prefer);
  } catch (e) {
    if (prefer === 'CPU') throw e;
    return make('CPU');
  }
}

export const photoFaces = lazy(async () => {
  const fs = await getFileset();
  return FaceLandmarker.createFromOptions(fs, {
    baseOptions: { modelAssetPath: BASE + 'models/face_landmarker.task', delegate: 'CPU' },
    runningMode: 'IMAGE',
    numFaces: 20,
    minFaceDetectionConfidence: 0.35,
    minFacePresenceConfidence: 0.35,
  });
});

export const photoPoses = lazy(async () => {
  const fs = await getFileset();
  return PoseLandmarker.createFromOptions(fs, {
    baseOptions: { modelAssetPath: BASE + 'models/pose_landmarker_lite.task', delegate: 'CPU' },
    runningMode: 'IMAGE',
    numPoses: 12,
    minPoseDetectionConfidence: 0.4,
  });
});

export const photoSegmenter = lazy(async () => {
  const fs = await getFileset();
  return ImageSegmenter.createFromOptions(fs, {
    baseOptions: { modelAssetPath: BASE + 'models/selfie_multiclass.tflite', delegate: 'CPU' },
    runningMode: 'IMAGE',
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  });
});

export const videoFaces = lazy(async () => {
  const fs = await getFileset();
  return withFallback(
    (delegate) =>
      FaceLandmarker.createFromOptions(fs, {
        baseOptions: { modelAssetPath: BASE + 'models/face_landmarker.task', delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      }),
    'GPU',
  );
});

/** Multiclass selfie segmentation classes. */
export const SEG = { BG: 0, HAIR: 1, BODY_SKIN: 2, FACE_SKIN: 3, CLOTHES: 4, OTHER: 5 } as const;

export interface CategoryMask {
  w: number;
  h: number;
  data: Uint8Array;
}

export async function segment(img: HTMLCanvasElement): Promise<CategoryMask | null> {
  try {
    const seg = await photoSegmenter();
    const res = seg.segment(img);
    const m = res.categoryMask;
    if (!m) return null;
    const out = { w: m.width, h: m.height, data: new Uint8Array(m.getAsUint8Array()) };
    res.close();
    return out;
  } catch (e) {
    console.warn('segmentation failed', e);
    return null;
  }
}
