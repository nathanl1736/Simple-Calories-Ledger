// In-page probes for the Dawni audit. Each export is the source of a function evaluated in the page.

/**
 * Tappable things under 44 x 44 CSS px. A checkbox or the date input inside a <label> is measured as its label,
 * because that is what a thumb hits. Hidden, zero-size and closed <details> content is skipped.
 */
export const TARGETS_SCRIPT = `(() => {
  const SELECTOR = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=menuitem], [role=tab], [role=slider]';
  const seen = new Set();
  const out = [];
  const describe = el => {
    const aria = el.getAttribute('aria-label');
    const text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    return (aria || text || el.getAttribute('placeholder') || el.getAttribute('title') || el.className || el.tagName).toString().slice(0, 70);
  };
  document.querySelectorAll(SELECTOR).forEach(raw => {
    let el = raw;
    if (raw instanceof HTMLInputElement && raw.type !== 'range') el = raw.closest('label') || raw;
    if (seen.has(el)) return;
    seen.add(el);
    if (el.closest('.keyboard-stand-in')) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return;
    let hidden = false;
    for (let p = el; p && !hidden; p = p.parentElement) { const s = getComputedStyle(p); if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0 && !p.matches('.tl-tool input')) hidden = true; }
    if (hidden) return;
    const w = Math.round(r.width * 2) / 2;
    const h = Math.round(r.height * 2) / 2;
    out.push({ label: describe(el), tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '', cls: String(el.className || '').toString().slice(0, 60), w, h, x: Math.round(r.left), y: Math.round(r.top + scrollY), disabled: !!el.disabled, small: w < 44 || h < 44 });
  });
  return out;
})()`;

/** Horizontal overflow of the page, and elements poking out past the viewport edges. */
export const OVERFLOW_SCRIPT = `(() => {
  const iw = window.innerWidth;
  const root = document.documentElement;
  const offenders = [];
  document.querySelectorAll('body *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    if (r.right > iw + 1 || r.left < -1) {
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' && (cs.transform !== 'none' || el.closest('.tabbar-wrap.hidden'))) return;
      if (el.closest('.modal-backdrop:not(.entered)')) return;
      if (el.closest('.tl-strip') && el.classList.contains('tl-strip')) return;
      offenders.push({ el: (el.className && String(el.className).slice(0, 50)) || el.tagName.toLowerCase(), text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 50), left: Math.round(r.left), right: Math.round(r.right) });
    }
  });
  return { scrollWidth: root.scrollWidth, bodyScrollWidth: document.body.scrollWidth, innerWidth: iw, overflowX: root.scrollWidth > iw || document.body.scrollWidth > iw, offenders: offenders.slice(0, 8) };
})()`;

/** Text that is cut off: single-line ellipsis or hidden overflow where the content is wider or taller than the box. */
export const CLIPPED_SCRIPT = `(() => {
  const out = [];
  document.querySelectorAll('body *').forEach(el => {
    if (el.children.length > 3) return;
    const text = (el.innerText || '').replace(/\\s+/g, ' ').trim();
    if (!text) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return;
    const hiddenX = cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll';
    const clamped = (cs.webkitLineClamp && cs.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 1);
    const hiddenY = cs.overflowY === 'hidden' && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0 && !el.matches('.modal-panel, .modal-backdrop');
    if (hiddenX || clamped || hiddenY) out.push({ text: text.slice(0, 60), cls: String(el.className || '').slice(0, 50), scrollW: el.scrollWidth, clientW: el.clientWidth, scrollH: el.scrollHeight, clientH: el.clientHeight, ellipsis: cs.textOverflow === 'ellipsis', kind: hiddenX ? 'x' : clamped ? 'clamp' : 'y' });
  });
  return out.slice(0, 12);
})()`;

/** Where focus is, relative to the topmost dialog. */
export const FOCUS_SCRIPT = `(() => {
  const dialogs = [...document.querySelectorAll('[role=dialog]')];
  const top = dialogs[dialogs.length - 1] || null;
  const active = document.activeElement;
  const label = el => el ? ((el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder'))) || (el.innerText || '').trim().slice(0, 40) || el.tagName.toLowerCase()) : '';
  return {
    hasDialog: !!top,
    dialogLabel: top ? top.getAttribute('aria-label') : '',
    insideDialog: !!(top && active && top.contains(active)),
    tag: active ? active.tagName.toLowerCase() : '',
    label: label(active),
    isBody: active === document.body
  };
})()`;

/** Is something under the page's tab bar / aria structure that a screen reader would trip on: background not inert while a dialog is open. */
export const A11Y_SCRIPT = `(() => {
  const dialogs = [...document.querySelectorAll('[role=dialog]')];
  const main = document.querySelector('main.app');
  const wrap = document.querySelector('.tabbar-wrap');
  return {
    dialogs: dialogs.length,
    ariaModalDialogs: dialogs.filter(d => d.getAttribute('aria-modal') === 'true').length,
    mainInert: !!(main && (main.inert || main.getAttribute('aria-hidden') === 'true')),
    tabbarInert: !!(wrap && (wrap.inert || wrap.getAttribute('aria-hidden') === 'true')),
    tabbarAriaHidden: wrap ? wrap.getAttribute('aria-hidden') : null
  };
})()`;

/** Contrast of a few named text elements against what is behind them is judged by eye on the screenshots; this returns computed colours. */
export const TEXT_COLORS_SCRIPT = `(sel) => [...document.querySelectorAll(sel)].slice(0, 6).map(el => { const cs = getComputedStyle(el); return { text: (el.innerText || '').trim().slice(0, 40), color: cs.color, size: cs.fontSize, weight: cs.fontWeight }; })`;

/** Smallest font sizes in use on the screen, ignoring hidden things. */
export const FONT_SIZES_SCRIPT = `(() => {
  const sizes = new Map();
  document.querySelectorAll('body *').forEach(el => {
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!own) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return;
    const px = parseFloat(cs.fontSize);
    const entry = sizes.get(px) || { px, count: 0, sample: '' };
    entry.count += 1;
    if (!entry.sample) entry.sample = (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 40) + ' [' + String(el.className || '').slice(0, 30) + ']';
    sizes.set(px, entry);
  });
  return [...sizes.values()].sort((a, b) => a.px - b.px).slice(0, 6);
})()`;
