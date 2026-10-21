import { Barometer } from 'expo-sensors';

/**
 * floorService.js — estimate which floor the phone is on
 *
 * No phone, GPS or map service (OpenStreetMap included) reports the floor
 * reliably. The best available signal is air pressure:
 *
 *   ground pressure  ← Open-Meteo "surface_pressure" for these coordinates
 *                      (weather model corrected to the local ground height)
 *   phone pressure   ← the phone's barometer (averaged over ~1.5 s)
 *   height above ground ≈ 8434 m × ln(ground / phone)    (hypsometric)
 *   floor ≈ (height − 1.2 m phone-in-hand) / 3.2 m per floor
 *
 * Weather-model and sensor error add up to roughly ±0.5–1 hPa, i.e. about
 * ±4–8 m, so the result is ALWAYS reported as an estimate with ±2 floors.
 * The SOS screen lets the person confirm the real floor in one tap; a
 * confirmed floor always wins over this estimate.
 */

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const SCALE_HEIGHT_M = 8434;
const FLOOR_HEIGHT_M = 3.2;
const HAND_HEIGHT_M = 1.2;
export const FLOOR_UNCERTAINTY = 2;

/** Pure math, exported for tests. Returns { heightM, floor } or null. */
export function estimateFloorFromPressure(phoneHpa, groundHpa) {
  if (!(phoneHpa > 800 && phoneHpa < 1100) || !(groundHpa > 800 && groundHpa < 1100)) return null;
  const heightM = SCALE_HEIGHT_M * Math.log(groundHpa / phoneHpa);
  const floor = Math.max(0, Math.round((heightM - HAND_HEIGHT_M) / FLOOR_HEIGHT_M));
  return { heightM: Math.round(heightM * 10) / 10, floor };
}

/** Human label: 0 → "Ground floor", 5 → "5th floor". */
export function floorLabel(n) {
  if (n === null || n === undefined) return 'Unknown floor';
  if (n < 0) return `Basement ${Math.abs(n)}`;
  if (n === 0) return 'Ground floor';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]} floor`;
}

export function createFloorService({ barometer = Barometer, fetchImpl = globalThis.fetch } = {}) {
  async function readPhonePressure(ms = 1500) {
    if (!(await barometer.isAvailableAsync())) return null;
    return new Promise((resolve) => {
      const samples = [];
      barometer.setUpdateInterval?.(200);
      const sub = barometer.addListener(({ pressure }) => {
        if (Number.isFinite(pressure)) samples.push(pressure);
      });
      setTimeout(() => {
        sub.remove();
        resolve(samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : null);
      }, ms);
    });
  }

  async function readGroundPressure(lat, lon) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetchImpl(`${OPEN_METEO}?latitude=${lat}&longitude=${lon}&current=surface_pressure`, { signal: controller.signal });
      if (!res.ok) return null;
      const json = await res.json();
      const p = json?.current?.surface_pressure;
      return Number.isFinite(p) ? p : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    /**
     * Resolves { estimate: { floor, heightM, uncertainty, source } } or
     * { unavailable: reason } — never throws, never invents a floor.
     */
    async estimate(location) {
      if (!location) return { unavailable: 'No location yet' };
      try {
        const [phone, ground] = await Promise.all([
          readPhonePressure(),
          readGroundPressure(location.latitude, location.longitude),
        ]);
        if (phone === null) return { unavailable: 'This phone has no barometer' };
        if (ground === null) return { unavailable: 'Ground-level pressure unavailable (offline?)' };
        const result = estimateFloorFromPressure(phone, ground);
        if (!result) return { unavailable: 'Pressure reading out of range' };
        return { estimate: { ...result, uncertainty: FLOOR_UNCERTAINTY, source: 'barometer', phoneHpa: phone, groundHpa: ground } };
      } catch (err) {
        return { unavailable: err?.message ?? 'Floor estimate failed' };
      }
    },
  };
}

export const floorService = createFloorService();
