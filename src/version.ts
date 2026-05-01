// Release checklist: always bump APP_VERSION here, sw.js, public/sw.js, package.json,
// package-lock.json, version.json, and public/version.json for user-visible app changes.
// Keep RELEASE_NOTES to the latest release only, ideally one to three short bullets.
export const APP_VERSION = '2.1.2.4';

export const RELEASE_NOTES = [
  'Fixed bottom-sheet close animation on iOS PWA — transition-based, no keyframes.',
  'Fixed double pale band at bottom of Log Food in light mode on iPhone.'
];
