import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, CalendarExportPreferences } from '../src/domain/types';
import type { AppError } from '../src/domain/errors';
import { GoogleCalendarClient, GoogleTokenSession } from '../src/services/googleCalendar';
import { requestGoogleAccessToken } from '../src/services/googleOAuth';

const item: CalendarEvent = {
  id: 'event-1',
  summary: 'OMSZ',
  shiftType: 'Nappalos 06–18',
  serviceCategory: 'Nappalos 06–18',
  shiftTime: { start: '2026-08-10T06:00:00', end: '2026-08-10T18:00:00' },
  calendarTime: { start: '2026-08-10T06:00:00', end: '2026-08-10T18:00:00' },
  timeZone: 'Europe/Budapest',
};

const kmrItem: CalendarEvent = {
  ...item,
  id: 'event-kmr',
  summary: 'KMR',
  shiftType: 'KMR',
  serviceCategory: 'KMR',
  shiftTime: { start: '2026-08-11T05:00:00', end: '2026-08-12T01:00:00' },
  calendarTime: { start: '2026-08-11T05:00:00', end: '2026-08-12T01:00:00' },
};

const twentyFourHourItem: CalendarEvent = {
  ...item,
  id: 'event-24-hour',
  shiftType: '24 órás szolgálat',
  serviceCategory: 'Parti szolgálat',
  shiftTime: { start: '2026-08-31T07:00:00', end: '2026-09-01T07:00:00' },
  calendarTime: { start: '2026-08-31T07:00:00', end: '2026-09-01T06:59:00' },
};

const partyTwelveItem: CalendarEvent = {
  ...item,
  id: 'event-party-12',
  shiftType: 'Nappalos 07–19',
  serviceCategory: 'Parti szolgálat',
  shiftTime: { start: '2026-08-12T07:00:00', end: '2026-08-12T19:00:00' },
  calendarTime: { start: '2026-08-12T07:00:00', end: '2026-08-12T19:00:00' },
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestUrl(input: RequestInfo | URL | undefined): string {
  if (!input) return '';
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

describe('Google Naptár szolgáltatás', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a böngészős fetch-et window kontextussal és Bearer tokennel hívja', async () => {
    let receivedHeaders: Headers | undefined;
    const strictWindowFetch = vi.fn(function (
      this: typeof globalThis,
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      if (this !== window) throw new TypeError('Illegal invocation');
      receivedHeaders = new Headers(init?.headers);
      return Promise.resolve(
        response({
          items: [{ id: 'primary', summary: 'Elsődleges', accessRole: 'owner' }],
        }),
      );
    });
    vi.stubGlobal('fetch', strictWindowFetch);

    const calendars = await new GoogleCalendarClient(
      'regression-access-token',
    ).listWritableCalendars();

    expect(calendars).toHaveLength(1);
    expect(strictWindowFetch).toHaveBeenCalledOnce();
    expect(receivedHeaders?.get('Authorization')).toBe('Bearer regression-access-token');
  });

  it('csak pontos summary/start/end egyezést tekint duplikációnak', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(
        response({
          items: [
            {
              summary: 'OMSZ',
              start: { dateTime: '2026-08-10T04:00:00Z' },
              end: { dateTime: '2026-08-10T16:00:00Z' },
            },
          ],
        }),
      );
    await expect(
      new GoogleCalendarClient('token', fetcher).isDuplicate('primary', item),
    ).resolves.toBe(true);
  });

  it('eltérő név vagy időpont nem duplikáció', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(
        response({
          items: [
            {
              summary: 'KMR',
              start: { dateTime: '2026-08-10T04:00:00Z' },
              end: { dateTime: '2026-08-10T16:00:00Z' },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(
        response({
          items: [
            {
              summary: 'OMSZ',
              start: { dateTime: '2026-08-10T05:00:00Z' },
              end: { dateTime: '2026-08-10T16:00:00Z' },
            },
          ],
        }),
      );
    const client = new GoogleCalendarClient('token', fetcher);
    await expect(client.isDuplicate('primary', item)).resolves.toBe(false);
    await expect(client.isDuplicate('primary', item)).resolves.toBe(false);
  });

  it('17–7 esetén kizárólag a 06:59-es naptári befejezést tekinti duplikációnak', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(
        response({
          items: [
            {
              summary: 'OMSZ',
              start: { dateTime: '2026-08-31T07:00:00+02:00' },
              end: { dateTime: '2026-09-01T06:59:00+02:00' },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(
        response({
          items: [
            {
              summary: 'OMSZ',
              start: { dateTime: '2026-08-31T07:00:00+02:00' },
              end: { dateTime: '2026-09-01T06:55:00+02:00' },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(
        response({
          items: [
            {
              summary: 'OMSZ',
              start: { dateTime: '2026-08-31T07:00:00+02:00' },
              end: { dateTime: '2026-09-01T07:00:00+02:00' },
            },
          ],
        }),
      );
    const client = new GoogleCalendarClient('token', fetcher);

    await expect(client.isDuplicate('primary', twentyFourHourItem)).resolves.toBe(true);
    await expect(client.isDuplicate('primary', twentyFourHourItem)).resolves.toBe(false);
    await expect(client.isDuplicate('primary', twentyFourHourItem)).resolves.toBe(false);
  });

  it('17–7 feltöltésnél a request body a 07:00–másnap 06:59 naptári időt használja', async () => {
    let requestBody: unknown;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      if (typeof init?.body !== 'string') throw new Error('Hiányzó JSON request body.');
      requestBody = JSON.parse(init.body) as unknown;
      return Promise.resolve(response({ id: 'created-24-hour', colorId: '10' }));
    });

    await new GoogleCalendarClient('token', fetcher).insertEvent('primary', twentyFourHourItem);

    expect(requestBody).toMatchObject({
      summary: 'OMSZ',
      description: '',
      start: {
        dateTime: '2026-08-31T07:00:00',
        timeZone: 'Europe/Budapest',
      },
      end: {
        dateTime: '2026-09-01T06:59:00',
        timeZone: 'Europe/Budapest',
      },
    });
  });

  it('Parti 12 feltöltésnél a request body a 07:00–19:00 időt és üres leírást használja', async () => {
    let requestBody: unknown;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      if (typeof init?.body !== 'string') throw new Error('Hiányzó JSON request body.');
      requestBody = JSON.parse(init.body) as unknown;
      return Promise.resolve(response({ id: 'created-party-12', colorId: '10' }));
    });

    await new GoogleCalendarClient('token', fetcher).insertEvent('primary', partyTwelveItem);

    expect(requestBody).toMatchObject({
      summary: 'OMSZ',
      description: '',
      start: {
        dateTime: '2026-08-12T07:00:00',
        timeZone: 'Europe/Budapest',
      },
      end: {
        dateTime: '2026-08-12T19:00:00',
        timeZone: 'Europe/Budapest',
      },
      colorId: '10',
    });
  });

  it('részleges API-hibát eseményenként jelez', async () => {
    const second = {
      ...item,
      id: 'event-2',
      shiftTime: { start: '2026-08-11T06:00:00', end: '2026-08-11T18:00:00' },
      calendarTime: { start: '2026-08-11T06:00:00', end: '2026-08-11T18:00:00' },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(response({ id: 'created-1', colorId: '10' }))
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(response({ error: { message: 'quota' } }, 429));
    const results = await new GoogleCalendarClient('token', fetcher).addEvents('primary', [
      item,
      second,
    ]);
    expect(results.map((result) => result.status)).toEqual(['Létrehozva', 'Sikertelen']);
  });

  it('az eseményenkénti kezdő- és eredmény callbacket folyamatosan meghívja', async () => {
    const onStart = vi.fn();
    const onResult = vi.fn();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(response({ id: 'created-1', colorId: '10' }))
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(response({ id: 'created-2', colorId: '10' }));

    await new GoogleCalendarClient('token', fetcher).addEvents('primary', [item, kmrItem], {
      onStart,
      onResult,
    });

    expect(onStart).toHaveBeenNthCalledWith(1, item);
    expect(onStart).toHaveBeenNthCalledWith(2, kmrItem);
    expect(onResult).toHaveBeenNthCalledWith(1, expect.objectContaining({ eventId: 'event-1' }));
    expect(onResult).toHaveBeenNthCalledWith(2, expect.objectContaining({ eventId: 'event-kmr' }));
  });

  it('lejárt tokennél megáll, és a hátralévő eseményt nem jelöli sikertelennek', async () => {
    const onResult = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ error: 'expired' }, 401));

    const results = await new GoogleCalendarClient('token', fetcher).addEvents(
      'primary',
      [item, kmrItem],
      { onResult },
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      eventId: 'event-1',
      status: 'Sikertelen',
      errorCode: 'GOOGLE_TOKEN_EXPIRED',
    });
    expect(onResult).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: 'hálózati hibát',
      fetcher: () => vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')),
      errorCode: 'GOOGLE_NETWORK_ERROR',
    },
    {
      name: 'nem írható naptárt',
      fetcher: () => vi.fn<typeof fetch>().mockResolvedValue(response({ error: 'forbidden' }, 403)),
      errorCode: 'GOOGLE_CALENDAR_NOT_WRITABLE',
    },
    {
      name: 'API-hibát',
      fetcher: () => vi.fn<typeof fetch>().mockResolvedValue(response({ error: 'backend' }, 500)),
      errorCode: 'GOOGLE_API_ERROR',
    },
  ] as const)('külön eredménykóddal jelzi: $name', async ({ fetcher, errorCode }) => {
    const [result] = await new GoogleCalendarClient('token', fetcher()).addEvents('primary', [
      item,
    ]);
    expect(result).toMatchObject({ status: 'Sikertelen', errorCode });
  });

  it.each([
    ['OMSZ', item],
    ['KMR', kmrItem],
  ] as const)(
    'a(z) %s esemény request body-jában explicit colorId 10-et küld, és kiolvassa a válaszból',
    async (_eventType, calendarEvent) => {
      let requestBody: unknown;
      const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
        if (typeof init?.body !== 'string') throw new Error('Hiányzó JSON request body.');
        requestBody = JSON.parse(init.body) as unknown;
        return Promise.resolve(response({ id: `created-${calendarEvent.id}`, colorId: '10' }));
      });

      const created = await new GoogleCalendarClient('token', fetcher).insertEvent(
        'primary',
        calendarEvent,
      );

      expect(requestBody).toMatchObject({
        summary: calendarEvent.summary,
        colorId: '10',
      });
      expect(created.colorId).toBe('10');
    },
  );

  it('jelzi, ha a Google válasza nem a kért colorId 10-et igazolja vissza', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(response({ id: 'created-1', colorId: '5' }));

    const [result] = await new GoogleCalendarClient('token', fetcher).addEvents('primary', [item]);

    expect(result).toMatchObject({ status: 'Létrehozva' });
    expect(result?.message).toContain('nem a kiválasztott eseményszínt igazolta vissza');
    expect(result?.technicalDetails).toContain('Kért colorId: 10');
    expect(result?.technicalDetails).toContain('Visszakapott colorId: 5');
  });

  it('a már létező eseményt nem írja és nem színezi át', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(
        response({
          items: [
            {
              summary: 'OMSZ',
              start: { dateTime: '2026-08-10T04:00:00Z' },
              end: { dateTime: '2026-08-10T16:00:00Z' },
            },
          ],
        }),
      );

    const [result] = await new GoogleCalendarClient('token', fetcher).addEvents('primary', [item]);

    expect(result?.status).toBe('Már szerepel a naptárban');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every((call) => call[1]?.method === undefined)).toBe(true);
  });

  it('a stabil belső azonosítót a cím vizsgálata előtt duplikációként felismeri', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response({
        items: [
          {
            summary: 'Korábbi egyéni cím',
            extendedProperties: {
              private: { beosztasKezeloEventId: item.id },
            },
          },
        ],
      }),
    );

    await expect(
      new GoogleCalendarClient('token', fetcher).isDuplicate('primary', item),
    ).resolves.toBe(true);
    expect(requestUrl(fetcher.mock.calls[0]?.[0])).toContain(
      'privateExtendedProperty=beosztasKezeloEventId%3Devent-1',
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('egyéni cím mellett a korábbi automatikus OMSZ-címet is legacy duplikációnak tekinti', async () => {
    const preferences: CalendarExportPreferences = {
      titleMode: 'custom',
      customTitle: 'Saját szolgálat',
      googleColorId: '9',
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(
        response({
          items: [
            {
              summary: 'OMSZ',
              start: { dateTime: '2026-08-10T04:00:00Z' },
              end: { dateTime: '2026-08-10T16:00:00Z' },
            },
          ],
        }),
      );

    const [result] = await new GoogleCalendarClient('token', fetcher).addEvents('primary', [item], {
      preferences,
    });

    expect(result?.status).toBe('Már szerepel a naptárban');
    expect(fetcher.mock.calls.every((call) => call[1]?.method === undefined)).toBe(true);
  });

  it('az egyéni címet, választott colorId-t és stabil azonosítót küldi a Google request body-ban', async () => {
    const preferences: CalendarExportPreferences = {
      titleMode: 'custom',
      customTitle: '  Saját szolgálat  ',
      googleColorId: '9',
    };
    let requestBody: unknown;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      if (typeof init?.body !== 'string') throw new Error('Hiányzó JSON request body.');
      requestBody = JSON.parse(init.body) as unknown;
      return Promise.resolve(response({ id: 'created-custom', colorId: '9' }));
    });

    await new GoogleCalendarClient('token', fetcher).insertEvent(
      'primary',
      item,
      undefined,
      preferences,
    );

    expect(requestBody).toMatchObject({
      summary: 'Saját szolgálat',
      colorId: '9',
      extendedProperties: {
        private: { beosztasKezeloEventId: item.id },
      },
    });
  });

  it('a kiválasztott címet és színt az eredmény visszajelzésében is rögzíti', async () => {
    const preferences: CalendarExportPreferences = {
      titleMode: 'custom',
      customTitle: 'Saját szolgálat',
      googleColorId: '9',
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(response({ id: 'created-custom', colorId: '9' }));

    const [result] = await new GoogleCalendarClient('token', fetcher).addEvents('primary', [item], {
      preferences,
    });

    expect(result).toMatchObject({
      status: 'Létrehozva',
      message: 'Az eseményt a Google Naptár a kiválasztott Kék színnel létrehozta.',
    });
    expect(result?.technicalDetails).toContain('Kért colorId: 9');
    expect(result?.technicalDetails).toContain('Visszakapott colorId: 9');
    expect(result?.technicalDetails).toContain('Kiválasztott eseménycím: Saját szolgálat');
    expect(result?.technicalDetails).toContain('Eredeti automatikus eseménycím: OMSZ');
  });

  it('betölti és colorId szerint rendezi a Google eseményszín-palettáját', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response({
        event: {
          '10': { background: '#51b749', foreground: '#ffffff' },
          '2': { background: '#7ae7bf', foreground: '#1d1d1d' },
          '42': { background: '#123456', foreground: '#fedcba' },
        },
        calendar: {
          '99': { background: '#000000', foreground: '#ffffff' },
        },
      }),
    );

    const colors = await new GoogleCalendarClient('token', fetcher).listEventColors();

    expect(colors.map((color) => color.colorId)).toEqual(['2', '10', '42']);
    expect(colors[1]).toMatchObject({
      label: 'Sötétzöld',
      background: '#51b749',
    });
    expect(colors[2]).toMatchObject({
      label: 'Egyéb szín',
      foreground: '#fedcba',
    });
    expect(colors.some((color) => color.colorId === '99')).toBe(false);
  });

  it('nem egészíti ki fix Basil-elemmel a Google által vissza nem adott palettát', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response({
        event: {
          '3': { background: '#dbadff', foreground: '#1d1d1d' },
        },
      }),
    );

    const colors = await new GoogleCalendarClient('token', fetcher).listEventColors();

    expect(colors.map((color) => color.colorId)).toEqual(['3']);
  });

  it('konfiguráció nélkül érthető hibát ad', async () => {
    await expect(requestGoogleAccessToken('')).rejects.toMatchObject({
      code: 'GOOGLE_NOT_CONFIGURED',
    } satisfies Partial<AppError>);
  });

  it('kijelentkezéskor memóriából törli és visszavonja a tokent', () => {
    const session = new GoogleTokenSession();
    const revoke = vi.fn();
    session.set('secret-token');
    session.signOut(revoke);
    expect(session.get()).toBeUndefined();
    expect(revoke).toHaveBeenCalledWith('secret-token');
  });
});
