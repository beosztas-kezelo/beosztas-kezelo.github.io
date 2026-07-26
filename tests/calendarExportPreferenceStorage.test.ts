import { describe, expect, it } from 'vitest';
import {
  MAX_SAVED_CUSTOM_TITLES,
  accountPreferenceStorageKey,
  defaultStoredCalendarExportPreferences,
  hashGoogleAccountIdentifier,
  loadStoredCalendarExportPreferences,
  moveSavedTitleToFront,
  preferencesFromStored,
  saveStoredCalendarExportPreferences,
} from '../src/services/calendarExportPreferenceStorage';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    values,
  };
}

describe('fiókonkénti naptárexport-beállítások tárolása', () => {
  it('az elsődleges naptárazonosítót nem írja a localStorage-kulcsba', () => {
    const identifier = 'szemelyes-fiok@example.com';
    const hash = hashGoogleAccountIdentifier(identifier);

    expect(hash).not.toContain(identifier);
    expect(accountPreferenceStorageKey(hash)).toBe(
      `beosztas-kezelo:calendar-export-preferences:v1:${hash}`,
    );
  });

  it('külön Google-fiókokhoz külön értékeket tárol és tölt vissza', () => {
    const storage = memoryStorage();
    const firstHash = hashGoogleAccountIdentifier('first@example.com');
    const secondHash = hashGoogleAccountIdentifier('second@example.com');
    saveStoredCalendarExportPreferences(
      firstHash,
      {
        savedCustomTitles: ['Első név'],
        lastSelectedTitleMode: 'custom',
        lastSelectedCustomTitle: 'Első név',
        lastSelectedGoogleColorId: '9',
      },
      storage,
    );
    saveStoredCalendarExportPreferences(
      secondHash,
      {
        savedCustomTitles: ['Második név'],
        lastSelectedTitleMode: 'custom',
        lastSelectedCustomTitle: 'Második név',
        lastSelectedGoogleColorId: '2',
      },
      storage,
    );

    expect(loadStoredCalendarExportPreferences(firstHash, storage)).toMatchObject({
      savedCustomTitles: ['Első név'],
      lastSelectedGoogleColorId: '9',
    });
    expect(loadStoredCalendarExportPreferences(secondHash, storage)).toMatchObject({
      savedCustomTitles: ['Második név'],
      lastSelectedGoogleColorId: '2',
    });
  });

  it('a legutóbb használt nevet előre teszi, kis- és nagybetűsen sem duplikálja', () => {
    expect(moveSavedTitleToFront(['Első', 'Második'], 'első')).toEqual([
      'első',
      'Második',
    ]);
  });

  it('legfeljebb húsz egyéni nevet őriz meg', () => {
    const titles = Array.from(
      { length: MAX_SAVED_CUSTOM_TITLES + 4 },
      (_, index) => `Név ${index}`,
    );
    const storage = memoryStorage();
    const hash = hashGoogleAccountIdentifier('limit@example.com');

    saveStoredCalendarExportPreferences(
      hash,
      {
        ...defaultStoredCalendarExportPreferences(),
        savedCustomTitles: titles,
      },
      storage,
    );

    expect(loadStoredCalendarExportPreferences(hash, storage).savedCustomTitles).toHaveLength(
      MAX_SAVED_CUSTOM_TITLES,
    );
  });

  it('sérült vagy hiányos tárolt adatnál biztonságos alapértékre áll vissza', () => {
    const storage = memoryStorage();
    const hash = hashGoogleAccountIdentifier('broken@example.com');
    storage.setItem(accountPreferenceStorageKey(hash), '{hibás json');

    expect(loadStoredCalendarExportPreferences(hash, storage)).toEqual(
      defaultStoredCalendarExportPreferences(),
    );
  });

  it('a tárolt automatikus módot és színt exportpreferenciává alakítja', () => {
    expect(
      preferencesFromStored({
        savedCustomTitles: ['Másik'],
        lastSelectedTitleMode: 'automatic',
        lastSelectedCustomTitle: '',
        lastSelectedGoogleColorId: '10',
      }),
    ).toEqual({
      titleMode: 'automatic',
      customTitle: '',
      googleColorId: '10',
    });
  });
});
