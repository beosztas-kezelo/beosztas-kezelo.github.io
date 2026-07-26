import { describe, expect, it } from 'vitest';
import {
  createFileFingerprint,
  fileFingerprintsMatch,
} from '../src/services/fileIdentity';

function file(bytes: number[], name: string, lastModified: number): {
  file: File;
  buffer: ArrayBuffer;
} {
  const buffer = Uint8Array.from(bytes).buffer;
  const result = new File([buffer], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    lastModified,
  });
  Object.defineProperty(result, 'arrayBuffer', {
    value: () => Promise.resolve(buffer),
  });
  return { file: result, buffer };
}

describe('munkaköri fájlazonosság', () => {
  it('azonos tartalmi hash esetén eltérő fájlnév mellett is azonosnak tekinti a fájlt', async () => {
    const first = file([1, 2, 3], 'vezető.xlsx', 1);
    const second = file([1, 2, 3], 'ápoló.xlsx', 2);

    const firstFingerprint = await createFileFingerprint(
      first.file,
      first.buffer,
    );
    const secondFingerprint = await createFileFingerprint(
      second.file,
      second.buffer,
    );

    expect(fileFingerprintsMatch(firstFingerprint, secondFingerprint)).toBe(true);
  });

  it('azonos név, méret és módosítási idő esetén metaadat alapján is duplikátum', () => {
    expect(
      fileFingerprintsMatch(
        {
          name: 'beosztás.xlsx',
          size: 100,
          lastModified: 123,
          sha256: 'first',
        },
        {
          name: 'beosztás.xlsx',
          size: 100,
          lastModified: 123,
          sha256: 'second',
        },
      ),
    ).toBe(true);
  });

  it('eltérő tartalom és metaadatok esetén nem jelöl duplikátumot', () => {
    expect(
      fileFingerprintsMatch(
        {
          name: 'vezető.xlsx',
          size: 100,
          lastModified: 123,
          sha256: 'first',
        },
        {
          name: 'ápoló.xlsx',
          size: 101,
          lastModified: 124,
          sha256: 'second',
        },
      ),
    ).toBe(false);
  });
});
