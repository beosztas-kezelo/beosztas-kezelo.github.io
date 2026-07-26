import { useEffect, useRef, useState } from 'react';
import type {
  CalendarEvent,
  CalendarExportPreferences,
  GoogleEventColorOption,
} from '../domain/types';
import {
  MAX_CUSTOM_EVENT_TITLE_LENGTH,
  limitCustomEventTitle,
  normalizedCustomEventTitle,
  resolveCalendarEventTitle,
  selectedGoogleEventColor,
} from '../services/calendarExportPreferences';

const AUTOMATIC_VALUE = 'automatic';
const NEW_CUSTOM_VALUE = 'new-custom';
const SAVED_PREFIX = 'saved:';

interface CalendarEventSettingsProps {
  events: CalendarEvent[];
  preferences: CalendarExportPreferences;
  colors: GoogleEventColorOption[];
  savedCustomTitles: string[];
  paletteWarning?: string;
  persistenceUnavailable?: boolean;
  attentionRequested?: boolean;
  onAttentionHandled?: () => void;
  onUseAutomatic: () => void;
  onUseSavedTitle: (title: string) => void;
  onSaveCustomTitle: (title: string) => void;
  onDeleteCustomTitle: (title: string) => void;
  onColorChange: (colorId: string) => void;
  onReloadColors: () => void;
  onReset: () => void;
}

export function CalendarEventSettings({
  events,
  preferences,
  colors,
  savedCustomTitles,
  paletteWarning,
  persistenceUnavailable,
  attentionRequested = false,
  onAttentionHandled,
  onUseAutomatic,
  onUseSavedTitle,
  onSaveCustomTitle,
  onDeleteCustomTitle,
  onColorChange,
  onReloadColors,
  onReset,
}: CalendarEventSettingsProps) {
  const [creatingTitle, setCreatingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [loginHighlightVisible, setLoginHighlightVisible] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const highlightTimeoutRef = useRef<number | undefined>(undefined);
  const attentionHandledRef = useRef(false);
  const selectedColor = selectedGoogleEventColor(colors, preferences.googleColorId);
  const hasOmsz = events.some((event) => event.summary === 'OMSZ');
  const hasKmr = events.some((event) => event.summary === 'KMR');
  const previewTitle =
    events.length > 0 ? resolveCalendarEventTitle(events[0] as CalendarEvent, preferences) : '';
  const normalizedDraft = normalizedCustomEventTitle(draftTitle);
  const duplicateTitle = savedCustomTitles.some(
    (title) => title.toLocaleLowerCase('hu-HU') === normalizedDraft.toLocaleLowerCase('hu-HU'),
  );
  const draftError =
    normalizedDraft === ''
      ? 'Az egyéni eseménynév nem lehet üres.'
      : duplicateTitle
        ? 'Ez az eseménynév már szerepel a mentett megnevezések között.'
        : undefined;
  const selectValue = creatingTitle
    ? NEW_CUSTOM_VALUE
    : preferences.titleMode === 'custom'
      ? `${SAVED_PREFIX}${preferences.customTitle}`
      : AUTOMATIC_VALUE;

  useEffect(() => {
    if (preferences.titleMode === 'automatic') {
      setCreatingTitle(false);
      setDraftTitle('');
      setSaveAttempted(false);
    }
  }, [preferences.titleMode]);

  useEffect(() => {
    if (!attentionRequested) {
      attentionHandledRef.current = false;
      return;
    }
    if (attentionHandledRef.current) return;
    attentionHandledRef.current = true;

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    sectionRef.current?.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'start',
    });
    headingRef.current?.focus({ preventScroll: true });
    window.clearTimeout(highlightTimeoutRef.current);
    setLoginHighlightVisible(true);
    highlightTimeoutRef.current = window.setTimeout(() => {
      setLoginHighlightVisible(false);
    }, 2600);
    onAttentionHandled?.();
  }, [attentionRequested, onAttentionHandled]);

  useEffect(
    () => () => {
      window.clearTimeout(highlightTimeoutRef.current);
    },
    [],
  );

  const cancelNewTitle = () => {
    setCreatingTitle(false);
    setDraftTitle('');
    setSaveAttempted(false);
  };

  const saveNewTitle = () => {
    setSaveAttempted(true);
    if (draftError) return;
    onSaveCustomTitle(normalizedDraft);
    setCreatingTitle(false);
    setDraftTitle('');
    setSaveAttempted(false);
  };

  return (
    <section
      ref={sectionRef}
      className={`panel calendar-event-settings workflow-section${
        loginHighlightVisible ? ' is-login-highlighted' : ''
      }`}
      aria-labelledby="calendar-settings-heading"
    >
      <div className="section-heading settings-heading">
        <div>
          <span className="eyebrow">Export megjelenése</span>
          <h2 ref={headingRef} id="calendar-settings-heading" tabIndex={-1}>
            Naptáresemény beállításai
          </h2>
        </div>
        <button type="button" className="button tertiary-outline" onClick={onReset}>
          Alapértékek visszaállítása
        </button>
      </div>

      {loginHighlightVisible && (
        <p className="notice success calendar-settings-login-notice" role="status">
          Bejelentkezés sikeres. A feltöltés előtt itt állíthatod be a naptáresemény nevét és
          színét.
        </p>
      )}

      <div className="calendar-settings-grid">
        <div className="calendar-title-settings">
          <label>
            Esemény neve
            <select
              value={selectValue}
              onChange={(event) => {
                const value = event.target.value;
                setSaveAttempted(false);
                if (value === AUTOMATIC_VALUE) {
                  cancelNewTitle();
                  onUseAutomatic();
                } else if (value === NEW_CUSTOM_VALUE) {
                  setCreatingTitle(true);
                  setDraftTitle('');
                } else if (value.startsWith(SAVED_PREFIX)) {
                  cancelNewTitle();
                  onUseSavedTitle(value.slice(SAVED_PREFIX.length));
                }
              }}
            >
              <option value={AUTOMATIC_VALUE}>Automatikus – OMSZ vagy KMR</option>
              {savedCustomTitles.map((title) => (
                <option key={title.toLocaleLowerCase('hu-HU')} value={`${SAVED_PREFIX}${title}`}>
                  {title}
                </option>
              ))}
              <option value={NEW_CUSTOM_VALUE}>Új egyéni megnevezés…</option>
            </select>
          </label>

          {creatingTitle && (
            <div className="new-custom-title">
              <label>
                Egyéni eseménynév
                <input
                  type="text"
                  value={draftTitle}
                  maxLength={MAX_CUSTOM_EVENT_TITLE_LENGTH}
                  aria-invalid={saveAttempted && Boolean(draftError)}
                  aria-describedby={
                    saveAttempted && draftError ? 'custom-event-title-error' : undefined
                  }
                  onChange={(event) => {
                    setDraftTitle(limitCustomEventTitle(event.target.value));
                    setSaveAttempted(false);
                  }}
                  placeholder="Például: Szolgálat"
                />
                <small>
                  {[...draftTitle].length} / {MAX_CUSTOM_EVENT_TITLE_LENGTH} karakter
                </small>
              </label>
              {saveAttempted && draftError && (
                <p id="custom-event-title-error" className="field-error" role="alert">
                  {draftError}
                </p>
              )}
              <div className="compact-button-row">
                <button type="button" className="button secondary" onClick={saveNewTitle}>
                  Mentés és használat
                </button>
                <button type="button" className="button text" onClick={cancelNewTitle}>
                  Mégse
                </button>
              </div>
            </div>
          )}

          {savedCustomTitles.length > 0 && (
            <details className="saved-title-manager">
              <summary>Mentett egyéni megnevezések kezelése</summary>
              <ul>
                {savedCustomTitles.map((title) => (
                  <li key={title.toLocaleLowerCase('hu-HU')}>
                    <span>{title}</span>
                    <button
                      type="button"
                      className="button tertiary-outline saved-title-delete"
                      aria-label={`${title} megnevezés törlése`}
                      onClick={() => {
                        if (window.confirm('Biztosan törlöd ezt az eseménynevet?')) {
                          onDeleteCustomTitle(title);
                        }
                      }}
                    >
                      Törlés
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {persistenceUnavailable && (
            <p className="notice neutral" role="status">
              A fiókhoz tartozó tartós beállítástárolás nem érhető el, ezért az eseménynevek és a
              színválasztás csak ebben a munkamenetben maradnak meg.
            </p>
          )}
        </div>

        <fieldset className="calendar-color-settings">
          <legend>Google Naptár eseményszíne</legend>
          <div className="color-options">
            {colors.map((color) => {
              const selected = color.colorId === preferences.googleColorId;
              const unknownOrdinal =
                color.label === 'Egyéb szín'
                  ? colors
                      .filter((candidate) => candidate.label === 'Egyéb szín')
                      .findIndex((candidate) => candidate.colorId === color.colorId) + 1
                  : undefined;
              const accessibleName =
                unknownOrdinal === undefined ? color.label : `Egyéb szín ${unknownOrdinal}`;
              return (
                <label
                  className={`color-option${selected ? ' is-selected' : ''}`}
                  key={color.colorId}
                >
                  <input
                    type="radio"
                    name="google-event-color"
                    value={color.colorId}
                    checked={selected}
                    aria-label={`${accessibleName} eseményszín kiválasztása${
                      selected ? ', kiválasztva' : ''
                    }`}
                    onChange={() => onColorChange(color.colorId)}
                  />
                  <span
                    className="color-swatch color-swatch-preview"
                    aria-hidden="true"
                    style={{
                      backgroundColor: color.background,
                      color: color.foreground,
                    }}
                  >
                    {selected ? '✓' : ''}
                  </span>
                  <span>{color.label}</span>
                </label>
              );
            })}
          </div>
          {paletteWarning && (
            <div className="notice warning color-palette-warning" role="status">
              <p>{paletteWarning}</p>
              <button type="button" className="button tertiary-outline" onClick={onReloadColors}>
                Színek újratöltése
              </button>
            </div>
          )}
        </fieldset>
      </div>

      <div className="calendar-preview" aria-live="polite">
        <h3>Naptárban így jelenik meg</h3>
        {events.length === 0 ? (
          <p className="muted">Jelölj ki legalább egy exportálható eseményt az előnézethez.</p>
        ) : preferences.titleMode === 'automatic' && hasOmsz && hasKmr ? (
          <div className="preview-titles">
            <p>
              Normál szolgálat: <strong>OMSZ</strong>
            </p>
            <p>
              KMR-szolgálat: <strong>KMR</strong>
            </p>
          </div>
        ) : (
          <p className="preview-event-title">
            <strong>{previewTitle}</strong>
          </p>
        )}
        <p className="preview-color">
          <span
            className="color-swatch color-swatch-preview"
            aria-hidden="true"
            style={{
              backgroundColor: selectedColor.background,
              color: selectedColor.foreground,
            }}
          >
            ✓
          </span>
          {selectedColor.label}
        </p>
      </div>
    </section>
  );
}
