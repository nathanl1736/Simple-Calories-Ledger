// Release checklist: always bump APP_VERSION here, sw.js, public/sw.js, package.json,
// package-lock.json, version.json, and public/version.json for user-visible app changes.
export const APP_VERSION = '2.0.0.6';

export const RELEASE_NOTES = [
  'Reset Cards and Stats on tab re-tap.',
  'Reset Track and Journal on tab re-tap.',
  'Cleaned up Meal Card branding.',
  'Pill toggles now switch from either side.',
  'Improved Food Log modal focus behavior, zero-value display, and Calories & Macros layout.',
  'Allowed completed-day entries to repeat into today while keeping completed days read-only.',
  'Made Stats mode-aware for cutting, bulking, and maintaining, with open days excluded from scores and banking.',
  'Aligned Last 7 days graph reference lines and completed-day coloring with the active goal mode.',
  'Unified macro chips through a reusable component across Track, Library, Journal, and Cards.',
  'Migrated the app to React, Vite, and TypeScript while preserving existing local data.',
  'Restored polished centered popup modals and improved iOS/PWA safe-area behavior.',
  'Rebuilt Stats, Journal, Food Log, quick picks, and meal cards for closer feature parity.',
  'Added kCal/kJ display and entry support while keeping saved calories normalized.',
  'Updated the app icon, Cards tab icon, and 2.0.0.0 offline update cache.',
  'Recovery release: forces a fresh 2.0.0.1 app shell for installed PWAs.'
];
