import { STAFF_ROLE_LABELS } from '../domain/staffRoles';
import type { CrewMemberMatch, StaffRole } from '../domain/types';
import { crewOverlapLabel } from './crewMatching';

const ROLE_ORDER: StaffRole[] = ['driver', 'nurse', 'officer'];

export function crewDescriptionLines(matches: CrewMemberMatch[]): string[] {
  if (matches.length === 0) return [];
  const lines = ['Szolgálati társak:'];
  for (const role of ROLE_ORDER) {
    const roleMatches = matches.filter((match) => match.role === role);
    if (roleMatches.length === 0) continue;
    lines.push(`${STAFF_ROLE_LABELS[role]}:`);
    for (const match of roleMatches) {
      lines.push(`- ${match.displayName} – ${crewOverlapLabel(match.overlap)}`);
    }
  }
  return lines;
}
