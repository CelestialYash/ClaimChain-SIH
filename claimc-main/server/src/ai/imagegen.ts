import sharp from 'sharp';

/**
 * Deterministic JPEG generator for demo evidence.
 *
 * Every (claimId, kind, variant) triple yields byte-identical output, so
 * seeded pHashes/sha256s are stable across server restarts and fresh nodes.
 * The embedded keyword makes DAMAGE_ASSESS stage-5 analysis real (the OCR
 * engine and CV heuristics genuinely read the generated pixels).
 *
 * Not a generic image library — demo-evidence generator for ClaimChain.
 */

const W = 320;
const H = 240;

function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

function escapeSvg(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildSvg(opts: { keyword: string; dark: boolean; r: () => number }): string {
  const { keyword, dark, r } = opts;

  const base = dark
    ? [68 + Math.floor(r() * 30), 56 + Math.floor(r() * 30), 50 + Math.floor(r() * 30)]
    : [96 + Math.floor(r() * 60), 104 + Math.floor(r() * 60), 92 + Math.floor(r() * 50)];

  let fields = '';
  for (let i = 0; i < 5; i++) {
    const y = 26 + i * 46;
    fields += `<rect x="0" y="${y}" width="${W}" height="10" fill="rgba(0,0,0,0.25)"/>`;
  }

  let blur = '';
  const n = 4 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(r() * W);
    const cy = Math.floor(r() * H);
    const rr = 20 + Math.floor(r() * 70);
    blur += `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="rgba(255,255,255,0.05)"/>`;
  }

  const text = escapeSvg(keyword);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="rgb(${base.join(',')})"/>
  ${fields}${blur}
  <rect x="8" y="8" width="${W - 16}" height="${H - 16}" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="2"/>
  <text x="50%" y="${Math.floor(H / 2) - 8}" font-family="DejaVu Sans, sans-serif" font-size="15" font-weight="bold" text-anchor="middle" fill="#ffffff">${text}</text>
  <text x="50%" y="${Math.floor(H / 2) + 16}" font-family="DejaVu Sans, sans-serif" font-size="10" text-anchor="middle" fill="rgba(255,255,255,0.8)">ClaimChain evidence sample</text>
  <text x="10" y="${H - 12}" font-family="DejaVu Sans, sans-serif" font-size="9" fill="rgba(255,255,255,0.7)">${dark ? 'low-light' : 'daylight'} · field capture</text>
</svg>`;
}

/** Build the synthetic evidence JPEG bytes for a given logical image. */
export async function generateEvidenceJpeg(spec: {
  claimId: string;
  kind: 'photo' | 'bill' | 'id';
  variant: number; // variant 0 = primary; >=1 duplicates for collision demos
  keyword: string;
  dark?: boolean;
  /** Overrides claimId in the deterministic seed — identical bytes across claims (pHash-collision demos). */
  seedKey?: string;
}): Promise<Buffer> {
  const dark = spec.dark ?? spec.variant % 2 === 1;
  const key = spec.seedKey ?? spec.claimId;
  const svg = buildSvg({ keyword: spec.keyword, dark, r: rng(hash32(`${key}:${spec.kind}:${spec.variant}`)) });
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}
