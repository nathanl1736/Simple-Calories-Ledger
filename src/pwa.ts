import { APP_VERSION, RELEASE_NOTES } from './version';

export type UpdateInfo = {
  version: string;
  notes: string[];
  waitingWorker?: ServiceWorker | null;
  source: 'service-worker' | 'version-json';
};

export type RemoteVersion = { version: string; notes: string[] };

let registration: ServiceWorkerRegistration | null = null;
let controllerReloadPending = false;

export async function fetchRemoteVersion(): Promise<RemoteVersion> {
  // No cache-buster in the URL: the service worker serves this path straight from
  // the network, and a unique URL per check used to leak one cache entry each time.
  const response = await fetch('./version.json', { cache: 'no-store' });
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

/**
 * The bundle only knows its own version, so the incoming version and notes have
 * to come from the deployed version.json. Falls back to this build's values so
 * the modal always has something to show.
 */
async function describeIncomingUpdate(waitingWorker: ServiceWorker | null): Promise<UpdateInfo> {
  try {
    const remote = await fetchRemoteVersion();
    if (compareVersions(remote.version, APP_VERSION) > 0) {
      return { version: remote.version, notes: remote.notes.length ? remote.notes : RELEASE_NOTES, waitingWorker, source: 'service-worker' };
    }
  } catch {
    // Offline or blocked: fall through to this build's own metadata.
  }
  return { version: APP_VERSION, notes: RELEASE_NOTES, waitingWorker, source: 'service-worker' };
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
        describeIncomingUpdate(worker).then(onUpdate).catch(console.warn);
      }
    });
  });
  if (registration.waiting && navigator.serviceWorker.controller) {
    describeIncomingUpdate(registration.waiting).then(onUpdate).catch(console.warn);
  }
  return registration;
}

export async function checkForAppUpdate(onUpdate: (update: UpdateInfo) => void, manual = false) {
  const reg = await registerServiceWorker(onUpdate);
  if (reg?.waiting && navigator.serviceWorker.controller) {
    onUpdate(await describeIncomingUpdate(reg.waiting));
    return true;
  }
  if (manual && reg) {
    await reg.update();
    const worker = await waitForServiceWorkerUpdate(reg);
    if ((reg.waiting || worker) && navigator.serviceWorker.controller) {
      onUpdate(await describeIncomingUpdate(reg.waiting || worker));
      return true;
    }
  }
  const remote = await fetchRemoteVersion();
  if (compareVersions(remote.version, APP_VERSION) > 0) {
    onUpdate({ ...remote, source: 'version-json' });
    return true;
  }
  return false;
}

const DISMISSED_VERSION_KEY = 'calorie-tracker-update-prompted-version';

/** Remembers a "Not now" so the automatic checks stop offering that version. */
export function dismissUpdatePrompt(version?: string) {
  if (!version) return;
  try {
    localStorage.setItem(DISMISSED_VERSION_KEY, version);
  } catch {
    // Private mode: the prompt just reappears on the next check.
  }
}

function wasDismissed(version: string) {
  try {
    return !!version && localStorage.getItem(DISMISSED_VERSION_KEY) === version;
  } catch {
    return false;
  }
}

const RESUME_CHECK_INTERVAL_MS = 20 * 60 * 1000;
let lastResumeCheck = Date.now();

/**
 * iOS suspends a home-screen PWA instead of closing it, so a session can run for
 * days without ever re-checking. Re-check when the app comes back to the
 * foreground, throttled so a quick app-switch doesn't hit the network, and quiet
 * about a version the user already waved off.
 */
export function watchForUpdatesOnResume(onUpdate: (update: UpdateInfo) => void) {
  const maybeCheck = () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastResumeCheck < RESUME_CHECK_INTERVAL_MS) return;
    lastResumeCheck = Date.now();
    // manual: also refetch sw.js, so a new worker is found and not just version.json.
    checkForAppUpdate(update => {
      if (wasDismissed(update.version)) return;
      onUpdate(update);
    }, true).catch(console.warn);
  };
  document.addEventListener('visibilitychange', maybeCheck);
  window.addEventListener('pageshow', maybeCheck);
  return () => {
    document.removeEventListener('visibilitychange', maybeCheck);
    window.removeEventListener('pageshow', maybeCheck);
  };
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
  try {
    await registration?.update();
  } catch {
    // The cache-busting reload below is the fallback.
  }
  // Marker params force a fresh navigation; strip them first so the installed app
  // never keeps drifting further from its start_url across updates.
  const url = new URL(location.href);
  url.searchParams.delete('appVersion');
  url.searchParams.delete('reload');
  url.searchParams.set('appVersion', String(update?.version || APP_VERSION));
  url.searchParams.set('reload', Date.now().toString());
  location.replace(url.toString());
}

/** Clears the one-shot reload markers so they don't stick to the installed app. */
export function clearUpdateReloadMarkers() {
  const url = new URL(location.href);
  if (!url.searchParams.has('appVersion') && !url.searchParams.has('reload')) return;
  url.searchParams.delete('appVersion');
  url.searchParams.delete('reload');
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}
