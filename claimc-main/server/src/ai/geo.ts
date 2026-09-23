/**
 * Offline district resolution for the R4 GPS-mismatch fraud rule.
 *
 * No API calls, no keys, deterministic: a small centroid table covering the
 * service-area districts (mirrors LOSS_META.idealDistricts) + haversine
 * distance. A photo's GPS resolves to the nearest known district when it is
 * within NEAR_KM of that centroid; otherwise the location is reported as
 * out-of-area (with its nearest-district distance) — which is itself a
 * strong fraud signal for claims filed inside the service area.
 */

export interface DistrictCentroid {
  name: string;
  lat: number;
  lon: number;
}

/** Maharashtra service-area centroids (district HQ approximations). */
export const DISTRICTS: DistrictCentroid[] = [
  { name: 'yavatmal', lat: 19.8697, lon: 77.3091 },
  { name: 'nanded', lat: 19.1383, lon: 77.321 },
  { name: 'thane', lat: 19.2203, lon: 72.9781 },
  { name: 'bhiwandi', lat: 19.3002, lon: 73.0631 },
  { name: 'amravati', lat: 20.9374, lon: 77.7796 },
  { name: 'solapur', lat: 17.6599, lon: 75.9064 },
  { name: 'latur', lat: 18.4004, lon: 76.9444 },
  { name: 'akola', lat: 20.7002, lon: 77.0082 },
];

/** A GPS fix far from EVERY service district is out-of-area beyond this. */
export const SERVICE_AREA_KM = 120;
/** Within this radius of a centroid, the photo "belongs" to that district. */
export const NEAR_KM = 45;

const EARTH_R_KM = 6371;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.sqrt(a));
}

export interface DistrictFix {
  /** Nearest known district, always present for reporting. */
  nearest: string;
  nearestKm: number;
  /** The district this GPS point belongs to (within NEAR_KM), if any. */
  resolved: string | null;
  /** True when the point is outside the whole service area. */
  outOfArea: boolean;
}

export function resolveDistrict(lat: number, lon: number): DistrictFix {
  let best = DISTRICTS[0];
  let bestKm = Number.POSITIVE_INFINITY;
  for (const d of DISTRICTS) {
    const km = haversineKm(lat, lon, d.lat, d.lon);
    if (km < bestKm) {
      best = d;
      bestKm = km;
    }
  }
  return {
    nearest: best.name,
    nearestKm: Math.round(bestKm),
    resolved: bestKm <= NEAR_KM ? best.name : null,
    outOfArea: bestKm > SERVICE_AREA_KM,
  };
}
