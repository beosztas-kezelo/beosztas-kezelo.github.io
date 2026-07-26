import type {
  InterpretedEmployeeSchedule,
  MonthSheet,
  StaffRole,
  WorkbookSession,
} from '../domain/types';
import {
  readEmployeeScheduleEntries,
  readWorksheetScheduleEntries,
} from '../excel/dayEntries';
import { buildDailyServicePatterns } from './dailyServiceInference';
import { interpretSchedule } from './shifts';

export function findRoleMonth(
  session: WorkbookSession,
  year: number,
  month: number,
): MonthSheet | undefined {
  return session.months.find((item) => item.year === year && item.month === month);
}

export function interpretSelectedEmployee(
  session: WorkbookSession,
  month: MonthSheet,
  role: StaffRole,
  normalizedName: string,
  rowOverride?: number,
): InterpretedEmployeeSchedule {
  const employee = month.employees.find((item) => item.normalizedName === normalizedName);
  if (!employee) throw new Error('A kiválasztott dolgozó nem található.');
  const selectedRow =
    rowOverride ?? (employee.rows.length === 1 ? employee.rows[0] : undefined);
  if (selectedRow === undefined) throw new Error('A dolgozói sor nincs kiválasztva.');

  const entries = readEmployeeScheduleEntries(
    session,
    month,
    normalizedName,
    selectedRow,
  );
  const dailyServicePatterns = buildDailyServicePatterns(
    readWorksheetScheduleEntries(session, month),
    role,
  );
  return {
    role,
    employeeName: employee.name,
    normalizedName,
    employeeRow: selectedRow,
    showRowIdentifier: employee.rows.length > 1,
    result: interpretSchedule(entries.current, {
      legend: month.legendStyles,
      previous: entries.previous,
      next: entries.next,
      dailyServicePatterns,
      role,
    }),
  };
}

export function interpretWorksheetEmployees(
  session: WorkbookSession,
  month: MonthSheet,
  role: StaffRole,
): InterpretedEmployeeSchedule[] {
  const schedules = readWorksheetScheduleEntries(session, month);
  const dailyServicePatterns = buildDailyServicePatterns(schedules, role);

  return schedules.map((schedule) => {
    const employee = month.employees.find(
      (item) =>
        item.normalizedName === schedule.normalizedName &&
        item.rows.includes(schedule.row),
    );
    if (!employee) throw new Error('A munkalap dolgozói sora nem található.');
    return {
      role,
      employeeName: employee.name,
      normalizedName: employee.normalizedName,
      employeeRow: schedule.row,
      showRowIdentifier: employee.rows.length > 1,
      result: interpretSchedule(schedule.current, {
        legend: month.legendStyles,
        previous: schedule.previous,
        next: schedule.next,
        dailyServicePatterns,
        role,
      }),
    };
  });
}
