import type { StaffRole } from './types';

export const STAFF_ROLES: StaffRole[] = ['driver', 'nurse', 'officer'];

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  driver: 'Mentőgépkocsi-vezető / technikus',
  nurse: 'Mentőápoló',
  officer: 'Mentőtiszt',
};

export const STAFF_ROLE_FILE_LABELS: Record<StaffRole, string> = {
  driver: 'Mentőgépkocsi-vezetői / technikusi beosztás',
  nurse: 'Mentőápolói beosztás',
  officer: 'Mentőtiszti beosztás',
};

export const STAFF_ROLE_SCHEDULE_NAMES: Record<StaffRole, string> = {
  driver: 'mentőgépkocsi-vezetői / technikusi',
  nurse: 'mentőápolói',
  officer: 'mentőtiszti',
};

export function partnerRolesFor(role: StaffRole): StaffRole[] {
  if (role === 'officer') return ['driver', 'nurse'];
  return role === 'driver' ? ['nurse', 'officer'] : ['driver', 'officer'];
}
