import 'dotenv/config';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { embedImage, embedTexts, cosine, preloadClip } from './ai/clip.js';

/**
 * Calibration harness for the visual zero-shot signals.
 *
 *   node -r tsx src/calibrate.ts <image-or-folder> [...more]
 *
 * Prints staged-imagery, AI-generation and per-loss relevance for each image
 * so thresholds (ZS_*, AI_GEN_*, RELEVANCE_*) can be tuned against real
 * samples before they go into the pipeline.
 */

const RELEVANCE_PROMPTS: Record<string, { positives: string[]; negatives: string[] }> = {
  flood: {
    positives: ['a flooded field or street with standing water', 'a submerged house or crops under floodwater', 'heavy rain and overflowing water in a village'],
    negatives: ['a dry cracked drought field', 'healthy green crops in daylight', 'an injured or deceased farm animal'],
  },
  drought: {
    positives: ['a dry cracked drought field', 'withered brown crops in a parched landscape', 'dry empty soil under harsh sun'],
    negatives: ['a flooded field with standing water', 'lush green irrigated crops', 'an injured or deceased farm animal'],
  },
  livestock: {
    positives: ['an injured or sick farm animal', 'a deceased cow or goat lying on the ground', 'cattle in distress on a farm'],
    negatives: ['a flooded field with standing water', 'a dry cracked field', 'healthy crops in daylight'],
  },
};

const UNRELATED = [
  'a random indoor photo of a person or a room',
  'a selfie portrait of a person',
  'a photo of food or a restaurant meal',
  'a screenshot of a website or an app interface',
  'a photo of a parked car on a street',
  'a page of printed text or a document',
];

function collectImages(args: string[]): string[] {
  const out: string[] = [];
  for (const a of args) {
    if (!existsSync(a)) {
      console.warn(`skip (missing): ${a}`);
      continue;
    }
    if (/\.(jpe?g|png|webp)$/i.test(a)) out.push(a);
    else {
      for (const f of readdirSync(a)) {
        if (/\.(jpe?g|png|webp)$/i.test(f)) out.push(path.join(a, f));
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: tsx src/calibrate.ts <image.jpg | folder> [...]');
    process.exit(1);
  }
  await preloadClip();

  const stagedF = await embedTexts([
    'a photo of a picture on a screen showing a damaged field',
    'a printed photograph of a damaged field held in front of the camera',
    'a screenshot of a damaged field displayed on a phone or computer',
  ]);
  const stagedG = await embedTexts([
    'a genuine photo taken outdoors of a damaged field',
    'a genuine outdoor photograph of flood damage',
    'an outdoor scene photograph taken in daylight',
  ]);
  const aiVecs = await embedTexts([
    'an AI-generated image',
    'a digitally rendered artificial image',
    'a hyperrealistic synthetic picture produced by a diffusion model',
    'an uncanny computer-generated scene',
  ]);
  const realVecs = await embedTexts([
    'a casual smartphone photo taken outdoors',
    'a real amateur photograph of a real place',
    'a candid snapshot from a phone camera',
  ]);

  const images = collectImages(args);
  for (const img of images) {
    const vec = await embedImage(readFileSync(img));
    const staged = Math.round(Math.max(0, Math.min(1, (Math.max(...stagedF.map((v) => cosine(vec, v))) - Math.max(...stagedG.map((v) => cosine(vec, v))) + 1) / 2)) * 100);
    const ai = Math.round(Math.max(0, Math.min(1, (Math.max(...aiVecs.map((v) => cosine(vec, v))) - Math.max(...realVecs.map((v) => cosine(vec, v))) + 1) / 2)) * 100);
    const rel: string[] = [];
    for (const [loss, p] of Object.entries(RELEVANCE_PROMPTS)) {
      const pos = await embedTexts([...p.positives]);
      const neg = await embedTexts([...p.negatives, ...UNRELATED]);
      const r = Math.round(Math.max(0, Math.min(1, (Math.max(...pos.map((v) => cosine(vec, v))) - Math.max(...neg.map((v) => cosine(vec, v))) + 1) / 2)) * 100);
      rel.push(`${loss}:${r}`);
    }
    console.log(`${path.basename(img).padEnd(32)} staged=${String(staged).padStart(3)}  aiGen=${String(ai).padStart(3)}  relevance[${rel.join(', ')}]`);
  }
  process.exit(0);
}

await main();
