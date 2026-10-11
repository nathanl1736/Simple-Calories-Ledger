// Which release notes the update sheet shows. src/release-notes.json is kept oldest first (a new
// release appends its notes to the end), so "what's new" is read from the end, newest first.

/** How many notes the update sheet lists. */
export const UPDATE_NOTES_SHOWN = 5;

/** The newest `count` notes, newest first. Blank entries are skipped. */
export function newestNotes(notes: readonly string[], count = UPDATE_NOTES_SHOWN): string[] {
  if (!(count > 0)) return [];
  return notes.filter(note => note.trim()).slice(-count).reverse();
}
