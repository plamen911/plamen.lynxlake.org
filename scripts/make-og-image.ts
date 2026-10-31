// Renders public/og.png (1200x630) and public/favicon.ico from SVG. Run once, by hand,
// after the name, tagline or colours change, and commit the output:
//   npx tsx scripts/make-og-image.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { profile } from '../src/data/profile';

const root = join(import.meta.dirname, '..');
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Hero colours from src/styles/tokens.css.
const BG = '#0f1b2d';
const LINE = '#2b3d58';
const TEXT = '#e8edf4';
const MUTED = '#a3b1c6';
const ACCENT = '#b4c2ff';
const SERIF = "Charter, 'Iowan Old Style', Georgia, serif";
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";

const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${BG}"/>
  <rect x="0" y="0" width="16" height="630" fill="${ACCENT}"/>
  <rect x="96" y="104" width="88" height="88" rx="16" fill="${ACCENT}"/>
  <text x="140" y="164" text-anchor="middle" font-family="${SERIF}" font-size="42" font-weight="700" fill="${BG}">PM</text>
  <text x="96" y="340" font-family="${SERIF}" font-size="96" font-weight="700" fill="${TEXT}">${esc(profile.name)}</text>
  <text x="96" y="420" font-family="${SANS}" font-size="38" fill="${MUTED}">${esc(profile.tagline)}</text>
  <line x1="96" y1="500" x2="1104" y2="500" stroke="${LINE}" stroke-width="2"/>
  <text x="96" y="558" font-family="${SANS}" font-size="30" fill="${ACCENT}">plamen.lynxlake.org</text>
</svg>`;

await sharp(Buffer.from(og)).png({ compressionLevel: 9 }).toFile(join(root, 'public', 'og.png'));

// favicon.ico: a single 32x32 PNG-encoded image, from public/favicon.svg.
const png = await sharp(readFileSync(join(root, 'public', 'favicon.svg')), { density: 288 }).resize(32, 32).png().toBuffer();
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // one image
header.writeUInt8(32, 6); // width
header.writeUInt8(32, 7); // height
header.writeUInt8(0, 8); // palette
header.writeUInt8(0, 9); // reserved
header.writeUInt16LE(1, 10); // colour planes
header.writeUInt16LE(32, 12); // bits per pixel
header.writeUInt32LE(png.length, 14); // image size
header.writeUInt32LE(22, 18); // image offset
writeFileSync(join(root, 'public', 'favicon.ico'), Buffer.concat([header, png]));

console.log('wrote public/og.png and public/favicon.ico');
