import type {
  CalendarEventTitleMode,
  CalendarExportPreferences,
} from '../domain/types';
import {
  DEFAULT_GOOGLE_EVENT_COLOR,
  MAX_CUSTOM_EVENT_TITLE_LENGTH,
  normalizedCustomEventTitle,
} from './calendarExportPreferences';

const STORAGE_PREFIX = 'beosztas-kezelo:calendar-export-preferences:v1';
export const MAX_SAVED_CUSTOM_TITLES = 20;

export interface StoredCalendarExportPreferences {
  savedCustomTitles: string[];
  lastSelectedTitleMode: CalendarEventTitleMode;
  lastSelectedCustomTitle: string;
  lastSelectedGoogleColorId: string;
}

export function hashGoogleAccountIdentifier(accountIdentifier: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const character of accountIdentifier) {
    const codePoint = character.codePointAt(0) ?? 0;
    first ^= codePoint;
    first = Math.imul(first, 0x01000193);
    second ^= codePoint + 0x9e3779b9 + (second << 6) + (second >>> 2);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

export function accountPreferenceStorageKey(accountHash: string): string {
  return `${STORAGE_PREFIX}:${accountHash}`;
}

export function defaultStoredCalendarExportPreferences(): StoredCalendarExportPreferences {
  return {
    savedCustomTitles: [],
    lastSelectedTitleMode: 'automatic',
    lastSelectedCustomTitle: '',
    lastSelectedGoogleColorId: DEFAULT_GOOGLE_EVENT_COLOR.colorId,
  };
}

function normalizedSavedTitles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const titles: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string') continue;
    const title = normalizedCustomEventTitle(candidate);
    const normalized = title.toLocaleLowerCase('hu-HU');
    if (
      title === '' ||
      [...title].length > MAX_CUSTOM_EVENT_TITLE_LENGTH ||
      seen.has(normalized)
    ) {
      continue;
    }
    seen.add(normalized);
    titles.push(title);
    if (titles.length === MAX_SAVED_CUSTOM_TITLES) break;
  }
  return titles;
}

export function loadStoredCalendarExportPreferences(
  accountHash: string,
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): StoredCalendarExportPreferences {
  const defaults = defaultStoredCalendarExportPreferences();
  try {
    const raw = storage.getItem(accountPreferenceStorageKey(accountHash));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return defaults;
    const value = parsed as Record<string, unknown>;
    const savedCustomTitles = normalizedSavedTitles(value.savedCustomTitles);
    const requestedMode = value.lastSelectedTitleMode === 'custom' ? 'custom' : 'automatic';
    const requestedTitle =
      typeof value.lastSelectedCustomTitle === 'string'
        ? normalizedCustomEventTitle(value.lastSelectedCustomTitle)
        : '';
    const matchingTitle =
      savedCustomTitles.find(
        (title) =>
          title.toLocaleLowerCase('hu-HU') ===
          requestedTitle.toLocaleLowerCase('hu-HU'),
      ) ?? '';
    return {
      savedCustomTitles,
      lastSelectedTitleMode:
        requestedMode === 'custom' && matchingTitle ? 'custom' : 'automatic',
      lastSelectedCustomTitle: matchingTitle,
      lastSelectedGoogleColorId:
        typeof value.lastSelectedGoogleColorId === 'string' &&
        value.lastSelectedGoogleColorId.trim() !== ''
          ? value.lastSelectedGoogleColorId
          : defaults.lastSelectedGoogleColorId,
    };
  } catch {
    return defaults;
  }
}

export function saveStoredCalendarExportPreferences(
  accountHash: string,
  value: StoredCalendarExportPreferences,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
): boolean {
  try {
    storage.setItem(
      accountPreferenceStorageKey(accountHash),
      JSON.stringify({
        savedCustomTitles: normalizedSavedTitles(value.savedCustomTitles),
        lastSelectedTitleMode: value.lastSelectedTitleMode,
        lastSelectedCustomTitle: normalizedCustomEventTitle(
          value.lastSelectedCustomTitle,
        ),
        lastSelectedGoogleColorId: value.lastSelectedGoogleColorId,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function preferencesFromStored(
  value: StoredCalendarExportPreferences,
): CalendarExportPreferences {
  return {
    titleMode: value.lastSelectedTitleMode,
    customTitle:
      value.lastSelectedTitleMode === 'custom'
        ? value.lastSelectedCustomTitle
        : '',
    googleColorId: value.lastSelectedGoogleColorId,
  };
}

export function moveSavedTitleToFront(
  savedTitles: string[],
  requestedTitle: string,
): string[] {
  const title = normalizedCustomEventTitle(requestedTitle);
  const normalized = title.toLocaleLowerCase('hu-HU');
  return [
    title,
    ...savedTitles.filter(
      (candidate) => candidate.toLocaleLowerCase('hu-HU') !== normalized,
    ),
  ].slice(0, MAX_SAVED_CUSTOM_TITLES);
}
