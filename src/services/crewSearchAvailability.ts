import type { CalendarEvent, MonthSheet, WorkbookSession } from '../domain/types';

export interface CrewSearchAvailability {
  enabled: boolean;
  message: string;
}

export interface OfficerScheduleState {
  status: 'empty' | 'loading' | 'success' | 'error';
  session?: Pick<WorkbookSession, 'months'>;
}

function monthAvailable(
  session: Pick<WorkbookSession, 'months'>,
  selectedMonth: Pick<MonthSheet, 'year' | 'month'>,
): boolean {
  return session.months.some(
    (month) =>
      month.year === selectedMonth.year && month.month === selectedMonth.month,
  );
}

export function getCrewSearchAvailability(
  driverSession: Pick<WorkbookSession, 'months'> | undefined,
  nurseSession: Pick<WorkbookSession, 'months'> | undefined,
  selectedMonth: Pick<MonthSheet, 'year' | 'month'> | undefined,
): CrewSearchAvailability {
  if (!driverSession && !nurseSession) {
    return {
      enabled: false,
      message:
        'A szolgálati társak kereséséhez töltsd fel a gépkocsivezetői és a mentőápolói beosztást.',
    };
  }
  if (!driverSession) {
    return {
      enabled: false,
      message: 'A szolgálati társak kereséséhez töltsd fel a gépkocsivezetői beosztást.',
    };
  }
  if (!nurseSession) {
    return {
      enabled: false,
      message: 'A szolgálati társak kereséséhez töltsd fel a mentőápolói beosztást.',
    };
  }
  if (!selectedMonth) {
    return {
      enabled: false,
      message: 'A szolgálati társak kereséséhez előbb válassz hónapot.',
    };
  }

  const driverMonthAvailable = monthAvailable(driverSession, selectedMonth);
  const nurseMonthAvailable = monthAvailable(nurseSession, selectedMonth);
  if (!driverMonthAvailable && !nurseMonthAvailable) {
    return {
      enabled: false,
      message:
        'A szolgálati társak kereséséhez a kiválasztott év és hónap munkalapja hiányzik a gépkocsivezetői és a mentőápolói beosztásból.',
    };
  }
  if (!driverMonthAvailable) {
    return {
      enabled: false,
      message:
        'A szolgálati társak kereséséhez a kiválasztott év és hónap munkalapja hiányzik a gépkocsivezetői beosztásból.',
    };
  }
  if (!nurseMonthAvailable) {
    return {
      enabled: false,
      message:
        'A szolgálati társak kereséséhez a kiválasztott év és hónap munkalapja hiányzik a mentőápolói beosztásból.',
    };
  }

  return {
    enabled: true,
    message: 'A szolgálati társak keresése bekapcsolható.',
  };
}

export function hasUsableOfficerSchedule(
  officerState: OfficerScheduleState,
  selectedMonth: Pick<MonthSheet, 'year' | 'month'> | undefined,
): boolean {
  return Boolean(
    officerState.status === 'success' &&
    officerState.session &&
    selectedMonth &&
    monthAvailable(officerState.session, selectedMonth),
  );
}

export function requiresOfficerScheduleWarning(
  events: CalendarEvent[],
  crewSearchActive: boolean,
  officerScheduleUsable: boolean,
): boolean {
  return (
    crewSearchActive &&
    !officerScheduleUsable &&
    events.some((event) => event.serviceCategory === 'Esetszolgálat')
  );
}
