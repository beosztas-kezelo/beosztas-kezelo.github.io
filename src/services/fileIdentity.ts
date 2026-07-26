import type { FileFingerprint } from '../domain/types';

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function createFileFingerprint(
  file: File,
  buffer: ArrayBuffer,
): Promise<FileFingerprint> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer.slice(0));
  return {
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    sha256: bytesToHex(new Uint8Array(digest)),
  };
}

export function fileFingerprintsMatch(
  first: FileFingerprint,
  second: FileFingerprint,
): boolean {
  return (
    first.sha256 === second.sha256 ||
    (first.name === second.name &&
      first.size === second.size &&
      first.lastModified === second.lastModified)
  );
}
