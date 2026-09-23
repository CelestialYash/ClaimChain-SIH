import sharp from 'sharp';
import {
  AutoTokenizer,
  AutoProcessor,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
  type Tensor,
} from '@huggingface/transformers';

/**
 * CLIP ViT-B/32 engine (Xenova ONNX build, local CPU — free, offline, no keys).
 *
 * Pre-trained on 400M image-text pairs; we use its embedding space for
 * few-shot fraud detection:
 *  - zero-shot: cosine(image, text prompts describing genuine vs fraudulent evidence)
 *  - few-shot : cosine(image, embeddings of PREVIOUSLY DECIDED claims) — the
 *               trainable memory in fraud-memory.ts
 *
 * Deterministic for fixed weights + inputs: same bytes → same embedding →
 * same verdict, preserving the pipeline's reproducibility guarantee.
 */

const MODEL_ID = 'Xenova/clip-vit-base-patch32';

interface ClipComponents {
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
  textModel: CLIPTextModelWithProjection;
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
  visionModel: CLIPVisionModelWithProjection;
}

let clip: ClipComponents | null = null;
let clipLoading: Promise<ClipComponents> | null = null;

async function getClip(): Promise<ClipComponents> {
  if (clip) return clip;
  if (!clipLoading) {
    clipLoading = (async () => {
      const t0 = Date.now();
      const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
      const textModel = await CLIPTextModelWithProjection.from_pretrained(MODEL_ID);
      const processor = await AutoProcessor.from_pretrained(MODEL_ID);
      const visionModel = await CLIPVisionModelWithProjection.from_pretrained(MODEL_ID);
      console.log(`[clip] ${MODEL_ID} ready in ${((Date.now() - t0) / 1000).toFixed(1)}s (cached after first run)`);
      return { tokenizer, textModel, processor, visionModel };
    })().catch((err) => {
      clipLoading = null; // allow retry
      throw err;
    });
  }
  return clipLoading;
}

export function isClipReady(): boolean {
  return clip !== null;
}

/** L2-normalize a vector (cosine similarity = dot product afterwards). */
function normalize(v: Float32Array | number[]): number[] {
  const arr = Array.from(v);
  const norm = Math.sqrt(arr.reduce((s, x) => s + x * x, 0)) || 1;
  return arr.map((x) => x / norm);
}

function firstRow(t: Tensor): Float32Array {
  // embeddings come out as [1, 512]
  const data = t.data as Float32Array;
  const dim = t.dims[t.dims.length - 1];
  return data.slice(0, dim);
}

/** Rasterize any evidence image to CLIP's expected RGB input. */
async function toRawImage(buf: Buffer): Promise<RawImage> {
  const png = await sharp(buf)
    .resize(224, 224, { fit: 'cover' })
    .png()
    .toBuffer();
  return RawImage.fromBlob(new Blob([new Uint8Array(png)], { type: 'image/png' }));
}

/** Embed one image → normalized 512-dim vector. */
export async function embedImage(buf: Buffer): Promise<number[]> {
  const { processor, visionModel } = await getClip();
  const image = await toRawImage(buf);
  const inputs = await processor(image);
  const { image_embeds } = await visionModel(inputs);
  return normalize(firstRow(image_embeds));
}

/** Embed a batch of texts → normalized 512-dim vectors (one per prompt). */
export async function embedTexts(prompts: string[]): Promise<number[][]> {
  const { tokenizer, textModel } = await getClip();
  const inputs = tokenizer(prompts, { padding: true, truncation: true });
  const { text_embeds } = await textModel(inputs);
  const data = text_embeds.data as Float32Array;
  const [rows, dim] = text_embeds.dims;
  const out: number[][] = [];
  for (let i = 0; i < rows; i++) {
    out.push(normalize(data.slice(i * dim, (i + 1) * dim)));
  }
  return out;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot; // both pre-normalized → dot = cosine
}

/** Preload the model (used at train time so the first verification isn't slow). */
export async function preloadClip(): Promise<void> {
  await getClip();
}
