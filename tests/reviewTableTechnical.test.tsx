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

  it('eltávolítja a megjegyzésoszlopot, és a hosszú magyarázatot csak a strukturált részletekben mutatja', async () => {
    const user = userEvent.setup();
    const note =
      'A 17–7 pár egyetlen szolgálatként felismerve; ez a hosszú ellenőrzési magyarázat nem tartozik a fő táblázatba.';
    const event = {
      id: 'compact-event',
      summary: 'OMSZ' as const,
      shiftType: '24 órás szolgálat' as const,
      serviceCategory: 'Parti szolgálat' as const,
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
      id: 'compact-row',
      date: { year: 2026, month: 8, day: 10 },
      marker: '17',
      shiftType: event.shiftType,
      serviceCategory: event.serviceCategory,
      summary: event.summary,
      status: 'Exportálható',
      note,
      diagnostics: [],
      event,
    };

    render(
      <ReviewTable
        rows={[row]}
        selected={new Set([event.id])}
        googleStates={new Map()}
        onToggle={vi.fn()}
        onSelectAll={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole('columnheader', { name: 'Ellenőrzési megjegyzés' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(note)).not.toBeVisible();
    await user.click(screen.getByText('Technikai részletek'));
    expect(screen.getByText(note)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Felismerés eredménye' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Excel-cellák és formázás' })).toBeVisible();
  });

  it('ÁP feloldásnál kompakt jelzést, címutótagot és teljes átirányítási technikai blokkot ad', async () => {
    const user = userEvent.setup();
    const event = {
      id: 'redirected-event',
      summary: 'OMSZ' as const,
      shiftType: 'Nappalos 07–19' as const,
      serviceCategory: 'Parti szolgálat' as const,
      shiftTime: {
        start: '2026-08-10T07:00:00',
        end: '2026-08-10T19:00:00',
      },
      calendarTime: {
        start: '2026-08-10T07:00:00',
        end: '2026-08-10T19:00:00',
      },
      timeZone: 'Europe/Budapest' as const,
      effectiveRole: 'nurse' as const,
      roleAssignment: {
        baseRole: 'driver' as const,
        effectiveRole: 'nurse' as const,
        marker: 'ÁP' as const,
        sourceFileName: 'driver-rendkívül-hosszú-fájlnév.xlsx',
        sourceRow: 5,
        sourceCells: ['C5'],
        targetFileName: 'nurse-rendkívül-hosszú-fájlnév.xlsx',
        targetRow: 7,
        targetCells: ['C7', 'D7'],
        targetMarker: '12',
        targetPairingCells: [],
        titleSuffix: 'ÁP' as const,
        resolution: 'resolved' as const,
        reason: 'ÁP jelölés sikeresen feloldva.',
      },
    };
    const row: ReviewRow = {
      id: 'redirected-row',
      date: { year: 2026, month: 8, day: 10 },
      marker: 'ÁP',
      resolvedMarker: '12',
      shiftType: event.shiftType,
      serviceCategory: event.serviceCategory,
      summary: event.summary,
      status: 'Exportálható',
      note: 'ÁP jelölés sikeresen feloldva.',
      diagnostics: [],
      roleAssignment: event.roleAssignment,
      event,
    };

    render(
      <ReviewTable
        rows={[row]}
        selected={new Set([event.id])}
        googleStates={
          new Map([
            [
              event.id,
              {
                status: 'Létrehozva',
                message: 'Létrehozva.',
                technicalDetails:
                  'RendkívülHosszúGoogleApiTechnikaiÉrtékAmelynekTöbbSorbaKellTörnie',
              },
            ],
          ])
        }
        preferences={{
          titleMode: 'custom',
          customTitle: 'Szolgálat',
          googleColorId: '10',
        }}
        onToggle={vi.fn()}
        onSelectAll={vi.fn()}
      />,
    );

    expect(screen.getByText('ÁP → 12')).toBeVisible();
    expect(screen.getByText('ÁP munkakörben')).toBeVisible();
    expect(screen.getByText('Szolgálat - ÁP')).toBeVisible();
    await user.click(screen.getByText('Technikai részletek'));
    expect(screen.getByRole('heading', { name: 'Munkakör-átirányítás' })).toBeVisible();
    expect(screen.getByText('Mentőgépkocsi-vezető / technikus')).toBeVisible();
    expect(screen.getByText('Mentőápoló')).toBeVisible();
    expect(screen.getByText('driver-rendkívül-hosszú-fájlnév.xlsx, 5. sor')).toBeVisible();
    expect(screen.getByText('nurse-rendkívül-hosszú-fájlnév.xlsx')).toBeVisible();
    expect(screen.getByText('RendkívülHosszúGoogleApiTechnikaiÉrtékAmelynekTöbbSorbaKellTörnie'))
      .toHaveClass('technical-pre');
  });
});
