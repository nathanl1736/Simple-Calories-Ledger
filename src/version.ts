// Release checklist: always bump APP_VERSION here, sw.js, public/sw.js, package.json,
// package-lock.json, version.json, and public/version.json for user-visible app changes.
// App icons live at stable paths under public/icons/ (no per-release icon filenames).
// Keep RELEASE_NOTES to the latest release only, ideally one to three short bullets.
export const APP_VERSION = '2.1.2.6';

export const RELEASE_NOTES = [
  'iOS PWA: bottom tab bar stays stable when closing Log Food and other modals (focus / nav hide sync).'
];
