// Release checklist: always bump APP_VERSION here, sw.js, public/sw.js, package.json,
// package-lock.json, version.json, and public/version.json for user-visible app changes.
// Keep RELEASE_NOTES to the latest release only, ideally one to three short bullets.
export const APP_VERSION = '2.0.0.15';

export const RELEASE_NOTES = [
  'Added AI Quick Log for pasting JSON meal estimates into Log Food.',
  'Added a Settings prompt and help guide for external AI chatbots.',
  'Kept AI Quick Log local-only with normal review before saving.'
];
