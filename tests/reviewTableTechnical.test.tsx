import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ReviewTable } from '../src/components/ReviewTable';
import type { CrewMemberMatch, GoogleEventState, ReviewRow } from '../src/domain/types';

function crewMatch(
  displayName: string,
  employeeRow: number,
  start: string,
  end: string,
): CrewMemberMatch {
  return {
    role: 'nurse',
    employeeName: displayName,
    normalizedName: displayName.toLocaleLowerCase('hu-HU'),
    employeeRow,
    displayName,
    serviceCategory: 'Esetszolgálat',
    overlap: { start, end },
  };
}

describe('érintett számos jelölések technikai részletei', () => {
  it('megjeleníti a stílust, a korrekciót, a párosítást, az időket és a Google-átfedést', async () => {
    const user = userEvent.setup();
    const row: ReviewRow = {
      id: 'row-1',
      date: { year: 2026, month: 8, day: 31 },
      marker: '17',
      shiftType: '24 órás szolgálat',
      serviceCategory: 'Parti szolgálat',
      summary: 'OMSZ',
      status: 'Exportálható',
      note: 'Helyreállított zöld 17.',
      timeRule: 'Hónapvégi 17 → 07:00–másnap 06:59',
      technicalNote: 'Napi összeállításból helyreállítva.',
      diagnostics: [
        {
          address: 'C5',
          rawValue: '17',
          displayedText: '17',
          isMerged: true,
          mergeMaster: 'C5',
          positionInDayGroup: 1,
          fillColor: '#FFF2CC',
          fontColorRaw: 'argb=FF008000',
          fontColor: '#008000',
          underline: false,
          italic: false,
          bold: false,
        },
      ],
      serviceResolution: {
        originalServiceCategory: 'Nem meghatározható',
        finalServiceCategory: 'Parti szolgálat',
        formattingCorrectionApplied: true,
        dailyInferenceApplied: true,
        assumedBoundaryPairing: true,
        pairingSource: 'assumed',
        pairingCell: 'feltételezett következő havi 7',
        finalShiftTime: {
          start: '2026-08-31T07:00:00',
          end: '2026-09-01T07:00:00',
        },
        finalCalendarTime: {
          start: '2026-08-31T07:00:00',
          end: '2026-09-01T06:59:00',
        },
      },
      event: {
        id: 'event-1',
        summary: 'OMSZ',
        shiftType: '24 órás szolgálat',
        serviceCategory: 'Parti szolgálat',
        shiftTime: {
          start: '2026-08-31T07:00:00',
          end: '2026-09-01T07:00:00',
        },
        calendarTime: {
          start: '2026-08-31T07:00:00',
          end: '2026-09-01T06:59:00',
        },
        timeZone: 'Europe/Budapest',
      },
    };
    const googleState: GoogleEventState = {
      status: 'Már szerepel a naptárban',
      message: 'Már szerepel.',
      technicalDetails: 'Átfedő előző havi teljes esemény található: igen.',
    };

    render(
      <ReviewTable
        rows={[row]}
        selected={new Set(['event-1'])}
        googleStates={new Map([['event-1', googleState]])}
        onToggle={vi.fn()}
        onSelectAll={vi.fn()}
      />,
    );

    const tableRow = screen.getByText('Parti szolgálat – következtetett').closest('tr');
    if (!tableRow) throw new Error('Hiányzó technikai tesztsor.');
    expect(
      within(tableRow).getByText('Átfedő előző havi teljes esemény található: igen.'),
    ).toBeInTheDocument();
    await user.click(within(tableRow).getByText('Technikai részletek'));
    expect(within(tableRow).getByText('Eredeti szolgálati kategória')).toBeVisible();
    expect(within(tableRow).getByText('Nem meghatározható')).toBeVisible();
    expect(within(tableRow).getByText('Formázási korrekció történt')).toBeVisible();
    expect(within(tableRow).getByText('Napi összeállításból következtetve')).toBeVisible();
    expect(within(tableRow).getByText('Feltételezett hónaphatár-párosítás')).toBeVisible();
    expect(within(tableRow).getByText('feltételezett következő havi 7')).toBeVisible();
    expect(within(tableRow).getByText('C5 (merge master: C5)')).toBeVisible();
    expect(within(tableRow).getByText('argb=FF008000')).toBeVisible();
    expect(within(tableRow).getByText('#008000')).toBeVisible();
    expect(within(tableRow).getByText('2026-08-31T07:00:00 – 2026-09-01T06:59:00')).toBeVisible();
  });

  it('a webes társlistában 07:00-ként jeleníti meg a tényleges 06:59-es befejezést', async () => {
    const user = userEvent.setup();
    const event = {
      id: 'event-with-crew',
      summary: 'OMSZ' as const,
      shiftType: '24 órás szolgálat' as const,
      serviceCategory: 'Esetszolgálat' as const,
      shiftTime: {
        start: '2026-08-10T07:00:00',
        end: '2026-08-11T07:00:00',
      },
      calendarTime: {
        start: '2026-08-10T07:00:00',
        end: '2026-08-11T06:59:00',
      },
      timeZone: 'Europe/Budapest' as const,
    };
    const row: ReviewRow = {
      id: 'crew-row',
      date: { year: 2026, month: 8, day: 10 },
      marker: '17–7',
      shiftType: event.shiftType,
      serviceCategory: event.serviceCategory,
      summary: event.summary,
      status: 'Exportálható',
      note: 'Teszt.',
      diagnostics: [],
      event,
      crewMatches: [
        crewMatch('Nappalos Ápoló', 7, '2026-08-10T07:00:00', '2026-08-10T19:00:00'),
        crewMatch('Éjszakás Ápoló', 9, '2026-08-10T19:00:00', '2026-08-11T06:59:00'),
      ],
    };

    render(
      <ReviewTable
        rows={[row]}
        selected={new Set([event.id])}
        googleStates={new Map()}
        crewSearchEnabled
        onToggle={vi.fn()}
        onSelectAll={vi.fn()}
      />,
    );

    await user.click(screen.getByText('2 társ'));
    expect(screen.getByText('Nappalos Ápoló – 07:00–19:00')).toBeVisible();
    expect(screen.getByText('Éjszakás Ápoló – 19:00–07:00')).toBeVisible();
    expect(screen.queryByText(/19:00–06:59/u)).not.toBeInTheDocument();
  });
});
