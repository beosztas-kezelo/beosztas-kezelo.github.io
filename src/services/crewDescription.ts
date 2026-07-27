import type { CrewMemberMatch, EventTimeRange, StaffRole } from '../domain/types';
import { crewOverlapLabel } from './crewTimeDisplay';

const ROLE_ORDER: StaffRole[] = ['driver', 'nurse', 'officer'];
const EXPORT_ROLE_LABELS: Record<StaffRole, string> = {
  driver: 'Mentőgépkocsi-vezető',
  nurse: 'Mentőápoló',
  officer: 'Mentőtiszt',
};

export interface PublicCrewMember {
  role: StaffRole;
  employeeName: string;
  overlap: EventTimeRange;
}

export function publicCrewMembers(matches: readonly CrewMemberMatch[]): PublicCrewMember[] {
  const unique = new Map<string, PublicCrewMember>();

  for (const match of matches) {
    const employeeName = match.employeeName.trim();
    if (!employeeName) continue;
    const key = [match.role, employeeName, match.overlap.start, match.overlap.end].join('|');
    if (!unique.has(key)) {
      unique.set(key, {
        role: match.role,
        employeeName,
        overlap: match.overlap,
      });
    }
  }

  return [...unique.values()].sort(
    (first, second) =>
      ROLE_ORDER.indexOf(first.role) - ROLE_ORDER.indexOf(second.role) ||
      first.overlap.start.localeCompare(second.overlap.start) ||
      first.employeeName.localeCompare(second.employeeName, 'hu-HU'),
  );
}

export function crewDescriptionLines(matches: readonly CrewMemberMatch[]): string[] {
  const publicMatches = publicCrewMembers(matches);
  if (publicMatches.length === 0) return [];
  if (publicMatches.length === 1) return [publicMatches[0]?.employeeName ?? ''];

  const roleGroups: string[][] = [];
  for (const role of ROLE_ORDER) {
    const roleMatches = publicMatches.filter((match) => match.role === role);
    if (roleMatches.length === 0) continue;
    if (roleMatches.length === 1) {
      roleGroups.push([
        `${EXPORT_ROLE_LABELS[role]}: ${roleMatches[0]?.employeeName ?? ''}`,
      ]);
      continue;
    }
    roleGroups.push([
      `${EXPORT_ROLE_LABELS[role]}:`,
      ...roleMatches.map(
        (match) => `${match.employeeName} – ${crewOverlapLabel(match.overlap)}`,
      ),
    ]);
  }
  return roleGroups.flatMap((group, index) => (index === 0 ? group : ['', ...group]));
}
