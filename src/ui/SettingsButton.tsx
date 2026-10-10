import { createContext, useContext } from 'react';
import { Icon } from './icons';

/** Opens Settings from whichever tab is showing; Done in Settings returns there. Provided by App. */
export const OpenSettingsContext = createContext<() => void>(() => undefined);

/** The sliders button for a glass toolbar that already holds other tools (Today's, Week's). */
export function SettingsTool() {
  const openSettings = useContext(OpenSettingsContext);
  return (
    <button className="tl-tool" type="button" aria-label="Settings" onClick={openSettings}>
      <Icon name="settings" size={22} />
    </button>
  );
}

/** The same button in its own glass capsule, for a header with no toolbar (Journal, Foods). */
export function SettingsGlassButton() {
  return (
    <div className="tl-glass tl-toolbar page-tools">
      <SettingsTool />
    </div>
  );
}
