import { describe, expect, it } from 'vitest';
import type {
  CalendarEvent,
  CrewRoleSource,
  EventTimeRange,
  InterpretedEmployeeSchedule,
  ServiceCategory,
  ShiftType,
  StaffRole,
} from '../src/domain/types';
import {
  attachCrewMatches,
  matchCrewMembers,
  overlappingRange,
} from '../src/services/crewMatching';

function calendarEvent(
  id: string,
  serviceCategory: ServiceCategory,
  start: string,
  end: string,
  shiftType: ShiftType = 'Nappalos 07–19',
): CalendarEvent {
  return {
    id,
    summary: serviceCategory === 'KMR' ? 'KMR' : 'OMSZ',
    shiftType,
    serviceCategory,
    shiftTime: { start, end },
    calendarTime: { start, end },
    timeZone: 'Europe/Budapest',
  };
}

function schedule(
  role: StaffRole,
  name: string,
  row: number,
  events: CalendarEvent[],
  showRowIdentifier = false,
): InterpretedEmployeeSchedule {
  return {
    role,
    employeeName: name,
    normalizedName: name.toLocaleLowerCase('hu-HU'),
    employeeRow: row,
    showRowIdentifier,
    result: {
      events,
      rows: events.map((event) => ({
        id: `${row}-${event.id}`,
        date: {
          year: Number(event.calendarTime.start.slice(0, 4)),
          month: Number(event.calendarTime.start.slice(5, 7)),
          day: Number(event.calendarTime.start.slice(8, 10)),
        },
        marker: '12',
        shiftType: event.shiftType,
        serviceCategory: event.serviceCategory,
        summary: event.summary,
        status: 'Exportálható',
        note: 'Teszt',
        diagnostics: [],
        event,
      })),
      summary: {
        recognized: events.length,
        omsz: events.filter((event) => event.summary === 'OMSZ').length,
        kmr: events.filter((event) => event.summary === 'KMR').length,
        uncertain: 0,
        invalid: 0,
        exportable: events.length,
      },
    },
  };
}

function available(
  role: StaffRole,
  employees: InterpretedEmployeeSchedule[],
): CrewRoleSource {
  return { role, status: 'available', employees };
}

function range(start: string, end: string): EventTimeRange {
  return { start, end };
}

const DAY_START = '2026-08-10T07:00:00';
const DAY_END = '2026-08-10T19:00:00';

describe('szolgálati társak idő- és kategóriaalapú párosítása', () => {
  it('Parti gépkocsivezetőt teljes időegyezéssel Parti ápolóval párosít', () => {
    const primary = schedule('driver', 'Vezető Vince', 5, [
      calendarEvent('primary', 'Parti szolgálat', DAY_START, DAY_END),
    ]);
    const crew = matchCrewMembers(primary, [
      available('nurse', [
        schedule('nurse', 'Ápoló Anna', 7, [
          calendarEvent('nurse', 'Parti szolgálat', DAY_START, DAY_END),
        ]),
      ]),
    ]);

    expect(crew.matchesByEventId.get('primary')).toEqual([
      expect.objectContaining({
        role: 'nurse',
        employeeName: 'Ápoló Anna',
        overlap: { start: DAY_START, end: DAY_END },
      }),
    ]);
  });

  it('Esetszolgálatnál ápolót és tisztet is párosít, Parti szolgálatnál tisztet nem', () => {
    const emergency = calendarEvent('emergency', 'Esetszolgálat', DAY_START, DAY_END);
    const party = calendarEvent('party', 'Parti szolgálat', DAY_START, DAY_END);
    const primary = schedule('driver', 'Vezető Vince', 5, [emergency, party]);
    const crew = matchCrewMembers(primary, [
      available('nurse', [
        schedule('nurse', 'Ápoló Anna', 7, [
          calendarEvent('nurse-emergency', 'Esetszolgálat', DAY_START, DAY_END),
          calendarEvent('nurse-party', 'Parti szolgálat', DAY_START, DAY_END),
        ]),
      ]),
      available('officer', [
        schedule('officer', 'Tiszt Tímea', 9, [
          calendarEvent('officer', 'Esetszolgálat', DAY_START, DAY_END),
        ]),
      ]),
    ]);

    expect(crew.matchesByEventId.get('emergency')?.map((match) => match.role)).toEqual([
      'nurse',
      'officer',
    ]);
    expect(crew.matchesByEventId.get('party')?.map((match) => match.role)).toEqual([
      'nurse',
    ]);
  });

  it('ápoló Esetszolgálatához vezetőt és tisztet, tisztéhez vezetőt és ápolót keres', () => {
    const shared = calendarEvent('shared', 'Esetszolgálat', DAY_START, DAY_END);
    const driver = schedule('driver', 'Vezető Vince', 5, [
      { ...shared, id: 'driver' },
    ]);
    const nurse = schedule('nurse', 'Ápoló Anna', 7, [
      { ...shared, id: 'nurse' },
    ]);
    const officer = schedule('officer', 'Tiszt Tímea', 9, [
      { ...shared, id: 'officer' },
    ]);
    const otherOfficer = schedule('officer', 'Másik Tiszt', 11, [
      { ...shared, id: 'other-officer' },
    ]);

    expect(
      matchCrewMembers(nurse, [
        available('driver', [driver]),
        available('officer', [officer]),
      ]).matchesByEventId.get('nurse')?.map((match) => match.role),
    ).toEqual(['driver', 'officer']);
    expect(
      matchCrewMembers(officer, [
        available('driver', [driver]),
        available('nurse', [nurse]),
        available('officer', [otherOfficer]),
      ]).matchesByEventId.get('officer')?.map((match) => match.role),
    ).toEqual(['driver', 'nurse']);
  });

  it.each([
    ['6-os kocsi', 'Nappalos 06–18'] as const,
    ['10-es kocsi', 'Nappalos 10–22'] as const,
    ['KMR', 'KMR'] as const,
  ])('%s csak azonos kategóriával párosul', (category, shiftType) => {
    const primary = schedule('driver', 'Vezető Vince', 5, [
      calendarEvent('primary', category, DAY_START, DAY_END, shiftType),
    ]);
    const crew = matchCrewMembers(primary, [
      available('nurse', [
        schedule('nurse', 'Egyező Ápoló', 7, [
          calendarEvent('same', category, DAY_START, DAY_END, shiftType),
        ]),
        schedule('nurse', 'Más Kategória', 9, [
          calendarEvent('other', 'Parti szolgálat', DAY_START, DAY_END),
        ]),
      ]),
    ]);

    expect(crew.matchesByEventId.get('primary')?.map((match) => match.employeeName)).toEqual([
      'Egyező Ápoló',
    ]);
  });

  it('Parti és Esetszolgálat nem párosul, az érintkező intervallum pedig nem átfedés', () => {
    expect(
      overlappingRange(
        range('2026-08-10T07:00:00', '2026-08-10T19:00:00'),
        range('2026-08-10T19:00:00', '2026-08-11T07:00:00'),
      ),
    ).toBeUndefined();
    const primary = schedule('driver', 'Vezető Vince', 5, [
      calendarEvent('primary', 'Parti szolgálat', DAY_START, DAY_END),
    ]);
    const crew = matchCrewMembers(primary, [
      available('nurse', [
        schedule('nurse', 'Ápoló Anna', 7, [
          calendarEvent('emergency', 'Esetszolgálat', DAY_START, DAY_END),
          calendarEvent(
            'touching',
            'Parti szolgálat',
            DAY_END,
            '2026-08-11T07:00:00',
          ),
        ]),
      ]),
    ]);

    expect(crew.matchesByEventId.get('primary')).toEqual([]);
    expect(crew.noticesByEventId.get('primary')).toEqual([
      expect.objectContaining({ kind: 'no-match' }),
    ]);
  });

  it('24 órás szolgálathoz két váltó 12 órás társat, a fordított esetben csak közös időt ad', () => {
    const primary = schedule('driver', 'Vezető Vince', 5, [
      calendarEvent(
        'primary-24',
        'Esetszolgálat',
        '2026-08-10T07:00:00',
        '2026-08-11T06:59:00',
        '24 órás szolgálat',
      ),
    ]);
    const crew = matchCrewMembers(primary, [
      available('nurse', [
        schedule('nurse', 'Nappalos Ápoló', 7, [
          calendarEvent(
            'day',
            'Esetszolgálat',
            '2026-08-10T07:00:00',
            '2026-08-10T19:00:00',
          ),
        ]),
        schedule('nurse', 'Éjszakás Ápoló', 9, [
          calendarEvent(
            'night',
            'Esetszolgálat',
            '2026-08-10T19:00:00',
            '2026-08-11T06:59:00',
          ),
        ]),
      ]),
    ]);

    expect(crew.matchesByEventId.get('primary-24')?.map((match) => match.overlap)).toEqual([
      {
        start: '2026-08-10T07:00:00',
        end: '2026-08-10T19:00:00',
      },
      {
        start: '2026-08-10T19:00:00',
        end: '2026-08-11T06:59:00',
      },
    ]);
    expect(
      crew.noticesByEventId
        .get('primary-24')
        ?.some((notice) => notice.kind === 'multiple-matches'),
    ).toBe(false);

    const twelveHourPrimary = schedule('driver', 'Vezető Vince', 5, [
      calendarEvent('primary-12', 'Esetszolgálat', DAY_START, DAY_END),
    ]);
    const reverse = matchCrewMembers(twelveHourPrimary, [
      available('nurse', [
        schedule('nurse', 'Huszonnégy Ápoló', 7, [
          calendarEvent(
            'nurse-24',
            'Esetszolgálat',
            '2026-08-10T07:00:00',
            '2026-08-11T06:59:00',
            '24 órás szolgálat',
          ),
        ]),
      ]),
    ]);
    expect(reverse.matchesByEventId.get('primary-12')?.[0]?.overlap).toEqual({
      start: DAY_START,
      end: DAY_END,
    });
  });

  it.each([
    [
      'hónaphatáron',
      '2026-08-31T19:00:00',
      '2026-09-01T06:59:00',
    ],
    [
      'évhatáron',
      '2026-12-31T19:00:00',
      '2027-01-01T06:59:00',
    ],
  ])('%s átívelő szolgálatot is párosít', (_name, start, end) => {
    const primary = schedule('driver', 'Vezető Vince', 5, [
      calendarEvent('primary', 'Esetszolgálat', start, end, 'Éjszakai szolgálat'),
    ]);
    const crew = matchCrewMembers(primary, [
      available('nurse', [
        schedule('nurse', 'Ápoló Anna', 7, [
          calendarEvent('nurse', 'Esetszolgálat', start, end, 'Éjszakai szolgálat'),
        ]),
      ]),
    ]);

    expect(crew.matchesByEventId.get('primary')?.[0]?.overlap).toEqual({ start, end });
  });

  it('azonos társat deduplikál, azonos nevű külön sorokat viszont megőriz', () => {
    const primaryEvent = calendarEvent('primary', 'Parti szolgálat', DAY_START, DAY_END);
    const duplicateEvent = calendarEvent('duplicate', 'Parti szolgálat', DAY_START, DAY_END);
    const primary = schedule('driver', 'Vezető Vince', 5, [primaryEvent]);
    const crew = matchCrewMembers(primary, [
      available('nurse', [
        schedule('nurse', 'Azonos Név', 7, [duplicateEvent, duplicateEvent], true),
        schedule('nurse', 'Azonos Név', 9, [duplicateEvent], true),
      ]),
    ]);

    expect(crew.matchesByEventId.get('primary')?.map((match) => match.displayName)).toEqual([
      'Azonos Név (7. sor)',
      'Azonos Név (9. sor)',
    ]);
  });

  it('párhuzamos egyezéseket mind listáz és figyelmeztet', () => {
    const primary = schedule('driver', 'Vezető Vince', 5, [
      calendarEvent('primary', 'Parti szolgálat', DAY_START, DAY_END),
    ]);
    const crew = matchCrewMembers(primary, [
      available('nurse', [
        schedule('nurse', 'Ápoló Anna', 7, [
          calendarEvent('first', 'Parti szolgálat', DAY_START, DAY_END),
        ]),
        schedule('nurse', 'Ápoló Béla', 9, [
          calendarEvent(
            'second',
            'Parti szolgálat',
            DAY_START,
            '2026-08-11T06:59:00',
            '24 órás szolgálat',
          ),
        ]),
      ]),
    ]);

    expect(crew.matchesByEventId.get('primary')).toHaveLength(2);
    expect(crew.noticesByEventId.get('primary')).toContainEqual({
      role: 'nurse',
      kind: 'multiple-matches',
      message: 'Több lehetséges egyező szolgálati társ található.',
    });
  });

  it('hiányzó fájl és hónap, valamint hiányzó egyezés csak tájékoztató értesítés', () => {
    const primary = schedule('driver', 'Vezető Vince', 5, [
      calendarEvent('primary', 'Esetszolgálat', DAY_START, DAY_END),
    ]);
    const crew = matchCrewMembers(primary, [
      { role: 'nurse', status: 'missing-file', employees: [] },
      { role: 'officer', status: 'missing-month', employees: [] },
    ]);
    const attached = attachCrewMatches(primary.result, crew);

    expect(crew.noticesByEventId.get('primary')?.map((notice) => notice.kind)).toEqual([
      'missing-file',
      'missing-month',
    ]);
    expect(attached.events).toHaveLength(1);
    expect(attached.events[0]).toMatchObject({
      crewSearchPerformed: true,
      crewMembers: undefined,
    });
    expect(attached.summary.exportable).toBe(1);
    expect(attached.rows[0]?.status).toBe('Exportálható');
  });

  it('a kiválasztott dolgozó saját nevét nem teszi a társlistába', () => {
    const primary = schedule('driver', 'Közös Név', 5, [
      calendarEvent('primary', 'Parti szolgálat', DAY_START, DAY_END),
    ]);
    const crew = matchCrewMembers(primary, [
      available('nurse', [
        schedule('nurse', 'Közös Név', 7, [
          calendarEvent('same-name', 'Parti szolgálat', DAY_START, DAY_END),
        ]),
      ]),
    ]);

    expect(crew.matchesByEventId.get('primary')).toEqual([]);
  });

  it('driverből ÁP-val ápolóként dolgozó eseményhez drivert és Esetszolgálatnál tisztet keres', () => {
    const redirected = {
      ...calendarEvent('redirected-ap', 'Esetszolgálat', DAY_START, DAY_END),
      effectiveRole: 'nurse' as const,
    };
    const primary = schedule('driver', 'Közös Név', 5, [redirected]);
    const crew = matchCrewMembers(primary, [
      available('driver', [
        schedule('driver', 'Közös Név', 7, [
          calendarEvent('self-driver', 'Esetszolgálat', DAY_START, DAY_END),
        ]),
        schedule('driver', 'Váltó Vezető', 9, [
          calendarEvent('driver-match', 'Esetszolgálat', DAY_START, DAY_END),
        ]),
      ]),
      available('nurse', [
        schedule('nurse', 'Másik Ápoló', 11, [
          calendarEvent('nurse-match', 'Esetszolgálat', DAY_START, DAY_END),
        ]),
      ]),
      available('officer', [
        schedule('officer', 'Tiszt Tímea', 13, [
          calendarEvent('officer-match', 'Esetszolgálat', DAY_START, DAY_END),
        ]),
      ]),
    ]);

    expect(crew.matchesByEventId.get('redirected-ap')?.map((match) => match.role)).toEqual([
      'driver',
      'officer',
    ]);
    expect(
      crew.matchesByEventId
        .get('redirected-ap')
        ?.some((match) => match.normalizedName === 'közös név'),
    ).toBe(false);
  });

  it('nurse-ből GKV-val driverként dolgozó eseményhez ápolót és Esetszolgálatnál tisztet keres', () => {
    const redirected = {
      ...calendarEvent('redirected-gkv', 'Esetszolgálat', DAY_START, DAY_END),
      effectiveRole: 'driver' as const,
    };
    const primary = schedule('nurse', 'Átirányított Anna', 5, [redirected]);
    const crew = matchCrewMembers(primary, [
      available('driver', [
        schedule('driver', 'Másik Vezető', 7, [
          calendarEvent('driver-match', 'Esetszolgálat', DAY_START, DAY_END),
        ]),
      ]),
      available('nurse', [
        schedule('nurse', 'Ápoló Béla', 9, [
          calendarEvent('nurse-match', 'Esetszolgálat', DAY_START, DAY_END),
        ]),
      ]),
      available('officer', [
        schedule('officer', 'Tiszt Tímea', 11, [
          calendarEvent('officer-match', 'Esetszolgálat', DAY_START, DAY_END),
        ]),
      ]),
    ]);

    expect(crew.matchesByEventId.get('redirected-gkv')?.map((match) => match.role)).toEqual([
      'nurse',
      'officer',
    ]);
  });
});
