// Names of the files Dawni hands to the share sheet or downloads. Only these names say Dawni: the stored
// data (IndexedDB name, localStorage keys, the backup's `app` field) keeps its original identifiers, because
// renaming those would lose people's data.

/** The title the share sheet shows for a backup. */
export const BACKUP_SHARE_TITLE = 'Dawni backup';

/** dawni-backup-2026-10-11.json */
export const backupFileName = (dateKey: string) => `dawni-backup-${dateKey}.json`;

/** dawni-photo-2026-10-11.jpg: the extension follows the file's real type (photos are JPEG). */
export function photoFileName(dateKey: string, mimeType = 'image/jpeg') {
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  return `dawni-photo-${dateKey}.${extension}`;
}

/** dawni-2026-10-11-lunch.png */
export const mealCardFileName = (dateKey: string, meal: string) => `dawni-${dateKey}-${meal.toLowerCase()}.png`;
