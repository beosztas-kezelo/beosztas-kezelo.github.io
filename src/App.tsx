import { useCallback, useMemo, useRef, useState } from 'react';
import { STAFF_ROLE_LABELS, STAFF_ROLES, partnerRolesFor } from './domain/staffRoles';
import type {
  CalendarExportPreferences,
  FileFingerprint,
  GoogleEventColorOption,
  GoogleEventState,
  InterpretedEmployeeSchedule,
  RoleWorkbookSession,
  ScheduleResult,
  StaffRole,
  WorkbookSession,
} from './domain/types';
import { AppError, toAppError } from './domain/errors';
import { createFileFingerprint, fileFingerprintsMatch } from './services/fileIdentity';
import { buildIcs, downloadIcs, icsFileName } from './services/ics';
import type { GoogleWriteResult } from './services/googleCalendar';
import {
  DEFAULT_GOOGLE_EVENT_COLOR,
  GOOGLE_COLOR_DEFAULT_MISSING_WARNING,
  calendarExportPreferencesError,
  createDefaultCalendarExportPreferences,
} from './services/calendarExportPreferences';
import {
  hashGoogleAccountIdentifier,
  loadStoredCalendarExportPreferences,
  moveSavedTitleToFront,
  preferencesFromStored,
  saveStoredCalendarExportPreferences,
  type StoredCalendarExportPreferences,
} from './services/calendarExportPreferenceStorage';
import {
  findRoleMonth,
  interpretSelectedEmployee,
  interpretWorksheetEmployees,
} from './services/scheduleInterpretation';
import { attachCrewMatches, matchCrewMembers } from './services/crewMatching';
import {
  getCrewSearchAvailability,
  hasUsableOfficerSchedule,
  requiresOfficerScheduleWarning,
} from './services/crewSearchAvailability';
import { monthOptionLabel, monthOptionValue } from './utils/monthOptions';
import { isGoogleSelectionLocked, isGoogleUploadComplete } from './utils/googleUpload';
import { deriveWorkflowProgress, type WorkflowStepId } from './utils/workflowProgress';
import { BackToTopButton } from './components/BackToTopButton';
import { CalendarEventSettings } from './components/CalendarEventSettings';
import { ErrorNotice } from './components/ErrorNotice';
import { FileUpload, type FileUploadHandle, type RoleFileView } from './components/FileUpload';
import { GooglePanel } from './components/GooglePanel';
import { OfficerScheduleWarningDialog } from './components/OfficerScheduleWarningDialog';
import { ReviewTable } from './components/ReviewTable';
import { Stepper } from './components/Stepper';
import { SummaryCards } from './components/SummaryCards';
import './styles.css';

interface RoleFileState extends RoleFileView {
  session?: WorkbookSession;
  fingerprint?: FileFingerprint;
  error?: AppError;
}

function emptyRoleFile(role: StaffRole): RoleFileState {
  return { role, status: 'empty' };
}

function initialRoleFiles(): Record<StaffRole, RoleFileState> {
  return {
    driver: emptyRoleFile('driver'),
    nurse: emptyRoleFile('nurse'),
    officer: emptyRoleFile('officer'),
  };
}

export default function App() {
  const uploadSectionRef = useRef<HTMLElement>(null);
  const fileUploadRef = useRef<FileUploadHandle>(null);
  const selectionSectionRef = useRef<HTMLElement>(null);
  const reviewSectionRef = useRef<HTMLElement>(null);
  const exportSectionRef = useRef<HTMLElement>(null);
  const [roleFiles, setRoleFiles] = useState<Record<StaffRole, RoleFileState>>(initialRoleFiles);
  const [selectedRole, setSelectedRole] = useState<StaffRole>();
  const [selectedMonthKey, setSelectedMonthKey] = useState('');
  const [employeeName, setEmployeeName] = useState('');
  const [employeeRow, setEmployeeRow] = useState<number>();
  const [crewSearchEnabled, setCrewSearchEnabled] = useState(false);
  const [officerWarningOpen, setOfficerWarningOpen] = useState(false);
  const [officerWarningAcknowledged, setOfficerWarningAcknowledged] = useState(false);
  const [continuedWithoutOfficer, setContinuedWithoutOfficer] = useState(false);
  const [result, setResult] = useState<ScheduleResult>();
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [error, setError] = useState<AppError>();
  const [notice, setNotice] = useState('');
  const [googleEventStates, setGoogleEventStates] = useState<Map<string, GoogleEventState>>(
    new Map(),
  );
  const [googleUploadResetKey, setGoogleUploadResetKey] = useState(0);
  const [icsExported, setIcsExported] = useState(false);
  const [calendarExportPreferences, setCalendarExportPreferences] =
    useState<CalendarExportPreferences>(createDefaultCalendarExportPreferences);
  const [googleEventColors, setGoogleEventColors] = useState<GoogleEventColorOption[]>([
    DEFAULT_GOOGLE_EVENT_COLOR,
  ]);
  const [googleColorPaletteWarning, setGoogleColorPaletteWarning] = useState<string>();
  const [googleConnected, setGoogleConnected] = useState(false);
  const [savedCustomTitles, setSavedCustomTitles] = useState<string[]>([]);
  const [preferencePersistenceUnavailable, setPreferencePersistenceUnavailable] = useState(false);
  const [colorReloadRequest, setColorReloadRequest] = useState(0);
  const [calendarSettingsAttentionRequested, setCalendarSettingsAttentionRequested] =
    useState(false);
  const preferredGoogleColorIdRef = useRef(DEFAULT_GOOGLE_EVENT_COLOR.colorId);
  const calendarExportPreferencesRef = useRef<CalendarExportPreferences>(
    createDefaultCalendarExportPreferences(),
  );
  const googleAccountHashRef = useRef<string | undefined>(undefined);
  const savedCustomTitlesRef = useRef<string[]>([]);

  const availableRoles = STAFF_ROLES.filter((role) => roleFiles[role].session);
  const selectedRoleFile = selectedRole ? roleFiles[selectedRole] : undefined;
  const session = selectedRoleFile?.session;
  const selectedMonth = session?.months.find(
    (month) => monthOptionValue(month) === selectedMonthKey,
  );
  const employee = selectedMonth?.employees.find((item) => item.normalizedName === employeeName);
  const crewSearchAvailability = getCrewSearchAvailability(
    roleFiles.driver.session,
    roleFiles.nurse.session,
    selectedMonth,
  );
  const crewSearchActive = crewSearchEnabled && crewSearchAvailability.enabled;
  const officerScheduleUsable = hasUsableOfficerSchedule(roleFiles.officer, selectedMonth);
  const selectedCalendarEvents = useMemo(
    () =>
      result?.events.filter(
        (event) =>
          selectedEvents.has(event.id) && !isGoogleUploadComplete(googleEventStates.get(event.id)),
      ) ?? [],
    [googleEventStates, result, selectedEvents],
  );
  const exportPreferencesError = calendarExportPreferencesError(calendarExportPreferences);
  const employeeSelectionComplete = Boolean(
    employeeName && employee && (employee.rows.length === 1 || employeeRow !== undefined),
  );
  const hasSelectedExportableEvent =
    result?.events.some((event) => selectedEvents.has(event.id)) ?? false;
  const hasCompletedGoogleEvent =
    result?.events.some((event) => isGoogleUploadComplete(googleEventStates.get(event.id))) ??
    false;
  const googleUploadInProgress = [...googleEventStates.values()].some(
    (state) => state.status === 'Létrehozás folyamatban',
  );
  const googleUploadFailed = [...googleEventStates.values()].some(
    (state) => state.status === 'Sikertelen',
  );
  const busy = STAFF_ROLES.some((role) => roleFiles[role].status === 'loading');
  const supplementalMonthWarnings =
    selectedRole && selectedMonth
      ? STAFF_ROLES.filter(
          (role) =>
            role !== selectedRole &&
            roleFiles[role].session &&
            !findRoleMonth(roleFiles[role].session, selectedMonth.year, selectedMonth.month),
        ).map(
          (role) =>
            `${STAFF_ROLE_LABELS[role]}: a ${selectedMonth.year}. ${selectedMonth.month}. havi munkalap nem található.`,
        )
      : [];
  const workflowSteps = deriveWorkflowProgress({
    fileLoaded: availableRoles.length > 0,
    monthSelected: Boolean(selectedMonth),
    employeeSelected: employeeSelectionComplete,
    resultReady: Boolean(result),
    hasSelectedExportableEvent,
    hasCompletedGoogleEvent,
    googleUploadInProgress,
    googleUploadFailed,
    icsExported,
    errorCode: error?.code,
  });

  const resetGoogleUpload = () => {
    setGoogleEventStates(new Map());
    setGoogleUploadResetKey((current) => current + 1);
  };

  const applyCalendarExportPreferences = (preferences: CalendarExportPreferences) => {
    calendarExportPreferencesRef.current = preferences;
    setCalendarExportPreferences(preferences);
  };

  const applySavedCustomTitles = (titles: string[]) => {
    savedCustomTitlesRef.current = titles;
    setSavedCustomTitles(titles);
  };

  const resetCalendarExportPreferenceSelection = () => {
    preferredGoogleColorIdRef.current = DEFAULT_GOOGLE_EVENT_COLOR.colorId;
    applyCalendarExportPreferences(createDefaultCalendarExportPreferences());
  };

  const persistCalendarExportSettings = (
    titles: string[],
    preferences: CalendarExportPreferences,
  ) => {
    const accountHash = googleAccountHashRef.current;
    if (!accountHash) return;
    const stored: StoredCalendarExportPreferences = {
      savedCustomTitles: titles,
      lastSelectedTitleMode: preferences.titleMode,
      lastSelectedCustomTitle: preferences.titleMode === 'custom' ? preferences.customTitle : '',
      lastSelectedGoogleColorId: preferences.googleColorId,
    };
    if (!saveStoredCalendarExportPreferences(accountHash, stored)) {
      setPreferencePersistenceUnavailable(true);
    }
  };

  const handleGoogleConnectionChange = (connection: {
    connected: boolean;
    primaryCalendarId?: string;
  }) => {
    if (!connection.connected) {
      setGoogleConnected(false);
      setCalendarSettingsAttentionRequested(false);
      googleAccountHashRef.current = undefined;
      applySavedCustomTitles([]);
      setPreferencePersistenceUnavailable(false);
      setGoogleEventColors([DEFAULT_GOOGLE_EVENT_COLOR]);
      setGoogleColorPaletteWarning(undefined);
      resetCalendarExportPreferenceSelection();
      return;
    }

    setGoogleConnected(true);
    if (result && result.events.length > 0) {
      setCalendarSettingsAttentionRequested(true);
    }
    const primaryCalendarId = connection.primaryCalendarId?.trim();
    if (!primaryCalendarId) {
      googleAccountHashRef.current = undefined;
      applySavedCustomTitles([]);
      setPreferencePersistenceUnavailable(true);
      resetCalendarExportPreferenceSelection();
      return;
    }

    const accountHash = hashGoogleAccountIdentifier(primaryCalendarId);
    const stored = loadStoredCalendarExportPreferences(accountHash);
    const nextPreferences = preferencesFromStored(stored);
    googleAccountHashRef.current = accountHash;
    applySavedCustomTitles(stored.savedCustomTitles);
    setPreferencePersistenceUnavailable(false);
    preferredGoogleColorIdRef.current = nextPreferences.googleColorId;
    applyCalendarExportPreferences(nextPreferences);
  };

  const handleCalendarSettingsAttention = useCallback(() => {
    setCalendarSettingsAttentionRequested(false);
  }, []);

  const resetOfficerWarningState = () => {
    setOfficerWarningOpen(false);
    setOfficerWarningAcknowledged(false);
    setContinuedWithoutOfficer(false);
  };

  const resetProcessing = () => {
    setResult(undefined);
    setSelectedEvents(new Set());
    setError(undefined);
    setIcsExported(false);
    resetCalendarExportPreferenceSelection();
    resetGoogleUpload();
    resetOfficerWarningState();
  };

  const resetEmployeeAndProcessing = () => {
    setEmployeeName('');
    setEmployeeRow(undefined);
    resetProcessing();
  };

  const selectDefaultMonth = async (nextSession: WorkbookSession) => {
    const { chooseDefaultMonth } = await import('./excel/workbookParser');
    const defaultSelection = chooseDefaultMonth(nextSession.months);
    setSelectedMonthKey(monthOptionValue(defaultSelection.month));
    setNotice(
      defaultSelection.usedFallback
        ? 'A következő naptári hónap nem található; az első kitöltött havi lapot választottuk ki.'
        : '',
    );
  };

  const handleRoleFile = async (role: StaffRole, file: File) => {
    resetProcessing();
    setRoleFiles((current) => ({
      ...current,
      [role]: {
        role,
        status: 'loading',
        fileName: file.name,
      },
    }));
    if (selectedRole === role) {
      setSelectedMonthKey('');
      setEmployeeName('');
      setEmployeeRow(undefined);
    }

    try {
      const buffer = await file.arrayBuffer();
      const fingerprint = await createFileFingerprint(file, buffer);
      const duplicateRole = STAFF_ROLES.find(
        (candidateRole) =>
          candidateRole !== role &&
          roleFiles[candidateRole].fingerprint &&
          fileFingerprintsMatch(fingerprint, roleFiles[candidateRole].fingerprint),
      );
      if (duplicateRole) {
        throw new AppError(
          'DUPLICATE_ROLE_FILE',
          `A fájl már a(z) ${STAFF_ROLE_LABELS[duplicateRole]} munkakörnél szerepel.`,
        );
      }
      const { parseWorkbook } = await import('./excel/workbookParser');
      const parsed = await parseWorkbook(buffer, file.name);
      const roleSession: RoleWorkbookSession = { role, session: parsed, fingerprint };
      setRoleFiles((current) => ({
        ...current,
        [role]: {
          role,
          status: 'success',
          fileName: parsed.fileName,
          monthCount: parsed.months.length,
          session: roleSession.session,
          fingerprint: roleSession.fingerprint,
        },
      }));
      if (!selectedRole || selectedRole === role) {
        setSelectedRole(role);
        resetEmployeeAndProcessing();
        await selectDefaultMonth(parsed);
      }
    } catch (caught) {
      const appError = toAppError(caught);
      const hasOtherSuccessfulRole = STAFF_ROLES.some(
        (candidateRole) => candidateRole !== role && roleFiles[candidateRole].session !== undefined,
      );
      setRoleFiles((current) => ({
        ...current,
        [role]: {
          role,
          status: 'error',
          fileName: file.name,
          error: appError,
          errorMessage: hasOtherSuccessfulRole ? appError.message : undefined,
        },
      }));
      const fallbackRole = STAFF_ROLES.find(
        (candidateRole) => candidateRole !== role && roleFiles[candidateRole].session,
      );
      if (selectedRole === role) {
        if (fallbackRole) {
          const fallbackSession = roleFiles[fallbackRole].session;
          setSelectedRole(fallbackRole);
          resetEmployeeAndProcessing();
          if (fallbackSession) await selectDefaultMonth(fallbackSession);
        } else {
          setSelectedRole(undefined);
          setSelectedMonthKey('');
          setError(appError);
        }
      } else if (availableRoles.length === 0) {
        setError(appError);
      }
    }
  };

  const removeRoleFile = (role: StaffRole) => {
    const nextFiles = { ...roleFiles, [role]: emptyRoleFile(role) };
    setRoleFiles(nextFiles);
    resetProcessing();
    if (selectedRole !== role) return;
    const fallbackRole = STAFF_ROLES.find((candidateRole) => nextFiles[candidateRole].session);
    setSelectedRole(fallbackRole);
    setSelectedMonthKey('');
    setEmployeeName('');
    setEmployeeRow(undefined);
    setNotice('');
    if (fallbackRole) {
      const fallbackSession = nextFiles[fallbackRole].session;
      if (fallbackSession) void selectDefaultMonth(fallbackSession);
    }
  };

  const selectRole = (role: StaffRole) => {
    const nextSession = roleFiles[role].session;
    if (!nextSession || role === selectedRole) return;
    setSelectedRole(role);
    setSelectedMonthKey('');
    resetEmployeeAndProcessing();
    void selectDefaultMonth(nextSession);
  };

  const selectMonth = (value: string) => {
    setSelectedMonthKey(value);
    resetEmployeeAndProcessing();
  };

  const selectEmployee = (value: string) => {
    setEmployeeName(value);
    const nextEmployee = selectedMonth?.employees.find((item) => item.normalizedName === value);
    setEmployeeRow(nextEmployee?.rows.length === 1 ? nextEmployee.rows[0] : undefined);
    resetProcessing();
  };

  const selectEmployeeRow = (row: number | undefined) => {
    setEmployeeRow(row);
    resetProcessing();
  };

  const toggleCrewSearch = (enabled: boolean) => {
    if (enabled && !crewSearchAvailability.enabled) return;
    setCrewSearchEnabled(enabled);
    resetProcessing();
  };

  const finishScheduleProcessing = (
    primary: InterpretedEmployeeSchedule,
    proceededWithoutOfficer: boolean,
  ) => {
    let interpreted = primary.result;
    if (crewSearchActive && selectedMonth && selectedRole) {
      const sources = partnerRolesFor(selectedRole).map((role) => {
        const supplementalSession = roleFiles[role].session;
        if (!supplementalSession) {
          return { role, status: 'missing-file' as const, employees: [] };
        }
        const supplementalMonth = findRoleMonth(
          supplementalSession,
          selectedMonth.year,
          selectedMonth.month,
        );
        if (!supplementalMonth) {
          return { role, status: 'missing-month' as const, employees: [] };
        }
        return {
          role,
          status: 'available' as const,
          employees: interpretWorksheetEmployees(supplementalSession, supplementalMonth, role),
        };
      });
      interpreted = attachCrewMatches(interpreted, matchCrewMembers(primary, sources));
    }
    setOfficerWarningOpen(false);
    setContinuedWithoutOfficer(proceededWithoutOfficer);
    setResult(interpreted);
    setSelectedEvents(new Set(interpreted.events.map((event) => event.id)));
  };

  const processSchedule = (allowMissingOfficer = false) => {
    setError(undefined);
    setIcsExported(false);
    resetCalendarExportPreferenceSelection();
    resetGoogleUpload();
    if (!session || !selectedRole || !selectedMonth || !employeeName) {
      setError(new AppError('EMPLOYEE_NOT_FOUND'));
      return;
    }
    if (employee && employee.rows.length > 1 && employeeRow === undefined) {
      setError(
        new AppError('EMPLOYEE_DUPLICATE', `Választható sorok: ${employee.rows.join(', ')}.`),
      );
      return;
    }
    try {
      const primary = interpretSelectedEmployee(
        session,
        selectedMonth,
        selectedRole,
        employeeName,
        employeeRow,
      );
      const officerScheduleRequired = requiresOfficerScheduleWarning(
        primary.result.events,
        crewSearchActive,
        officerScheduleUsable,
      );
      if (officerScheduleRequired && !officerWarningAcknowledged && !allowMissingOfficer) {
        setOfficerWarningOpen(true);
        return;
      }
      finishScheduleProcessing(
        primary,
        officerScheduleRequired && (officerWarningAcknowledged || allowMissingOfficer),
      );
    } catch (caught) {
      setError(toAppError(caught));
    }
  };

  const uploadOfficerSchedule = () => {
    setOfficerWarningOpen(false);
    fileUploadRef.current?.openRolePicker('officer');
  };

  const continueWithoutOfficerSchedule = () => {
    setOfficerWarningAcknowledged(true);
    setOfficerWarningOpen(false);
    processSchedule(true);
  };

  const toggleEvent = (id: string) => {
    if (isGoogleSelectionLocked(googleEventStates.get(id))) return;
    setIcsExported(false);
    setSelectedEvents((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = (checked: boolean) => {
    setIcsExported(false);
    setSelectedEvents(
      checked && result
        ? new Set(
            result.events
              .filter((event) => !isGoogleSelectionLocked(googleEventStates.get(event.id)))
              .map((event) => event.id),
          )
        : new Set(),
    );
  };

  const exportIcs = () => {
    if (
      !selectedMonth ||
      !employee ||
      selectedCalendarEvents.length === 0 ||
      exportPreferencesError
    ) {
      return;
    }
    downloadIcs(
      buildIcs(selectedCalendarEvents, new Date(), calendarExportPreferences),
      icsFileName(employee.name, selectedMonth.year, selectedMonth.month),
    );
    setIcsExported(true);
  };

  const markGoogleEventStarted = (eventId: string) => {
    setGoogleEventStates((current) => {
      const next = new Map(current);
      next.set(eventId, {
        status: 'Létrehozás folyamatban',
        message: 'A Google Naptár ellenőrzése és az esemény létrehozása folyamatban van.',
      });
      return next;
    });
  };

  const applyGoogleResult = (googleResult: GoogleWriteResult) => {
    setGoogleEventStates((current) => {
      const next = new Map(current);
      next.set(googleResult.eventId, googleResult);
      return next;
    });
    if (
      googleResult.status === 'Létrehozva' ||
      googleResult.status === 'Már szerepel a naptárban'
    ) {
      setSelectedEvents((current) => {
        const next = new Set(current);
        next.delete(googleResult.eventId);
        return next;
      });
    }
  };

  const resetAfterCalendarChange = () => {
    setGoogleEventStates(new Map());
    setSelectedEvents(new Set(result?.events.map((event) => event.id) ?? []));
    setIcsExported(false);
  };

  const useAutomaticEventTitle = () => {
    const nextPreferences: CalendarExportPreferences = {
      ...calendarExportPreferencesRef.current,
      titleMode: 'automatic',
      customTitle: '',
    };
    applyCalendarExportPreferences(nextPreferences);
    persistCalendarExportSettings(savedCustomTitlesRef.current, nextPreferences);
    setIcsExported(false);
  };

  const useSavedEventTitle = (title: string) => {
    const nextTitles = moveSavedTitleToFront(savedCustomTitlesRef.current, title);
    const selectedTitle = nextTitles[0] ?? '';
    const nextPreferences: CalendarExportPreferences = {
      ...calendarExportPreferencesRef.current,
      titleMode: 'custom',
      customTitle: selectedTitle,
    };
    applySavedCustomTitles(nextTitles);
    applyCalendarExportPreferences(nextPreferences);
    persistCalendarExportSettings(nextTitles, nextPreferences);
    setIcsExported(false);
  };

  const deleteSavedEventTitle = (title: string) => {
    const normalized = title.toLocaleLowerCase('hu-HU');
    const nextTitles = savedCustomTitlesRef.current.filter(
      (candidate) => candidate.toLocaleLowerCase('hu-HU') !== normalized,
    );
    const currentPreferences = calendarExportPreferencesRef.current;
    const deletedWasSelected =
      currentPreferences.titleMode === 'custom' &&
      currentPreferences.customTitle.toLocaleLowerCase('hu-HU') === normalized;
    const nextPreferences: CalendarExportPreferences = deletedWasSelected
      ? {
          ...currentPreferences,
          titleMode: 'automatic',
          customTitle: '',
        }
      : currentPreferences;
    applySavedCustomTitles(nextTitles);
    applyCalendarExportPreferences(nextPreferences);
    persistCalendarExportSettings(nextTitles, nextPreferences);
    setIcsExported(false);
  };

  const selectGoogleEventColor = (colorId: string) => {
    preferredGoogleColorIdRef.current = colorId;
    const nextPreferences: CalendarExportPreferences = {
      ...calendarExportPreferencesRef.current,
      googleColorId: colorId,
    };
    applyCalendarExportPreferences(nextPreferences);
    persistCalendarExportSettings(savedCustomTitlesRef.current, nextPreferences);
  };

  const resetCalendarExportDefaults = () => {
    const nextPreferences = createDefaultCalendarExportPreferences();
    if (!googleEventColors.some((color) => color.colorId === DEFAULT_GOOGLE_EVENT_COLOR.colorId)) {
      nextPreferences.googleColorId =
        googleEventColors[0]?.colorId ?? DEFAULT_GOOGLE_EVENT_COLOR.colorId;
    }
    preferredGoogleColorIdRef.current = nextPreferences.googleColorId;
    applyCalendarExportPreferences(nextPreferences);
    persistCalendarExportSettings(savedCustomTitlesRef.current, nextPreferences);
    setIcsExported(false);
  };

  const applyGoogleEventColors = (colors: GoogleEventColorOption[], warning?: string) => {
    setGoogleEventColors(colors);
    const hasDefaultColor = colors.some(
      (color) => color.colorId === DEFAULT_GOOGLE_EVENT_COLOR.colorId,
    );
    const preferredColorId = preferredGoogleColorIdRef.current;
    const preferredAvailable = colors.some((color) => color.colorId === preferredColorId);
    const nextColorId = preferredAvailable
      ? preferredColorId
      : hasDefaultColor
        ? DEFAULT_GOOGLE_EVENT_COLOR.colorId
        : (colors[0]?.colorId ?? DEFAULT_GOOGLE_EVENT_COLOR.colorId);
    const nextWarning =
      warning ??
      (!hasDefaultColor && colors.length > 0 ? GOOGLE_COLOR_DEFAULT_MISSING_WARNING : undefined);
    setGoogleColorPaletteWarning(nextWarning);

    const nextPreferences: CalendarExportPreferences = {
      ...calendarExportPreferencesRef.current,
      googleColorId: nextColorId,
    };
    applyCalendarExportPreferences(nextPreferences);
    if (!warning && !preferredAvailable) {
      preferredGoogleColorIdRef.current = nextColorId;
      persistCalendarExportSettings(savedCustomTitlesRef.current, nextPreferences);
    }
  };

  const startNewSchedule = () => {
    setRoleFiles(initialRoleFiles());
    setSelectedRole(undefined);
    setSelectedMonthKey('');
    setEmployeeName('');
    setEmployeeRow(undefined);
    setCrewSearchEnabled(false);
    setResult(undefined);
    setSelectedEvents(new Set());
    setError(undefined);
    setNotice('');
    setIcsExported(false);
    resetOfficerWarningState();
    resetCalendarExportPreferenceSelection();
    resetGoogleUpload();
    uploadSectionRef.current?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'start',
    });
  };

  const navigateWorkflow = (stepId: WorkflowStepId) => {
    const selectionTarget = selectionSectionRef.current ?? uploadSectionRef.current;
    const target =
      stepId === 'file'
        ? uploadSectionRef.current
        : stepId === 'month' || stepId === 'employee' || stepId === 'processing'
          ? selectionTarget
          : stepId === 'review'
            ? reviewSectionRef.current
            : exportSectionRef.current;
    target?.scrollIntoView({
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="brand-mark" aria-hidden="true">
          B
        </div>
        <div>
          <p className="eyebrow">Biztonságos, helyi feldolgozás</p>
          <h1>Beosztáskezelő</h1>
          <p>Alakítsd át az Excel-beosztást ellenőrzött naptáreseményekké.</p>
        </div>
      </header>

      <main>
        <Stepper steps={workflowSteps} onNavigate={navigateWorkflow} />
        <FileUpload
          ref={fileUploadRef}
          sectionRef={uploadSectionRef}
          files={roleFiles}
          disabled={busy}
          onFile={(role, file) => void handleRoleFile(role, file)}
          onRemove={removeRoleFile}
        />
        <ErrorNotice error={error} />
        {notice && (
          <div className="notice warning" role="status">
            {notice}
          </div>
        )}
        {continuedWithoutOfficer && (
          <div className="notice warning" role="status">
            A feldolgozás mentőtiszti beosztás nélkül folytatódott. Az esetkocsis társlista ezért
            hiányos lehet.
          </div>
        )}

        {availableRoles.length > 0 && (
          <section
            ref={selectionSectionRef}
            className="panel workflow-section"
            aria-labelledby="selection-heading"
          >
            <div className="section-heading">
              <span className="eyebrow">2–4. lépés</span>
              <h2 id="selection-heading">Beosztás kiválasztása</h2>
            </div>
            <div className="form-grid">
              <label>
                Kinek a beosztását szeretnéd feldolgozni?
                <select
                  value={selectedRole ?? ''}
                  onChange={(event) => selectRole(event.target.value as StaffRole)}
                >
                  {availableRoles.map((role) => (
                    <option key={role} value={role}>
                      {STAFF_ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Hónap
                <select
                  value={selectedMonthKey}
                  onChange={(event) => selectMonth(event.target.value)}
                >
                  {session?.months.map((month) => (
                    <option key={monthOptionValue(month)} value={monthOptionValue(month)}>
                      {monthOptionLabel(month)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Dolgozó
                <select
                  value={employeeName}
                  onChange={(event) => selectEmployee(event.target.value)}
                >
                  <option value="">Válassz dolgozót…</option>
                  {selectedMonth?.employees.map((item) => (
                    <option key={item.normalizedName} value={item.normalizedName}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              {employee && employee.rows.length > 1 && (
                <label>
                  Sor kézi kiválasztása
                  <select
                    value={employeeRow ?? ''}
                    onChange={(event) => selectEmployeeRow(Number(event.target.value) || undefined)}
                  >
                    <option value="">Válassz sort…</option>
                    {employee.rows.map((row) => (
                      <option key={row} value={row}>
                        {row}. sor
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <label className="crew-search-toggle">
              <input
                type="checkbox"
                checked={crewSearchActive}
                disabled={!crewSearchAvailability.enabled}
                aria-describedby="crew-search-availability"
                onChange={(event) => toggleCrewSearch(event.target.checked)}
              />
              <span>
                <strong>Szolgálati társak keresése</strong>
                <small id="crew-search-availability">
                  {crewSearchAvailability.enabled
                    ? 'A gépkocsivezetői és a mentőápolói beosztás kiválasztott hónapja alapján.'
                    : crewSearchAvailability.message}
                </small>
              </span>
            </label>
            {selectedMonth && selectedMonth.warnings.length > 0 && (
              <div className="notice warning">
                <strong>Forrásadat-ellenőrzés</strong>
                <ul>
                  {selectedMonth.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
            {supplementalMonthWarnings.length > 0 && (
              <div className="notice warning">
                <strong>Kiegészítő beosztások</strong>
                <ul>
                  {supplementalMonthWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
            <button
              type="button"
              className="button primary"
              disabled={
                !employeeName ||
                (Boolean(employee && employee.rows.length > 1) && employeeRow === undefined)
              }
              onClick={() => processSchedule()}
            >
              Beosztás feldolgozása
            </button>
          </section>
        )}

        {result && (
          <>
            <SummaryCards summary={result.summary} />
            <ReviewTable
              sectionRef={reviewSectionRef}
              rows={result.rows}
              selected={selectedEvents}
              googleStates={googleEventStates}
              crewSearchEnabled={crewSearchActive}
              onToggle={toggleEvent}
              onSelectAll={selectAll}
            />
            <section
              ref={exportSectionRef}
              className="panel export-panel workflow-section"
              aria-labelledby="export-heading"
            >
              <div>
                <span className="eyebrow">6. lépés</span>
                <h2 id="export-heading">Export</h2>
                <p>
                  <strong>{selectedCalendarEvents.length}</strong> kijelölt, biztos esemény kerül az
                  ICS-fájlba.
                </p>
                <p className="notice neutral ics-color-note">
                  Az ICS-fájl tartalmazza a kiválasztott eseménynevet. Az esemény színét az
                  importáláshoz használt naptáralkalmazás határozza meg.
                </p>
              </div>
              <button
                type="button"
                className="button primary"
                onClick={exportIcs}
                disabled={selectedCalendarEvents.length === 0 || Boolean(exportPreferencesError)}
              >
                ICS letöltése
              </button>
            </section>
          </>
        )}
        <GooglePanel
          visible={Boolean(result)}
          events={selectedCalendarEvents}
          resetKey={googleUploadResetKey}
          onEventStart={markGoogleEventStarted}
          onResult={applyGoogleResult}
          onCalendarChange={resetAfterCalendarChange}
          onNewSchedule={startNewSchedule}
          preferences={calendarExportPreferences}
          preferencesError={exportPreferencesError}
          onEventColorsChange={applyGoogleEventColors}
          onConnectionChange={handleGoogleConnectionChange}
          colorReloadRequest={colorReloadRequest}
          eventSettings={
            googleConnected && result && result.events.length > 0 ? (
              <CalendarEventSettings
                events={selectedCalendarEvents}
                preferences={calendarExportPreferences}
                colors={googleEventColors}
                savedCustomTitles={savedCustomTitles}
                paletteWarning={googleColorPaletteWarning}
                persistenceUnavailable={preferencePersistenceUnavailable}
                attentionRequested={calendarSettingsAttentionRequested}
                onAttentionHandled={handleCalendarSettingsAttention}
                onUseAutomatic={useAutomaticEventTitle}
                onUseSavedTitle={useSavedEventTitle}
                onSaveCustomTitle={useSavedEventTitle}
                onDeleteCustomTitle={deleteSavedEventTitle}
                onColorChange={selectGoogleEventColor}
                onReloadColors={() => setColorReloadRequest((current) => current + 1)}
                onReset={resetCalendarExportDefaults}
              />
            ) : undefined
          }
        />
        <OfficerScheduleWarningDialog
          open={officerWarningOpen}
          onUploadOfficerSchedule={uploadOfficerSchedule}
          onContinueWithoutOfficer={continueWithoutOfficerSchedule}
        />
      </main>
      <BackToTopButton />
      <footer>Az alkalmazás nem küldi el és nem tárolja a feltöltött beosztást.</footer>
    </div>
  );
}
