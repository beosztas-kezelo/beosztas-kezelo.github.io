import { STAFF_ROLE_LABELS, STAFF_ROLE_SCHEDULE_NAMES } from '../domain/staffRoles';
import type {
  CalendarEvent,
  CrewMatchNotice,
  CrewMatchResult,
  CrewMemberMatch,
  CrewRoleSource,
  EventTimeRange,
  InterpretedEmployeeSchedule,
  ScheduleResult,
  StaffRole,
} from '../domain/types';
import { zonedLocalToInstant } from './dates';

const ROLE_ORDER: Record<StaffRole, number> = {
  driver: 0,
  nurse: 1,
  officer: 2,
};

function roleIsRelevant(
  primaryRole: StaffRole,
  sourceRole: StaffRole,
  event: CalendarEvent,
): boolean {
  if (primaryRole === 'officer') return sourceRole === 'driver' || sourceRole === 'nurse';
  if (sourceRole === 'officer') return event.serviceCategory === 'Esetszolgálat';
  return primaryRole !== sourceRole;
}

export function overlappingRange(
  first: EventTimeRange,
  second: EventTimeRange,
): EventTimeRange | undefined {
  const firstStart = zonedLocalToInstant(first.start).getTime();
  const firstEnd = zonedLocalToInstant(first.end).getTime();
  const secondStart = zonedLocalToInstant(second.start).getTime();
  const secondEnd = zonedLocalToInstant(second.end).getTime();
  const overlapStart = Math.max(firstStart, secondStart);
  const overlapEnd = Math.min(firstEnd, secondEnd);
  if (overlapStart >= overlapEnd) return undefined;
  return {
    start: firstStart >= secondStart ? first.start : second.start,
    end: firstEnd <= secondEnd ? first.end : second.end,
  };
}

function missingNotice(source: CrewRoleSource): CrewMatchNotice {
  const scheduleName = STAFF_ROLE_SCHEDULE_NAMES[source.role];
  return {
    role: source.role,
    kind: source.status === 'missing-month' ? 'missing-month' : 'missing-file',
    message:
      source.status === 'missing-month'
        ? `A(z) ${scheduleName} beosztásban nincs kiválasztott év és hónap.`
        : `A(z) ${scheduleName} beosztása nincs feltöltve.`,
  };
}

function noMatchNotice(role: StaffRole): CrewMatchNotice {
  return {
    role,
    kind: 'no-match',
    message: `Nem található egyező ${STAFF_ROLE_LABELS[role].toLocaleLowerCase('hu-HU')}.`,
  };
}

function multipleMatchNotices(matches: CrewMemberMatch[]): CrewMatchNotice[] {
  const groups = new Map<string, CrewMemberMatch[]>();
  for (const match of matches) {
    const key = `${match.role}|${match.serviceCategory}`;
    const group = groups.get(key) ?? [];
    group.push(match);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) =>
      group.some((first, firstIndex) =>
        group.some(
          (second, secondIndex) =>
            firstIndex < secondIndex &&
            overlappingRange(first.overlap, second.overlap) !== undefined,
        ),
      ),
    )
    .map((group) => ({
      role: group[0]?.role ?? 'driver',
      kind: 'multiple-matches' as const,
      message: 'Több lehetséges egyező szolgálati társ található.',
    }));
}

function deduplicateAndSort(matches: CrewMemberMatch[]): CrewMemberMatch[] {
  const unique = new Map<string, CrewMemberMatch>();
  for (const match of matches) {
    const key = [
      match.role,
      match.normalizedName,
      match.employeeRow,
      match.overlap.start,
      match.overlap.end,
    ].join('|');
    if (!unique.has(key)) unique.set(key, match);
  }
  return [...unique.values()].sort(
    (first, second) =>
      ROLE_ORDER[first.role] - ROLE_ORDER[second.role] ||
      first.overlap.start.localeCompare(second.overlap.start) ||
      first.displayName.localeCompare(second.displayName, 'hu-HU'),
  );
}

export function matchCrewMembers(
  primary: InterpretedEmployeeSchedule,
  sources: CrewRoleSource[],
): CrewMatchResult {
  const matchesByEventId = new Map<string, CrewMemberMatch[]>();
  const noticesByEventId = new Map<string, CrewMatchNotice[]>();

  for (const primaryEvent of primary.result.events) {
    const eventMatches: CrewMemberMatch[] = [];
    const eventNotices: CrewMatchNotice[] = [];
    for (const source of sources) {
      if (!roleIsRelevant(primary.role, source.role, primaryEvent)) continue;
      if (source.status !== 'available') {
        eventNotices.push(missingNotice(source));
        continue;
      }

      const roleMatches: CrewMemberMatch[] = [];
      for (const employee of source.employees) {
        if (employee.normalizedName === primary.normalizedName) continue;
        for (const candidate of employee.result.events) {
          if (candidate.serviceCategory !== primaryEvent.serviceCategory) continue;
          const overlap = overlappingRange(primaryEvent.calendarTime, candidate.calendarTime);
          if (!overlap) continue;
          roleMatches.push({
            role: employee.role,
            employeeName: employee.employeeName,
            normalizedName: employee.normalizedName,
            employeeRow: employee.employeeRow,
            displayName: employee.showRowIdentifier
              ? `${employee.employeeName} (${employee.employeeRow}. sor)`
              : employee.employeeName,
            serviceCategory: candidate.serviceCategory,
            overlap,
          });
        }
      }
      if (roleMatches.length === 0) eventNotices.push(noMatchNotice(source.role));
      eventMatches.push(...roleMatches);
    }
    const normalizedMatches = deduplicateAndSort(eventMatches);
    eventNotices.push(...multipleMatchNotices(normalizedMatches));
    matchesByEventId.set(primaryEvent.id, normalizedMatches);
    noticesByEventId.set(primaryEvent.id, eventNotices);
  }

  return { matchesByEventId, noticesByEventId };
}

export function attachCrewMatches(
  result: ScheduleResult,
  crew: CrewMatchResult,
): ScheduleResult {
  const events = result.events.map((item) => {
    const crewMembers = crew.matchesByEventId.get(item.id) ?? [];
    return {
      ...item,
      crewSearchPerformed: true,
      crewMembers: crewMembers.length > 0 ? crewMembers : undefined,
    };
  });
  const eventsById = new Map(events.map((item) => [item.id, item]));
  return {
    ...result,
    events,
    rows: result.rows.map((row) => {
      if (!row.event) return row;
      const event = eventsById.get(row.event.id) ?? row.event;
      return {
        ...row,
        event,
        crewMatches: crew.matchesByEventId.get(row.event.id) ?? [],
        crewNotices: crew.noticesByEventId.get(row.event.id) ?? [],
      };
    }),
  };
}

export function crewOverlapLabel(overlap: EventTimeRange): string {
  return `${overlap.start.slice(11, 16)}–${overlap.end.slice(11, 16)}`;
}
