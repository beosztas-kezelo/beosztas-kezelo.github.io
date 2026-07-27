import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, StaffRole, WorkbookSession } from '../src/domain/types';
import { parseWorkbook } from '../src/excel/workbookParser';
import {
  createDefaultCalendarExportPreferences,
  resolveCalendarEventTitle,
} from '../src/services/calendarExportPreferences';
import { GoogleCalendarClient } from '../src/services/googleCalendar';
import { buildIcs, stableUid } from '../src/services/ics';
import {
  resolveDailyRoleAssignments,
  type RoleAssignmentWorkbookSource,
} from '../src/services/roleReassignment';
import { findRoleMonth, interpretSelectedEmployee } from '../src/services/scheduleInterpretation';

interface MarkerCell {
  value: string | number;
  color?: string;
  underline?: boolean;
}

interface EmployeeRow {
  name: string;
  days: Record<number, MarkerCell | MarkerCell[]>;
}

interface WorkbookOptions {
  employees: EmployeeRow[];
  sheetName?: string;
  year?: number;
  monthName?: string;
}

async function assignmentWorkbook(
  fileName: string,
  { employees, sheetName = 'Augusztus', year = 2026, monthName = 'augusztus' }: WorkbookOptions,
): Promise<WorkbookSession> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.getCell('B2').value = `${year}. ${monthName}`;
  sheet.getCell('B4').value = 'Név';
  for (let day = 1; day <= 31; day += 1) {
    sheet.getCell(4, 3 + (day - 1) * 2).value = day;
  }
  employees.forEach((employee, employeeIndex) => {
    const row = 5 + employeeIndex * 2;
    sheet.getCell(row, 2).value = employee.name;
    for (const [dayText, markerValue] of Object.entries(employee.days)) {
      const day = Number(dayText);
      const markers = Array.isArray(markerValue) ? markerValue : [markerValue];
      markers.forEach((marker, markerIndex) => {
        const cell = sheet.getCell(row, 3 + (day - 1) * 2 + markerIndex);
        cell.value = marker.value;
        if (marker.color || marker.underline) {
          cell.font = {
            color: marker.color
              ? { argb: `FF${marker.color.replace('#', '').toUpperCase()}` }
              : undefined,
            underline: marker.underline,
          };
        }
      });
    }
  });
  sheet.getCell(5 + employees.length * 2, 2).value = 'Összesen:';
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  return parseWorkbook(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    fileName,
  );
}

function emptySources(): Record<StaffRole, RoleAssignmentWorkbookSource> {
  return {
    driver: { role: 'driver', status: 'empty' },
    nurse: { role: 'nurse', status: 'empty' },
    officer: { role: 'officer', status: 'empty' },
  };
}

async function resolveAssignment({
  baseRole,
  sourceMarker,
  targetEmployees,
  sourceName = 'Kovács Anna',
  targetFile = true,
  targetSheetName,
  targetMonthName,
}: {
  baseRole: 'driver' | 'nurse';
  sourceMarker: string;
  targetEmployees: EmployeeRow[];
  sourceName?: string;
  targetFile?: boolean;
  targetSheetName?: string;
  targetMonthName?: string;
}) {
  const targetRole = baseRole === 'driver' ? 'nurse' : 'driver';
  const sourceSession = await assignmentWorkbook(`${baseRole}.xlsx`, {
    employees: [{ name: sourceName, days: { 1: { value: sourceMarker } } }],
  });
  const sourceMonth = findRoleMonth(sourceSession, 2026, 8);
  if (!sourceMonth) throw new Error('Hiányzó forráshónap.');
  const primary = interpretSelectedEmployee(
    sourceSession,
    sourceMonth,
    baseRole,
    sourceMonth.employees[0]?.normalizedName ?? '',
  );
  const sources = emptySources();
  sources[baseRole] = { role: baseRole, status: 'success', session: sourceSession };
  if (targetFile) {
    const targetSession = await assignmentWorkbook(`${targetRole}.xlsx`, {
      employees: targetEmployees,
      sheetName: targetSheetName,
      monthName: targetMonthName,
    });
    sources[targetRole] = { role: targetRole, status: 'success', session: targetSession };
  }
  return resolveDailyRoleAssignments(primary, sourceSession, sourceMonth, sources);
}

function redirectedEvent(result: Awaited<ReturnType<typeof resolveAssignment>>): CalendarEvent {
  const event = result.result.events[0];
  if (!event) throw new Error('Hiányzó átirányított esemény.');
  return event;
}

describe('napi munkakör-átirányítás', () => {
  it('normál eseménynél az effectiveRole az alapmunkakör, és a stabil ID munkakörfüggő', async () => {
    const session = await assignmentWorkbook('normal.xlsx', {
      employees: [{ name: 'Kovács Anna', days: { 1: { value: 12 } } }],
    });
    const month = findRoleMonth(session, 2026, 8);
    if (!month) throw new Error('Hiányzó hónap.');
    const normalizedName = month.employees[0]?.normalizedName ?? '';
    const driver = interpretSelectedEmployee(session, month, 'driver', normalizedName);
    const nurse = interpretSelectedEmployee(session, month, 'nurse', normalizedName);
    const officer = interpretSelectedEmployee(session, month, 'officer', normalizedName);

    expect(driver.result.events[0]?.effectiveRole).toBe('driver');
    expect(nurse.result.events[0]?.effectiveRole).toBe('nurse');
    expect(officer.result.events[0]?.effectiveRole).toBe('officer');
    expect(driver.result.events[0]?.id).not.toBe(nurse.result.events[0]?.id);
    expect(officer.result.events[0]?.id).not.toBe(driver.result.events[0]?.id);
  });

  it.each([
    {
      name: 'fekete 12',
      marker: { value: 12, color: '#000000' },
      category: 'Parti szolgálat',
      shift: 'Nappalos 07–19',
      start: '07:00:00',
      end: '19:00:00',
    },
    {
      name: 'piros 12',
      marker: { value: 12, color: '#FF0000' },
      category: 'Esetszolgálat',
      shift: 'Nappalos 07–19',
      start: '07:00:00',
      end: '19:00:00',
    },
    {
      name: 'kék 12',
      marker: { value: 12, color: '#0000FF' },
      category: '6-os kocsi',
      shift: 'Nappalos 06–18',
      start: '06:00:00',
      end: '18:00:00',
    },
    {
      name: 'zöld, aláhúzott 12',
      marker: { value: 12, color: '#008000', underline: true },
      category: '10-es kocsi',
      shift: 'Nappalos 10–22',
      start: '10:00:00',
      end: '22:00:00',
    },
    {
      name: 'KMR',
      marker: { value: 'KMR' },
      category: 'KMR',
      shift: 'KMR',
      start: '05:00:00',
      end: '01:00:00',
    },
  ])(
    'driver ÁP + ápolói $name a célmunkakör teljes szabályával exportálható',
    async ({ marker, category, shift, start, end }) => {
      const result = await resolveAssignment({
        baseRole: 'driver',
        sourceMarker: 'ÁP',
        targetEmployees: [{ name: 'Kovács Anna', days: { 1: marker } }],
      });
      const event = redirectedEvent(result);

      expect(event).toMatchObject({
        effectiveRole: 'nurse',
        shiftType: shift,
        serviceCategory: category,
        roleAssignment: {
          baseRole: 'driver',
          effectiveRole: 'nurse',
          marker: 'ÁP',
          resolution: 'resolved',
        },
      });
      expect(event.calendarTime.start.endsWith(start)).toBe(true);
      expect(event.calendarTime.end.endsWith(end)).toBe(true);
      expect(result.result.rows[0]).toMatchObject({
        marker: 'ÁP',
        resolvedMarker: String(marker.value),
        status: 'Exportálható',
      });
      expect(resolveCalendarEventTitle(event, createDefaultCalendarExportPreferences())).toBe(
        `${event.summary} - ÁP`,
      );
    },
  );

  it.each([
    {
      name: '17–7',
      days: {
        1: { value: 17, color: '#000000' },
        2: { value: 7, color: '#000000' },
      },
      shiftType: '24 órás szolgálat',
      end: '2026-08-02T06:59:00',
    },
    {
      name: '5–7',
      days: {
        1: { value: 5, color: '#000000' },
        2: { value: 7, color: '#000000' },
      },
      shiftType: 'Éjszakai szolgálat',
      end: '2026-08-02T07:00:00',
    },
  ])('ÁP céloldali $name párból egyetlen eseményt készít', async ({ days, shiftType, end }) => {
    const result = await resolveAssignment({
      baseRole: 'driver',
      sourceMarker: 'ÁP',
      targetEmployees: [{ name: 'Kovács Anna', days }],
    });

    expect(result.result.events).toHaveLength(1);
    expect(result.result.events[0]).toMatchObject({
      shiftType,
      calendarTime: { end },
      effectiveRole: 'nurse',
    });
  });

  it('a céloldali 7 / 5 kettős nap teljes párosítását használja, és azonos eseményt nem duplikál', async () => {
    const sourceSession = await assignmentWorkbook('driver.xlsx', {
      employees: [
        {
          name: 'Kovács Anna',
          days: {
            1: { value: 'ÁP' },
            2: { value: 'ÁP' },
          },
        },
      ],
    });
    const targetSession = await assignmentWorkbook('nurse.xlsx', {
      employees: [
        {
          name: 'Kovács Anna',
          days: {
            1: { value: 17, color: '#000000' },
            2: [
              { value: 7, color: '#000000' },
              { value: 5, color: '#000000' },
            ],
            3: { value: 7, color: '#000000' },
          },
        },
      ],
    });
    const month = findRoleMonth(sourceSession, 2026, 8);
    if (!month) throw new Error('Hiányzó hónap.');
    const primary = interpretSelectedEmployee(
      sourceSession,
      month,
      'driver',
      month.employees[0]?.normalizedName ?? '',
    );
    const sources = emptySources();
    sources.nurse = { role: 'nurse', status: 'success', session: targetSession };
    const result = resolveDailyRoleAssignments(primary, sourceSession, month, sources);

    expect(result.result.events.map((event) => event.shiftType)).toEqual([
      '24 órás szolgálat',
      'Éjszakai szolgálat',
    ]);
    expect(new Set(result.result.events.map((event) => event.id)).size).toBe(2);
    expect(result.result.rows.filter((row) => row.roleAssignment)).toHaveLength(2);
  });

  it('a hónap utolsó napi céloldali 5-öt a következő hónap 06:59-éig oldja fel', async () => {
    const sourceSession = await assignmentWorkbook('driver.xlsx', {
      employees: [{ name: 'Kovács Anna', days: { 31: { value: 'ÁP' } } }],
    });
    const targetSession = await assignmentWorkbook('nurse.xlsx', {
      employees: [{ name: 'Kovács Anna', days: { 31: { value: 5, color: '#000000' } } }],
    });
    const month = findRoleMonth(sourceSession, 2026, 8);
    if (!month) throw new Error('Hiányzó hónap.');
    const primary = interpretSelectedEmployee(
      sourceSession,
      month,
      'driver',
      month.employees[0]?.normalizedName ?? '',
    );
    const sources = emptySources();
    sources.nurse = { role: 'nurse', status: 'success', session: targetSession };
    const result = resolveDailyRoleAssignments(primary, sourceSession, month, sources);

    expect(redirectedEvent(result)).toBeDefined();
    expect(result.result.events[0]?.calendarTime).toEqual({
      start: '2026-08-31T19:00:00',
      end: '2026-09-01T06:59:00',
    });
  });

  it('a január 1-jei céloldali 7-ből az előző évről áthúzódó részidőt is feloldja', async () => {
    const sourceSession = await assignmentWorkbook('driver.xlsx', {
      employees: [{ name: 'Kovács Anna', days: { 1: { value: 'ÁP' } } }],
      sheetName: 'Január',
      year: 2027,
      monthName: 'január',
    });
    const targetSession = await assignmentWorkbook('nurse.xlsx', {
      employees: [{ name: 'Kovács Anna', days: { 1: { value: 7, color: '#000000' } } }],
      sheetName: 'Január',
      year: 2027,
      monthName: 'január',
    });
    const month = findRoleMonth(sourceSession, 2027, 1);
    if (!month) throw new Error('Hiányzó hónap.');
    const primary = interpretSelectedEmployee(
      sourceSession,
      month,
      'driver',
      month.employees[0]?.normalizedName ?? '',
    );
    const sources = emptySources();
    sources.nurse = { role: 'nurse', status: 'success', session: targetSession };
    const result = resolveDailyRoleAssignments(primary, sourceSession, month, sources);

    expect(result.result.events[0]).toMatchObject({
      shiftType: 'Előző hónapról áthúzódó szolgálat',
      calendarTime: {
        start: '2027-01-01T00:00:00',
        end: '2027-01-01T06:59:00',
      },
      effectiveRole: 'nurse',
    });
  });

  it.each(['AP', 'ap', 'áp'])('az ÁP %s írásmódját is feloldja', async (sourceMarker) => {
    const result = await resolveAssignment({
      baseRole: 'driver',
      sourceMarker,
      targetEmployees: [{ name: '  KOVÁCS   ANNA ', days: { 1: { value: 12, color: '#000000' } } }],
    });
    expect(result.result.events).toHaveLength(1);
    expect(redirectedEvent(result).roleAssignment?.marker).toBe('ÁP');
  });

  it('hiányzó ápolói fájlnál csak az ÁP nap bizonytalan és nem exportálható', async () => {
    const result = await resolveAssignment({
      baseRole: 'driver',
      sourceMarker: 'ÁP',
      targetEmployees: [],
      targetFile: false,
    });

    expect(result.result.events).toEqual([]);
    expect(result.result.rows).toEqual([
      expect.objectContaining({
        status: 'Bizonytalan',
        note: 'Az ÁP jelölés feloldásához a mentőápolói beosztás szükséges.',
      }),
    ]);
  });

  it('hiányzó célfájl mellett a többi normál szolgálati nap feldolgozása folytatódik', async () => {
    const sourceSession = await assignmentWorkbook('driver.xlsx', {
      employees: [
        {
          name: 'Kovács Anna',
          days: {
            1: { value: 'ÁP' },
            2: { value: 12, color: '#000000' },
          },
        },
      ],
    });
    const month = findRoleMonth(sourceSession, 2026, 8);
    if (!month) throw new Error('Hiányzó hónap.');
    const primary = interpretSelectedEmployee(
      sourceSession,
      month,
      'driver',
      month.employees[0]?.normalizedName ?? '',
    );
    const result = resolveDailyRoleAssignments(primary, sourceSession, month, emptySources());

    expect(result.result.events).toHaveLength(1);
    expect(result.result.events[0]?.calendarTime.start).toBe('2026-08-02T07:00:00');
    expect(result.result.rows.map((row) => row.status)).toEqual(['Bizonytalan', 'Exportálható']);
  });

  it('hiányzó célhónapnál megőrzi a célfájl nevét a technikai adatokban', async () => {
    const result = await resolveAssignment({
      baseRole: 'driver',
      sourceMarker: 'ÁP',
      targetEmployees: [{ name: 'Kovács Anna', days: { 1: { value: 12 } } }],
      targetSheetName: 'Szeptember',
      targetMonthName: 'szeptember',
    });

    expect(result.result.rows[0]).toMatchObject({
      status: 'Bizonytalan',
      roleAssignment: {
        targetFileName: 'nurse.xlsx',
        targetCells: [],
        resolution: 'unresolved',
      },
    });
  });

  it('hiányzó célszemélynél nem találgat', async () => {
    const result = await resolveAssignment({
      baseRole: 'driver',
      sourceMarker: 'ÁP',
      targetEmployees: [{ name: 'Másik Dolgozó', days: { 1: { value: 12 } } }],
    });
    expect(result.result.events).toEqual([]);
    expect(result.result.rows[0]?.note).toMatch(/nem található.*mentőápolói/u);
  });

  it('több azonos nevű aktív célsornál bizonytalan, és felsorolja a sorokat és cellákat', async () => {
    const result = await resolveAssignment({
      baseRole: 'driver',
      sourceMarker: 'ÁP',
      targetEmployees: [
        { name: 'Kovács Anna', days: { 1: { value: 12 } } },
        { name: 'Kovács Anna', days: { 1: { value: 12, color: '#FF0000' } } },
      ],
    });
    const row = result.result.rows[0];

    expect(result.result.events).toEqual([]);
    expect(row?.note).toMatch(/5, 7\. sor/u);
    expect(row?.roleAssignment?.targetRows).toEqual([5, 7]);
    expect(row?.roleAssignment?.targetCells).toEqual(['C5', 'D5', 'C7', 'D7']);
  });

  it('egy aktív és egy kizárt azonos nevű célsorból az egyetlen érvényeset használja', async () => {
    const result = await resolveAssignment({
      baseRole: 'driver',
      sourceMarker: 'ÁP',
      targetEmployees: [
        { name: 'Kovács Anna', days: { 1: { value: 'x' } } },
        { name: 'Kovács Anna', days: { 1: { value: 12, color: '#FF0000' } } },
      ],
    });
    expect(redirectedEvent(result)).toMatchObject({
      serviceCategory: 'Esetszolgálat',
      roleAssignment: { targetRow: 7 },
    });
  });

  it('a célmunkaköri teljes munkalap napi összeállításából végzi el a 12-es korrekciót', async () => {
    const result = await resolveAssignment({
      baseRole: 'driver',
      sourceMarker: 'ÁP',
      targetEmployees: [
        { name: 'Kovács Anna', days: { 1: { value: 12, color: '#000000' } } },
        {
          name: 'Huszonnégy Órás',
          days: {
            1: { value: 17, color: '#000000' },
            2: { value: 7, color: '#000000' },
          },
        },
        { name: 'Kék Kocsi', days: { 1: { value: 12, color: '#0000FF' } } },
      ],
    });

    expect(redirectedEvent(result)).toMatchObject({
      shiftType: 'Nappalos 10–22',
      serviceCategory: '10-es kocsi',
      inference: { source: 'daily-service-pattern', target: 'tenCar' },
      effectiveRole: 'nurse',
    });
  });

  it('kizárt céljelölésnél az ÁP nap bizonytalan marad', async () => {
    const result = await resolveAssignment({
      baseRole: 'driver',
      sourceMarker: 'ÁP',
      targetEmployees: [{ name: 'Kovács Anna', days: { 1: { value: 'x' } } }],
    });
    expect(result.result.events).toEqual([]);
    expect(result.result.rows[0]).toMatchObject({
      status: 'Bizonytalan',
      roleAssignment: {
        targetRow: 5,
        targetCells: ['C5', 'D5'],
        resolution: 'unresolved',
      },
    });
  });

  it.each(['GKV', 'gkv', 'GkV'])(
    'nurse %s + driver 12 esetén GKV eseményt készít',
    async (sourceMarker) => {
      const result = await resolveAssignment({
        baseRole: 'nurse',
        sourceMarker,
        targetEmployees: [{ name: 'Kovács Anna', days: { 1: { value: 12, color: '#000000' } } }],
      });
      const event = redirectedEvent(result);
      expect(event).toMatchObject({
        effectiveRole: 'driver',
        serviceCategory: 'Parti szolgálat',
        roleAssignment: { marker: 'GKV', titleSuffix: 'GKV' },
      });
      expect(resolveCalendarEventTitle(event, createDefaultCalendarExportPreferences())).toBe(
        'OMSZ - GKV',
      );
    },
  );

  it.each([
    [{ 1: { value: 'KMR' } }, 'KMR', 'KMR - GKV'],
    [
      {
        1: { value: 17, color: '#FF0000' },
        2: { value: 7, color: '#FF0000' },
      },
      '24 órás szolgálat',
      'OMSZ - GKV',
    ],
  ] as const)(
    'GKV a driver teljes sorából %s szolgálatot old fel',
    async (days, shiftType, title) => {
      const result = await resolveAssignment({
        baseRole: 'nurse',
        sourceMarker: 'GKV',
        targetEmployees: [{ name: 'Kovács Anna', days }],
      });
      const event = redirectedEvent(result);
      expect(event.shiftType).toBe(shiftType);
      expect(resolveCalendarEventTitle(event, createDefaultCalendarExportPreferences())).toBe(
        title,
      );
    },
  );

  it('hiányzó driver fájlnál pontos GKV hibát ad', async () => {
    const result = await resolveAssignment({
      baseRole: 'nurse',
      sourceMarker: 'GKV',
      targetEmployees: [],
      targetFile: false,
    });
    expect(result.result.rows[0]?.note).toBe(
      'A GKV jelölés feloldásához a gépkocsivezetői beosztás szükséges.',
    );
  });

  it.each(['ÁP', 'GKV'])('mentőtisztnél a %s nem indít átirányítást', async (marker) => {
    const session = await assignmentWorkbook('officer.xlsx', {
      employees: [{ name: 'Tiszt Tímea', days: { 1: { value: marker } } }],
    });
    const month = findRoleMonth(session, 2026, 8);
    if (!month) throw new Error('Hiányzó hónap.');
    const primary = interpretSelectedEmployee(
      session,
      month,
      'officer',
      month.employees[0]?.normalizedName ?? '',
    );
    const result = resolveDailyRoleAssignments(primary, session, month, emptySources());

    expect(result.result.events).toEqual([]);
    expect(result.result.rows[0]?.roleAssignment).toBeUndefined();
  });

  it('az ÁP/GKV utótag az egyéni cím után kerül, az ID és az UID cím- és színfüggetlen', async () => {
    const result = await resolveAssignment({
      baseRole: 'driver',
      sourceMarker: 'ÁP',
      targetEmployees: [{ name: 'Kovács Anna', days: { 1: { value: 12 } } }],
    });
    const event = redirectedEvent(result);
    const defaults = createDefaultCalendarExportPreferences();
    const custom = {
      titleMode: 'custom' as const,
      customTitle: 'Szolgálat',
      googleColorId: '9',
    };

    expect(resolveCalendarEventTitle(event, custom)).toBe('Szolgálat - ÁP');
    expect(buildIcs([event], new Date('2026-01-01T00:00:00Z'), defaults)).toContain(
      'SUMMARY:OMSZ - ÁP',
    );
    expect(buildIcs([event], new Date('2026-01-01T00:00:00Z'), custom)).toContain(
      'SUMMARY:Szolgálat - ÁP',
    );
    expect(stableUid(event)).toBe(stableUid({ ...event }));
    expect(event.id).not.toContain('Szolgálat');
  });

  it('a Google request az átirányított címet és a változatlan tényleges időt küldi', async () => {
    const result = await resolveAssignment({
      baseRole: 'driver',
      sourceMarker: 'ÁP',
      targetEmployees: [
        {
          name: 'Kovács Anna',
          days: {
            1: { value: 17, color: '#000000' },
            2: { value: 7, color: '#000000' },
          },
        },
      ],
    });
    const event = redirectedEvent(result);
    let requestBody: unknown;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      if (typeof init?.body !== 'string') throw new Error('Hiányzó request body.');
      requestBody = JSON.parse(init.body) as unknown;
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'created', colorId: '10' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    await new GoogleCalendarClient('token', fetcher).insertEvent('primary', event);

    expect(requestBody).toMatchObject({
      summary: 'OMSZ - ÁP',
      start: { dateTime: '2026-08-01T07:00:00' },
      end: { dateTime: '2026-08-02T06:59:00' },
      colorId: '10',
    });
    expect(buildIcs([event])).toContain('DTEND;TZID=Europe/Budapest:20260802T065900');
  });

  it('a GKV KMR cím a Google summary és az ICS SUMMARY mezőjébe is bekerül', async () => {
    const result = await resolveAssignment({
      baseRole: 'nurse',
      sourceMarker: 'GKV',
      targetEmployees: [{ name: 'Kovács Anna', days: { 1: { value: 'KMR' } } }],
    });
    const event = redirectedEvent(result);
    let requestBody: unknown;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      if (typeof init?.body !== 'string') throw new Error('Hiányzó request body.');
      requestBody = JSON.parse(init.body) as unknown;
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'created-kmr-gkv', colorId: '10' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    await new GoogleCalendarClient('token', fetcher).insertEvent('primary', event);

    expect(requestBody).toMatchObject({ summary: 'KMR - GKV' });
    expect(buildIcs([event])).toContain('SUMMARY:KMR - GKV');
  });

  it('átirányított eseménynél a cím/idő fallback nem keveri össze a normál OMSZ eseménnyel', async () => {
    const result = await resolveAssignment({
      baseRole: 'driver',
      sourceMarker: 'ÁP',
      targetEmployees: [{ name: 'Kovács Anna', days: { 1: { value: 12 } } }],
    });
    const event = redirectedEvent(result);
    const response = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(
        response({
          items: [
            {
              summary: 'OMSZ',
              start: { dateTime: '2026-08-01T07:00:00+02:00' },
              end: { dateTime: '2026-08-01T19:00:00+02:00' },
            },
          ],
        }),
      );

    await expect(
      new GoogleCalendarClient('token', fetcher).isDuplicate('primary', event),
    ).resolves.toBe(false);
  });
});
