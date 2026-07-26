import { describe, expect, it } from 'vitest';
import type { CalendarEvent, CalendarExportPreferences } from '../src/domain/types';
import {
  DEFAULT_CALENDAR_EXPORT_PREFERENCES,
  MAX_CUSTOM_EVENT_TITLE_LENGTH,
  calendarExportPreferencesError,
  createDefaultCalendarExportPreferences,
  limitCustomEventTitle,
  resolveCalendarEventTitle,
  selectedGoogleEventColor,
} from '../src/services/calendarExportPreferences';

const omszEvent: CalendarEvent = {
  id: 'omsz-event',
  summary: 'OMSZ',
  shiftType: 'Nappalos 07–19',
  serviceCategory: 'Parti szolgálat',
  shiftTime: { start: '2026-08-10T07:00:00', end: '2026-08-10T19:00:00' },
  calendarTime: { start: '2026-08-10T07:00:00', end: '2026-08-10T19:00:00' },
  timeZone: 'Europe/Budapest',
};

const kmrEvent: CalendarEvent = {
  ...omszEvent,
  id: 'kmr-event',
  summary: 'KMR',
  shiftType: 'KMR',
  serviceCategory: 'KMR',
};

function preferences(
  titleMode: CalendarExportPreferences['titleMode'],
  customTitle = '',
): CalendarExportPreferences {
  return { titleMode, customTitle, googleColorId: '10' };
}

describe('naptárexport-beállítások', () => {
  it('automatikus OMSZ/KMR címmel és Basil 10 színnel indul', () => {
    const defaults = createDefaultCalendarExportPreferences();

    expect(defaults).toEqual({
      titleMode: 'automatic',
      customTitle: '',
      googleColorId: '10',
    });
    expect(resolveCalendarEventTitle(omszEvent, defaults)).toBe('OMSZ');
    expect(resolveCalendarEventTitle(kmrEvent, defaults)).toBe('KMR');
  });

  it('a mentett egyéni cím minden természetes eseménycímet felülír', () => {
    const custom = preferences('custom', 'Saját szolgálat');
    expect(resolveCalendarEventTitle(omszEvent, custom)).toBe('Saját szolgálat');
    expect(resolveCalendarEventTitle(kmrEvent, custom)).toBe('Saját szolgálat');
  });

  it('az egyéni címet levágja a szélső szóközökről', () => {
    expect(resolveCalendarEventTitle(omszEvent, preferences('custom', '  Saját szolgálat  '))).toBe(
      'Saját szolgálat',
    );
  });

  it('az üres és csak szóközt tartalmazó egyéni címet hibásnak jelzi', () => {
    expect(calendarExportPreferencesError(preferences('custom'))).toBe(
      'Az egyéni eseménynév nem lehet üres.',
    );
    expect(calendarExportPreferencesError(preferences('custom', '   '))).toBe(
      'Az egyéni eseménynév nem lehet üres.',
    );
  });

  it('Unicode-karakterenként legfeljebb 80 karakterre korlátoz', () => {
    const value = `🚑${'á'.repeat(MAX_CUSTOM_EVENT_TITLE_LENGTH)}`;
    const limited = limitCustomEventTitle(value);

    expect([...limited]).toHaveLength(MAX_CUSTOM_EVENT_TITLE_LENGTH);
    expect(limited.startsWith('🚑')).toBe(true);
  });

  it('a 80 karakternél hosszabb közvetlen modellértéket is hibásnak jelzi', () => {
    expect(
      calendarExportPreferencesError(
        preferences('custom', 'a'.repeat(MAX_CUSTOM_EVENT_TITLE_LENGTH + 1)),
      ),
    ).toBe('Az egyéni eseménynév legfeljebb 80 karakter lehet.');
  });

  it('ismeretlen Google colorId mellett is típusos, megjeleníthető tartalék színt ad', () => {
    expect(selectedGoogleEventColor([], '42')).toEqual({
      colorId: '42',
      background: '#5F6368',
      foreground: '#FFFFFF',
      label: 'Egyéb szín',
    });
  });

  it('az alapértelmezett objektumot nem módosítja a létrehozott példány átírása', () => {
    const defaults = createDefaultCalendarExportPreferences();
    defaults.titleMode = 'custom';

    expect(DEFAULT_CALENDAR_EXPORT_PREFERENCES.titleMode).toBe('automatic');
  });
});
