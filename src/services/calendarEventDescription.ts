import type { CalendarEvent } from '../domain/types';
import { crewDescriptionLines } from './crewDescription';

export function calendarEventDescription(item: CalendarEvent): string {
  return crewDescriptionLines(item.crewMembers ?? []).join('\n');
}
