// Release checklist: always bump APP_VERSION here, sw.js, public/sw.js, package.json,
// package-lock.json, version.json, and public/version.json for user-visible app changes.
// Keep RELEASE_NOTES to the latest release only, ideally one to three short bullets.
export const APP_VERSION = '2.0.0.14';

export const RELEASE_NOTES = [
  'Added fuzzy token-based food search with improved database ranking.',
  'Improved Chobani Greek Yoghurt database search results.',
  'Added yoghurt and yogurt spelling support.'
];
