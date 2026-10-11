// 3.0 polish: typed numbers, the update sheet's note order, share file names, Undo for a deleted food, and the
// release metadata staying in step. npm test (Node 22.6+).
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

register('./resolveTs.mjs', import.meta.url);
const { parseTypedNumber } = await import('../src/numberInput.ts');
const { newestNotes, UPDATE_NOTES_SHOWN } = await import('../src/releaseNotes.ts');
const { backupFileName, photoFileName, mealCardFileName, BACKUP_SHARE_TITLE } = await import('../src/fileNames.ts');
const { removeFood, restoreFood } = await import('../src/undo.ts');

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

/* ---------------------------------------------------------------- typed numbers */

test('a number being typed is read as far as it goes', () => {
  assert.equal(parseTypedNumber('1.5'), 1.5);
  assert.equal(parseTypedNumber('1.'), 1);
  assert.equal(parseTypedNumber('.5'), 0.5);
  assert.equal(parseTypedNumber('0.'), 0);
  assert.equal(parseTypedNumber('  12 '), 12);
  assert.equal(parseTypedNumber('120'), 120);
});

test('a comma is a decimal point or a thousands separator, whichever it looks like', () => {
  assert.equal(parseTypedNumber('1,5'), 1.5);
  assert.equal(parseTypedNumber('0,25'), 0.25);
  assert.equal(parseTypedNumber('1,450'), 1450);
  assert.equal(parseTypedNumber('12,345.5'), 12345.5);
});

test('anything that is not a number is 0, and a stray second dot ends the number', () => {
  assert.equal(parseTypedNumber(''), 0);
  assert.equal(parseTypedNumber('abc'), 0);
  assert.equal(parseTypedNumber('-3'), 0);
  assert.equal(parseTypedNumber('1.2.3'), 1.2);
  assert.equal(parseTypedNumber('12g'), 12);
});

/* ---------------------------------------------------------------- the update sheet's notes */

test('the update sheet reads the notes from the end: the newest five, newest first', () => {
  const notes = Array.from({ length: 12 }, (_, i) => `note ${i + 1}`);
  assert.deepEqual(newestNotes(notes), ['note 12', 'note 11', 'note 10', 'note 9', 'note 8']);
  assert.equal(UPDATE_NOTES_SHOWN, 5);
  assert.deepEqual(newestNotes(notes, 2), ['note 12', 'note 11']);
});

test('fewer notes than the limit are all shown, and blanks and a zero limit show nothing extra', () => {
  assert.deepEqual(newestNotes(['one', 'two']), ['two', 'one']);
  assert.deepEqual(newestNotes(['one', '  ', '', 'two']), ['two', 'one']);
  assert.deepEqual(newestNotes([]), []);
  assert.deepEqual(newestNotes(['one'], 0), []);
});

test('the real release notes end with the 3.0 headline, and the newest five are distinct', () => {
  const notes = JSON.parse(read('../src/release-notes.json'));
  const shown = newestNotes(notes);
  assert.equal(shown.length, 5);
  assert.equal(shown[0], notes[notes.length - 1]);
  assert.match(shown[0], /^One Log food sheet/);
  assert.equal(new Set(shown).size, 5);
  // The oldest note (the first release's) is not what the sheet leads with any more.
  assert.notEqual(shown[0], notes[0]);
});

/* ---------------------------------------------------------------- file names */

test('files Dawni shares are named for Dawni', () => {
  assert.equal(backupFileName('2026-10-11'), 'dawni-backup-2026-10-11.json');
  assert.equal(BACKUP_SHARE_TITLE, 'Dawni backup');
  assert.equal(mealCardFileName('2026-10-11', 'Lunch'), 'dawni-2026-10-11-lunch.png');
});

test('a shared photo is named for what it is: a JPEG unless it says otherwise', () => {
  assert.equal(photoFileName('2026-10-11'), 'dawni-photo-2026-10-11.jpg');
  assert.equal(photoFileName('2026-10-11', 'image/jpeg'), 'dawni-photo-2026-10-11.jpg');
  assert.equal(photoFileName('2026-10-11', 'image/png'), 'dawni-photo-2026-10-11.png');
  assert.equal(photoFileName('2026-10-11', ''), 'dawni-photo-2026-10-11.jpg');
});

test('stored data keeps its original names: renaming them would lose what people have saved', () => {
  assert.match(read('../src/storage.ts'), /DB_NAME = 'calorie-tracker-db'/);
  assert.match(read('../src/backup.ts'), /app: 'calorie-tracker'/);
  assert.match(read('../vite.config.ts'), /\/Simple-Calories-Ledger\//);
});

/* ---------------------------------------------------------------- Undo for a deleted food */

const food = (id, name) => ({ id, name, calories: 100, protein: 0, carbs: 0, fat: 0, favourite: false, usageCount: 1, lastUsedAt: 1, createdAt: 1, updatedAt: 1 });

test('a deleted food goes back where it was', () => {
  const foods = [food('a', 'Apple'), food('b', 'Bread'), food('c', 'Cheese')];
  const { foods: left, removed } = removeFood(foods, 'b');
  assert.deepEqual(left.map(item => item.id), ['a', 'c']);
  assert.equal(removed.index, 1);
  assert.deepEqual(restoreFood(left, removed).map(item => item.id), ['a', 'b', 'c']);
});

test('Undo for a food is safe when the list moved on', () => {
  const foods = [food('a', 'Apple'), food('b', 'Bread')];
  const { foods: left, removed } = removeFood(foods, 'b');
  // Shorter than it was: it goes on the end.
  assert.deepEqual(restoreFood([], removed).map(item => item.id), ['b']);
  // Already back some other way: no double.
  assert.deepEqual(restoreFood(foods, removed).map(item => item.id), ['a', 'b']);
  // Already gone: nothing to undo.
  assert.equal(removeFood(left, 'b').removed, null);
  assert.equal(removeFood(left, 'b').foods, left);
});

/* ---------------------------------------------------------------- release metadata */

test('the version is the same in package.json, the service worker, version.json and index.html', () => {
  const version = JSON.parse(read('../package.json')).version;
  assert.match(version, /^\d+\.\d+\.\d+\.\d+$/);
  assert.match(read('../public/sw.js'), new RegExp(`const APP_VERSION = '${version.replaceAll('.', '\\.')}'`));
  assert.equal(JSON.parse(read('../public/version.json')).version, version);
  assert.match(read('../index.html'), new RegExp(`<meta name="app-version" content="${version.replaceAll('.', '\\.')}" />`));
});

test('version.json carries the same notes as src/release-notes.json', () => {
  assert.deepEqual(JSON.parse(read('../public/version.json')).notes, JSON.parse(read('../src/release-notes.json')));
});

test('the page allows zoom', () => {
  const viewport = read('../index.html').match(/<meta name="viewport" content="([^"]*)"/)?.[1] ?? '';
  assert.doesNotMatch(viewport, /maximum-scale|user-scalable/);
});
