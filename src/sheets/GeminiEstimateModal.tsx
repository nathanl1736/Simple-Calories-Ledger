import { FormEvent, useEffect, useRef, useState } from 'react';
import { compressImage, SHARP_PHOTO_OPTIONS } from '../image';
import { MAX_ESTIMATE_PHOTOS } from '../aiEstimate';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/controls';

export function GeminiEstimateModal({ open, onClose, onEstimate }: { open: boolean; onClose: () => void; onEstimate: (description: string, photos: string[]) => Promise<void> }) {
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingPhotos, setAddingPhotos] = useState(false);
  const [error, setError] = useState('');
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setText('');
      setPhotos([]);
      setLoading(false);
      setError('');
    }
  }, [open]);

  const addPhotos = async (files: FileList | null) => {
    const list = Array.from(files || []).slice(0, MAX_ESTIMATE_PHOTOS - photos.length);
    if (photoInputRef.current) photoInputRef.current.value = '';
    if (!list.length) return;
    setError('');
    setAddingPhotos(true);
    const added: string[] = [];
    // One at a time: full-size phone photos decoded together can exhaust memory.
    for (const file of list) {
      try {
        const photo = await compressImage(file, SHARP_PHOTO_OPTIONS);
        if (photo) added.push(photo);
      } catch {
        setError('One photo couldn’t be read. Try taking it again.');
      }
    }
    setPhotos(current => [...current, ...added].slice(0, MAX_ESTIMATE_PHOTOS));
    setAddingPhotos(false);
  };

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed && !photos.length) {
      setError('Add a short description or a photo.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await onEstimate(trimmed, photos);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gemini could not estimate this meal.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} title="Estimate with Gemini" onClose={onClose} bottomSheet closeDisabled={loading}>
      <form className="gemini-estimate-modal" onSubmit={(event: FormEvent) => { event.preventDefault(); submit(); }}>
        <p className="hint">Describe what you ate, add photos, or both. You’ll review the numbers before saving.</p>
        <Field label="What did you eat?" full>
          <textarea disabled={loading} value={text} onChange={event => { setText(event.target.value); setError(''); }} placeholder="e.g. chicken stir fry, about 150 g chicken, 1 cup rice, 1 tbsp oil. Or for a label: ate half the tub." />
        </Field>
        <div className="menu-pick-section">
          <div className="section">Photos (optional, up to {MAX_ESTIMATE_PHOTOS})</div>
          <input ref={photoInputRef} hidden type="file" accept="image/*" multiple onChange={event => addPhotos(event.target.files)} />
          <div className="menu-photo-grid">
            {photos.map((src, index) => (
              <div key={`${index}-${src.length}`} className="menu-photo">
                <img src={src} alt={`Photo ${index + 1}`} />
                {!loading && (
                  <button type="button" className="menu-photo-remove" aria-label={`Remove photo ${index + 1}`} onClick={() => setPhotos(current => current.filter((_, i) => i !== index))}>
                    <span aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
            {photos.length < MAX_ESTIMATE_PHOTOS && (
              <button type="button" className="menu-photo-add" disabled={loading || addingPhotos} onClick={() => photoInputRef.current?.click()}>
                <span className="empty-photo-icon" aria-hidden="true" />
                <span>{addingPhotos ? 'Adding…' : photos.length ? 'Add another' : 'Add photo'}</span>
              </button>
            )}
          </div>
        </div>
        <details className="extra-info menu-pick-how">
          <summary>Tips for accurate numbers</summary>
          <div className="extra-info-body">
            <ul className="menu-pick-how-list">
              <li>Packaged food: photograph the nutrition panel flat and close, plus the front of the pack. Say how much you ate (e.g. 150 g, half the tub).</li>
              <li>Home cooking: list ingredients and amounts, including oil, butter and sauces, and how many serves it made.</li>
              <li>Meals out: a photo from above plus a short description works best.</li>
            </ul>
          </div>
        </details>
        {error && <p className="ai-quick-log-error">{error}</p>}
        <div className="actions vertical">
          <button className="primary" type="submit" disabled={loading || addingPhotos || (!text.trim() && !photos.length)}>{loading ? 'Estimating…' : 'Estimate food'}</button>
          <button className="secondary" type="button" disabled={loading} onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}
