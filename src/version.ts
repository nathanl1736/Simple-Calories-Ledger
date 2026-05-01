// Version: edit package.json "version" (or npm version patch). Notes: src/release-notes.json.
// Run npm run build (or npm run dev); prebuild propagates to sw.js, version.json, index.html.
import pkg from '../package.json';
import releaseNotes from './release-notes.json';

export const APP_VERSION: string = pkg.version;
export const RELEASE_NOTES: string[] = Array.isArray(releaseNotes)
  ? releaseNotes.map(String)
  : [];
