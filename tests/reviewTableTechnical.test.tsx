import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ReviewTable } from '../src/components/ReviewTable';
import type { CrewMemberMatch, GoogleEventState, ReviewRow } from '../src/domain/types';

function crewMatch(
  employeeName: string,
  employeeRow: number,
  start: string,
  end: string,
  displayName = employeeName,
): CrewMemberMatch {
  return {
    role: 'nurse',
    employeeName,
    normalizedName: employeeName.toLocaleLowerCase('hu-HU'),
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
      screen.queryByText('Átfedő előző havi teljes esemény található: igen.'),
    ).not.toBeInTheDocument();
    const toggle = within(tableRow).getByRole('button', { name: 'Technikai részletek' });
    const panelId = toggle.getAttribute('aria-controls');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(panelId).toBeTruthy();

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panel = panelId ? document.getElementById(panelId) : null;
    if (!panel) throw new Error('Hiányzó teljes szélességű technikai panel.');
    const detailsRow = panel.closest('tr');
    const detailsCell = panel.closest('td');
    expect(detailsRow).toBe(tableRow.nextElementSibling);
    expect(detailsRow).toHaveClass('review-details-row');
    expect(detailsCell).toHaveAttribute('colspan', '10');
    expect(within(panel).getByText('Eredeti szolgálati kategória')).toBeVisible();
    expect(within(panel).getByText('Nem meghatározható')).toBeVisible();
    expect(within(panel).getByText('Formázási korrekció történt')).toBeVisible();
    expect(within(panel).getByText('Napi összeállításból következtetve')).toBeVisible();
    expect(within(panel).getByText('Feltételezett hónaphatár-párosítás')).toBeVisible();
    expect(within(panel).getByText('feltételezett következő havi 7')).toBeVisible();
    expect(within(panel).getByText('C5 (merge master: C5)')).toBeVisible();
    expect(within(panel).getByText('argb=FF008000')).toBeVisible();
    expect(within(panel).getByText('#008000')).toBeVisible();
    expect(
      within(panel).getByText('2026-08-31T07:00:00 – 2026-09-01T06:59:00'),
    ).toBeVisible();
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
        crewMatch(
          'Nappalos Ápoló',
          7,
          '2026-08-10T07:00:00',
          '2026-08-10T19:00:00',
          'Nappalos Ápoló (7. sor)',
        ),
        crewMatch('Éjszakás Ápoló', 9, '2026-08-10T19:00:00', '2026-08-11T06:59:00'),
      ],
      crewNotices: [
        {
          role: 'nurse',
          kind: 'multiple-matches',
          message: 'Több lehetséges egyező szolgálati társ található.',
        },
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
    expect(screen.queryByText(/Nappalos Ápoló \(7\. sor\)/u)).not.toBeInTheDocument();
    expect(
      screen.queryByText('Több lehetséges egyező szolgálati társ található.'),
    ).not.toBeInTheDocument();
    expect(row.crewMatches?.[0]?.employeeRow).toBe(7);

    const toggle = screen.getByRole('button', { name: 'Technikai részletek' });
    await user.click(toggle);
    const panelId = toggle.getAttribute('aria-controls');
    const panel = panelId ? document.getElementById(panelId) : null;
    if (!panel) throw new Error('Hiányzó társas technikai panel.');
    expect(panel.closest('td')).toHaveAttribute('colspan', '11');
    expect(within(panel).getByText('Szolgálati társak technikai adatai')).toBeVisible();
    expect(
      within(panel).getByText('Több lehetséges egyező szolgálati társ található.'),
    ).toBeVisible();
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
    expect(screen.queryByText(note)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Technikai részletek' }));
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
    await user.click(screen.getByRole('button', { name: 'Technikai részletek' }));
    expect(screen.getByRole('heading', { name: 'Munkakör-átirányítás' })).toBeVisible();
    expect(screen.getByText('Mentőgépkocsi-vezető / technikus')).toBeVisible();
    expect(screen.getByText('Mentőápoló')).toBeVisible();
    expect(screen.getByText('driver-rendkívül-hosszú-fájlnév.xlsx, 5. sor')).toBeVisible();
    expect(screen.getByText('nurse-rendkívül-hosszú-fájlnév.xlsx')).toBeVisible();
    expect(screen.getByText('RendkívülHosszúGoogleApiTechnikaiÉrtékAmelynekTöbbSorbaKellTörnie'))
      .toHaveClass('technical-pre');
  });

  it('a hibás sor pontos üzenetét a teljes szélességű részletpanel elején emeli ki', async () => {
    const user = userEvent.setup();
    const issueMessage =
      'Az 5 jelöléshez nem található következő napi 7, ezért a párosítás nem egyértelmű.';
    const row: ReviewRow = {
      id: 'issue-row',
      date: { year: 2026, month: 8, day: 15 },
      marker: '5',
      shiftType: 'Éjszakai szolgálat',
      status: 'Hibás párosítás',
      note: issueMessage,
      diagnostics: [],
    };

    render(
      <ReviewTable
        rows={[row]}
        selected={new Set()}
        googleStates={new Map()}
        onToggle={vi.fn()}
        onSelectAll={vi.fn()}
      />,
    );

    const mainRow = screen.getByText('Hibás párosítás').closest('tr');
    if (!mainRow) throw new Error('Hiányzó hibás fő sor.');
    expect(within(mainRow).queryByText(issueMessage)).not.toBeInTheDocument();
    await user.click(within(mainRow).getByRole('button', { name: 'Technikai részletek' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(issueMessage);
    expect(alert).toHaveClass('technical-issue-message');
    expect(alert.parentElement?.firstElementChild).toBe(alert);
    expect(alert.closest('tr')).toHaveClass('review-details-row-issue');
  });

  it('több technikai panel egyedi azonosítóval, billentyűzettel és egymástól függetlenül nyitható', async () => {
    const user = userEvent.setup();
    const rows: ReviewRow[] = [1, 2].map((day) => ({
      id: `independent-row-${day}`,
      date: { year: 2026, month: 8, day },
      marker: '12',
      shiftType: 'Nappalos 07–19',
      serviceCategory: 'Parti szolgálat',
      summary: 'OMSZ',
      status: 'Exportálható',
      note: `${day}. sor technikai üzenete.`,
      diagnostics: [],
    }));

    render(
      <ReviewTable
        rows={rows}
        selected={new Set()}
        googleStates={new Map()}
        onToggle={vi.fn()}
        onSelectAll={vi.fn()}
      />,
    );

    const toggles = screen.getAllByRole('button', { name: 'Technikai részletek' });
    expect(toggles).toHaveLength(2);
    expect(toggles[0]).toHaveAttribute('aria-expanded', 'false');
    expect(toggles[1]).toHaveAttribute('aria-expanded', 'false');
    expect(toggles[0]?.getAttribute('aria-controls')).not.toBe(
      toggles[1]?.getAttribute('aria-controls'),
    );

    toggles[0]?.focus();
    await user.keyboard('{Enter}');
    await user.click(toggles[1] as HTMLElement);

    expect(toggles[0]).toHaveAttribute('aria-expanded', 'true');
    expect(toggles[1]).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelectorAll('.review-details-row')).toHaveLength(2);

    await user.click(toggles[0] as HTMLElement);
    expect(toggles[0]).toHaveAttribute('aria-expanded', 'false');
    expect(toggles[1]).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelectorAll('.review-details-row')).toHaveLength(1);
  });
});
