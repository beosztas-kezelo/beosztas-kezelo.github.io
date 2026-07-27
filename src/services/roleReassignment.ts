import { STAFF_ROLE_LABELS, STAFF_ROLE_SCHEDULE_NAMES } from '../domain/staffRoles';
import type {
  CalendarEvent,
  InterpretedEmployeeSchedule,
  MonthSheet,
  ReviewRow,
  RoleAssignmentMarker,
  RoleAssignmentTechnicalDetails,
  ScheduleResult,
  StaffRole,
  WorkbookSession,
} from '../domain/types';
import { normalizeMarker } from '../utils/normalize';
import { localDateKey } from './dates';
import { findRoleMonth, interpretSelectedEmployee } from './scheduleInterpretation';

export interface RoleAssignmentWorkbookSource {
  role: StaffRole;
  status: 'empty' | 'loading' | 'success' | 'error';
  fileName?: string;
  session?: WorkbookSession;
}

type RoleAssignmentSources = Readonly<Record<StaffRole, RoleAssignmentWorkbookSource>>;

interface AssignmentRule {
  marker: RoleAssignmentMarker;
  normalizedMarkers: ReadonlySet<string>;
  targetRole: StaffRole;
}

interface TargetCandidate {
  schedule: InterpretedEmployeeSchedule;
  rows: ReviewRow[];
}

const AP_MARKERS = new Set(['áp', 'ap']);
const GKV_MARKERS = new Set(['gkv']);

function assignmentRule(role: StaffRole): AssignmentRule | undefined {
  if (role === 'driver') {
    return { marker: 'ÁP', normalizedMarkers: AP_MARKERS, targetRole: 'nurse' };
  }
  if (role === 'nurse') {
    return { marker: 'GKV', normalizedMarkers: GKV_MARKERS, targetRole: 'driver' };
  }
  return undefined;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function summaryFor(rows: ReviewRow[], events: CalendarEvent[]): ScheduleResult['summary'] {
  return {
    recognized: events.length,
    omsz: events.filter((item) => item.summary === 'OMSZ').length,
    kmr: events.filter((item) => item.summary === 'KMR').length,
    uncertain: rows.filter((item) => item.status === 'Bizonytalan').length,
    invalid: rows.filter((item) => item.status === 'Hibás párosítás').length,
    exportable: events.length,
  };
}

function eventKey(event: CalendarEvent): string {
  return [event.id, event.calendarTime.start, event.calendarTime.end, event.effectiveRole].join(
    '|',
  );
}

function assignmentEventId(event: CalendarEvent, effectiveRole: StaffRole): string {
  return stableHash(
    [event.id, event.calendarTime.start, event.calendarTime.end, effectiveRole].join('|'),
  );
}

function targetRowsOnDate(schedule: InterpretedEmployeeSchedule, dateKey: string): ReviewRow[] {
  return schedule.result.rows.filter(
    (row) =>
      localDateKey(row.date) === dateKey &&
      row.event !== undefined &&
      (row.status === 'Exportálható' || row.status === 'Felismerve'),
  );
}

function uniqueTargetRows(rows: ReviewRow[]): ReviewRow[] {
  const unique = new Map<string, ReviewRow>();
  for (const row of rows) {
    const targetEvent = row.event;
    if (!targetEvent) continue;
    const key = [targetEvent.id, targetEvent.calendarTime.start, targetEvent.calendarTime.end].join(
      '|',
    );
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()];
}

function targetDiagnostics(schedules: InterpretedEmployeeSchedule[], dateKey: string): string[] {
  return [
    ...new Set(
      schedules.flatMap((schedule) =>
        schedule.result.rows
          .filter((row) => localDateKey(row.date) === dateKey)
          .flatMap((row) => row.diagnostics.map((item) => item.address)),
      ),
    ),
  ];
}

function targetPairingCells(rows: ReviewRow[]): string[] {
  return [
    ...new Set(rows.flatMap((row) => row.pairingReferences?.map((item) => item.address) ?? [])),
  ];
}

function resolutionDetails(
  primary: InterpretedEmployeeSchedule,
  sourceSession: WorkbookSession,
  sourceRow: ReviewRow,
  rule: AssignmentRule,
  reason: string,
  target?: {
    session: WorkbookSession;
    schedule?: InterpretedEmployeeSchedule;
    rows?: number[];
    row?: ReviewRow;
    cells: string[];
  },
): RoleAssignmentTechnicalDetails {
  return {
    baseRole: primary.role,
    effectiveRole: rule.targetRole,
    marker: rule.marker,
    sourceFileName: sourceSession.fileName,
    sourceRow: primary.employeeRow,
    sourceCells: sourceRow.diagnostics.map((item) => item.address),
    targetFileName: target?.session.fileName,
    targetRow: target?.schedule?.employeeRow,
    targetRows: target?.rows ?? (target?.schedule ? [target.schedule.employeeRow] : undefined),
    targetCells: target?.cells ?? [],
    targetMarker: target?.row?.marker,
    targetPairingCells: target?.row ? targetPairingCells([target.row]) : [],
    titleSuffix: rule.marker,
    resolution: target?.row?.event ? 'resolved' : 'unresolved',
    reason,
  };
}

function unresolvedRow(
  primary: InterpretedEmployeeSchedule,
  sourceSession: WorkbookSession,
  sourceRow: ReviewRow,
  rule: AssignmentRule,
  reason: string,
  target?: {
    session: WorkbookSession;
    schedule?: InterpretedEmployeeSchedule;
    rows?: number[];
    cells: string[];
  },
): ReviewRow {
  return {
    ...sourceRow,
    status: 'Bizonytalan',
    note: reason,
    shiftType: undefined,
    serviceCategory: undefined,
    summary: undefined,
    timeRule: undefined,
    pairingReferences: undefined,
    dailyInference: undefined,
    serviceResolution: undefined,
    event: undefined,
    roleAssignment: resolutionDetails(primary, sourceSession, sourceRow, rule, reason, target),
    resolvedMarker: undefined,
    technicalNote: reason,
  };
}

function resolvedRows(
  primary: InterpretedEmployeeSchedule,
  sourceSession: WorkbookSession,
  sourceRow: ReviewRow,
  rule: AssignmentRule,
  targetSession: WorkbookSession,
  candidate: TargetCandidate,
): ReviewRow[] {
  return candidate.rows.map((targetRow) => {
    const targetEvent = targetRow.event as CalendarEvent;
    const reason = `${rule.marker} jelölés feloldva a(z) ${STAFF_ROLE_LABELS[rule.targetRole]} beosztásból.`;
    const roleAssignment = resolutionDetails(primary, sourceSession, sourceRow, rule, reason, {
      session: targetSession,
      schedule: candidate.schedule,
      row: targetRow,
      cells: targetRow.diagnostics.map((item) => item.address),
    });
    const redirectedEvent: CalendarEvent = {
      ...targetEvent,
      id: assignmentEventId(targetEvent, rule.targetRole),
      effectiveRole: rule.targetRole,
      roleAssignment,
    };
    return {
      ...targetRow,
      id: `${sourceRow.id}-${redirectedEvent.id}`,
      date: sourceRow.date,
      marker: rule.marker,
      resolvedMarker: targetRow.marker,
      status: 'Exportálható',
      note: reason,
      diagnostics: sourceRow.diagnostics,
      roleAssignment,
      event: redirectedEvent,
      summary: redirectedEvent.summary,
      shiftType: redirectedEvent.shiftType,
      serviceCategory: redirectedEvent.serviceCategory,
    };
  });
}

function missingScheduleReason(rule: AssignmentRule): string {
  return rule.marker === 'ÁP'
    ? 'Az ÁP jelölés feloldásához a mentőápolói beosztás szükséges.'
    : 'A GKV jelölés feloldásához a gépkocsivezetői beosztás szükséges.';
}

function resolveSourceRow(
  primary: InterpretedEmployeeSchedule,
  sourceSession: WorkbookSession,
  selectedMonth: MonthSheet,
  sourceRow: ReviewRow,
  rule: AssignmentRule,
  sources: RoleAssignmentSources,
): ReviewRow[] {
  const source = sources[rule.targetRole];
  if (!source.session || source.status !== 'success') {
    return [unresolvedRow(primary, sourceSession, sourceRow, rule, missingScheduleReason(rule))];
  }
  const targetSession = source.session;

  const targetMonth = findRoleMonth(targetSession, selectedMonth.year, selectedMonth.month);
  if (!targetMonth) {
    const reason = `A ${rule.marker} jelölés célmunkakörének ${selectedMonth.year}. ${selectedMonth.month}. havi munkalapja nem található.`;
    return [
      unresolvedRow(primary, sourceSession, sourceRow, rule, reason, {
        session: source.session,
        cells: [],
      }),
    ];
  }

  const employee = targetMonth.employees.find(
    (item) => item.normalizedName === primary.normalizedName,
  );
  if (!employee) {
    const reason = `A dolgozó nem található a(z) ${STAFF_ROLE_SCHEDULE_NAMES[rule.targetRole]} beosztásban.`;
    return [
      unresolvedRow(primary, sourceSession, sourceRow, rule, reason, {
        session: source.session,
        cells: [],
      }),
    ];
  }

  const dateKey = localDateKey(sourceRow.date);
  const schedules = employee.rows.map((row) =>
    interpretSelectedEmployee(
      targetSession,
      targetMonth,
      rule.targetRole,
      primary.normalizedName,
      row,
    ),
  );
  const candidates: TargetCandidate[] = schedules
    .map((schedule) => ({
      schedule,
      rows: uniqueTargetRows(targetRowsOnDate(schedule, dateKey)),
    }))
    .filter((candidate) => candidate.rows.length > 0);
  const cells = targetDiagnostics(schedules, dateKey);

  const firstCandidate = candidates[0];
  if (candidates.length > 1 && firstCandidate) {
    const activeRows = candidates.map((item) => item.schedule.employeeRow).join(', ');
    const reason = `Több azonos nevű, érvényes célsor található (${activeRows}. sor); az átirányítás nem oldható fel egyértelműen.`;
    return [
      unresolvedRow(primary, sourceSession, sourceRow, rule, reason, {
        session: targetSession,
        schedule: firstCandidate.schedule,
        rows: candidates.map((item) => item.schedule.employeeRow),
        cells,
      }),
    ];
  }

  const candidate = firstCandidate;
  if (!candidate) {
    const firstSchedule = schedules[0];
    const reason = `A ${rule.marker} napján a célmunkaköri sorból nem állítható elő érvényes szolgálat.`;
    return [
      unresolvedRow(
        primary,
        sourceSession,
        sourceRow,
        rule,
        reason,
        firstSchedule
          ? {
              session: targetSession,
              schedule: firstSchedule,
              rows: schedules.map((item) => item.employeeRow),
              cells,
            }
          : undefined,
      ),
    ];
  }

  return resolvedRows(primary, sourceSession, sourceRow, rule, targetSession, candidate);
}

export function resolveDailyRoleAssignments(
  primary: InterpretedEmployeeSchedule,
  sourceSession: WorkbookSession,
  selectedMonth: MonthSheet,
  sources: RoleAssignmentSources,
): InterpretedEmployeeSchedule {
  const rule = assignmentRule(primary.role);
  if (!rule) return primary;

  const rows = primary.result.rows.flatMap((row) =>
    rule.normalizedMarkers.has(normalizeMarker(row.marker))
      ? resolveSourceRow(primary, sourceSession, selectedMonth, row, rule, sources)
      : [row],
  );
  const existingRedirectMarkers = new Set(
    primary.result.rows
      .filter((row) => rule.normalizedMarkers.has(normalizeMarker(row.marker)))
      .map((row) => row.event?.id)
      .filter((id): id is string => id !== undefined),
  );
  const events = [
    ...primary.result.events.filter((item) => !existingRedirectMarkers.has(item.id)),
    ...rows.flatMap((row) =>
      row.roleAssignment?.resolution === 'resolved' && row.event ? [row.event] : [],
    ),
  ];
  const uniqueEvents = new Map(events.map((item) => [eventKey(item), item]));

  return {
    ...primary,
    result: {
      rows,
      events: [...uniqueEvents.values()],
      summary: summaryFor(rows, [...uniqueEvents.values()]),
    },
  };
}
