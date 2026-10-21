import { createGeoService, formatOsmAddress, osmUrl } from '../services/geoService';
import { createFloorService, estimateFloorFromPressure, floorLabel } from '../services/floorService';
import { buildAlertMessage, buildAlertPayload, describeFloor } from '../services/alertService';

const OSM_JSON = {
  name: 'Sunrise Apartments',
  display_name: 'Sunrise Apartments, 12, MG Road, Indiranagar, Bengaluru, Karnataka, 560038, India',
  address: { house_number: '12', road: 'MG Road', suburb: 'Indiranagar', city: 'Bengaluru', postcode: '560038', state: 'Karnataka', country: 'India' },
};
const LOC = { latitude: 12.97194, longitude: 77.64111, accuracy: 6, timestamp: '2026-10-21T10:00:00.000Z' };

describe('geoService (OpenStreetMap reverse geocoding)', () => {
  it('formats building, street, area, city and postcode', () => {
    const a = formatOsmAddress(OSM_JSON);
    expect(a.label).toBe('Sunrise Apartments, 12 MG Road, Indiranagar, Bengaluru 560038, Karnataka');
    expect(a.source).toBe('openstreetmap');
  });

  it('calls Nominatim with an identifying User-Agent and caches the result', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => OSM_JSON }));
    const geo = createGeoService({ fetchImpl, location: { reverseGeocodeAsync: jest.fn() } });
    const first = await geo.reverseGeocode(LOC);
    const second = await geo.reverseGeocode({ ...LOC, latitude: LOC.latitude + 0.00001 });
    expect(first.address.building).toBe('Sunrise Apartments');
    expect(second.address).toEqual(first.address);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/^https:\/\/nominatim\.openstreetmap\.org\/reverse\?format=jsonv2&lat=12\.97194&lon=77\.64111/);
    expect(opts.headers['User-Agent']).toMatch(/^VISHWAS-Safety\//);
  });

  it('falls back to the phone geocoder when OpenStreetMap fails', async () => {
    const geo = createGeoService({
      fetchImpl: jest.fn(async () => ({ ok: false, status: 503 })),
      location: { reverseGeocodeAsync: jest.fn(async () => [{ name: 'Tower B', streetNumber: '4', street: 'Ring Rd', district: 'HSR', city: 'Bengaluru', postalCode: '560102' }]) },
    });
    const res = await geo.reverseGeocode(LOC);
    expect(res.address.source).toBe('device');
    expect(res.address.label).toBe('Tower B, 4 Ring Rd, HSR, Bengaluru 560102');
    expect(res.note).toMatch(/503/);
  });

  it('reports failure instead of inventing an address', async () => {
    const geo = createGeoService({ fetchImpl: jest.fn(async () => { throw new Error('offline'); }), location: { reverseGeocodeAsync: jest.fn(async () => []) } });
    expect(await geo.reverseGeocode(LOC)).toEqual({ error: 'offline' });
  });

  it('builds an OpenStreetMap link', () => {
    expect(osmUrl(LOC)).toBe('https://www.openstreetmap.org/?mlat=12.97194&mlon=77.64111#map=19/12.97194/77.64111');
  });
});

describe('floorService (barometer estimate)', () => {
  it('turns a pressure difference into height and floor', () => {
    // ~17 m above ground → (17 - 1.2) / 3.2 ≈ 5th floor
    expect(estimateFloorFromPressure(1011.2, 1013.25)).toEqual({ heightM: 17.1, floor: 5 });
    expect(estimateFloorFromPressure(1013.25, 1013.25).floor).toBe(0);
    expect(estimateFloorFromPressure(10, 1013)).toBeNull();
  });

  it('labels floors', () => {
    expect(floorLabel(0)).toBe('Ground floor');
    expect(floorLabel(1)).toBe('1st floor');
    expect(floorLabel(2)).toBe('2nd floor');
    expect(floorLabel(3)).toBe('3rd floor');
    expect(floorLabel(5)).toBe('5th floor');
    expect(floorLabel(11)).toBe('11th floor');
    expect(floorLabel(22)).toBe('22nd floor');
    expect(floorLabel(-1)).toBe('Basement 1');
  });

  it('estimates from the phone barometer and Open-Meteo ground pressure', async () => {
    const barometer = {
      isAvailableAsync: jest.fn(async () => true),
      setUpdateInterval: jest.fn(),
      addListener: jest.fn((l) => {
        setTimeout(() => { l({ pressure: 1011.1 }); l({ pressure: 1011.3 }); }, 10);
        return { remove: jest.fn() };
      }),
    };
    const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ current: { surface_pressure: 1013.25 } }) }));
    const res = await createFloorService({ barometer, fetchImpl }).estimate(LOC);
    expect(fetchImpl.mock.calls[0][0]).toMatch(/api\.open-meteo\.com\/v1\/forecast\?latitude=12\.97194&longitude=77\.64111&current=surface_pressure/);
    expect(res.estimate).toMatchObject({ floor: 5, uncertainty: 2, source: 'barometer' });
  });

  it('never invents a floor without a barometer or ground reference', async () => {
    const noBaro = { isAvailableAsync: jest.fn(async () => false), addListener: jest.fn() };
    expect(await createFloorService({ barometer: noBaro, fetchImpl: jest.fn() }).estimate(LOC)).toEqual({ unavailable: 'This phone has no barometer' });
    const baro = {
      isAvailableAsync: jest.fn(async () => true),
      setUpdateInterval: jest.fn(),
      addListener: jest.fn((l) => { setTimeout(() => l({ pressure: 1000 }), 5); return { remove: jest.fn() }; }),
    };
    const offline = jest.fn(async () => { throw new Error('offline'); });
    expect((await createFloorService({ barometer: baro, fetchImpl: offline }).estimate(LOC)).unavailable).toMatch(/Ground-level pressure unavailable/);
  });
});

describe('alert text with address and floor', () => {
  const base = {
    user: { fullName: 'Priya' },
    location: LOC,
    triggerSource: 'button',
    startedAt: LOC.timestamp,
    address: { label: 'Sunrise Apartments, 12 MG Road, Bengaluru 560038' },
  };

  it('a confirmed floor wins over the estimate', () => {
    const msg = buildAlertMessage({ ...base, floor: { confirmed: 5, estimate: { floor: 4, uncertainty: 2 } } });
    expect(msg).toMatch(/Address: Sunrise Apartments, 12 MG Road, Bengaluru 560038\./);
    expect(msg).toMatch(/Floor: 5th floor \(confirmed by them\)\./);
    expect(msg).toMatch(/openstreetmap\.org/);
    expect(msg).toMatch(/±6 m/);
  });

  it('an estimate is labelled as approximate', () => {
    expect(describeFloor({ estimate: { floor: 5, uncertainty: 2 } })).toBe('about 5th floor (barometer estimate, ±2 floors)');
  });

  it('no floor information means no floor claim', () => {
    expect(buildAlertMessage({ ...base, floor: { unavailable: 'no barometer' } })).not.toMatch(/Floor:/);
  });

  it('payload carries address and floor', () => {
    const p = buildAlertPayload({
      session: { id: 's', startedAt: LOC.timestamp, triggerSource: 'button', address: { label: 'X', source: 'openstreetmap' }, floor: { confirmed: 3 } },
      location: LOC,
      contacts: [],
      user: null,
    });
    expect(p.address).toEqual({ label: 'X', source: 'openstreetmap' });
    expect(p.floor).toEqual({ confirmed: 3, estimate: null });
    expect(p.location.osmUrl).toMatch(/openstreetmap/);
  });
});
