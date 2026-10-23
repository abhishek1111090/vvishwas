import { useState } from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
import { USER_AGENT, OSM_ATTRIBUTION } from '../services/geoService';
import { RadarPing } from './motion';
import { fonts } from '../theme/theme';

// OsmMap — a small live map built from OpenStreetMap tiles: a 3×3 block of
// 256-px tiles positioned so the exact coordinate sits in the centre, with
// the GPS accuracy drawn as a circle. No map SDK, so it runs in Expo Go.
// Tiles are fetched with an identifying User-Agent and attributed, as the
// OSM tile policy asks; the app only loads 9 tiles per view.

const TILE = 256;
const TILE_URL = 'https://tile.openstreetmap.org';

/** Web-Mercator maths: which tiles to draw and where the point falls. */
export function tileView(latitude, longitude, zoom) {
  const n = 2 ** zoom;
  const lat = (Math.max(-85.05, Math.min(85.05, latitude)) * Math.PI) / 180;
  const fx = ((longitude + 180) / 360) * n;
  const fy = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n;
  const x0 = Math.floor(fx) - 1;
  const y0 = Math.floor(fy) - 1;
  const tiles = [];
  for (let dy = 0; dy < 3; dy += 1) {
    for (let dx = 0; dx < 3; dx += 1) {
      const x = (((x0 + dx) % n) + n) % n;
      const y = y0 + dy;
      if (y >= 0 && y < n) tiles.push({ key: `${zoom}/${x}/${y}`, left: dx * TILE, top: dy * TILE, uri: `${TILE_URL}/${zoom}/${x}/${y}.png` });
    }
  }
  // Pixel position of the point inside the 3×3 block.
  const px = (fx - x0) * TILE;
  const py = (fy - y0) * TILE;
  const metresPerPixel = (156543.03392 * Math.cos(lat)) / n;
  return { tiles, px, py, metresPerPixel };
}

export function OsmMap({ latitude, longitude, accuracy, height = 170, zoom = 16, color = '#FF2E3A', radius = 16, tone = 'dark' }) {
  const light = tone === 'light';
  const [failed, setFailed] = useState(false);
  const { tiles, px, py, metresPerPixel } = tileView(latitude, longitude, zoom);
  const accPx = accuracy ? Math.min(140, Math.max(10, accuracy / metresPerPixel)) : 0;

  return (
    <View style={[styles.box, { height, borderRadius: radius }, light && { backgroundColor: '#DCE1D6' }]} accessibilityLabel="Map of your current position" testID="osm-map">
      <View style={[styles.grid, { top: height / 2 - py, marginLeft: -px }]}>
        {tiles.map((t) => (
          <Image
            key={t.key}
            source={{ uri: t.uri, headers: { 'User-Agent': USER_AGENT } }}
            style={[styles.tile, { left: t.left, top: t.top }]}
            onError={() => setFailed(true)}
            fadeDuration={250}
          />
        ))}
      </View>
      {/* Dims the bright OSM style in the dark SOS screen; a whisper of lime in the light app. */}
      <View style={[styles.tint, light && { backgroundColor: 'rgba(238,246,230,0.18)' }]} pointerEvents="none" />
      {failed ? <Text style={styles.failed}>Map tiles unavailable offline</Text> : null}
      {accPx ? (
        <View
          pointerEvents="none"
          style={[styles.accuracy, { width: accPx * 2, height: accPx * 2, borderRadius: accPx, marginLeft: -accPx, marginTop: -accPx, borderColor: color, backgroundColor: `${color}22` }]}
        />
      ) : null}
      <View style={styles.marker} pointerEvents="none">
        <RadarPing color={color} size={70} active />
      </View>
      <Text style={[styles.attrib, light && { color: 'rgba(11,11,11,0.7)' }]}>{OSM_ATTRIBUTION}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', backgroundColor: '#1D1D22' },
  grid: { position: 'absolute', left: '50%', width: TILE * 3, height: TILE * 3 },
  tile: { position: 'absolute', width: TILE, height: TILE },
  tint: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,8,10,0.42)' },
  accuracy: { position: 'absolute', left: '50%', top: '50%', borderWidth: 1 },
  marker: { position: 'absolute', left: '50%', top: '50%', marginLeft: -35, marginTop: -35 },
  attrib: { position: 'absolute', right: 6, bottom: 4, fontFamily: fonts.medium, fontSize: 9, color: 'rgba(255,255,255,0.75)' },
  failed: { position: 'absolute', alignSelf: 'center', top: 10, fontFamily: fonts.medium, fontSize: 11, color: '#9C9CA6' },
});
