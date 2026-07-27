import type {
  CalendarEvent,
  CalendarExportPreferences,
  GoogleEventColorOption,
} from '../domain/types';

export const MAX_CUSTOM_EVENT_TITLE_LENGTH = 80;

export const DEFAULT_GOOGLE_EVENT_COLOR: GoogleEventColorOption = {
  colorId: '10',
  background: '#51B749',
  foreground: '#FFFFFF',
  label: 'Sötétzöld',
};

const GOOGLE_EVENT_COLOR_LABELS: Record<string, string> = {
  '1': 'Levendula',
  '2': 'Zsályazöld',
  '3': 'Lila',
  '4': 'Rózsaszín',
  '5': 'Sárga',
  '6': 'Narancssárga',
  '7': 'Türkiz',
  '8': 'Grafitszürke',
  '9': 'Kék',
  '10': DEFAULT_GOOGLE_EVENT_COLOR.label,
  '11': 'Piros',
};

export const DEFAULT_CALENDAR_EXPORT_PREFERENCES: CalendarExportPreferences = {
  titleMode: 'automatic',
  customTitle: '',
  googleColorId: DEFAULT_GOOGLE_EVENT_COLOR.colorId,
};

export const GOOGLE_COLOR_FALLBACK_WARNING =
  'A Google teljes színpalettája nem tölthető be. Az alapértelmezett sötétzöld színt használjuk.';

export const GOOGLE_COLOR_DEFAULT_MISSING_WARNING =
  'A Google színpalettája nem tartalmazza az alapértelmezett sötétzöld színt. Az első elérhető eseményszínt használjuk.';

export function createDefaultCalendarExportPreferences(): CalendarExportPreferences {
  return { ...DEFAULT_CALENDAR_EXPORT_PREFERENCES };
}

export function googleEventColorLabel(colorId: string): string {
  return GOOGLE_EVENT_COLOR_LABELS[colorId] ?? 'Egyéb szín';
}

export function limitCustomEventTitle(value: string): string {
  return [...value].slice(0, MAX_CUSTOM_EVENT_TITLE_LENGTH).join('');
}

export function normalizedCustomEventTitle(value: string): string {
  return value.trim();
}

export function calendarExportPreferencesError(
  preferences: CalendarExportPreferences,
): string | undefined {
  if (preferences.titleMode !== 'custom') return undefined;
  const title = normalizedCustomEventTitle(preferences.customTitle);
  if (title === '') return 'Az egyéni eseménynév nem lehet üres.';
  if ([...title].length > MAX_CUSTOM_EVENT_TITLE_LENGTH) {
    return `Az egyéni eseménynév legfeljebb ${MAX_CUSTOM_EVENT_TITLE_LENGTH} karakter lehet.`;
  }
  return undefined;
}

export function resolveCalendarEventTitle(
  event: CalendarEvent,
  preferences: CalendarExportPreferences,
): string {
  const title =
    preferences.titleMode === 'custom'
      ? normalizedCustomEventTitle(preferences.customTitle)
      : event.summary;
  const suffix = event.roleAssignment?.titleSuffix;
  return suffix ? `${title} - ${suffix}` : title;
}

export function selectedGoogleEventColor(
  colors: GoogleEventColorOption[],
  colorId: string,
): GoogleEventColorOption {
  return (
    colors.find((color) => color.colorId === colorId) ??
    (colorId === DEFAULT_GOOGLE_EVENT_COLOR.colorId
      ? DEFAULT_GOOGLE_EVENT_COLOR
      : {
          colorId,
          background: '#5F6368',
          foreground: '#FFFFFF',
          label: googleEventColorLabel(colorId),
        })
  );
}
