import { CSSProperties, useEffect, useState } from 'react';
import { skyBackground, skyBand, skyFor, type Sky, type SkyBand } from '../tidelight';

/** Light or dark as actually shown, following the attribute applyThemePreference sets. */
function useResolvedDark() {
  const read = () => document.documentElement.dataset.theme === 'dark';
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

const skyBandNow = () => {
  const now = new Date();
  return skyBand(now.getHours() + now.getMinutes() / 60);
};

/** The sky follows the clock (checked each minute and on return to the app); its light or dark version follows the appearance. */
export function useSky(): Sky {
  const dark = useResolvedDark();
  const [band, setBand] = useState<SkyBand>(skyBandNow);
  useEffect(() => {
    const refresh = () => setBand(skyBandNow());
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  const sky = skyFor(band, dark);
  useEffect(() => {
    // Under the clock the scrim takes the sky's top colour, so there is no pale band at rest.
    document.documentElement.style.setProperty('--status-scrim', sky.stops[0]);
    return () => { document.documentElement.style.removeProperty('--status-scrim'); };
  }, [sky.stops[0]]);
  useEffect(() => {
    // At the top of a sky screen the scrim is hidden, so the sky runs cleanly under the clock.
    const root = document.documentElement;
    const update = () => root.toggleAttribute('data-sky-at-rest', window.scrollY <= 4);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => {
      window.removeEventListener('scroll', update);
      root.removeAttribute('data-sky-at-rest');
    };
  }, []);
  return sky;
}

export const skyStyle = (sky: Sky) => ({ '--sky': skyBackground(sky), '--sky-end': sky.stops[3], '--arc': sky.arc } as CSSProperties);
