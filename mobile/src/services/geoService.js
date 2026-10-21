import * as Location from 'expo-location';

/**
 * geoService.js — coordinates → human address
 *
 * Primary: OpenStreetMap Nominatim reverse geocoding (building name, house
 * number, road, area, city, postcode). Follows the Nominatim usage policy:
 * identifies the app, at most one request per second, results cached, and
 * the UI shows "© OpenStreetMap contributors".
 * Fallback: the phone's own geocoder (expo-location) when OSM is
 * unreachable or slow.
 *
 * Privacy: during an SOS the coordinates are sent to Nominatim to look up
 * the address. Nothing else (no name, no contacts) is sent.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = 'VISHWAS-Safety/1.0 (com.vishwas.safety)';
const TIMEOUT_MS = 5000;
const MIN_INTERVAL_MS = 1100;

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

export function osmUrl(location) {
  if (!location) return null;
  const { latitude: lat, longitude: lon } = location;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=19/${lat}/${lon}`;
}

/** Turn a Nominatim `address` object into display parts. */
export function formatOsmAddress(json) {
  const a = json?.address ?? {};
  const building = json?.name || a.building || a.amenity || a.shop || a.office || a.tourism || null;
  const street = [a.house_number, a.road ?? a.pedestrian ?? a.footway].filter(Boolean).join(' ') || null;
  const area = a.neighbourhood ?? a.suburb ?? a.quarter ?? a.residential ?? a.city_district ?? null;
  const city = a.city ?? a.town ?? a.village ?? a.county ?? null;
  const lines = [building, street, area, [city, a.postcode].filter(Boolean).join(' ') || null, a.state].filter(Boolean);
  // Drop accidental duplicates (e.g. building name equal to road).
  const unique = lines.filter((l, i) => lines.indexOf(l) === i);
  return {
    label: unique.join(', ') || json?.display_name || null,
    building,
    street,
    area,
    city,
    postcode: a.postcode ?? null,
    state: a.state ?? null,
    country: a.country ?? null,
    source: 'openstreetmap',
  };
}

function formatDeviceAddress(r) {
  if (!r) return null;
  const street = [r.streetNumber, r.street].filter(Boolean).join(' ') || null;
  const lines = [r.name && r.name !== street ? r.name : null, street, r.district, [r.city, r.postalCode].filter(Boolean).join(' ') || null, r.region]
    .filter(Boolean);
  return {
    label: lines.join(', ') || r.formattedAddress || null,
    building: r.name ?? null,
    street,
    area: r.district ?? null,
    city: r.city ?? null,
    postcode: r.postalCode ?? null,
    state: r.region ?? null,
    country: r.country ?? null,
    source: 'device',
  };
}

export function createGeoService({ fetchImpl = globalThis.fetch, location = Location, now = () => Date.now() } = {}) {
  const cache = new Map();
  let lastRequestAt = 0;

  async function fromOsm(lat, lon) {
    const wait = lastRequestAt + MIN_INTERVAL_MS - now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const url = `${NOMINATIM}?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&namedetails=0`;
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Accept-Language': 'en' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`OpenStreetMap error ${res.status}`);
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      return formatOsmAddress(json);
    } finally {
      clearTimeout(timer);
    }
  }

  async function fromDevice(lat, lon) {
    const results = await location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
    return formatDeviceAddress(results?.[0]);
  }

  return {
    /**
     * Resolves { address } or { error } — never throws. Results are cached
     * per ~11 m cell so a moving person doesn't hammer the service.
     */
    async reverseGeocode(loc) {
      if (!loc) return { error: 'No location yet' };
      const key = `${loc.latitude.toFixed(4)},${loc.longitude.toFixed(4)}`;
      if (cache.has(key)) return { address: cache.get(key) };
      let osmError = null;
      try {
        const address = await fromOsm(loc.latitude, loc.longitude);
        if (address?.label) {
          cache.set(key, address);
          return { address };
        }
      } catch (err) {
        osmError = err?.name === 'AbortError' ? 'OpenStreetMap did not respond in time' : err?.message ?? 'OpenStreetMap unavailable';
      }
      try {
        const address = await fromDevice(loc.latitude, loc.longitude);
        if (address?.label) {
          cache.set(key, address);
          return { address, note: osmError };
        }
      } catch {
        // fall through
      }
      return { error: osmError ?? 'Address not available' };
    },
  };
}

export const geoService = createGeoService();
