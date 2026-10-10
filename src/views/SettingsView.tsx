import { useEffect, useRef, useState } from 'react';
import { APP_VERSION } from '../version';
import type { AppState, Settings, ThemePreference } from '../types';
import { DEFAULT } from '../state';
import { backupCounts } from '../backup';
import { AI_ESTIMATE_DISCLAIMER, AI_QUICK_LOG_PROMPT } from '../aiQuickLog';
import { geminiModelLabel, probeGeminiKey, readGeminiKeyStatus, type GeminiError, type GeminiKeyStatus as SavedGeminiKeyStatus } from '../geminiEstimate';
import { energyUnitLabel, energyUnitValue, energyValueForUnit, fmt, n } from '../utils';
import { Field } from '../ui/controls';

type GeminiCheck = {
  state: 'idle' | 'testing' | 'ok' | 'error';
  /** The key this check was for; a result for any other key is ignored. */
  key?: string;
  modelId?: string;
  modelCount?: number;
  freeTier?: boolean;
  best?: boolean;
  message?: string;
  detail?: string;
};

/** Setup feedback for the Gemini card: model choice is dynamic, so show the pick and the plan. */
function GeminiKeyStatus({ hasKey, check, saved }: { hasKey: boolean; check: GeminiCheck; saved: SavedGeminiKeyStatus | null }) {
  if (check.state === 'testing') return <p className="hint gemini-status">Checking which Gemini models this key can use...</p>;
  if (check.state === 'ok' && check.modelId) {
    return (
      <div className="gemini-status is-ok">
        <p className="hint is-ready">
          Ready. Dawni will use <strong>{geminiModelLabel(check.modelId)}</strong>
          {check.best && !check.freeTier ? ', the best model this key can use.' : '.'}
        </p>
        {check.freeTier && <p className="hint">This key is on Google’s free tier. Pro models need a paid plan; if you upgrade, tap Test key and Dawni moves up to the best model.</p>}
        <p className="hint gemini-model-id">{check.modelId}{check.modelCount ? ` · ${fmt(check.modelCount)} model${check.modelCount === 1 ? '' : 's'} listed for this key` : ''}</p>
      </div>
    );
  }
  if (check.state === 'error') {
    return (
      <div className="gemini-status is-error">
        <p className="hint">{check.message}</p>
        {check.detail ? <details className="extra-info"><summary>Details from Google</summary><div className="extra-info-body"><p className="hint selectable">{check.detail}</p></div></details> : null}
      </div>
    );
  }
  if (!hasKey) return <p className="hint gemini-status">Not set up. Add a key to use Estimate with Gemini and Help me pick from a menu.</p>;
  if (saved) {
    return (
      <p className="hint gemini-status">
        Dawni uses <strong>{geminiModelLabel(saved.modelId)}</strong>{saved.freeTier ? ' on Google’s free tier' : ''}. Tap Test key to check again.
      </p>
    );
  }
  return <p className="hint gemini-status">Key saved. Tap Test key to see which Gemini model Dawni will use.</p>;
}

export function SettingsView(props: {
  state: AppState;
  onDone: () => void;
  focus: 'gemini' | null;
  onFocusHandled: () => void;
  goalsEditing: boolean;
  goalDraft: Settings;
  setGoalDraft: (settings: Settings) => void;
  setGoalsEditing: (on: boolean) => void;
  onSaveGoals: () => void;
  onAccent: (color: string) => void;
  onTheme: (theme: ThemePreference) => void;
  onEnergyUnit: (unit: 'kcal' | 'kj') => void;
  onBackupDays: (days: number) => void;
  onSpreadWeeklyBank: (enabled: boolean) => void;
  onRefreshFoodDatabase: () => Promise<void>;
  onImportCustomDatabase: () => void;
  onToggleCustomDatabase: (id: string, enabled: boolean) => Promise<void>;
  onDeleteCustomDatabase: (id: string) => void;
  onCustomDatabaseHelp: () => void;
  onGeminiApiKey: (key: string) => Promise<void> | void;
  onAiPreferences: (text: string) => Promise<void> | void;
  onGeminiApiKeyHelp: () => void;
  onCopyAiPrompt: () => Promise<void>;
  onAiPromptHelp: () => void;
  onExport: () => void;
  onImport: () => void;
  onCheckUpdates: () => void;
  onClear: () => void;
}) {
  const [foodDatabaseUpdating, setFoodDatabaseUpdating] = useState(false);
  const [geminiEditing, setGeminiEditing] = useState(false);
  const [geminiDraft, setGeminiDraft] = useState(() => props.state.settings.geminiApiKey);
  const [geminiCheck, setGeminiCheck] = useState<GeminiCheck>({ state: 'idle' });
  const [savedGeminiStatus, setSavedGeminiStatus] = useState<(SavedGeminiKeyStatus & { key: string }) | null>(null);
  const geminiCheckSeq = useRef(0);
  const [preferencesDraft, setPreferencesDraft] = useState(() => props.state.settings.aiPreferences);
  const preferencesChanged = preferencesDraft.trim() !== props.state.settings.aiPreferences.trim();
  const counts = backupCounts(props.state);
  const goalUnit = energyUnitValue(props.state.settings.energyUnit);
  const visibleSettings = { ...props.state.settings, calories: energyValueForUnit(props.state.settings.calories, goalUnit) };
  const draft = props.goalsEditing ? props.goalDraft : visibleSettings;
  const patchGoal = (patch: Partial<Settings>) => props.setGoalDraft({ ...props.goalDraft, ...patch });
  const toggleEnergyUnit = () => props.onEnergyUnit(goalUnit === 'kcal' ? 'kj' : 'kcal');

  useEffect(() => {
    if (!geminiEditing) setGeminiDraft(props.state.settings.geminiApiKey);
  }, [props.state.settings.geminiApiKey, geminiEditing]);

  // Arriving from "Set up Gemini" opens the key field ready to paste into.
  useEffect(() => {
    if (props.focus !== 'gemini') return;
    setGeminiDraft(props.state.settings.geminiApiKey);
    setGeminiEditing(true);
    props.onFocusHandled();
  }, [props.focus]);

  // What the last check or estimate learned about the saved key, without calling Google.
  useEffect(() => {
    let cancelled = false;
    const key = props.state.settings.geminiApiKey.trim();
    readGeminiKeyStatus(key)
      .then(status => {
        if (!cancelled) setSavedGeminiStatus(status ? { ...status, key } : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [props.state.settings.geminiApiKey]);

  const geminiKey = (geminiEditing ? geminiDraft : props.state.settings.geminiApiKey).trim();
  // A check only describes the key it ran on, so editing the key hides it.
  const visibleGeminiCheck: GeminiCheck = geminiCheck.key === geminiKey ? geminiCheck : { state: 'idle' };

  const testGeminiKey = async (keyToTest = geminiKey) => {
    const key = keyToTest.trim();
    const seq = ++geminiCheckSeq.current;
    if (!key) return setGeminiCheck({ state: 'error', key, message: 'Add a key first.' });
    setGeminiCheck({ state: 'testing', key });
    try {
      const result = await probeGeminiKey(key);
      if (seq === geminiCheckSeq.current) setGeminiCheck({ state: 'ok', key, ...result });
    } catch (err) {
      const error = err as GeminiError;
      if (seq === geminiCheckSeq.current) setGeminiCheck({ state: 'error', key, message: error.message || 'Could not reach Gemini.', detail: error.detail });
    }
  };

  const toggleGeminiEdit = () => {
    if (geminiEditing) {
      const next = geminiDraft.trim();
      const changed = next !== props.state.settings.geminiApiKey.trim();
      // Saving a new key runs the check, so setup is paste, Save, done.
      void Promise.resolve(props.onGeminiApiKey(geminiDraft)).then(() => {
        setGeminiEditing(false);
        if (next && changed) void testGeminiKey(next);
      });
    } else {
      setGeminiDraft(props.state.settings.geminiApiKey);
      setGeminiEditing(true);
    }
  };

  return (
    <>
      <header className="page-header has-helper settings-head">
        <h1 className="page-title">Settings</h1>
        <button className="tl-glass tl-pill" type="button" onClick={props.onDone}>Done</button>
      </header>
      <section className="card"><div className="card-head"><h2>Goals</h2><button className="small-btn" type="button" onClick={() => props.goalsEditing ? props.onSaveGoals() : (props.setGoalDraft({ ...props.state.settings, calories: energyValueForUnit(props.state.settings.calories, goalUnit) }), props.setGoalsEditing(true))}>{props.goalsEditing ? 'Save goals' : 'Edit'}</button></div><div className="form"><Field label="Mode" full><select disabled={!props.goalsEditing} value={draft.trackingMode} onChange={event => patchGoal({ trackingMode: event.target.value as Settings['trackingMode'] })}><option>Cutting</option><option>Maintaining</option><option>Bulking</option></select></Field><Field label={`Calories (${energyUnitLabel(goalUnit)})`}><input disabled={!props.goalsEditing} inputMode="decimal" value={props.goalsEditing ? String(draft.calories || '') : fmt(draft.calories)} onChange={event => patchGoal({ calories: n(event.target.value) })} /></Field><Field label="Fat"><input disabled={!props.goalsEditing} value={draft.fat} onChange={event => patchGoal({ fat: n(event.target.value) })} /></Field><Field label="Carbs"><input disabled={!props.goalsEditing} value={draft.carbs} onChange={event => patchGoal({ carbs: n(event.target.value) })} /></Field><Field label="Protein"><input disabled={!props.goalsEditing} value={draft.protein} onChange={event => patchGoal({ protein: n(event.target.value) })} /></Field></div></section>
      <section className="card">
        <h2>Weekly banking</h2>
        <p className="hint">Days count toward your week bank on their own once they’re over.</p>
        <label className="check-pill full">
          <input type="checkbox" checked={props.state.settings.spreadWeeklyBank} onChange={event => props.onSpreadWeeklyBank(event.target.checked)} />
          <span>Spread banked calories across remaining days</span>
        </label>
        <p className="hint">When on, what you’ve banked or gone over is shared evenly across the days left, from today to Sunday. Going over never takes a day below 80% of its target; the rest stays in that week’s result.</p>
      </section>
      <section className="card"><h2>Display</h2><div className="field full"><span>Theme</span><div className="smooth-toggle theme-toggle" role="group" aria-label="Theme">{(['system', 'dark', 'light'] as ThemePreference[]).map(theme => <button key={theme} type="button" className={(props.state.settings.theme || DEFAULT.settings.theme) === theme ? 'active' : ''} onClick={() => props.onTheme(theme)}>{theme[0].toUpperCase() + theme.slice(1)}</button>)}</div></div><div className="field full"><span>Energy unit</span><div className="smooth-toggle" role="group" aria-label="Energy unit"><button type="button" className={goalUnit === 'kcal' ? 'active' : ''} onClick={toggleEnergyUnit}>Cal</button><button type="button" className={goalUnit === 'kj' ? 'active' : ''} onClick={toggleEnergyUnit}>kJ</button></div></div><div className="section spaced">Accent</div><div className="preset-row">{['#0E7C76', '#2B58B1', '#A04E1E', '#7A5AA6', '#3F7F4F'].map(color => <button key={color} className="preset" style={{ '--c': color } as React.CSSProperties} type="button" onClick={() => props.onAccent(color)} aria-label={`Accent ${color}`} />)}</div><input type="color" value={props.state.settings.accent} onChange={event => props.onAccent(event.target.value)} /></section>
      <section className="card" id="backupSection"><h2>Backup</h2><p className="hint">{props.state.settings.lastBackupAt ? `Last backup: ${new Date(props.state.settings.lastBackupAt).toLocaleString()}.` : 'No backup exported yet.'} Dawni keeps your data on this device; export a backup to protect your logs and journal photos. Current data: {counts.entries} entries, {counts.foods} saved foods, {counts.photos} photos, {counts.customFoodDatabases || 0} custom databases.</p><Field label="Reminder" full><select value={props.state.settings.backupReminderDays} onChange={event => props.onBackupDays(n(event.target.value))}><option value="3">Every 3 days</option><option value="7">Every 7 days</option><option value="14">Every 14 days</option></select></Field><div className="actions"><button className="primary" type="button" onClick={props.onExport}>Export backup</button><button className="secondary" type="button" onClick={props.onImport}>Import backup</button></div></section>
      <section className="card gemini-settings-card" id="geminiSection">
        <div className="card-head">
          <h2>Gemini</h2>
          <div className="card-head-trailing">
            <button className="small-btn" type="button" onClick={toggleGeminiEdit}>{geminiEditing ? 'Save' : 'Edit'}</button>
            <button className="help-btn" type="button" onClick={props.onGeminiApiKeyHelp}>?</button>
          </div>
        </div>
        <p className="hint">Use your own Gemini API key for Estimate with Gemini and Help me pick from a menu. A free key from Google AI Studio works. The key stays on this device and is included in backups.</p>
        <Field label="Gemini API key" full>
          <input
            type="password"
            disabled={!geminiEditing}
            value={geminiEditing ? geminiDraft : props.state.settings.geminiApiKey}
            placeholder={geminiEditing ? 'Paste API key' : 'Tap Edit to add or change your key'}
            autoComplete="off"
            onChange={event => setGeminiDraft(event.target.value)}
          />
        </Field>
        <GeminiKeyStatus
          hasKey={!!geminiKey}
          check={visibleGeminiCheck}
          saved={savedGeminiStatus?.key === geminiKey ? savedGeminiStatus : null}
        />
        <div className="actions">
          <button className="secondary" type="button" disabled={visibleGeminiCheck.state === 'testing'} onClick={() => void testGeminiKey()}>
            {visibleGeminiCheck.state === 'testing' ? 'Checking key...' : 'Test key'}
          </button>
        </div>
      </section>
      <section className="card ai-preferences-card">
        <h2>About you, for AI</h2>
        <p className="hint">Sent with every Gemini estimate and menu pick, and added to the copied chatbot prompt. Keep it short. It stays on this phone.</p>
        <Field label="What Gemini should always know" full>
          <textarea
            value={preferencesDraft}
            maxLength={500}
            onChange={event => setPreferencesDraft(event.target.value)}
            placeholder="e.g. Melbourne. Vegetarian on weekdays, no seafood. I usually cook with olive oil spray."
          />
        </Field>
        <div className="actions">
          <button className="secondary" type="button" disabled={!preferencesChanged} onClick={() => props.onAiPreferences(preferencesDraft)}>Save</button>
        </div>
      </section>
      <section className="card ai-prompt-card"><div className="card-head"><h2>AI estimate helper</h2><button className="help-btn" type="button" onClick={props.onAiPromptHelp}>?</button></div><p className="hint">Use this prompt with your AI chatbot, then review the estimate before saving it. Dawni treats AI output as editable, not guaranteed.</p><details className="extra-info ai-prompt-details"><summary>Show prompt</summary><textarea className="ai-prompt-textarea" readOnly value={AI_QUICK_LOG_PROMPT} /></details><div className="actions"><button className="secondary" type="button" onClick={props.onCopyAiPrompt}>Copy prompt</button></div><p className="hint ai-prompt-disclaimer">{AI_ESTIMATE_DISCLAIMER}</p></section>
      <section className="card"><h2>Food estimates</h2><p className="hint">Refreshes Dawni&apos;s local estimate list. Estimates stay editable and won&apos;t change your saved foods or logs.</p><div className="actions"><button className="secondary" type="button" disabled={foodDatabaseUpdating} onClick={() => { setFoodDatabaseUpdating(true); props.onRefreshFoodDatabase().finally(() => setFoodDatabaseUpdating(false)); }}>{foodDatabaseUpdating ? 'Updating estimates...' : 'Update local food estimates'}</button></div></section>
      <section className="card custom-db-card"><div className="card-head"><h2>Custom food databases</h2><button className="help-btn" type="button" onClick={props.onCustomDatabaseHelp}>?</button></div><p className="hint">Import your own JSON estimate list. Enabled databases appear in food search and remain stored on this device.</p><div className="actions"><button className="primary" type="button" onClick={props.onImportCustomDatabase}>Import JSON</button></div>{props.state.customFoodDatabases.length ? <div className="custom-db-list">{props.state.customFoodDatabases.map(database => <div className="custom-db-row" key={database.id}><div className="custom-db-main"><strong>{database.name}</strong><span>{fmt(database.itemCount)} foods · Imported {new Date(database.importedAt).toLocaleDateString()} · {database.enabled ? 'Enabled' : 'Disabled'}</span></div><label className="toggle-line"><input type="checkbox" checked={database.enabled} onChange={event => props.onToggleCustomDatabase(database.id, event.target.checked)} /><span>{database.enabled ? 'On' : 'Off'}</span></label><button className="small-btn danger" type="button" onClick={() => props.onDeleteCustomDatabase(database.id)}>Delete</button></div>)}</div> : <div className="empty custom-db-empty">No custom databases imported yet.</div>}</section>
      <section className="card"><h2>App</h2><p className="hint"><strong>Dawni</strong><br /><span className="project-note">Weekly Calorie Tracker</span><br />Version {APP_VERSION}</p><div className="actions"><button className="secondary" type="button" onClick={props.onCheckUpdates}>Check for updates</button><button className="secondary danger" type="button" onClick={props.onClear}>Clear local data</button></div></section>
    </>
  );
}
