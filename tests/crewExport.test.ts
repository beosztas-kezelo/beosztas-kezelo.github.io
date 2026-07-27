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
  employeeName: string,
  start: string,
  end: string,
  employeeRow: number,
  displayName = employeeName,
): CrewMemberMatch {
  return {
    role,
    employeeName,
    normalizedName: employeeName.toLocaleLowerCase('hu-HU'),
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
    expect(description).not.toContain('Mentőápoló');
    expect(description).not.toContain('07:00');
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
    ).toBe('Mentőápoló: Liszkai Marianna\n\nMentőtiszt: Kovács Anna');
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
    ).toBe('Mentőgépkocsi-vezető: Gera Zoltán\n\nMentőtiszt: Kovács Anna');
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
        '',
        'Mentőtiszt: Kovács Anna',
      ].join('\n'),
    );
  });

  it('pontosan egy üres sort tesz a munkaköri csoportok közé, de egy csoporton belül nem', () => {
    const description = calendarEventDescription({
      ...baseEvent,
      crewMembers: [
        crew('nurse', 'Köteles János', DAY_START, DAY_END, 7),
        crew('nurse', 'Tábit Zoltán', DAY_END, NIGHT_END, 9),
        crew('officer', 'Takács Réka', DAY_START, DAY_END, 11),
        crew('officer', 'Szilágyi Mihály', DAY_END, NIGHT_END, 13),
      ],
    });

    expect(description).toBe(
      [
        'Mentőápoló:',
        'Köteles János – 07:00–19:00',
        'Tábit Zoltán – 19:00–07:00',
        '',
        'Mentőtiszt:',
        'Takács Réka – 07:00–19:00',
        'Szilágyi Mihály – 19:00–07:00',
      ].join('\n'),
    );
    expect(description).not.toMatch(/^\n|\n$/u);
    expect(description).not.toContain('\n\n\n');
    expect(description).not.toContain('Köteles János – 07:00–19:00\n\nTábit Zoltán');
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

  it('azonos név, munkakör és idő esetén a külön belső sorokat csak egyszer jeleníti meg', () => {
    const first = crew(
      'nurse',
      'Azonos Név',
      DAY_START,
      DAY_END,
      5,
      'Azonos Név (5. sor)',
    );
    const second = crew(
      'nurse',
      'Azonos Név',
      DAY_START,
      DAY_END,
      9,
      'Azonos Név (9. sor)',
    );

    expect(
      calendarEventDescription({
        ...baseEvent,
        crewMembers: [first, second],
      }),
    ).toBe('Azonos Név');
    expect(first.employeeRow).toBe(5);
    expect(second.employeeRow).toBe(9);
  });

  it('azonos nevet eltérő közös időkkel külön intervallumokként jelenít meg', () => {
    expect(
      calendarEventDescription({
        ...baseEvent,
        crewMembers: [
          crew('nurse', 'Azonos Név', DAY_START, DAY_END, 5),
          crew('nurse', 'Azonos Név', DAY_END, NIGHT_END, 9),
        ],
      }),
    ).toBe('Mentőápoló:\nAzonos Név – 07:00–19:00\nAzonos Név – 19:00–07:00');
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

  it('sem a Google-, sem az ICS-leírásba nem engedi át a sorszámot vagy technikai sallangot', async () => {
    const event: CalendarEvent = {
      ...baseEvent,
      crewSearchPerformed: true,
      crewMembers: [
        crew(
          'nurse',
          'Liszkai Marianna',
          DAY_START,
          DAY_END,
          5,
          'Liszkai Marianna (5. sor)',
        ),
      ],
    };
    const forbidden = [
      '(5. sor)',
      '5. sor',
      'Szolgálati társak:',
      'Szolgálati jelleg:',
      'Beosztás:',
      'Felismerés:',
      'Technikai magyarázat:',
      'Technikai részletek',
      'Következtetett',
      'A napi szolgálati összeállításból',
      'Nem található egyező',
      'A beosztás nincs feltöltve',
      'Több lehetséges egyezés',
    ];
    const ics = buildIcs([event]);
    const exportedIcsDescription = icsDescription(ics);
    let requestBody: { description?: string } | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      if (typeof init?.body !== 'string') throw new Error('Hiányzó request body.');
      requestBody = JSON.parse(init.body) as { description?: string };
      return Promise.resolve(response({ id: 'created', colorId: '10' }));
    });

    await new GoogleCalendarClient('token', fetcher).insertEvent('primary', event);

    expect(exportedIcsDescription).toBe('Liszkai Marianna');
    expect(requestBody?.description).toBe('Liszkai Marianna');
    for (const text of forbidden) {
      expect(exportedIcsDescription).not.toContain(text);
      expect(requestBody?.description).not.toContain(text);
    }
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
    expect(expected).toContain('Nagy Anna – 19:00–07:00\n\nMentőtiszt: Kovács Anna');
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
