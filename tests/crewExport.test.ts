import { describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, CrewMemberMatch, StaffRole } from '../src/domain/types';
import { calendarEventDescription } from '../src/services/calendarEventDescription';
import { GoogleCalendarClient } from '../src/services/googleCalendar';
import { buildIcs, stableUid } from '../src/services/ics';

const baseEvent: CalendarEvent = {
  id: 'crew-event',
  summary: 'OMSZ',
  shiftType: '24 órás szolgálat',
  serviceCategory: 'Esetszolgálat',
  shiftTime: {
    start: '2026-08-10T07:00:00',
    end: '2026-08-11T07:00:00',
  },
  calendarTime: {
    start: '2026-08-10T07:00:00',
    end: '2026-08-11T06:59:00',
  },
  timeZone: 'Europe/Budapest',
  inference: {
    source: 'daily-service-pattern',
    target: 'emergency',
    explanation: 'Technikai tesztmagyarázat.',
  },
};

function crew(
  role: StaffRole,
  displayName: string,
  start: string,
  end: string,
  employeeRow: number,
): CrewMemberMatch {
  return {
    role,
    employeeName: displayName,
    normalizedName: displayName.toLocaleLowerCase('hu-HU'),
    employeeRow,
    displayName,
    serviceCategory: 'Esetszolgálat',
    overlap: { start, end },
  };
}

const DAY_START = '2026-08-10T07:00:00';
const DAY_END = '2026-08-10T19:00:00';
const NIGHT_END = '2026-08-11T06:59:00';

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function icsDescription(content: string): string {
  const unfolded = content.replace(/\r\n /gu, '');
  const value = unfolded.match(/^DESCRIPTION:(.*)$/mu)?.[1];
  return (value ?? '').replace(/\\n/gu, '\n');
}

describe('szolgálati társak minimális exportleírása', () => {
  it('egyetlen társ esetén kizárólag a nevet írja ki', () => {
    const description = calendarEventDescription({
      ...baseEvent,
      crewSearchPerformed: true,
      crewMembers: [crew('nurse', 'Liszkai Marianna', DAY_START, DAY_END, 7)],
    });

    expect(description).toBe('Liszkai Marianna');
    expect(description).not.toMatch(
      /Szolgálati társak|Szolgálati jelleg|Beosztás|Felismerés|Technikai/u,
    );
    expect(description).not.toContain('A mentőtiszti beosztás hiányzik');
    expect(description).not.toContain('mentőtiszti beosztás nélkül');
  });

  it('egy mentőápoló és egy mentőtiszt esetén munkaköri címkéket ír', () => {
    expect(
      calendarEventDescription({
        ...baseEvent,
        crewMembers: [
          crew('nurse', 'Liszkai Marianna', DAY_START, NIGHT_END, 7),
          crew('officer', 'Kovács Anna', DAY_START, NIGHT_END, 9),
        ],
      }),
    ).toBe('Mentőápoló: Liszkai Marianna\nMentőtiszt: Kovács Anna');
  });

  it('egy gépkocsivezető és egy mentőtiszt esetén megfelelő címkéket ír', () => {
    expect(
      calendarEventDescription({
        ...baseEvent,
        crewMembers: [
          crew('driver', 'Gera Zoltán', DAY_START, NIGHT_END, 5),
          crew('officer', 'Kovács Anna', DAY_START, NIGHT_END, 9),
        ],
      }),
    ).toBe('Mentőgépkocsi-vezető: Gera Zoltán\nMentőtiszt: Kovács Anna');
  });

  it('két mentőápoló váltásánál mindkét tényleges közös időt kiírja', () => {
    expect(
      calendarEventDescription({
        ...baseEvent,
        crewMembers: [
          crew('nurse', 'Liszkai Marianna', DAY_START, DAY_END, 7),
          crew('nurse', 'Nagy Anna', DAY_END, NIGHT_END, 9),
        ],
      }),
    ).toBe('Mentőápoló:\nLiszkai Marianna – 07:00–19:00\nNagy Anna – 19:00–07:00');
  });

  it('két mentőtiszt váltásánál mindkét tényleges közös időt kiírja', () => {
    expect(
      calendarEventDescription({
        ...baseEvent,
        crewMembers: [
          crew('officer', 'Kovács Anna', DAY_START, DAY_END, 9),
          crew('officer', 'Szabó Péter', DAY_END, NIGHT_END, 11),
        ],
      }),
    ).toBe('Mentőtiszt:\nKovács Anna – 07:00–19:00\nSzabó Péter – 19:00–07:00');
  });

  it('vegyes váltásnál csak a többszereplős munkakörnél ír időpontot', () => {
    expect(
      calendarEventDescription({
        ...baseEvent,
        crewMembers: [
          crew('nurse', 'Liszkai Marianna', DAY_START, DAY_END, 7),
          crew('nurse', 'Nagy Anna', DAY_END, NIGHT_END, 9),
          crew('officer', 'Kovács Anna', DAY_START, NIGHT_END, 11),
        ],
      }),
    ).toBe(
      [
        'Mentőápoló:',
        'Liszkai Marianna – 07:00–19:00',
        'Nagy Anna – 19:00–07:00',
        'Mentőtiszt: Kovács Anna',
      ].join('\n'),
    );
  });

  it('a teljes napos 07:00–06:59 belső társintervallumot 07:00–07:00-ként írja le', () => {
    expect(
      calendarEventDescription({
        ...baseEvent,
        crewMembers: [
          crew('nurse', 'Egész napos Ápoló', DAY_START, NIGHT_END, 7),
          crew('nurse', 'Nappalos Ápoló', DAY_START, DAY_END, 9),
        ],
      }),
    ).toContain('Egész napos Ápoló – 07:00–07:00');
  });

  it('találat nélkül üres Google-leírást és DESCRIPTION nélküli ICS-t készít', async () => {
    expect(calendarEventDescription(baseEvent)).toBe('');
    const ics = buildIcs([baseEvent]);
    expect(ics).not.toContain('DESCRIPTION:');

    let requestBody: unknown;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      if (typeof init?.body !== 'string') throw new Error('Hiányzó request body.');
      requestBody = JSON.parse(init.body) as unknown;
      return Promise.resolve(response({ id: 'created', colorId: '10' }));
    });
    await new GoogleCalendarClient('token', fetcher).insertEvent('primary', baseEvent);
    expect(requestBody).toMatchObject({ description: '' });
  });

  it('a Google Naptár és az ICS ugyanazt a minimális társlistát kapja', async () => {
    const event = {
      ...baseEvent,
      crewSearchPerformed: true,
      crewMembers: [
        crew('nurse', 'Liszkai Marianna', DAY_START, DAY_END, 7),
        crew('nurse', 'Nagy Anna', DAY_END, NIGHT_END, 9),
        crew('officer', 'Kovács Anna', DAY_START, NIGHT_END, 11),
      ],
    };
    const expected = calendarEventDescription(event);
    const ics = buildIcs([event]);
    expect(icsDescription(ics)).toBe(expected);
    expect(ics).toContain('DTEND;TZID=Europe/Budapest:20260811T065900');

    let requestBody: unknown;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      if (typeof init?.body !== 'string') throw new Error('Hiányzó request body.');
      requestBody = JSON.parse(init.body) as unknown;
      return Promise.resolve(response({ id: 'created', colorId: '9' }));
    });
    await new GoogleCalendarClient('token', fetcher).insertEvent('primary', event, undefined, {
      titleMode: 'custom',
      customTitle: 'Saját szolgálat',
      googleColorId: '9',
    });
    expect(requestBody).toMatchObject({
      summary: 'Saját szolgálat',
      description: expected,
      end: {
        dateTime: '2026-08-11T06:59:00',
        timeZone: 'Europe/Budapest',
      },
      colorId: '9',
    });
  });

  it('a társlista változása nem módosítja az ICS UID-t és a Google-duplikáció kulcsát', async () => {
    const withCrew = {
      ...baseEvent,
      crewSearchPerformed: true,
      crewMembers: [crew('nurse', 'Liszkai Marianna', DAY_START, DAY_END, 7)],
    };
    expect(stableUid(withCrew)).toBe(stableUid(baseEvent));

    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(
        response({
          items: [
            {
              summary: 'OMSZ',
              start: { dateTime: '2026-08-10T07:00:00+02:00' },
              end: { dateTime: '2026-08-11T06:59:00+02:00' },
              description: 'Korábbi, társlista nélküli leírás',
            },
          ],
        }),
      );
    await expect(
      new GoogleCalendarClient('token', fetcher).isDuplicate('primary', withCrew),
    ).resolves.toBe(true);
  });
});
