// Release checklist: always bump APP_VERSION here, sw.js, public/sw.js, package.json,
// package-lock.json, version.json, and public/version.json for user-visible app changes.
// Keep RELEASE_NOTES to the latest release only, ideally one to three short bullets.
export const APP_VERSION = '2.0.0.16';

export const RELEASE_NOTES = [
  'Improved AI Quick Log JSON paste parsing reliability.',
  'Cleared stale AI Quick Log errors when valid JSON is pasted.',
  'Kept AI Quick Log entries in the normal review-before-save flow.'
];
