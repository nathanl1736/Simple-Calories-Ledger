// Version: edit the 4-part "version" in package.json by hand. `npm version` cannot
// parse it (2.2.0.10 is not semver). Notes: src/release-notes.json.
// Run npm run build (or npm run dev); prebuild propagates it to public/sw.js,
// public/version.json and index.html. A bump is required for the in-app update
// check to notice a deploy, because it is what changes sw.js.
import pkg from '../package.json';
import releaseNotes from './release-notes.json';

export const APP_VERSION: string = pkg.version;
export const RELEASE_NOTES: string[] = Array.isArray(releaseNotes)
  ? releaseNotes.map(String)
  : [];
