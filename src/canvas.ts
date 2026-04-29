import type { Entry, Meal, Totals } from './types';
import { fmt, n, shortDate } from './utils';

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

export async function renderMealCardCanvas(group: MealGroup) {
  const W = 1080;
  const H = 1220;
  const pad = 56;
  const x = pad + 52;
  let y = pad + 64;
  const maxW = W - pad * 2 - 104;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas');
  const bg = cssVar('--bg', '#141414');
  const card = cssVar('--card', '#1d1d1d');
  const card2 = cssVar('--card2', '#252525');
  const ink = cssVar('--ink', '#f7f2ed');
  const muted = cssVar('--muted', '#8b8b8b');
  const accent = cssVar('--accent', '#9be7c4');
  const font = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = card;
  roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 46);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.font = `900 34px ${font}`;
  ctx.fillText('Meal Summary', x, y);
  y += 66;
  ctx.fillStyle = ink;
  ctx.font = `950 82px ${font}`;
  ctx.fillText(group.meal, x, y);
  ctx.textAlign = 'right';
  ctx.fillStyle = muted;
  ctx.font = `900 31px ${font}`;
  ctx.fillText(shortDate(group.date), x + maxW, y - 10);
  ctx.textAlign = 'left';
  y += 58;
  const photos = group.photos.slice(0, 4);
  if (photos.length) {
    const imgs = await Promise.all(photos.map(loadImage).map(p => p.catch(() => null)));
    const good = imgs.filter(Boolean) as HTMLImageElement[];
    if (good.length) {
      const gap = 16;
      const photoH = good.length <= 2 ? 360 : 430;
      if (good.length === 1) drawCover(ctx, good[0], x, y, maxW, photoH, 30);
      else {
        const cw = (maxW - gap) / 2;
        const ch = good.length <= 2 ? photoH : (photoH - gap) / 2;
        good.slice(0, 4).forEach((img, i) => drawCover(ctx, img, x + (i % 2) * (cw + gap), y + Math.floor(i / 2) * (ch + gap), cw, ch, 26));
      }
      y += photoH + 30;
    }
  }
  ctx.fillStyle = card2;
  roundRect(ctx, x, y, maxW, 134, 30);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.font = `950 82px ${font}`;
  const calText = fmt(group.totals.calories);
  ctx.fillText(calText, x + 32, y + 84);
  ctx.fillStyle = muted;
  ctx.font = `900 32px ${font}`;
  ctx.fillText('kCal', x + 54 + ctx.measureText(calText).width, y + 78);
  ctx.fillText(`${group.items.length} item${group.items.length === 1 ? '' : 's'}`, x + 34, y + 116);
  y += 170;
  const rows = group.items.slice(0, 10);
  ctx.fillStyle = card2;
  roundRect(ctx, x, y, maxW, 104 + rows.length * 62, 30);
  ctx.fill();
  y += 54;
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
    ctx.fillText(`${fmt(n(item.calories))} kCal`, x + maxW - 30, y);
    ctx.textAlign = 'left';
    y += 62;
  });
  ctx.fillStyle = muted;
  ctx.font = `900 26px ${font}`;
  ctx.fillText('Simple Calories Ledger', x, H - pad - 34);
  return canvas;
}

export function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create PNG')), 'image/png'));
}
