import { describe, expect, it } from 'vitest';
import type { CalendarEvent, MonthSheet, ServiceCategory, ShiftType } from '../src/domain/types';
import {
  getCrewSearchAvailability,
  hasUsableOfficerSchedule,
  requiresOfficerScheduleWarning,
} from '../src/services/crewSearchAvailability';

function month(year = 2026, monthNumber = 8): MonthSheet {
  return {
    sheetName: 'Augusztus',
    year,
    month: monthNumber,
    headerRow: 4,
    nameColumn: 2,
    dayGroups: [],
    employees: [],
    warnings: [],
    legendStyles: { blue12: [], green12: [] },
  };
}

const august = month();
const augustSession = { months: [august] };
const septemberSession = { months: [month(2026, 9)] };

function event(serviceCategory: ServiceCategory, shiftType: ShiftType): CalendarEvent {
  return {
    id: `${serviceCategory}-${shiftType}`,
    summary: serviceCategory === 'KMR' ? 'KMR' : 'OMSZ',
    serviceCategory,
    shiftType,
    shiftTime: {
      start: '2026-08-01T07:00:00',
      end: '2026-08-01T19:00:00',
    },
    calendarTime: {
      start: '2026-08-01T07:00:00',
      end: '2026-08-01T19:00:00',
    },
    timeZone: 'Europe/Budapest',
  };
}

describe('szolgálati társkeresés elérhetősége', () => {
  it('mindkét kötelező fájl hiányát pontosan jelzi', () => {
    expect(getCrewSearchAvailability(undefined, undefined, august)).toEqual({
      enabled: false,
      message:
        'A szolgálati társak kereséséhez töltsd fel a gépkocsivezetői és a mentőápolói beosztást.',
    });
  });

  it('csak a gépkocsivezetői fájl hiányát pontosan jelzi', () => {
    expect(getCrewSearchAvailability(undefined, augustSession, august)).toEqual({
      enabled: false,
      message: 'A szolgálati társak kereséséhez töltsd fel a gépkocsivezetői beosztást.',
    });
  });

  it('csak a mentőápolói fájl hiányát pontosan jelzi', () => {
    expect(getCrewSearchAvailability(augustSession, undefined, august)).toEqual({
      enabled: false,
      message: 'A szolgálati társak kereséséhez töltsd fel a mentőápolói beosztást.',
    });
  });

  it('mindkét kötelező fájl megfelelő hónapjával engedélyez', () => {
    expect(getCrewSearchAvailability(augustSession, augustSession, august)).toEqual({
      enabled: true,
      message: 'A szolgálati társak keresése bekapcsolható.',
    });
  });

  it('hiányzó kiválasztott hónapnál letilt, és megnevezi az érintett beosztást', () => {
    const availability = getCrewSearchAvailability(
      augustSession,
      septemberSession,
      august,
    );
    expect(availability.enabled).toBe(false);
    expect(availability.message).toContain('mentőápolói beosztásból');
  });

  it('a mentőtiszti beosztás csak a megfelelő hónappal használható', () => {
    expect(hasUsableOfficerSchedule(undefined, august)).toBe(false);
    expect(hasUsableOfficerSchedule(septemberSession, august)).toBe(false);
    expect(hasUsableOfficerSchedule(augustSession, august)).toBe(true);
  });

  it('csak bekapcsolt társkeresés, Esetszolgálat és hiányzó tiszti beosztás együtt kér figyelmeztetést', () => {
    const emergency = event('Esetszolgálat', 'Nappalos 07–19');
    expect(requiresOfficerScheduleWarning([emergency], true, false)).toBe(true);
    expect(requiresOfficerScheduleWarning([emergency], false, false)).toBe(false);
    expect(requiresOfficerScheduleWarning([emergency], true, true)).toBe(false);
  });

  it.each([
    ['Parti szolgálat', 'Nappalos 07–19'],
    ['6-os kocsi', 'Nappalos 06–18'],
    ['10-es kocsi', 'Nappalos 10–22'],
    ['KMR', 'KMR'],
  ] as const)('%s önmagában nem kér tiszti figyelmeztetést', (category, shiftType) => {
    expect(requiresOfficerScheduleWarning([event(category, shiftType)], true, false)).toBe(false);
  });
});
