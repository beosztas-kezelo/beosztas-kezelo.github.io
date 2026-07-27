import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CalendarEventSettings } from '../src/components/CalendarEventSettings';
import type {
  CalendarEvent,
  CalendarExportPreferences,
  GoogleEventColorOption,
} from '../src/domain/types';
import { GOOGLE_COLOR_FALLBACK_WARNING } from '../src/services/calendarExportPreferences';

const events: CalendarEvent[] = [
  {
    id: 'omsz-event',
    summary: 'OMSZ',
    shiftType: 'Nappalos 07–19',
    serviceCategory: 'Parti szolgálat',
    shiftTime: { start: '2026-08-10T07:00:00', end: '2026-08-10T19:00:00' },
    calendarTime: { start: '2026-08-10T07:00:00', end: '2026-08-10T19:00:00' },
    timeZone: 'Europe/Budapest',
  },
  {
    id: 'kmr-event',
    summary: 'KMR',
    shiftType: 'KMR',
    serviceCategory: 'KMR',
    shiftTime: { start: '2026-08-11T05:00:00', end: '2026-08-12T01:00:00' },
    calendarTime: { start: '2026-08-11T05:00:00', end: '2026-08-12T01:00:00' },
    timeZone: 'Europe/Budapest',
  },
];

const knownColorLabels = [
  'Levendula',
  'Zsályazöld',
  'Lila',
  'Rózsaszín',
  'Sárga',
  'Narancssárga',
  'Türkiz',
  'Grafitszürke',
  'Kék',
  'Sötétzöld',
  'Piros',
];

const colors: GoogleEventColorOption[] = [
  ...knownColorLabels.map((label, index) => ({
    colorId: String(index + 1),
    background: `#${String(index + 1).padStart(6, '0')}`,
    foreground: '#ffffff',
    label,
  })),
  {
    colorId: '42',
    background: '#123456',
    foreground: '#fedcba',
    label: 'Egyéb szín',
  },
];

function renderSettings(
  preferences: CalendarExportPreferences = {
    titleMode: 'automatic',
    customTitle: '',
    googleColorId: '10',
  },
  options: {
    events?: CalendarEvent[];
    savedCustomTitles?: string[];
    paletteWarning?: string;
    persistenceUnavailable?: boolean;
    attentionRequested?: boolean;
    onAttentionHandled?: () => void;
  } = {},
) {
  const callbacks = {
    onUseAutomatic: vi.fn(),
    onUseSavedTitle: vi.fn(),
    onSaveCustomTitle: vi.fn(),
    onDeleteCustomTitle: vi.fn(),
    onColorChange: vi.fn(),
    onReloadColors: vi.fn(),
    onReset: vi.fn(),
  };
  const rendered = render(
    <CalendarEventSettings
      events={options.events ?? events}
      preferences={preferences}
      colors={colors}
      savedCustomTitles={options.savedCustomTitles ?? []}
      paletteWarning={options.paletteWarning}
      persistenceUnavailable={options.persistenceUnavailable}
      attentionRequested={options.attentionRequested}
      onAttentionHandled={options.onAttentionHandled}
      {...callbacks}
    />,
  );
  return { ...callbacks, unmount: rendered.unmount };
}

describe('Naptáresemény beállításai felület', () => {
  it('vegyes automatikus kijelölésnél külön OMSZ és KMR előnézetet mutat', () => {
    renderSettings();

    expect(screen.getByRole('heading', { name: 'Naptárban így jelenik meg' })).toBeVisible();
    expect(screen.getByText(/Normál szolgálat:/u)).toHaveTextContent('OMSZ');
    expect(screen.getByText(/KMR-szolgálat:/u)).toHaveTextContent('KMR');
  });

  it('az ÁP utótagot automatikus és egyéni címnél is megjeleníti az előnézetben', () => {
    const redirectedEvent: CalendarEvent = {
      ...(events[0] as CalendarEvent),
      roleAssignment: {
        baseRole: 'driver',
        effectiveRole: 'nurse',
        marker: 'ÁP',
        sourceFileName: 'driver.xlsx',
        sourceRow: 5,
        sourceCells: ['C5'],
        targetFileName: 'nurse.xlsx',
        targetRow: 5,
        targetCells: ['C5'],
        targetMarker: '12',
        targetPairingCells: [],
        titleSuffix: 'ÁP',
        resolution: 'resolved',
        reason: 'Teszt.',
      },
    };
    const { unmount } = renderSettings(undefined, { events: [redirectedEvent] });
    expect(screen.getByText('OMSZ - ÁP')).toBeVisible();
    unmount();

    renderSettings(
      {
        titleMode: 'custom',
        customTitle: 'Szolgálat',
        googleColorId: '10',
      },
      { events: [redirectedEvent] },
    );
    expect(screen.getByText('Szolgálat - ÁP')).toBeVisible();
  });

  it('a választóban nincs külön OMSZ vagy KMR felülírás', () => {
    renderSettings();
    const select = screen.getByLabelText('Esemény neve');

    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Automatikus – OMSZ vagy KMR', 'Új egyéni megnevezés…']);
  });

  it('az új név kiválasztása önmagában nem mutat hibát, csak sikertelen mentés után', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.selectOptions(screen.getByLabelText('Esemény neve'), 'new-custom');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mentés és használat' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Az egyéni eseménynév nem lehet üres.');
  });

  it('az új nevet levágva menti és használja', async () => {
    const user = userEvent.setup();
    const callbacks = renderSettings();
    await user.selectOptions(screen.getByLabelText('Esemény neve'), 'new-custom');
    await user.type(
      screen.getByRole('textbox', { name: /Egyéni eseménynév/u }),
      '  Saját szolgálat  ',
    );
    await user.click(screen.getByRole('button', { name: 'Mentés és használat' }));

    expect(callbacks.onSaveCustomTitle).toHaveBeenCalledWith('Saját szolgálat');
  });

  it('azonos nevet kis- és nagybetűtől függetlenül nem ment kétszer', async () => {
    const user = userEvent.setup();
    const callbacks = renderSettings(undefined, {
      savedCustomTitles: ['Saját szolgálat'],
    });
    await user.selectOptions(screen.getByLabelText('Esemény neve'), 'new-custom');
    await user.type(screen.getByRole('textbox', { name: /Egyéni eseménynév/u }), 'sAJÁT sZOLGÁLAT');
    await user.click(screen.getByRole('button', { name: 'Mentés és használat' }));

    expect(screen.getByRole('alert')).toHaveTextContent('már szerepel');
    expect(callbacks.onSaveCustomTitle).not.toHaveBeenCalled();
  });

  it('mentett név kiválasztását külön callbackben jelzi', async () => {
    const user = userEvent.setup();
    const callbacks = renderSettings(undefined, {
      savedCustomTitles: ['Mentett szolgálat'],
    });

    await user.selectOptions(screen.getByLabelText('Esemény neve'), 'saved:Mentett szolgálat');

    expect(callbacks.onUseSavedTitle).toHaveBeenCalledWith('Mentett szolgálat');
  });

  it('mentett név törlését megerősítés után jelzi', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const callbacks = renderSettings(undefined, {
      savedCustomTitles: ['Mentett szolgálat'],
    });
    await user.click(screen.getByText('Mentett egyéni megnevezések kezelése'));
    await user.click(
      screen.getByRole('button', {
        name: 'Mentett szolgálat megnevezés törlése',
      }),
    );

    expect(confirm).toHaveBeenCalledWith('Biztosan törlöd ezt az eseménynevet?');
    expect(callbacks.onDeleteCustomTitle).toHaveBeenCalledWith('Mentett szolgálat');
  });

  it('minden ismert magyar eseményszínt és az ismeretlen színt is megjeleníti technikai azonosító nélkül', () => {
    renderSettings();

    expect(screen.getAllByRole('radio')).toHaveLength(12);
    for (const label of knownColorLabels) {
      expect(screen.getAllByText(label, { exact: true }).length).toBeGreaterThan(0);
    }
    expect(
      screen.getByRole('radio', {
        name: 'Egyéb szín 1 eseményszín kiválasztása',
      }),
    ).toBeVisible();
    expect(screen.getByText('Egyéb szín', { exact: true })).toBeVisible();
    expect(screen.queryByText(/colorId/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/Lavender|Blueberry|Basil|Tomato/u)).not.toBeInTheDocument();
  });

  it('billentyűzettel is kiválasztható Google-színhez a tényleges colorId-t adja vissza', async () => {
    const user = userEvent.setup();
    const callbacks = renderSettings();
    const blueberry = screen.getByRole('radio', {
      name: 'Kék eseményszín kiválasztása',
    });
    blueberry.focus();
    await user.keyboard(' ');

    expect(callbacks.onColorChange).toHaveBeenCalledWith('9');
  });

  it('a kiválasztott színt magyar névvel és képernyőolvasó-jelzéssel mutatja az előnézetben', () => {
    renderSettings();

    expect(
      screen.getByRole('radio', {
        name: 'Sötétzöld eseményszín kiválasztása, kiválasztva',
      }),
    ).toBeChecked();
    const preview = screen
      .getByRole('heading', { name: 'Naptárban így jelenik meg' })
      .closest('.calendar-preview');
    if (!(preview instanceof HTMLElement)) throw new Error('Hiányzó naptárelőnézet.');
    expect(within(preview).getByText('Sötétzöld', { exact: true })).toBeVisible();
    expect(screen.queryByText(/colorId|Basil/u)).not.toBeInTheDocument();
  });

  it('sikeres bejelentkezés után egyszer görget, fókuszál és kiemeli a kártyát', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const onAttentionHandled = vi.fn();
    const view = render(
      <CalendarEventSettings
        events={events}
        preferences={{
          titleMode: 'automatic',
          customTitle: '',
          googleColorId: '10',
        }}
        colors={colors}
        savedCustomTitles={[]}
        attentionRequested
        onAttentionHandled={onAttentionHandled}
        onUseAutomatic={vi.fn()}
        onUseSavedTitle={vi.fn()}
        onSaveCustomTitle={vi.fn()}
        onDeleteCustomTitle={vi.fn()}
        onColorChange={vi.fn()}
        onReloadColors={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
    expect(screen.getByRole('heading', { name: 'Naptáresemény beállításai' })).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Bejelentkezés sikeres.');
    expect(screen.getByRole('status').closest('section')).toHaveClass('is-login-highlighted');
    expect(onAttentionHandled).toHaveBeenCalledOnce();

    view.rerender(
      <CalendarEventSettings
        events={events}
        preferences={{
          titleMode: 'automatic',
          customTitle: '',
          googleColorId: '10',
        }}
        colors={colors}
        savedCustomTitles={[]}
        attentionRequested
        onAttentionHandled={onAttentionHandled}
        onUseAutomatic={vi.fn()}
        onUseSavedTitle={vi.fn()}
        onSaveCustomTitle={vi.fn()}
        onDeleteCustomTitle={vi.fn()}
        onColorChange={vi.fn()}
        onReloadColors={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    expect(scrollIntoView).toHaveBeenCalledOnce();
  });

  it('csökkentett mozgásnál animáció nélküli görgetési módot kér', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: true,
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    );

    renderSettings(undefined, { attentionRequested: true });

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'start',
    });
  });

  it('palettahibánál megjeleníti az újratöltési műveletet', async () => {
    const user = userEvent.setup();
    const callbacks = renderSettings(undefined, {
      paletteWarning: GOOGLE_COLOR_FALLBACK_WARNING,
    });

    expect(screen.getByRole('status')).toHaveTextContent(GOOGLE_COLOR_FALLBACK_WARNING);
    await user.click(screen.getByRole('button', { name: 'Színek újratöltése' }));
    expect(callbacks.onReloadColors).toHaveBeenCalledOnce();
  });

  it('elsődleges fiókazonosító nélkül nem blokkoló munkamenet-tájékoztatást mutat', () => {
    renderSettings(undefined, { persistenceUnavailable: true });

    expect(screen.getByRole('status')).toHaveTextContent('csak ebben a munkamenetben maradnak meg');
  });

  it('az alapértékek visszaállítását külön műveletként jelzi', async () => {
    const user = userEvent.setup();
    const callbacks = renderSettings();

    await user.click(screen.getByRole('button', { name: 'Alapértékek visszaállítása' }));

    expect(callbacks.onReset).toHaveBeenCalledOnce();
  });
});
