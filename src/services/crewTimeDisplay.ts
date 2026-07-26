import type { EventTimeRange } from '../domain/types';

function localTime(value: string): string {
  return value.slice(11, 16);
}

function displayedCrewEndTime(value: string): string {
  const actualTime = localTime(value);
  return actualTime === '06:59' ? '07:00' : actualTime;
}

export function crewOverlapLabel(overlap: EventTimeRange): string {
  return `${localTime(overlap.start)}–${displayedCrewEndTime(overlap.end)}`;
}
