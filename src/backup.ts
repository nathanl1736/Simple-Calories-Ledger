import { APP_VERSION } from './version';
import type { AppState, BackupPayload } from './types';
import { customFoodItemCount } from './customFoodDatabases';
import { downloadBlob } from './image';
import { normalizeStateShape } from './state';
import { toKey, validBackupReminderDays } from './utils';

export function backupCounts(state: AppState) {
  return {
    entries: state.entries.length,
    foods: state.foods.length,
    completedDates: state.completedDates.length,
    photos: state.entries.filter(entry => !!entry.photo).length,
    customFoodDatabases: state.customFoodDatabases.length,
    customFoodItems: customFoodItemCount(state.customFoodDatabases)
  };
}

// Days since the last export. The oldest log stands in only until there is a
// first backup: taking the earliest of both let months-old logs outweigh a
// backup made yesterday, so the reminder came back every day.
export function backupAgeDays(state: AppState, now = Date.now()) {
  const lastBackup = Date.parse(state.settings.lastBackupAt || '');
  if (Number.isFinite(lastBackup)) return Math.floor((now - lastBackup) / 86400000);
  const logged = state.entries
    .map(entry => Number(entry.createdAt) || Number(entry.updatedAt))
    .filter(time => Number.isFinite(time) && time > 0);
  return logged.length ? Math.floor((now - Math.min(...logged)) / 86400000) : 0;
}

export function backupFileName() {
  return `calorie-tracker-backup-${toKey(new Date())}.json`;
}

export async function exportBackup(state: AppState) {
  const exportedAt = new Date().toISOString();
  const counts = { version: APP_VERSION, ...backupCounts(state) };
  const backupState: AppState = structuredClone(state);
  backupState.settings = {
    ...backupState.settings,
    lastBackupAt: exportedAt,
    lastBackupMeta: counts,
    lastBackupReminderShownAt: null,
    backupReminderDays: validBackupReminderDays(backupState.settings.backupReminderDays)
  };
  const payload: BackupPayload = { exportedAt, app: 'calorie-tracker', version: APP_VERSION, counts, state: backupState };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const filename = backupFileName();
  if (typeof File !== 'undefined' && navigator.share) {
    const file = new File([blob], filename, { type: 'application/json' });
    if (!navigator.canShare || navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: 'Simple Calories Ledger backup'
      });
      return backupState;
    }
  }
  downloadBlob(blob, filename);
  return backupState;
}

export async function parseBackup(file: File) {
  const parsed = JSON.parse(await file.text()) as Partial<BackupPayload> | AppState;
  const next = 'state' in parsed ? parsed.state : parsed;
  if (!next || !('entries' in next) || !('foods' in next) || !('settings' in next)) throw new Error('Invalid backup file');
  return normalizeStateShape(next);
}
