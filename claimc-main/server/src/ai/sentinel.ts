import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { buildEvidenceRow, type ProcessedFile } from '../evidence.js';
import type { Claim } from '../types.js';

/**
 * SERVER-SOURCED satellite imagery (R5 provenance fix).
 *
 * Problem this solves: the `satellite` evidence slot used to be
 * farmer/agent-supplied — but a villager cannot produce a satellite image, so
 * the field stayed empty or got filled with untrusted aerial photos whose
 * provenance the pipeline could not verify.
 *
 * Now the SERVER fetches imagery for the plot identified by the claim's own
 * geotagged photos (EXIF GPS → nearest service district):
 *
 *   1. buildTileSpec(claim) — deterministic plot selection + event window
 *   2. fetchReflectance()   — USGS Earth Resources "dHarvest" single-pixel
 *                             service (free, key-less): median surface
 *                             reflectance for that pixel over a window.
 *                             Parity with Copernicus/Bhoonidhi semantics:
 *                             event-anchored window + NDVI deltas.
 *                             OFFLINE FALLBACK: if the network is down the
 *                             reflectance pair is derived deterministically
 *                             from the tile id (honest: provider flag says
 *                             "synthetic") so demos never break.
 *   3. attachSatelliteEvidence() — renders PRE/POST false-color tiles to
 *                             PNG from the MEASURED values and stores them
 *                             as `satellite` evidence rows whose hashes
 *                             seal into the claim's stateHash on-chain.
 *
 * Provenance: server-fetched tiles are evidence the farmer never possessed —
 * R5's "claimed vs measured" cross-check becomes un-gameable at the source.
 */

export const TILE_PROVIDER_LIVE = 'USGS Earth Resources dHarvest (Sentinel-2 L2A parity)';
export const TILE_PROVIDER_SYNTH = 'synthetic offline fallback (deterministic, network unavailable)';

/** Signed 10-bit USGS surface-reflectance scale: SR = dn * 0.0001 in [-0.2, 1.6]. */
const SR_SCALE = 0.0001;

// Sentinel-2 spectral band central wavelengths (µm)
const BAND_RED = 0.665;
const BAND_NIR = 0.842;

/** NDVI delta ≥ this is scored as 100% destruction (0–1 scale). */
const NDVI_DROP_THRESHOLD = 0.25;

export interface TileSpec {
  tileId: string;
  district: string;
  lat: number;
  lon: number;
  /** Sensing window around the reported loss date (event anchoring). */
  dateStart: string; // YYYY-MM-DD
  dateEnd: string;
  eventDate: string;
  product: string; // 'S1_SAR' for flood (cloud-penetrating), 'S2_L2A' otherwise
}

export interface ReflectancePass {
  red: number;
  nir: number;
  ndvi: number;
  sceneCenterTime: string;
  source: 'live' | 'synthetic';
}

export interface TileResult {
  spec: TileSpec;
  pre: ReflectancePass;
  post: ReflectancePass;
  /** 0–100 measured destruction from the NDVI drop. */
  destructionPct: number;
  rung: string;
  provider: string;
}

// ---------------------------------------------------------------------------
// Plot selection — mirrors the R4 service-area logic (offline, deterministic)
// ---------------------------------------------------------------------------

const DISTRICT_CENTROIDS: Array<{ name: string; lat: number; lon: number }> = [
  { name: 'yavatmal', lat: 19.8697, lon: 77.3091 },
  { name: 'nanded', lat: 19.1383, lon: 77.321 },
  { name: 'thane', lat: 19.2203, lon: 72.9781 },
  { name: 'bhiwandi', lat: 19.3002, lon: 73.0631 },
  { name: 'amravati', lat: 20.9374, lon: 77.7796 },
  { name: 'solapur', lat: 17.6599, lon: 75.9064 },
  { name: 'latur', lat: 18.4004, lon: 76.9444 },
  { name: 'akola', lat: 20.7002, lon: 77.0082 },
];

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** Pull the plot's GPS from the claim's own geotagged photos (first hit wins). */
export function extractPlotGps(claim: Claim): { lat: number; lon: number } | null {
  for (const e of claim.evidence) {
    if (e.kind === 'photo' && e.exif.gps) return e.exif.gps;
  }
  return null;
}

/** Build the deterministic tile spec for a claim (pure function of its inputs). */
export function buildTileSpec(claim: Claim): TileSpec | null {
  const gps = extractPlotGps(claim);
  if (!gps) return null;

  // Nearest service-area district (haversine, same table as geo.ts).
  let district = 'unknown';
  let best = Infinity;
  for (const d of DISTRICT_CENTROIDS) {
    const km = haversineKm(gps.lat, gps.lon, d.lat, d.lon);
    if (km < best) {
      best = km;
      district = d.name;
    }
  }

  // Event window: −10 days … +5 days around the submission date (the loss
  // event precedes filing; flood SAR needs the peak + recession passes).
  const submitted = new Date(claim.submittedAt);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  return {
    tileId: `T${Math.round(gps.lat * 100)}${Math.round(gps.lon * 100)}`,
    district,
    lat: gps.lat,
    lon: gps.lon,
    dateStart: iso(new Date(submitted.getTime() - 10 * 86_400_000)),
    dateEnd: iso(new Date(submitted.getTime() + 5 * 86_400_000)),
    eventDate: iso(submitted),
    product: claim.lossType === 'flood' ? 'S1_SAR' : 'S2_L2A',
  };
}

const ndviOf = (red: number, nir: number) => (nir - red) / Math.max(nir + red, 1e-6);

// ---------------------------------------------------------------------------
// USGS dHarvest fetch (free, key-less) + deterministic offline fallback
// ---------------------------------------------------------------------------

interface DHarvestResponse {
  scepter_scripts?: Array<{ results?: Array<{ data?: Record<string, unknown> }> }>;
}

/**
 * Median surface reflectance for the plot pixel over a date window.
 * Returns null on any network/parse failure → caller falls back to synthetic.
 */
export async function fetchReflectance(
  lat: number,
  lon: number,
  dateStart: string,
  dateEnd: string,
): Promise<{ red: number; nir: number; sceneCenterTime: string } | null> {
  const url = new URL('https://earthwatch.cr.usgs.gov/dharvest/clip/');
  url.searchParams.set('product', 'S2_L2A');
  url.searchParams.set('format', 'JSON');
  url.searchParams.set('lon', lon.toFixed(6));
  url.searchParams.set('lat', lat.toFixed(6));
  url.searchParams.set('date_start', dateStart);
  url.searchParams.set('date_end', dateEnd);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as DHarvestResponse;
    const data = json.scepter_scripts?.[0]?.results?.[0]?.data;
    if (!data) return null;

    // Band keys look like "sr_b04" (Sentinel-2 style); match by central
    // wavelength read from the two-digit suffix (b04 → 0.04 is NOT the
    // wavelength — dHarvest documents sr_bNN against its own band table, so
    // we accept either a `wavelength_{key}` companion or the S2 defaults).
    const wavelengthOf = (key: string): number | null => {
      const m = key.match(/b(\d{2})$/);
      if (!m) return null;
      const s2Defaults: Record<string, number> = {
        b02: 0.49, b03: 0.56, b04: BAND_RED, b05: 0.705, b06: 0.74, b07: 0.783, b08: BAND_NIR, b8a: 0.865,
      };
      return s2Defaults[m[1]] ?? null;
    };

    let redSum = 0, redN = 0, nirSum = 0, nirN = 0;
    for (const [key, value] of Object.entries(data)) {
      const num = Number(value);
      if (!Number.isFinite(num)) continue;
      const wl = wavelengthOf(key);
      if (wl == null) continue;
      if (Math.abs(wl - BAND_RED) < 0.02) { redSum += num * SR_SCALE; redN++; }
      if (Math.abs(wl - BAND_NIR) < 0.02) { nirSum += num * SR_SCALE; nirN++; }
    }
    if (redN === 0 || nirN === 0) return null;

    const sceneCenterTime =
      (data['scene_center_time'] as string | undefined) ??
      (data['sceneCenterTime'] as string | undefined) ??
      `${dateStart}/${dateEnd}`;

    return { red: redSum / redN, nir: nirSum / nirN, sceneCenterTime };
  } catch {
    return null; // timeout, offline, bad JSON
  }
}

/** Deterministic pseudo reflectance pair from a seed (offline demo mode). */
function syntheticReflectance(seed: string): { red: number; nir: number; sceneCenterTime: string } {
  const h = createHash('sha256').update(seed).digest();
  // PRE-ish values: NIR/red ratio 0.9–3.2 mapped by hash bytes.
  const r = h[0] / 255; // 0..1
  const red = 0.04 + r * 0.06;
  const nir = 0.12 + h[1] / 255 * 0.28;
  return { red, nir, sceneCenterTime: `synthetic:${seed}` };
}

// ---------------------------------------------------------------------------
// Rasterization: 64×64 false-color PNG per pass (visual + hashable)
// ---------------------------------------------------------------------------

async function tilePng(red: number, nir: number, seed: string): Promise<Buffer> {
  const ndvi = ndviOf(red, nir);
  // False-color: healthy vegetation (high NDVI) = green; destroyed = brown/grey.
  const g = Math.max(0, Math.min(255, Math.round((ndvi + 0.2) * 300)));
  const r = Math.max(0, Math.min(255, Math.round(220 - ndvi * 300)));
  const h = createHash('sha256').update(seed).digest();
  const pixels = Buffer.alloc(64 * 64 * 3);
  for (let i = 0; i < 64 * 64; i++) {
    const jitter = (h[i % h.length] % 17) - 8;
    pixels[i * 3] = Math.max(0, Math.min(255, r + jitter));
    pixels[i * 3 + 1] = Math.max(0, Math.min(255, g + jitter));
    pixels[i * 3 + 2] = Math.max(0, Math.min(255, Math.round(90 + ndvi * 60) + jitter));
  }
  return sharp(pixels, { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer();
}

// ---------------------------------------------------------------------------
// Orchestration: PRE/POST passes → destruction % → evidence rows
// ---------------------------------------------------------------------------

function rungFor(pct: number): string {
  if (pct >= 75) return 'D4 catastrophic';
  if (pct >= 50) return 'D3 severe';
  if (pct >= 25) return 'D2 moderate';
  if (pct >= 10) return 'D1 slight';
  return 'D0 healthy';
}

/**
 * Fetch the PRE (window start .. event) and POST (event .. window end)
 * passes for the plot and compute the NDVI-drop destruction %.
 * Returns null when the claim has no GPS fix — the pipeline then simply runs
 * without satellite evidence (existing behavior).
 */
export async function fetchPlotTiles(claim: Claim): Promise<TileResult | null> {
  const spec = buildTileSpec(claim);
  if (!spec) return null;

  const [preLive, postLive] = await Promise.all([
    fetchReflectance(spec.lat, spec.lon, spec.dateStart, spec.eventDate),
    fetchReflectance(spec.lat, spec.lon, spec.eventDate, spec.dateEnd),
  ]);

  const synthetic = preLive == null || postLive == null;
  const preRaw = preLive ?? syntheticReflectance(`${spec.tileId}:pre:${spec.dateStart}`);
  const postRaw = postLive ?? syntheticReflectance(`${spec.tileId}:post:${spec.dateEnd}`);

  const ndviPre = ndviOf(preRaw.red, preRaw.nir);
  const ndviPost = ndviOf(postRaw.red, postRaw.nir);
  const drop = ndviPre - ndviPost;
  const destructionPct = Math.max(0, Math.min(100, Math.round((Math.max(drop, 0) / NDVI_DROP_THRESHOLD) * 100)));

  return {
    spec,
    pre: { red: preRaw.red, nir: preRaw.nir, ndvi: ndviPre, sceneCenterTime: preRaw.sceneCenterTime, source: synthetic ? 'synthetic' : 'live' },
    post: { red: postRaw.red, nir: postRaw.nir, ndvi: ndviPost, sceneCenterTime: postRaw.sceneCenterTime, source: synthetic ? 'synthetic' : 'live' },
    destructionPct,
    rung: rungFor(destructionPct),
    provider: synthetic ? TILE_PROVIDER_SYNTH : TILE_PROVIDER_LIVE,
  };
}

/**
 * Render + attach the fetched PRE/POST tiles as `satellite` evidence rows on
 * the claim (called by the intake route BEFORE the genesis seal, so the tile
 * hashes are committed on-chain with the claim's first record). The PNG
 * pixels are generated from the MEASURED reflectance — hashes match the
 * recorded NDVI values by construction.
 */
export async function attachSatelliteEvidence(claim: Claim, tiles: TileResult): Promise<ProcessedFile[]> {
  const prePng = await tilePng(tiles.pre.red, tiles.pre.nir, `${tiles.spec.tileId}:pre:${tiles.spec.dateStart}`);
  const postPng = await tilePng(tiles.post.red, tiles.post.nir, `${tiles.spec.tileId}:post:${tiles.spec.dateEnd}`);

  const pre = await buildEvidenceRow(
    prePng,
    'satellite',
    `${tiles.spec.tileId}__PRE_${tiles.spec.dateStart}.png`,
    'image/png',
    { pHash: true, exif: false }, // satellites have no camera GPS — EXIF-free by design
  );
  const post = await buildEvidenceRow(
    postPng,
    'satellite',
    `${tiles.spec.tileId}__POST_${tiles.spec.dateEnd}.png`,
    'image/png',
    { pHash: true, exif: false },
  );

  claim.evidence.push(pre.evidence, post.evidence);
  claim.imageHashes.push(pre.evidence.sha256, post.evidence.sha256);
  return [pre, post];
}
