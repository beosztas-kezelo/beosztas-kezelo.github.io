import type { CalendarEvent } from '../domain/types';
import { crewDescriptionLines } from './crewDescription';

export function calendarEventDescription(
  item: CalendarEvent,
  target: 'google' | 'ics' = 'google',
): string {
  const lines = [`Szolgálati jelleg: ${item.serviceCategory}`];
  if (item.crewSearchPerformed) {
    lines.push(`Beosztás: ${item.shiftType}`);
  }
  if (item.crewMembers && item.crewMembers.length > 0) {
    lines.push('', ...crewDescriptionLines(item.crewMembers));
  }
  if (item.inference) {
    lines.push(
      'Felismerés: a szolgálattípus a napi szolgálati összeállításból lett következtetve.',
      `Technikai magyarázat: ${item.inference.explanation}`,
    );
  }
  if (target === 'ics' && item.specialKind === 'previous-month-carryover-partial') {
    lines.push(
      'Előző hónapról áthúzódó részleges szolgálat. Importálás előtt ellenőrizd, hogy a teljes december 31-i esemény nem szerepel-e már a naptárban.',
    );
  }
  return lines.join('\n');
}
