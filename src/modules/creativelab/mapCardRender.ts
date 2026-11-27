import sharp, { type OverlayOptions } from 'sharp';
import { Direction, NearbyPlace, formatPlaceChip } from './knowledge.js';

/**
 * Map card = an AI background (no text) + everything that must be exact drawn by us:
 * project pin and name, one label per place with its time/distance chip, connector lines,
 * "Not to scale" and the logo. Text can never be misspelled because no AI draws it.
 */

export const CARD_W = 1080;
export const CARD_H = 1920;
const FONT = "'Avenir Next', 'Poppins', 'Montserrat', 'DejaVu Sans', Arial, sans-serif";

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Label slots around the pin (centre of each label box), by direction. North is up. */
const SLOTS: Record<Direction, { x: number; y: number }> = {
  NW: { x: 270, y: 560 },
  N: { x: 540, y: 430 },
  NE: { x: 810, y: 560 },
  W: { x: 215, y: 960 },
  E: { x: 865, y: 960 },
  SW: { x: 270, y: 1360 },
  S: { x: 540, y: 1470 },
  SE: { x: 810, y: 1360 },
};
/** Order used for places without a direction (corners first: tidiest layout) */
const FREE_ORDER: Direction[] = ['NW', 'NE', 'SW', 'SE', 'N', 'S', 'W', 'E'];

/** Picks a slot for every place: its own direction if free, otherwise the next free slot. */
export function layoutPlaces(places: NearbyPlace[]): Array<{ place: NearbyPlace; slot: Direction }> {
  const used = new Set<Direction>();
  const out: Array<{ place: NearbyPlace; slot: Direction } | null> = places.map(() => null);
  places.forEach((p, i) => {
    if (p.direction && !used.has(p.direction)) {
      used.add(p.direction);
      out[i] = { place: p, slot: p.direction };
    }
  });
  places.forEach((p, i) => {
    if (out[i]) return;
    const slot = FREE_ORDER.find((d) => !used.has(d))!;
    used.add(slot);
    out[i] = { place: p, slot };
  });
  return out as Array<{ place: NearbyPlace; slot: Direction }>;
}

/** Rough text width for Avenir-like fonts (good enough to size boxes) */
const textW = (s: string, size: number, bold = false) => s.length * size * (bold ? 0.6 : 0.54);

export function buildOverlaySvg(params: {
  projectName: string;
  locality?: string | null;
  places: NearbyPlace[];
  hasLogo: boolean;
  accent?: string;
}): string {
  const gold = params.accent || '#C9962B';
  const cx = CARD_W / 2;
  const cy = 960;
  const hasDir = params.places.some((p) => p.direction);
  const parts: string[] = [];

  // Soft vignette top/bottom so text and logo read on any background
  parts.push(`<defs>
    <linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.28"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
    <linearGradient id="bot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0.75"/></linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000" flood-opacity="0.22"/></filter>
    <filter id="glow"><feGaussianBlur stdDeviation="10"/></filter>
  </defs>
  <rect x="0" y="0" width="${CARD_W}" height="260" fill="url(#top)"/>
  <rect x="0" y="1560" width="${CARD_W}" height="360" fill="url(#bot)"/>`);

  // Connector lines first (under the boxes)
  const laid = layoutPlaces(params.places);
  for (const { slot } of laid) {
    const s = SLOTS[slot];
    parts.push(`<line x1="${cx}" y1="${cy - 40}" x2="${s.x}" y2="${s.y}" stroke="${gold}" stroke-width="7" stroke-linecap="round" stroke-dasharray="1 16" opacity="1"/>`);
  }

  // Project pin + name card
  parts.push(`<circle cx="${cx}" cy="${cy + 10}" r="46" fill="${gold}" opacity="0.35" filter="url(#glow)"/>
  <g filter="url(#sh)" transform="translate(${cx} ${cy - 150})">
    <path d="M0 150 C-14 118 -62 78 -62 34 A62 62 0 1 1 62 34 C62 78 14 118 0 150 Z" fill="${gold}"/>
    <circle cx="0" cy="28" r="24" fill="#fff"/>
  </g>`);
  const nameSize = 54;
  const locSize = 30;
  const boxW = Math.max(textW(params.projectName, nameSize, true), params.locality ? textW(params.locality, locSize) : 0) + 80;
  const boxH = params.locality ? 128 : 92;
  const by = cy + 40;
  parts.push(`<g filter="url(#sh)">
    <rect x="${cx - boxW / 2}" y="${by}" width="${boxW}" height="${boxH}" rx="26" fill="#fff" opacity="0.96"/>
  </g>
  <text x="${cx}" y="${by + 62}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${nameSize}" fill="#3B2A12">${esc(params.projectName)}</text>
  ${params.locality ? `<text x="${cx}" y="${by + 106}" text-anchor="middle" font-family="${FONT}" font-size="${locSize}" fill="#6B5B45">${esc(params.locality)}</text>` : ''}`);

  // Place labels
  for (const { place, slot } of laid) {
    const s = SLOTS[slot];
    const chip = formatPlaceChip(place);
    const nSize = place.name.length > 18 ? 34 : 40;
    const cSize = 30;
    const w = Math.min(470, Math.max(textW(place.name, nSize, true), textW(chip, cSize) + 40) + 56);
    const h = 132;
    const x = Math.max(16, Math.min(CARD_W - 16 - w, s.x - w / 2));
    const y = s.y - h / 2;
    const chipW = textW(chip, cSize) + 36;
    parts.push(`<g filter="url(#sh)"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="24" fill="#fff" opacity="0.97"/></g>
    <text x="${x + w / 2}" y="${y + 54}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${nSize}" fill="#1F1F1F">${esc(place.name)}</text>
    <rect x="${x + w / 2 - chipW / 2}" y="${y + 72}" width="${chipW}" height="44" rx="22" fill="#F3EBDD"/>
    <text x="${x + w / 2}" y="${y + 104}" text-anchor="middle" font-family="${FONT}" font-weight="600" font-size="${cSize}" fill="#4A3A22">${esc(chip)}</text>`);
  }

  // North arrow only when directions were given
  if (hasDir) {
    parts.push(`<g transform="translate(980 300)" filter="url(#sh)">
      <circle r="44" fill="#fff" opacity="0.95"/>
      <path d="M0 -30 L14 10 L0 2 L-14 10 Z" fill="${gold}"/>
      <text y="34" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="22" fill="#3B2A12">N</text>
    </g>`);
  }

  parts.push(`<text x="${CARD_W - 40}" y="${params.hasLogo ? 1590 : 1870}" text-anchor="end" font-family="${FONT}" font-size="26" fill="#3B2A12" opacity="0.8">Not to scale</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">${parts.join('\n')}</svg>`;
}

/**
 * Builds the final 1080×1920 PNG: background scene (any size, cover-cropped), overlay, logo.
 */
export async function renderMapCard(params: {
  background: Buffer;
  projectName: string;
  locality?: string | null;
  places: NearbyPlace[];
  logo?: Buffer | null;
}): Promise<Buffer> {
  // Square FLUX images: extend to 9:16 with a blurred, enlarged copy behind, scene sharp in the middle
  const bgMeta = await sharp(params.background).metadata();
  // Plain backdrop in the scene's own colours (top edge colour → bottom edge colour)
  const edge = async (top: boolean) => {
    const h = bgMeta.height || 1024;
    const { data } = await sharp(params.background)
      .extract({ left: 0, top: top ? 0 : Math.round(h * 0.9), width: bgMeta.width || 1024, height: Math.round(h * 0.1) })
      .resize(1, 1)
      .raw()
      .toBuffer({ resolveWithObject: true });
    return `rgb(${data[0]},${data[1]},${data[2]})`;
  };
  const [c1, c2] = await Promise.all([edge(true), edge(false)]);
  const backdrop = await sharp(
    Buffer.from(
      `<svg width="${CARD_W}" height="${CARD_H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`
    )
  )
    .png()
    .toBuffer();
  const sceneW = CARD_W;
  const sceneH = Math.round((sceneW / (bgMeta.width || 1024)) * (bgMeta.height || 1024));
  const scene = await sharp(params.background).resize(sceneW, Math.min(sceneH, CARD_H)).toBuffer();
  const sceneTop = Math.max(0, Math.round(960 - Math.min(sceneH, CARD_H) / 2));

  // Fade the scene's top and bottom edges into the backdrop
  const fadeMask = Buffer.from(
    `<svg width="${sceneW}" height="${Math.min(sceneH, CARD_H)}"><defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.12" stop-color="#fff"/><stop offset="0.88" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient></defs><rect width="100%" height="100%" fill="url(#f)"/></svg>`
  );
  const fadedScene = await sharp(scene).ensureAlpha().composite([{ input: fadeMask, blend: 'dest-in' }]).png().toBuffer();

  const layers: OverlayOptions[] = [
    { input: fadedScene, top: sceneTop, left: 0 },
    { input: Buffer.from(buildOverlaySvg({ ...params, hasLogo: Boolean(params.logo) })), top: 0, left: 0 },
  ];
  if (params.logo) {
    const logo = await sharp(params.logo).resize(420, 170, { fit: 'inside', withoutEnlargement: false }).png().toBuffer();
    const m = await sharp(logo).metadata();
    layers.push({ input: logo, top: 1920 - 70 - (m.height || 0), left: Math.round((CARD_W - (m.width || 0)) / 2) });
  }
  return sharp(backdrop).composite(layers).png({ compressionLevel: 8 }).toBuffer();
}
