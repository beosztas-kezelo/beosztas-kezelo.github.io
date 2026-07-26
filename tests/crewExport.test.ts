import { describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, CrewMemberMatch } from '../src/domain/types';
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
};

const crewMembers: CrewMemberMatch[] = [
  {
    role: 'driver',
    employeeName: 'Vezető Vince',
    normalizedName: 'vezető vince',
    employeeRow: 5,
    displayName: 'Vezető Vince',
    serviceCategory: 'Esetszolgálat',
    overlap: {
      start: '2026-08-10T07:00:00',
      end: '2026-08-10T19:00:00',
    },
  },
  {
    role: 'nurse',
    employeeName: 'Ápoló Anna',
    normalizedName: 'ápoló anna',
    employeeRow: 7,
    displayName: 'Ápoló Anna',
    serviceCategory: 'Esetszolgálat',
    overlap: {
      start: '2026-08-10T19:00:00',
      end: '2026-08-11T06:59:00',
    },
  },
];

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('szolgálati társak exportleírása', () => {
  it('az ICS-leírás tartalmazza a ténylegesen megtalált társakat', () => {
    const content = buildIcs([
      { ...baseEvent, crewSearchPerformed: true, crewMembers },
    ]).replace(/\r\n /g, '');

    expect(content).toContain('Beosztás: 24 órás szolgálat');
    expect(content).toContain('Szolgálati társak:');
    expect(content).toContain('Mentőgépkocsi-vezető / technikus:');
    expect(content).toContain('- Vezető Vince – 07:00–19:00');
    expect(content).toContain('Mentőápoló:');
    expect(content).toContain('- Ápoló Anna – 19:00–06:59');
  });

  it('a Google request body leírása tartalmazza a társakat', async () => {
    let requestBody: unknown;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      if (typeof init?.body !== 'string') throw new Error('Hiányzó request body.');
      requestBody = JSON.parse(init.body) as unknown;
      return Promise.resolve(response({ id: 'created', colorId: '10' }));
    });

    await new GoogleCalendarClient('token', fetcher).insertEvent(
      'primary',
      { ...baseEvent, crewSearchPerformed: true, crewMembers },
    );

    expect(requestBody).toMatchObject({
      summary: 'OMSZ',
      start: { dateTime: '2026-08-10T07:00:00' },
      end: { dateTime: '2026-08-11T06:59:00' },
      colorId: '10',
    });
    expect((requestBody as { description: string }).description).toContain(
      'Szolgálati társak:',
    );
    expect((requestBody as { description: string }).description).toContain(
      '- Ápoló Anna – 19:00–06:59',
    );
  });

  it('üres társlistánál nincs üres szakasz, kikapcsolt keresésnél pedig a régi leírás marad', () => {
    expect(
      calendarEventDescription({
        ...baseEvent,
        crewSearchPerformed: true,
        crewMembers: [],
      }),
    ).toBe(
      'Szolgálati jelleg: Esetszolgálat\nBeosztás: 24 órás szolgálat',
    );
    expect(calendarEventDescription(baseEvent)).toBe(
      'Szolgálati jelleg: Esetszolgálat',
    );
  });

  it('a társlista változása nem módosítja az ICS UID-t és a Google-duplikáció kulcsát', async () => {
    const withCrew = { ...baseEvent, crewSearchPerformed: true, crewMembers };
    expect(stableUid(withCrew)).toBe(stableUid(baseEvent));

    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
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
