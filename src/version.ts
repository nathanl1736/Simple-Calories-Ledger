// Release checklist: always bump APP_VERSION here, sw.js, public/sw.js, package.json,
// package-lock.json, version.json, and public/version.json for user-visible app changes.
// Keep RELEASE_NOTES to the latest release only, ideally one to three short bullets.
export const APP_VERSION = '2.0.0.18';

export const RELEASE_NOTES = [
  'Hid the bottom navigation while typing in food and settings fields.',
  'Kept the navigation clear of the mobile keyboard and active inputs.',
  'Restored the bottom navigation automatically after input focus ends.'
];
