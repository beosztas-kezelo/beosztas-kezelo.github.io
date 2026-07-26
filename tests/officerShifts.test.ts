import { describe, expect, it } from 'vitest';
import type { CellDiagnostic, DayEntry } from '../src/domain/types';
import { interpretSchedule } from '../src/services/shifts';

function entry(
  year: number,
  month: number,
  day: number,
  marker: string,
  fontColor = '#000000',
  positionInDayGroup = 1,
): DayEntry {
  const diagnostic: CellDiagnostic = {
    address: `${positionInDayGroup === 1 ? 'C' : 'D'}${day + 4}`,
    rawValue: marker,
    displayedText: marker,
    isMerged: false,
    positionInDayGroup,
    fontColor,
    underline: fontColor === '#008000',
    italic: false,
    bold: false,
  };
  return {
    date: { year, month, day },
    group: { day, startColumn: 3, endColumn: 4, valid: true },
    kind: marker ? 'single' : 'empty',
    marker,
    normalizedMarker: marker.toLocaleLowerCase('hu-HU'),
    diagnostics: marker ? [diagnostic] : [],
    selectedDiagnostic: marker ? diagnostic : undefined,
  };
}

function sevenFive(year: number, month: number, day: number): DayEntry {
  const closing = entry(year, month, day, '7').diagnostics[0];
  const starting = entry(year, month, day, '5', '#000000', 2).diagnostics[0];
  if (!closing || !starting) throw new Error('Hiányzó tesztdiagnosztika.');
  return {
    date: { year, month, day },
    group: { day, startColumn: 3, endColumn: 4, valid: true },
    kind: 'double',
    marker: '7 / 5',
    normalizedMarker: '',
    diagnostics: [closing, starting],
  };
}

describe('mentőtiszti műszakértelmezés', () => {
  it.each(['#000000', '#FF0000'])(
    'a %s betűszínű 12 Esetszolgálat 07:00–19:00',
    (fontColor) => {
      const result = interpretSchedule(
        [entry(2026, 8, 1, '12', fontColor)],
        { role: 'officer' },
      );

      expect(result.events[0]).toMatchObject({
        summary: 'OMSZ',
        shiftType: 'Nappalos 07–19',
        serviceCategory: 'Esetszolgálat',
        calendarTime: {
          start: '2026-08-01T07:00:00',
          end: '2026-08-01T19:00:00',
        },
      });
    },
  );

  it('a fekete 17–7 24 órás Esetszolgálat', () => {
    const result = interpretSchedule(
      [entry(2026, 8, 1, '17'), entry(2026, 8, 2, '7')],
      { role: 'officer' },
    );

    expect(result.events[0]).toMatchObject({
      shiftType: '24 órás szolgálat',
      serviceCategory: 'Esetszolgálat',
      shiftTime: {
        start: '2026-08-01T07:00:00',
        end: '2026-08-02T07:00:00',
      },
      calendarTime: {
        start: '2026-08-01T07:00:00',
        end: '2026-08-02T06:59:00',
      },
    });
  });

  it('a fekete 5–7 éjszakai Esetszolgálat', () => {
    const result = interpretSchedule(
      [entry(2026, 8, 1, '5'), entry(2026, 8, 2, '7')],
      { role: 'officer' },
    );

    expect(result.events[0]).toMatchObject({
      shiftType: 'Éjszakai szolgálat',
      serviceCategory: 'Esetszolgálat',
      calendarTime: {
        start: '2026-08-01T19:00:00',
        end: '2026-08-02T07:00:00',
      },
    });
  });

  it('a január 1-jei fekete 7 részleges Esetszolgálat', () => {
    const result = interpretSchedule(
      [entry(2027, 1, 1, '7')],
      { role: 'officer' },
    );

    expect(result.events[0]).toMatchObject({
      shiftType: 'Előző hónapról áthúzódó szolgálat',
      serviceCategory: 'Esetszolgálat',
      calendarTime: {
        start: '2027-01-01T00:00:00',
        end: '2027-01-01T06:59:00',
      },
    });
  });

  it.each([
    ['17', '24 órás szolgálat', '07:00:00'],
    ['5', 'Éjszakai szolgálat', '19:00:00'],
  ] as const)(
    'a hónapvégi fekete %s feltételezett 7-tel Esetszolgálat',
    (marker, shiftType, startTime) => {
      const result = interpretSchedule(
        [entry(2026, 12, 31, marker)],
        { role: 'officer' },
      );

      expect(result.events[0]).toMatchObject({
        shiftType,
        serviceCategory: 'Esetszolgálat',
        calendarTime: {
          start: `2026-12-31T${startTime}`,
          end: '2027-01-01T06:59:00',
        },
      });
    },
  );

  it('a 7 / 5 kettős nap mindkét szolgálatát Esetszolgálatként értelmezi', () => {
    const result = interpretSchedule(
      [
        entry(2026, 8, 1, '5'),
        sevenFive(2026, 8, 2),
        entry(2026, 8, 3, '7'),
      ],
      { role: 'officer' },
    );

    expect(result.events).toHaveLength(2);
    expect(result.events.every((event) => event.serviceCategory === 'Esetszolgálat')).toBe(true);
  });

  it.each(['#0000FF', '#008000'])(
    'a %s színű tiszti 12 bizonytalan és nem exportálható',
    (fontColor) => {
      const result = interpretSchedule(
        [entry(2026, 8, 1, '12', fontColor)],
        { role: 'officer' },
      );

      expect(result.events).toHaveLength(0);
      expect(result.rows[0]).toMatchObject({
        status: 'Bizonytalan',
      });
      expect(result.rows[0]?.note).toContain('mentőtiszti munkakörben nem támogatott');
    },
  );

  it('tiszti beosztásból nem készül Parti, 6-os, 10-es vagy KMR esemény', () => {
    const result = interpretSchedule(
      [
        entry(2026, 8, 1, '12'),
        entry(2026, 8, 2, '12', '#0000FF'),
        entry(2026, 8, 3, '12', '#008000'),
        entry(2026, 8, 4, 'KMR'),
      ],
      { role: 'officer' },
    );

    expect(result.events.map((event) => event.serviceCategory)).toEqual([
      'Esetszolgálat',
    ]);
    expect(result.rows.slice(1).every((row) => row.status === 'Bizonytalan')).toBe(true);
  });
});
