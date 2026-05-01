// To release: bump version in package.json, update src/release-notes.json, run npm run build.
// The prebuild script auto-generates sw.js, public/sw.js, version.json, public/version.json,
// and the app-version meta in index.html. No other files need manual version edits.
import pkg from '../package.json';
import notes from './release-notes.json';

export const APP_VERSION: string = pkg.version;
export const RELEASE_NOTES: string[] = notes as string[];
