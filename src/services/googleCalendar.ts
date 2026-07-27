import type {
  CalendarEvent,
  CalendarExportPreferences,
  GoogleEventColorOption,
  ReviewStatus,
} from '../domain/types';
import { AppError, type AppErrorCode } from '../domain/errors';
import { calendarEventDescription } from './calendarEventDescription';
import {
  DEFAULT_CALENDAR_EXPORT_PREFERENCES,
  googleEventColorLabel,
  resolveCalendarEventTitle,
} from './calendarExportPreferences';
import { addDays, instantToLocal, localDateKey, localDateTime, zonedLocalToInstant } from './dates';

const API_ROOT = 'https://www.googleapis.com/calendar/v3';
export const BEOSZTAS_KEZELO_EVENT_ID_PROPERTY = 'beosztasKezeloEventId';

const browserFetch: typeof fetch = (input, init) => window.fetch(input, init);

export interface GoogleCalendarListItem {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole: string;
}

interface GoogleEventItem {
  id?: string;
  summary?: string;
  colorId?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  extendedProperties?: {
    private?: Record<string, string>;
  };
}

interface CalendarListResponse {
  items?: GoogleCalendarListItem[];
}

interface EventsResponse {
  items?: GoogleEventItem[];
}

interface ColorsResponse {
  event?: Record<string, { background?: string; foreground?: string }>;
}

export interface GoogleWriteResult {
  eventId: string;
  status: Extract<ReviewStatus, 'Már szerepel a naptárban' | 'Létrehozva' | 'Sikertelen'>;
  message: string;
  errorCode?: Extract<
    AppErrorCode,
    | 'GOOGLE_TOKEN_EXPIRED'
    | 'GOOGLE_NETWORK_ERROR'
    | 'GOOGLE_CALENDAR_NOT_WRITABLE'
    | 'GOOGLE_API_ERROR'
  >;
  technicalDetails?: string;
}

export interface GoogleUploadOptions {
  signal?: AbortSignal;
  preferences?: CalendarExportPreferences;
  onStart?: (event: CalendarEvent) => void;
  onResult?: (result: GoogleWriteResult) => void;
}

function googleTechnicalDetails(
  item: CalendarEvent,
  preferences: CalendarExportPreferences,
  returnedColorId?: string,
  extra?: string,
): string {
  return [
    `Kért colorId: ${preferences.googleColorId}`,
    `Visszakapott colorId: ${returnedColorId ?? '—'}`,
    `Kiválasztott eseménycím: ${resolveCalendarEventTitle(item, preferences)}`,
    `Eredeti automatikus eseménycím: ${item.summary}`,
    ...(extra ? [extra] : []),
  ].join('\n');
}

async function parseGoogleError(response: Response): Promise<AppError> {
  const details = await response.text();
  if (response.status === 401) return new AppError('GOOGLE_TOKEN_EXPIRED', details);
  if (response.status === 403) return new AppError('GOOGLE_CALENDAR_NOT_WRITABLE', details);
  return new AppError('GOOGLE_API_ERROR', `${response.status}: ${details}`);
}

export class GoogleCalendarClient {
  constructor(
    private readonly accessToken: string,
    private readonly fetcher: typeof fetch = browserFetch,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${API_ROOT}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          ...init?.headers,
        },
      });
    } catch (error) {
      throw new AppError(
        'GOOGLE_NETWORK_ERROR',
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!response.ok) throw await parseGoogleError(response);
    return (await response.json()) as T;
  }

  async listWritableCalendars(): Promise<GoogleCalendarListItem[]> {
    const response = await this.request<CalendarListResponse>('/users/me/calendarList');
    return (response.items ?? []).filter((item) => ['owner', 'writer'].includes(item.accessRole));
  }

  async listEventColors(): Promise<GoogleEventColorOption[]> {
    const response = await this.request<ColorsResponse>('/colors');
    return Object.entries(response.event ?? {})
      .map(([colorId, value]) => ({
        colorId,
        background: value.background ?? '#5F6368',
        foreground: value.foreground ?? '#FFFFFF',
        label: googleEventColorLabel(colorId),
      }))
      .sort((left, right) => Number(left.colorId) - Number(right.colorId));
  }

  async isDuplicate(
    calendarId: string,
    item: CalendarEvent,
    signal?: AbortSignal,
    preferences: CalendarExportPreferences = DEFAULT_CALENDAR_EXPORT_PREFERENCES,
  ): Promise<boolean> {
    const stableIdQuery = new URLSearchParams({
      privateExtendedProperty: `${BEOSZTAS_KEZELO_EVENT_ID_PROPERTY}=${item.id}`,
      singleEvents: 'true',
      showDeleted: 'false',
    });
    const stableIdResponse = await this.request<EventsResponse>(
      `/calendars/${encodeURIComponent(calendarId)}/events?${stableIdQuery.toString()}`,
      { signal },
    );
    if (
      (stableIdResponse.items ?? []).some(
        (candidate) =>
          candidate.extendedProperties?.private?.[BEOSZTAS_KEZELO_EVENT_ID_PROPERTY] === item.id,
      )
    ) {
      return true;
    }

    const start = zonedLocalToInstant(item.calendarTime.start);
    const end = zonedLocalToInstant(item.calendarTime.end);
    const query = new URLSearchParams({
      timeMin: new Date(start.getTime() - 1000).toISOString(),
      timeMax: new Date(end.getTime() + 1000).toISOString(),
      singleEvents: 'true',
      showDeleted: 'false',
    });
    const response = await this.request<EventsResponse>(
      `/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`,
      { signal },
    );
    const acceptedTitles = new Set(
      item.roleAssignment
        ? [resolveCalendarEventTitle(item, preferences)]
        : [resolveCalendarEventTitle(item, preferences), item.summary],
    );
    return (response.items ?? []).some((candidate) => {
      const startValue = candidate.start?.dateTime;
      const endValue = candidate.end?.dateTime;
      if (
        !startValue ||
        !endValue ||
        !candidate.summary ||
        !acceptedTitles.has(candidate.summary)
      ) {
        return false;
      }
      return (
        instantToLocal(startValue) === item.calendarTime.start &&
        instantToLocal(endValue) === item.calendarTime.end
      );
    });
  }

  async hasPreviousMonthCarryoverOverlap(
    calendarId: string,
    item: CalendarEvent,
    signal?: AbortSignal,
    preferences: CalendarExportPreferences = DEFAULT_CALENDAR_EXPORT_PREFERENCES,
  ): Promise<boolean> {
    if (item.specialKind !== 'previous-month-carryover-partial') return false;

    const [year, month, day] = item.calendarTime.start.slice(0, 10).split('-').map(Number);
    if (!year || !month || !day) return false;
    const partialDate = { year, month, day };
    const previousDate = addDays(partialDate, -1);
    const partialStart = zonedLocalToInstant(item.calendarTime.start);
    const partialEnd = zonedLocalToInstant(item.calendarTime.end);
    const queryStart = zonedLocalToInstant(localDateTime(previousDate, '00:00'));
    const query = new URLSearchParams({
      timeMin: new Date(queryStart.getTime() - 1000).toISOString(),
      timeMax: new Date(partialEnd.getTime() + 1000).toISOString(),
      singleEvents: 'true',
      showDeleted: 'false',
    });
    const response = await this.request<EventsResponse>(
      `/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`,
      { signal },
    );
    const previousDateKey = localDateKey(previousDate);
    const partialDateKey = localDateKey(partialDate);
    const acceptedTitles = new Set(
      item.roleAssignment
        ? [resolveCalendarEventTitle(item, preferences)]
        : [resolveCalendarEventTitle(item, preferences), item.summary],
    );

    return (response.items ?? []).some((candidate) => {
      const startValue = candidate.start?.dateTime;
      const endValue = candidate.end?.dateTime;
      if (
        !startValue ||
        !endValue ||
        !candidate.summary ||
        !acceptedTitles.has(candidate.summary)
      ) {
        return false;
      }
      const candidateStartLocal = instantToLocal(startValue);
      const candidateEndLocal = instantToLocal(endValue);
      const acceptedEnd =
        candidateEndLocal === `${partialDateKey}T06:59:00` ||
        candidateEndLocal === `${partialDateKey}T07:00:00`;
      if (!acceptedEnd || !candidateStartLocal.startsWith(`${previousDateKey}T`)) {
        return false;
      }
      const candidateStart = new Date(startValue).getTime();
      const candidateEnd = new Date(endValue).getTime();
      return candidateStart < partialEnd.getTime() && candidateEnd > partialStart.getTime();
    });
  }

  async insertEvent(
    calendarId: string,
    item: CalendarEvent,
    signal?: AbortSignal,
    preferences: CalendarExportPreferences = DEFAULT_CALENDAR_EXPORT_PREFERENCES,
  ): Promise<GoogleEventItem> {
    return this.request<GoogleEventItem>(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      signal,
      body: JSON.stringify({
        summary: resolveCalendarEventTitle(item, preferences),
        description: calendarEventDescription(item),
        start: { dateTime: item.calendarTime.start, timeZone: item.timeZone },
        end: { dateTime: item.calendarTime.end, timeZone: item.timeZone },
        colorId: preferences.googleColorId,
        extendedProperties: {
          private: {
            [BEOSZTAS_KEZELO_EVENT_ID_PROPERTY]: item.id,
          },
        },
      }),
    });
  }

  async addEvents(
    calendarId: string,
    events: CalendarEvent[],
    options: GoogleUploadOptions = {},
  ): Promise<GoogleWriteResult[]> {
    const results: GoogleWriteResult[] = [];
    const preferences = options.preferences ?? DEFAULT_CALENDAR_EXPORT_PREFERENCES;
    for (const item of events) {
      if (options.signal?.aborted) break;
      options.onStart?.(item);
      let result: GoogleWriteResult;
      let carryoverOverlap: boolean | undefined;
      try {
        carryoverOverlap =
          item.specialKind === 'previous-month-carryover-partial'
            ? await this.hasPreviousMonthCarryoverOverlap(
                calendarId,
                item,
                options.signal,
                preferences,
              )
            : undefined;
        const duplicate =
          carryoverOverlap === undefined
            ? await this.isDuplicate(calendarId, item, options.signal, preferences)
            : carryoverOverlap ||
              (await this.isDuplicate(calendarId, item, options.signal, preferences));
        if (duplicate) {
          result = {
            eventId: item.id,
            status: 'Már szerepel a naptárban',
            message: carryoverOverlap
              ? 'Már szerepel a naptárban az előző hónapról áthúzódó teljes szolgálat.'
              : 'Azonos belső azonosítójú vagy azonos nevű és időpontú esemény már létezik.',
            technicalDetails: googleTechnicalDetails(
              item,
              preferences,
              undefined,
              carryoverOverlap === undefined
                ? undefined
                : 'Átfedő előző havi teljes esemény található: igen.',
            ),
          };
        } else {
          const created = await this.insertEvent(calendarId, item, options.signal, preferences);
          const colorConfirmed = created.colorId === preferences.googleColorId;
          const selectedColorLabel = googleEventColorLabel(preferences.googleColorId);
          result = {
            eventId: item.id,
            status: 'Létrehozva',
            message: colorConfirmed
              ? `Az eseményt a Google Naptár a kiválasztott ${selectedColorLabel} színnel létrehozta.`
              : 'Az esemény létrejött, de a Google nem a kiválasztott eseményszínt igazolta vissza.',
            technicalDetails: googleTechnicalDetails(
              item,
              preferences,
              created.colorId,
              carryoverOverlap === undefined
                ? undefined
                : 'Átfedő előző havi teljes esemény található: nem.',
            ),
          };
        }
      } catch (error) {
        if (options.signal?.aborted) break;
        const appError =
          error instanceof AppError
            ? error
            : new AppError(
                'GOOGLE_API_ERROR',
                error instanceof Error ? error.message : String(error),
              );
        result = {
          eventId: item.id,
          status: 'Sikertelen',
          message: appError.message,
          errorCode:
            appError.code === 'GOOGLE_TOKEN_EXPIRED' ||
            appError.code === 'GOOGLE_NETWORK_ERROR' ||
            appError.code === 'GOOGLE_CALENDAR_NOT_WRITABLE' ||
            appError.code === 'GOOGLE_API_ERROR'
              ? appError.code
              : 'GOOGLE_API_ERROR',
          technicalDetails: googleTechnicalDetails(
            item,
            preferences,
            undefined,
            appError.technicalDetails,
          ),
        };
      }
      results.push(result);
      options.onResult?.(result);
      if (result.errorCode === 'GOOGLE_TOKEN_EXPIRED') break;
    }
    return results;
  }
}

export class GoogleTokenSession {
  private token?: string;

  set(token: string): void {
    this.token = token;
  }

  get(): string | undefined {
    return this.token;
  }

  clear(): void {
    this.token = undefined;
  }

  signOut(revoke?: (token: string) => void): void {
    const current = this.token;
    this.clear();
    if (current && revoke) revoke(current);
  }
}
