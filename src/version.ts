// Release checklist: always bump APP_VERSION here, sw.js, public/sw.js, package.json,
// package-lock.json, version.json, and public/version.json for user-visible app changes.
// Keep RELEASE_NOTES to the latest release only, ideally one to three short bullets.
export const APP_VERSION = '2.0.0.12';

export const RELEASE_NOTES = [
  'Improved Quick Picks search layout.',
  'Added grouped search results for user foods and database suggestions.',
  'Added mock local database suggestions for testing future food database UX.',
  'Kept database suggestions limited so search stays clean.'
];
