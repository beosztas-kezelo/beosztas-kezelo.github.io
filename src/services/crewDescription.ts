import type { CrewMemberMatch, StaffRole } from '../domain/types';
import { crewOverlapLabel } from './crewTimeDisplay';

const ROLE_ORDER: StaffRole[] = ['driver', 'nurse', 'officer'];
const EXPORT_ROLE_LABELS: Record<StaffRole, string> = {
  driver: 'Mentőgépkocsi-vezető',
  nurse: 'Mentőápoló',
  officer: 'Mentőtiszt',
};

export function crewDescriptionLines(matches: CrewMemberMatch[]): string[] {
  if (matches.length === 0) return [];
  if (matches.length === 1) return [matches[0]?.displayName ?? ''];

  const lines: string[] = [];
  for (const role of ROLE_ORDER) {
    const roleMatches = matches.filter((match) => match.role === role);
    if (roleMatches.length === 0) continue;
    if (roleMatches.length === 1) {
      lines.push(`${EXPORT_ROLE_LABELS[role]}: ${roleMatches[0]?.displayName ?? ''}`);
      continue;
    }
    lines.push(`${EXPORT_ROLE_LABELS[role]}:`);
    lines.push(
      ...roleMatches.map((match) => `${match.displayName} – ${crewOverlapLabel(match.overlap)}`),
    );
  }
  return lines;
}
