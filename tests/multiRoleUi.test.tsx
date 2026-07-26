import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import {
  asFile,
  roleWorkbookBuffer,
} from './fixtures/syntheticWorkbook';

async function uploadRole(
  user: ReturnType<typeof userEvent.setup>,
  role: 'driver' | 'nurse' | 'officer',
  employeeName: string,
  options: {
    fileName?: string;
    sheetName?: string;
    monthName?: string;
    fontColor?: string;
  } = {},
): Promise<void> {
  const fileName = options.fileName ?? `${role}.xlsx`;
  const buffer = await roleWorkbookBuffer({
    employeeName,
    sheetName: options.sheetName,
    monthName: options.monthName,
    fontColor: options.fontColor,
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
      await user.selectOptions(screen.getByLabelText('Dolgozó'), employeeName.toLocaleLowerCase('hu-HU'));
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
    expect(within(roleSelect).queryByRole('option', { name: 'Mentőtiszt' })).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('Dolgozó')).getByRole('option', {
      name: 'Vezető Vince',
    })).toBeVisible();

    await user.selectOptions(roleSelect, 'nurse');

    expect(roleSelect).toHaveValue('nurse');
    expect(within(screen.getByLabelText('Dolgozó')).getByRole('option', {
      name: 'Ápoló Anna',
    })).toBeVisible();
    expect(within(screen.getByLabelText('Dolgozó')).queryByRole('option', {
      name: 'Vezető Vince',
    })).not.toBeInTheDocument();
  });

  it('ugyanazt a tartalmú fájlt második munkakörnél elutasítja', async () => {
    const user = userEvent.setup();
    render(<App />);
    const buffer = await roleWorkbookBuffer({ employeeName: 'Közös Dolgozó' });
    await user.upload(
      screen.getByTestId('file-input'),
      asFile(buffer, 'vezető.xlsx'),
    );
    await screen.findByLabelText('Kinek a beosztását szeretnéd feldolgozni?');
    await user.upload(
      screen.getByTestId('file-input-nurse'),
      asFile(buffer, 'ápoló-másolat.xlsx'),
    );

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
      screen.getByLabelText<HTMLSelectElement>(
        'Kinek a beosztását szeretnéd feldolgozni?',
      ),
    ).toHaveValue('driver');
    expect(within(screen.getByLabelText('Dolgozó')).getByRole('option', {
      name: 'Vezető Vince',
    })).toBeVisible();
  });

  it('eltérő hónapú kiegészítő fájlt nem párosít és nem blokkoló figyelmeztetést ad', async () => {
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
    await user.selectOptions(screen.getByLabelText('Dolgozó'), 'vezető vince');
    await user.click(
      screen.getByRole('checkbox', { name: /Szolgálati társak keresése/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));

    expect(await screen.findByText(/mentőápolói beosztásban nincs kiválasztott év és hónap/i))
      .toBeVisible();
    expect(screen.getByRole('button', { name: 'ICS letöltése' })).toBeEnabled();
  });

  it('a kapcsolóval a teljes kiegészítő munkalapból megjelennek a társak', async () => {
    const user = userEvent.setup();
    render(<App />);
    await uploadRole(user, 'driver', 'Vezető Vince', { fontColor: '#FF0000' });
    await uploadRole(user, 'nurse', 'Ápoló Anna', { fontColor: '#FF0000' });
    await uploadRole(user, 'officer', 'Tiszt Tímea', { fontColor: '#000000' });
    await user.selectOptions(await screen.findByLabelText('Dolgozó'), 'vezető vince');
    await user.click(
      screen.getByRole('checkbox', { name: /Szolgálati társak keresése/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Szolgálati társak' })).toBeVisible();
    await user.click(within(table).getByText('2 társ'));
    expect(within(table).getByText(/Ápoló Anna – 07:00–19:00/)).toBeVisible();
    expect(within(table).getByText(/Tiszt Tímea – 07:00–19:00/)).toBeVisible();
  });

  it('munkakör-, kapcsoló- és kiegészítőfájl-változás visszaállítja az eredményt', async () => {
    const user = userEvent.setup();
    render(<App />);
    await uploadRole(user, 'driver', 'Vezető Vince');
    await uploadRole(user, 'nurse', 'Ápoló Anna');
    await user.selectOptions(await screen.findByLabelText('Dolgozó'), 'vezető vince');
    await user.click(screen.getByRole('button', { name: 'Beosztás feldolgozása' }));
    expect(await screen.findByRole('heading', { name: 'Ellenőrzés' })).toBeVisible();

    await user.click(
      screen.getByRole('checkbox', { name: /Szolgálati társak keresése/ }),
    );
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
      screen.getByLabelText<HTMLSelectElement>(
        'Kinek a beosztását szeretnéd feldolgozni?',
      ),
    ).toHaveValue('nurse');
  });
});
