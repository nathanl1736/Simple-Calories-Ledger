import { APP_VERSION, RELEASE_NOTES } from './version';

export type UpdateInfo = {
  version: string;
  notes: string[];
  waitingWorker?: ServiceWorker | null;
  source: 'service-worker' | 'version-json';
};

let registration: ServiceWorkerRegistration | null = null;
let controllerReloadPending = false;

export async function fetchRemoteVersion() {
  const response = await fetch(`./version.json?cacheBust=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not check for updates');
  const data = await response.json() as { version?: string; notes?: unknown[] };
  return { version: String(data.version || APP_VERSION), notes: Array.isArray(data.notes) ? data.notes.map(String) : [] };
}

export function compareVersions(a: string, b: string) {
  const pa = String(a || '0').split('.').map(x => parseInt(x, 10) || 0);
  const pb = String(b || '0').split('.').map(x => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function waitForServiceWorkerUpdate(reg: ServiceWorkerRegistration) {
  return new Promise<ServiceWorker | null>(resolve => {
    const worker = reg.installing || reg.waiting;
    if (worker) return resolve(worker);
    const timeout = window.setTimeout(() => resolve(null), 2200);
    reg.addEventListener('updatefound', () => {
      window.clearTimeout(timeout);
      resolve(reg.installing || reg.waiting || null);
    }, { once: true });
  });
}

export async function registerServiceWorker(onUpdate: (update: UpdateInfo) => void) {
  if (!('serviceWorker' in navigator)) return null;
  if (registration) return registration;
  registration = await navigator.serviceWorker.register('./sw.js');
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controllerReloadPending) return;
    controllerReloadPending = false;
    location.reload();
  });
  registration.addEventListener('updatefound', () => {
    const worker = registration?.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        onUpdate({ version: APP_VERSION, notes: RELEASE_NOTES, waitingWorker: worker, source: 'service-worker' });
      }
    });
  });
  if (registration.waiting && navigator.serviceWorker.controller) {
    onUpdate({ version: APP_VERSION, notes: RELEASE_NOTES, waitingWorker: registration.waiting, source: 'service-worker' });
  }
  return registration;
}

export async function checkForAppUpdate(onUpdate: (update: UpdateInfo) => void, manual = false) {
  const reg = await registerServiceWorker(onUpdate);
  if (reg?.waiting && navigator.serviceWorker.controller) {
    onUpdate({ version: APP_VERSION, notes: RELEASE_NOTES, waitingWorker: reg.waiting, source: 'service-worker' });
    return true;
  }
  if (manual && reg) {
    await reg.update();
    const worker = await waitForServiceWorkerUpdate(reg);
    if ((reg.waiting || worker) && navigator.serviceWorker.controller) {
      onUpdate({ version: APP_VERSION, notes: RELEASE_NOTES, waitingWorker: reg.waiting || worker, source: 'service-worker' });
      return true;
    }
  }
  const remote = await fetchRemoteVersion();
  if (compareVersions(remote.version, APP_VERSION) > 0) {
    localStorage.setItem('calorie-tracker-update-prompted-version', remote.version);
    onUpdate({ ...remote, source: 'version-json' });
    return true;
  }
  return false;
}

export async function applyAppUpdate(update: UpdateInfo | null) {
  const worker = update?.waitingWorker || registration?.waiting;
  if (worker) {
    controllerReloadPending = true;
    worker.postMessage({ type: 'SKIP_WAITING' });
    window.setTimeout(() => {
      if (controllerReloadPending) location.reload();
    }, 2500);
    return;
  }
  const version = update?.version || Date.now();
  localStorage.setItem('calorie-tracker-update-prompted-version', String(version));
  try {
    await registration?.update();
  } catch {
    // The cache-busting reload below is the fallback.
  }
  const url = new URL(location.href);
  url.searchParams.set('appVersion', String(version));
  url.searchParams.set('reload', Date.now().toString());
  location.replace(url.toString());
}
