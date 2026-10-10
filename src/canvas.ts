import type { EnergyUnit, Entry, Meal, Totals } from './types';
import { energyUnitLabel, energyValueForUnit, entryTotals, fmt, shortDate } from './utils';

export type MealGroup = {
  id: string;
  date: string;
  meal: Meal;
  items: Entry[];
  totals: Totals;
  photos: string[];
};

function cssVar(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, r: number) {
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) / 2;
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();
}

/** Mixes two #rrggbb colours; null if either isn't plain hex. */
function mixHex(a: string, b: string, weightA: number) {
  const parse = (hex: string) => /^#[0-9a-f]{6}$/i.test(hex.trim()) ? [1, 3, 5].map(i => parseInt(hex.trim().slice(i, i + 2), 16)) : null;
  const ca = parse(a);
  const cb = parse(b);
  if (!ca || !cb) return null;
  return `rgb(${ca.map((v, i) => Math.round(v * weightA + cb[i] * (1 - weightA))).join(', ')})`;
}

export async function renderMealCardCanvas(group: MealGroup, energyUnit: EnergyUnit = 'kcal') {
  const unitLabel = energyUnitLabel(energyUnit);
  const energy = (kcal: number) => fmt(energyValueForUnit(kcal, energyUnit));
  const W = 1080;
  const pad = 56;
  const x = pad + 52;
  const maxW = W - pad * 2 - 104;
  const photos = group.photos.slice(0, 4);
  const imgs = photos.length ? (await Promise.all(photos.map(src => loadImage(src).catch(() => null)))).filter(Boolean) as HTMLImageElement[] : [];
  const photoH = imgs.length ? (imgs.length <= 2 ? 360 : 430) : 0;
  const rows = group.items.slice(0, 10);

  // Lay out first so the card is exactly as tall as its content: a fixed
  // height left a gap under short meals and cut off long ones.
  const kickerY = pad + 64;
  const titleY = kickerY + 88;
  const photoY = titleY + 40;
  const totalsY = photoY + (photoH ? photoH + 30 : 0);
  const totalsH = 152;
  const listY = totalsY + totalsH + 36;
  const listH = 104 + rows.length * 62;
  const H = listY + listH + 40 + pad;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas');
  const bg = cssVar('--bg', '#0A1B1E');
  const card = cssVar('--card', '#1f211d');
  const card2 = cssVar('--card2', '#262922');
  const ink = cssVar('--ink', '#f7f2ed');
  const muted = cssVar('--muted', '#a19b90');
  const accent = cssVar('--accent', '#0E7C76');
  // Pastel accents are unreadable as text on the light theme's cream, so darken
  // them towards the ink the same way the app's own light theme does.
  const accentText = document.documentElement.dataset.theme === 'light' ? mixHex(accent, ink, 0.14) || ink : accent;
  const font = cssVar('--font-ui', 'sans-serif');
  const display = cssVar('--font-display', 'serif');
  // A canvas draws with whatever has loaded by now, so wait for the app's fonts
  // instead of letting the card fall back to the system font.
  await Promise.all([`900 34px ${font}`, `700 82px ${display}`].map(spec => document.fonts.load(spec).catch(() => [])));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = card;
  roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 46);
  ctx.fill();

  ctx.fillStyle = accentText;
  ctx.font = `900 34px ${font}`;
  ctx.fillText('Meal Summary', x, kickerY);
  ctx.fillStyle = ink;
  ctx.font = `700 82px ${display}`;
  ctx.fillText(group.meal, x, titleY);
  ctx.textAlign = 'right';
  ctx.fillStyle = muted;
  ctx.font = `900 31px ${font}`;
  ctx.fillText(shortDate(group.date), x + maxW, titleY - 10);
  ctx.textAlign = 'left';

  if (imgs.length) {
    const gap = 16;
    if (imgs.length === 1) drawCover(ctx, imgs[0], x, photoY, maxW, photoH, 30);
    else {
      const cw = (maxW - gap) / 2;
      const ch = imgs.length <= 2 ? photoH : (photoH - gap) / 2;
      imgs.forEach((img, i) => drawCover(ctx, img, x + (i % 2) * (cw + gap), photoY + Math.floor(i / 2) * (ch + gap), cw, ch, 26));
    }
  }

  ctx.fillStyle = card2;
  roundRect(ctx, x, totalsY, maxW, totalsH, 30);
  ctx.fill();
  ctx.fillStyle = accentText;
  ctx.font = `700 82px ${display}`;
  const calText = energy(group.totals.calories);
  ctx.fillText(calText, x + 32, totalsY + 86);
  // Measure while the large font is still set, so the unit sits beside the number.
  const unitX = x + 54 + ctx.measureText(calText).width;
  ctx.fillStyle = muted;
  ctx.font = `900 32px ${font}`;
  ctx.fillText(unitLabel, unitX, totalsY + 80);
  ctx.font = `850 28px ${font}`;
  ctx.fillText(`${group.items.length} item${group.items.length === 1 ? '' : 's'}`, x + 34, totalsY + 128);

  ctx.fillStyle = card2;
  roundRect(ctx, x, listY, maxW, listH, 30);
  ctx.fill();
  let y = listY + 54;
  ctx.fillStyle = muted;
  ctx.font = `900 28px ${font}`;
  ctx.fillText('Food items', x + 30, y);
  y += 48;
  rows.forEach(item => {
    ctx.fillStyle = ink;
    ctx.font = `850 31px ${font}`;
    ctx.fillText(String(item.name || 'Food item').slice(0, 36), x + 30, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = muted;
    ctx.font = `850 27px ${font}`;
    ctx.fillText(`${energy(entryTotals(item).calories)} ${unitLabel}`, x + maxW - 30, y);
    ctx.textAlign = 'left';
    y += 62;
  });
  return canvas;
}

export function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create PNG')), 'image/png'));
}
