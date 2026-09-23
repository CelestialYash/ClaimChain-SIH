import 'dotenv/config';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { preloadClip } from './ai/clip.js';
import { embedImage } from './ai/clip.js';
import { enrollEmbeddings, memoryStats } from './ai/fraud-memory.js';

/**
 * External training-set ingestion — turns a labeled folder tree into fraud
 * memory. Labels are treated as ground truth ('external' source), groups map
 * to stable claim ids so re-runs UPSERT (no duplicates):
 *
 *   training-set/
 *   ├── genuine/
 *   │   ├── claim-001/  *.jpg …        ← one folder = one case/claim
 *   │   └── flat-file.jpg              ← loose files form a "_flat" group
 *   └── fraud/
 *       ├── case-001/  *.jpg
 *       └── case-002/  ai-fake.jpg, original.jpg
 *
 * Usage:  npm run train:folder -- ../training-set
 * Optional manifest per group (lossType, district, note) is read if present:
 *   training-set/fraud/case-001/manifest.json  { "lossType": "flood" }
 * (manifest is displayed, not yet used for scoring).
 */

const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

function walkGroups(labelDir: string): Array<{ groupId: string; dir: string }> {
  const groups: Array<{ groupId: string; dir: string }> = [];
  let loose = 0;
  for (const entry of readdirSync(labelDir)) {
    const full = path.join(labelDir, entry);
    const st = statSync(full);
    if (st.isDirectory()) groups.push({ groupId: entry, dir: full });
    else if (IMAGE_RE.test(entry)) loose++;
  }
  if (loose > 0) groups.push({ groupId: '_flat', dir: labelDir });
  return groups;
}

async function main(): Promise<void> {
  const root = process.argv[2];
  if (!root || !existsSync(root)) {
    console.error('Usage: npm run train:folder -- <path-to-training-set>');
    console.error('Expected structure:\n  <root>/genuine/<group>/ *.jpg\n  <root>/fraud/<group>/ *.jpg');
    process.exit(1);
  }

  await preloadClip();

  let enrolled = 0;
  let groups = 0;
  for (const label of ['genuine', 'fraud'] as const) {
    const labelDir = path.join(root, label);
    if (!existsSync(labelDir)) continue;

    for (const g of walkGroups(labelDir)) {
      const images = readdirSync(g.dir).filter((f) => IMAGE_RE.test(f));
      if (images.length === 0) continue;

      let manifestNote = '';
      const manifestPath = path.join(g.dir, 'manifest.json');
      if (existsSync(manifestPath)) {
        try {
          const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as { lossType?: string; district?: string; note?: string };
          manifestNote = [m.lossType, m.district, m.note].filter(Boolean).join(' · ');
        } catch {
          manifestNote = '(unreadable manifest)';
        }
      }

      const items: Array<{ fileId: string; vec: number[]; label: 'genuine' | 'fraud' }> = [];
      for (const img of images) {
        try {
          const vec = await embedImage(readFileSync(path.join(g.dir, img)));
          items.push({ fileId: img, vec, label });
        } catch (e) {
          console.warn(`  ! skip ${label}/${g.groupId}/${img}: ${(e as Error).message}`);
        }
      }

      const claimId = `TRAINING/${label}/${g.groupId}`;
      const n = enrollEmbeddings(claimId, items);
      enrolled += n;
      groups++;
      console.log(`[train:folder] ${claimId}: ${n} image(s) enrolled${manifestNote ? ` (${manifestNote})` : ''}`);
    }
  }

  console.log(`[train:folder] done — ${groups} group(s), ${enrolled} image embedding(s) enrolled`);
  console.log('Training set memory:', memoryStats());
  process.exit(0);
}

await main();
