// make-icons.mjs
// --------------
// Renders the VISHWAS shield logo (the same lucide ShieldCheck mark used in
// the app header) into the source images @capacitor/assets expects, then
// writes the PWA icons referenced by index.html / manifest.json.
//
//   node scripts/make-icons.mjs && npx capacitor-assets generate
//
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const ACCENT = '#5856D6';
const SHIELD = `
  <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
        fill="none" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="m9 12 2 2 4-4" fill="none" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;

/** Shield centred in a square; `scale` = fraction of the canvas the 24-unit glyph spans. */
function svg({ size, background, scale }) {
  const glyph = size * scale;
  const offset = (size - glyph) / 2;
  const bg = background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : '';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${bg}
    <g transform="translate(${offset} ${offset}) scale(${glyph / 24})">${SHIELD}</g>
  </svg>`);
}

async function png(file, opts) {
  await sharp(svg(opts)).png().toFile(file);
  console.log('wrote', file);
}

mkdirSync('assets', { recursive: true });
mkdirSync('public/icons', { recursive: true });

await png('assets/icon-only.png', { size: 1024, background: ACCENT, scale: 0.62 });
await png('assets/icon-foreground.png', { size: 1024, background: null, scale: 0.46 });
await png('assets/icon-background.png', { size: 1024, background: ACCENT, scale: 0 });
await png('assets/splash.png', { size: 2732, background: ACCENT, scale: 0.18 });
await png('assets/splash-dark.png', { size: 2732, background: '#16171F', scale: 0.18 });
await png('public/icons/icon-192.png', { size: 192, background: ACCENT, scale: 0.62 });
await png('public/icons/icon-512.png', { size: 512, background: ACCENT, scale: 0.62 });
