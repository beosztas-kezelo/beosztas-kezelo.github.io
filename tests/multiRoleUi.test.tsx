import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { asFile, roleWorkbookBuffer } from './fixtures/syntheticWorkbook';

async function uploadRole(
  user: ReturnType<typeof userEvent.setup>,
  role: 'driver' | 'nurse' | 'officer',
  employeeName: string,
  options: {
    fileName?: string;
    sheetName?: string;
    monthName?: string;
    fontColor?: string;
    marker?: string | number;
    additionalEmployeeNames?: string[];
    additionalMonths?: Array<{
      sheetName: string;
      year: number;
      monthName: string;
    }>;
  } = {},
): Promise<void> {
  const fileName = options.fileName ?? `${role}.xlsx`;
  const buffer = await roleWorkbookBuffer({
    employeeName,
    sheetName: options.sheetName,
    monthName: options.monthName,
    fontColor: options.fontColor,
    marker: options.marker,
    additionalEmployeeNames: options.additionalEmployeeNames,
    additionalMonths: options.additionalMonths,
  });
  await user.upload(
    screen.getByTestId(role === 'driver' ? 'file-input' : `file-input-${role}`),
    asFile(buffer, fileName),
  );
  await screen.findByText(fileName);
}

describe('több munkaköri beosztás felülete', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ['driver', 'Vezető Vince', 'Mentőgépkocsi-vezető / technikus'],
    ['nurse', 'Ápoló Anna', 'Mentőápoló'],
    ['officer', 'Tiszt Tímea', 'Mentőtiszt'],
  ] as const)(
    'csak %s fájllal is végigvihető a kiválasztás',
    async (role, employeeName, roleLabel) => {
      const user = userEvent.setup();
      render(<App />);
      await uploadRole(user, role, employeeName, {
        fontColor: role === 'officer' ? '#000000' : '#FF0000',
      });

      const roleSelect = await screen.findByLabelText<HTMLSelectElement>(
        'Kinek a beosztását szeretnéd feldolgozni?',
      );
      expect(roleSelect).toHaveValue(role);
      expect(within(roleSelect).getAllByRole('option')).toHaveLength(1);
      expect(within(roleSelect).getByRole('option', { name: roleLabel })).toBeVisible();
      const crewSearch = screen.getByRole('checkbox', {
        name: /Szolgálati társak keresése/,
      });
      expect(crewSearch).toBeDisabled();
      expect(
        screen.getByText(
          role === 'driver'
            ? 'A szolgálati társak kereséséhez töltsd fel a mentőápolói beosztást.'
            : role === 'nurse'
              ? 'A szolgálati társak kereséséhez töltsd fel a gépkocsivezetői beosztást.'
              : 'A szolgálati társak kereséséhez töltsd fel a gépkocsivezetői és a mentőápolói beosztást.',
        ),
      ).toBeVisible();
      await user.selectOptions(
        screen.getByLabelText('Dolgozó'),
        employeeName.toLocaleLowerCase('hu-HU'),
      );
      await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));

      expect(await screen.findByRole('heading', { name: 'Ellenőrzés' })).toBeVisible();
      if (role === 'officer') {
        expect(screen.getAllByText('Esetszolgálat').length).toBeGreaterThan(0);
      }
    },
  );

  it('több fájlnál a kiválasztott munkakör határozza meg a fő fájlt és dolgozólistát', async () => {
    const user = userEvent.setup();
    render(<App />);
    await uploadRole(user, 'driver', 'Vezető Vince');
    await uploadRole(user, 'nurse', 'Ápoló Anna');

    const roleSelect = await screen.findByLabelText<HTMLSelectElement>(
      'Kinek a beosztását szeretnéd feldolgozni?',
    );
    expect(roleSelect).toHaveValue('driver');
    expect(
      within(roleSelect).queryByRole('option', { name: 'Mentőtiszt' }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Dolgozó')).getByRole('option', {
        name: 'Vezető Vince',
      }),
    ).toBeVisible();
    expect(screen.getByRole('checkbox', { name: /Szolgálati társak keresése/ })).toBeEnabled();

    await user.selectOptions(roleSelect, 'nurse');

    expect(roleSelect).toHaveValue('nurse');
    expect(
      within(screen.getByLabelText('Dolgozó')).getByRole('option', {
        name: 'Ápoló Anna',
      }),
    ).toBeVisible();
    expect(
      within(screen.getByLabelText('Dolgozó')).queryByRole('option', {
        name: 'Vezető Vince',
      }),
    ).not.toBeInTheDocument();
  });

  it('ugyanazt a tartalmú fájlt második munkakörnél elutasítja', async () => {
    const user = userEvent.setup();
    render(<App />);
    const buffer = await roleWorkbookBuffer({ employeeName: 'Közös Dolgozó' });
    await user.upload(screen.getByTestId('file-input'), asFile(buffer, 'vezető.xlsx'));
    await screen.findByLabelText('Kinek a beosztását szeretnéd feldolgozni?');
    await user.upload(screen.getByTestId('file-input-nurse'), asFile(buffer, 'ápoló-másolat.xlsx'));

    expect(
      await screen.findByText(
        /Ugyanaz az Excel-fájl nem használható egyszerre több munkakör beosztásaként/,
      ),
    ).toBeVisible();
    const roleSelect = screen.getByLabelText<HTMLSelectElement>(
      'Kinek a beosztását szeretnéd feldolgozni?',
    );
    expect(within(roleSelect).getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Fájl.*Teljesítve/u })).toBeEnabled();
  });

  it('a kiegészítő fájl eltávolítható, a fő fájl és a munkakörválasztás megmarad', async () => {
    const user = userEvent.setup();
    render(<App />);
    await uploadRole(user, 'driver', 'Vezető Vince');
    await uploadRole(user, 'nurse', 'Ápoló Anna');
    const nurseCard = screen
      .getByRole('heading', { name: 'Mentőápolói beosztás' })
      .closest('article');
    if (!nurseCard) throw new Error('Hiányzó mentőápolói fájlkártya.');

    await user.click(within(nurseCard).getByRole('button', { name: 'Fájl eltávolítása' }));

    expect(within(nurseCard).getByText('Nincs fájl kiválasztva.')).toBeVisible();
    const roleSelect = screen.getByLabelText<HTMLSelectElement>(
      'Kinek a beosztását szeretnéd feldolgozni?',
    );
    expect(roleSelect).toHaveValue('driver');
    expect(within(roleSelect).getAllByRole('option')).toHaveLength(1);
  });

  it('kiegészítő fájl hibája megtartja a fő fájlt, de az előző feldolgozási eredményt visszaállítja', async () => {
    const user = userEvent.setup();
    render(<App />);
    await uploadRole(user, 'driver', 'Vezető Vince');
    await user.selectOptions(await screen.findByLabelText('Dolgozó'), 'vezető vince');
    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));
    expect(await screen.findByRole('heading', { name: 'Ellenőrzés' })).toBeVisible();

    await user.upload(
      screen.getByTestId('file-input-nurse'),
      asFile(new TextEncoder().encode('sérült').buffer, 'hibás-ápolói.xlsx'),
    );

    expect(await screen.findByText(/nem olvasható vagy sérült/)).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Ellenőrzés' })).not.toBeInTheDocument();
    expect(
      screen.getByLabelText<HTMLSelectElement>('Kinek a beosztását szeretnéd feldolgozni?'),
    ).toHaveValue('driver');
    expect(
      within(screen.getByLabelText('Dolgozó')).getByRole('option', {
        name: 'Vezető Vince',
      }),
    ).toBeVisible();
  });

  it('driver ÁP jelölését az ápolói teljes sorból oldja fel, és a címben is jelzi', async () => {
    const user = userEvent.setup();
    render(<App />);
    await uploadRole(user, 'driver', 'Kovács Anna', {
      marker: 'AP',
      fileName: 'driver-ap.xlsx',
    });
    await uploadRole(user, 'nurse', 'Kovács Anna', {
      marker: 12,
      fontColor: '#FF0000',
      fileName: 'nurse-szolgalat.xlsx',
    });
    await user.selectOptions(await screen.findByLabelText('Dolgozó'), 'kovács anna');
    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));

    const table = await screen.findByRole('table');
    expect(within(table).getByText('ÁP → 12')).toBeVisible();
    expect(within(table).getByText('ÁP munkakörben')).toBeVisible();
    expect(within(table).getByText('OMSZ - ÁP')).toBeVisible();
    expect(
      table.querySelector('td[data-label="Szolgálati jelleg"]'),
    ).toHaveTextContent('Esetszolgálat');
    expect(screen.getByRole('button', { name: 'ICS letöltése' })).toBeEnabled();

    const nurseCard = screen
      .getByRole('heading', { name: 'Mentőápolói beosztás' })
      .closest('article');
    if (!nurseCard) throw new Error('Hiányzó mentőápolói fájlkártya.');
    await user.click(within(nurseCard).getByRole('button', { name: 'Fájl eltávolítása' }));
    expect(screen.queryByRole('heading', { name: 'Ellenőrzés' })).not.toBeInTheDocument();
  });

  it('hiányzó ápolói fájlnál az ÁP napot bizonytalanként megtartja, de nem exportálja', async () => {
    const user = userEvent.setup();
    render(<App />);
    await uploadRole(user, 'driver', 'Kovács Anna', {
      marker: 'ÁP',
      fileName: 'driver-ap.xlsx',
    });
    await user.selectOptions(await screen.findByLabelText('Dolgozó'), 'kovács anna');
    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));

    await screen.findByRole('heading', { name: 'Ellenőrzés' });
    const row = screen.getByRole('table').querySelector<HTMLTableRowElement>('tbody tr');
    if (!row) throw new Error('Hiányzó ÁP hibasor.');
    expect(screen.getByRole('button', { name: 'ICS letöltése' })).toBeDisabled();
    const technicalMessage =
      'Az ÁP jelölés feloldásához a mentőápolói beosztás szükséges.';
    expect(screen.queryByText(technicalMessage)).not.toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Technikai részletek' }));
    expect(screen.getByRole('alert')).toHaveTextContent(technicalMessage);
  });

  it('eltérő hónapú kötelező fájlnál letiltja a társkeresést és pontos magyarázatot ad', async () => {
    const user = userEvent.setup();
    render(<App />);
    await uploadRole(user, 'driver', 'Vezető Vince', {
      sheetName: 'Augusztus',
      monthName: 'augusztus',
    });
    await uploadRole(user, 'nurse', 'Ápoló Anna', {
      sheetName: 'Szeptember',
      monthName: 'szeptember',
    });

    expect(
      await screen.findByText(/Mentőápoló: a 2026\. 8\. havi munkalap nem található/),
    ).toBeVisible();
    const crewSearch = screen.getByRole('checkbox', {
      name: /Szolgálati társak keresése/,
    });
    expect(crewSearch).toBeDisabled();
    expect(crewSearch).not.toBeChecked();
    expect(
      screen.getByText(
        'A szolgálati társak kereséséhez a kiválasztott év és hónap munkalapja hiányzik a mentőápolói beosztásból.',
      ),
    ).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Dolgozó'), 'vezető vince');
    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));

    expect(
      screen.queryByRole('columnheader', { name: 'Szolgálati társak' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ICS letöltése' })).toBeEnabled();
  });

  it('tiszti fájl nélkül, Esetszolgálat nélkül figyelmeztetés nélkül feldolgoz', async () => {
    const user = userEvent.setup();
    render(<App />);
    await uploadRole(user, 'driver', 'Vezető Vince');
    await uploadRole(user, 'nurse', 'Ápoló Anna');
    await user.selectOptions(await screen.findByLabelText('Dolgozó'), 'vezető vince');
    await user.click(screen.getByRole('checkbox', { name: /Szolgálati társak keresése/ }));
    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));

    expect(
      screen.queryByRole('dialog', { name: 'A mentőtiszti beosztás hiányzik' }),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Ellenőrzés' })).toBeVisible();
  });

  it('Esetszolgálatnál tiszti fájl nélkül választást kér, majd engedi a hiányos folytatást és exportot', async () => {
    const user = userEvent.setup();
    render(<App />);
    await uploadRole(user, 'driver', 'Vezető Vince', { fontColor: '#FF0000' });
    await uploadRole(user, 'nurse', 'Ápoló Anna', { fontColor: '#FF0000' });
    await user.selectOptions(await screen.findByLabelText('Dolgozó'), 'vezető vince');
    await user.click(screen.getByRole('checkbox', { name: /Szolgálati társak keresése/ }));
    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));

    const dialog = screen.getByRole('dialog', {
      name: 'A mentőtiszti beosztás hiányzik',
    });
    expect(dialog).toHaveTextContent('A kiválasztott dolgozónak Esetszolgálata is van.');
    await user.click(
      within(dialog).getByRole('button', {
        name: 'Folytatás mentőtiszti beosztás nélkül',
      }),
    );

    expect(await screen.findByRole('heading', { name: 'Ellenőrzés' })).toBeVisible();
    expect(
      screen.getByText(
        'A feldolgozás mentőtiszti beosztás nélkül folytatódott. Az esetkocsis társlista ezért hiányos lehet.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'ICS letöltése' })).toBeEnabled();
    expect(screen.getAllByText('Esetszolgálat').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));
    expect(
      screen.queryByRole('dialog', { name: 'A mentőtiszti beosztás hiányzik' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Szolgálati társak keresése/ }));
    await user.click(screen.getByRole('checkbox', { name: /Szolgálati társak keresése/ }));
    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));
    expect(screen.getByRole('dialog', { name: 'A mentőtiszti beosztás hiányzik' })).toBeVisible();
  });

  it('a tiszti feltöltés művelet a megfelelő fájlkártyához görget, fókuszál és megnyitja a választót', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    render(<App />);
    await uploadRole(user, 'driver', 'Vezető Vince', { fontColor: '#FF0000' });
    await uploadRole(user, 'nurse', 'Ápoló Anna', { fontColor: '#FF0000' });
    await user.selectOptions(await screen.findByLabelText('Dolgozó'), 'vezető vince');
    await user.click(screen.getByRole('checkbox', { name: /Szolgálati társak keresése/ }));
    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));
    const inputClick = vi
      .spyOn(HTMLInputElement.prototype, 'click')
      .mockImplementation(() => undefined);
    await user.click(screen.getByRole('button', { name: 'Mentőtiszti beosztás feltöltése' }));

    const officerCard = screen
      .getByRole('heading', { name: 'Mentőtiszti beosztás' })
      .closest('article');
    if (!(officerCard instanceof HTMLElement)) {
      throw new Error('Hiányzó mentőtiszti fájlkártya.');
    }
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
    });
    expect(within(officerCard).getByRole('button', { name: 'Fájl kiválasztása' })).toHaveFocus();
    expect(inputClick).toHaveBeenCalled();
    expect(screen.getByLabelText('Dolgozó')).toHaveValue('vezető vince');
  });

  it('a kapcsolóval a teljes kiegészítő munkalapból megjelennek a társak', async () => {
    const user = userEvent.setup();
    render(<App />);
    await uploadRole(user, 'driver', 'Vezető Vince', { fontColor: '#FF0000' });
    await uploadRole(user, 'nurse', 'Ápoló Anna', { fontColor: '#FF0000' });
    await uploadRole(user, 'officer', 'Tiszt Tímea', { fontColor: '#000000' });
    await user.selectOptions(await screen.findByLabelText('Dolgozó'), 'vezető vince');
    await user.click(screen.getByRole('checkbox', { name: /Szolgálati társak keresése/ }));
    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Szolgálati társak' })).toBeVisible();
    await user.click(within(table).getByText('2 társ'));
    expect(within(table).getByText(/Ápoló Anna – 07:00–19:00/)).toBeVisible();
    expect(within(table).getByText(/Tiszt Tímea – 07:00–19:00/)).toBeVisible();
  });

  it('a tiszti fájl eltávolítása teljesen érvényteleníti a tiszti társakat és újra figyelmeztet', async () => {
    const user = userEvent.setup();
    render(<App />);
    await uploadRole(user, 'driver', 'Vezető Vince', { fontColor: '#FF0000' });
    await uploadRole(user, 'nurse', 'Ápoló Anna', { fontColor: '#FF0000' });
    await uploadRole(user, 'officer', 'Tiszt Tímea');
    await user.selectOptions(await screen.findByLabelText('Dolgozó'), 'vezető vince');
    const crewSearch = screen.getByRole('checkbox', {
      name: /Szolgálati társak keresése/,
    });
    await user.click(crewSearch);
    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));

    const table = await screen.findByRole('table');
    await user.click(within(table).getByText('2 társ'));
    expect(within(table).getByText(/Tiszt Tímea – 07:00–19:00/)).toBeVisible();

    const officerCard = screen
      .getByRole('heading', { name: 'Mentőtiszti beosztás' })
      .closest('article');
    if (!officerCard) throw new Error('Hiányzó mentőtiszti fájlkártya.');
    await user.click(within(officerCard).getByRole('button', { name: 'Fájl eltávolítása' }));

    expect(within(officerCard).getByText('Nincs fájl kiválasztva.')).toBeVisible();
    expect(screen.queryByText('Tiszt Tímea')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ellenőrzés' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Dolgozó')).toHaveValue('vezető vince');
    expect(crewSearch).toBeEnabled();
    expect(crewSearch).toBeChecked();
    expect(
      within(screen.getByLabelText('Kinek a beosztását szeretnéd feldolgozni?')).queryByRole(
        'option',
        { name: 'Mentőtiszt' },
      ),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));
    expect(screen.getByRole('dialog', { name: 'A mentőtiszti beosztás hiányzik' })).toBeVisible();
  });

  it('nem Esetszolgálatos dolgozónál a tiszti fájl eltávolítása után sem figyelmeztet', async () => {
    const user = userEvent.setup();
    render(<App />);
    await uploadRole(user, 'driver', 'Vezető Vince');
    await uploadRole(user, 'nurse', 'Ápoló Anna');
    await uploadRole(user, 'officer', 'Tiszt Tímea');
    const officerCard = screen
      .getByRole('heading', { name: 'Mentőtiszti beosztás' })
      .closest('article');
    if (!officerCard) throw new Error('Hiányzó mentőtiszti fájlkártya.');
    await user.click(within(officerCard).getByRole('button', { name: 'Fájl eltávolítása' }));

    await user.selectOptions(screen.getByLabelText('Dolgozó'), 'vezető vince');
    const crewSearch = screen.getByRole('checkbox', {
      name: /Szolgálati társak keresése/,
    });
    expect(crewSearch).toBeEnabled();
    await user.click(crewSearch);
    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));

    expect(
      screen.queryByRole('dialog', { name: 'A mentőtiszti beosztás hiányzik' }),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Ellenőrzés' })).toBeVisible();
  });

  it('a tiszti fájl feltöltése és eltávolítása törli a korábbi tiszt nélküli jóváhagyást', async () => {
    const user = userEvent.setup();
    render(<App />);
    await uploadRole(user, 'driver', 'Vezető Vince', { fontColor: '#FF0000' });
    await uploadRole(user, 'nurse', 'Ápoló Anna', { fontColor: '#FF0000' });
    await user.selectOptions(await screen.findByLabelText('Dolgozó'), 'vezető vince');
    await user.click(screen.getByRole('checkbox', { name: /Szolgálati társak keresése/ }));
    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));
    await user.click(screen.getByRole('button', { name: 'Folytatás mentőtiszti beosztás nélkül' }));
    expect(await screen.findByRole('heading', { name: 'Ellenőrzés' })).toBeVisible();

    await uploadRole(user, 'officer', 'Tiszt Tímea');
    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));
    expect(
      screen.queryByRole('dialog', { name: 'A mentőtiszti beosztás hiányzik' }),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Ellenőrzés' })).toBeVisible();

    const officerCard = screen
      .getByRole('heading', { name: 'Mentőtiszti beosztás' })
      .closest('article');
    if (!officerCard) throw new Error('Hiányzó mentőtiszti fájlkártya.');
    await user.click(within(officerCard).getByRole('button', { name: 'Fájl eltávolítása' }));
    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));

    expect(screen.getByRole('dialog', { name: 'A mentőtiszti beosztás hiányzik' })).toBeVisible();
  });

  it('tiszti fájl feltöltése után figyelmeztetés nélkül újraszámolja a tiszti társlistát', async () => {
    const user = userEvent.setup();
    render(<App />);
    await uploadRole(user, 'driver', 'Vezető Vince', { fontColor: '#FF0000' });
    await uploadRole(user, 'nurse', 'Ápoló Anna', { fontColor: '#FF0000' });
    await user.selectOptions(await screen.findByLabelText('Dolgozó'), 'vezető vince');
    await user.click(screen.getByRole('checkbox', { name: /Szolgálati társak keresése/ }));
    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));
    await user.click(screen.getByRole('button', { name: 'Mentőtiszti beosztás feltöltése' }));

    await uploadRole(user, 'officer', 'Tiszt Tímea');
    expect(screen.getByLabelText('Dolgozó')).toHaveValue('vezető vince');
    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));

    expect(
      screen.queryByRole('dialog', { name: 'A mentőtiszti beosztás hiányzik' }),
    ).not.toBeInTheDocument();
    const table = await screen.findByRole('table');
    await user.click(within(table).getByText('2 társ'));
    expect(within(table).getByText(/Tiszt Tímea – 07:00–19:00/)).toBeVisible();
  });

  it('dolgozó- és hónapváltás után újra megjelenhet a mentőtiszti figyelmeztetés', async () => {
    const user = userEvent.setup();
    const additionalMonths = [{ sheetName: 'Szeptember', year: 2026, monthName: 'szeptember' }];
    render(<App />);
    await uploadRole(user, 'driver', 'Vezető Vince', {
      fontColor: '#FF0000',
      additionalEmployeeNames: ['Vezető Viktor'],
      additionalMonths,
    });
    await uploadRole(user, 'nurse', 'Ápoló Anna', {
      fontColor: '#FF0000',
      additionalMonths,
    });
    await user.selectOptions(await screen.findByLabelText('Dolgozó'), 'vezető vince');
    await user.click(screen.getByRole('checkbox', { name: /Szolgálati társak keresése/ }));
    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));
    await user.click(screen.getByRole('button', { name: 'Folytatás mentőtiszti beosztás nélkül' }));

    await user.selectOptions(screen.getByLabelText('Dolgozó'), 'vezető viktor');
    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));
    expect(screen.getByRole('dialog', { name: 'A mentőtiszti beosztás hiányzik' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Folytatás mentőtiszti beosztás nélkül' }));

    const monthSelect = screen.getByLabelText('Hónap');
    await user.selectOptions(
      monthSelect,
      within(monthSelect).getByRole('option', { name: '2026. szeptember' }),
    );
    await user.selectOptions(screen.getByLabelText('Dolgozó'), 'vezető vince');
    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));
    expect(screen.getByRole('dialog', { name: 'A mentőtiszti beosztás hiányzik' })).toBeVisible();
  });

  it('munkakör-, kapcsoló- és kiegészítőfájl-változás visszaállítja az eredményt', async () => {
    const user = userEvent.setup();
    render(<App />);
    await uploadRole(user, 'driver', 'Vezető Vince');
    await uploadRole(user, 'nurse', 'Ápoló Anna');
    await user.selectOptions(await screen.findByLabelText('Dolgozó'), 'vezető vince');
    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));
    expect(await screen.findByRole('heading', { name: 'Ellenőrzés' })).toBeVisible();

    await user.click(screen.getByRole('checkbox', { name: /Szolgálati társak keresése/ }));
    expect(screen.queryByRole('heading', { name: 'Ellenőrzés' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));
    expect(await screen.findByRole('heading', { name: 'Ellenőrzés' })).toBeVisible();

    await user.selectOptions(
      screen.getByLabelText('Kinek a beosztását szeretnéd feldolgozni?'),
      'nurse',
    );
    expect(screen.queryByRole('heading', { name: 'Ellenőrzés' })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Dolgozó'), 'ápoló anna');
    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));
    expect(await screen.findByRole('heading', { name: 'Ellenőrzés' })).toBeVisible();

    await uploadRole(user, 'driver', 'Másik Vezető', { fileName: 'másik-vezető.xlsx' });
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Ellenőrzés' })).not.toBeInTheDocument(),
    );
    expect(
      screen.getByLabelText<HTMLSelectElement>('Kinek a beosztását szeretnéd feldolgozni?'),
    ).toHaveValue('nurse');
  });
});
