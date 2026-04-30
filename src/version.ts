// Release checklist: always bump APP_VERSION here, sw.js, public/sw.js, package.json,
// package-lock.json, version.json, and public/version.json for user-visible app changes.
// Keep RELEASE_NOTES to the latest release only, ideally one to three short bullets.
export const APP_VERSION = '2.0.0.13';

export const RELEASE_NOTES = [
  'Added bundled food estimate database support with a Settings refresh action.',
  'Added database result previews, source chips, and cleaner subtitles.',
  'Quick Picks search now clears after selecting a food.'
];
