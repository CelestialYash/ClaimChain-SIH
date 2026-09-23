import 'dotenv/config';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pdf } from 'pdf-to-img';

const outDir = '.doc-probe';
mkdirSync(outDir, { recursive: true });

for (const f of process.argv.slice(2)) {
  if (!existsSync(f)) { console.error('missing', f); continue; }
  console.log(`\n=== ${path.basename(f)} ===`);
  try {
    const doc = await pdf(readFileSync(f), { scale: 2 });
    let i = 0;
    for await (const img of doc) {
      i++;
      const file = path.join(outDir, `${path.basename(f, '.pdf')}-p${i}.png`);
      await writeFile(file, img as unknown as Buffer);
      console.log(`page ${i} → ${file} (${(img as unknown as Buffer).length} bytes)`);
      if (i >= 3) break;
    }
  } catch (e) {
    console.error('ERR', String(e).slice(0, 400));
  }
}
process.exit(0);
