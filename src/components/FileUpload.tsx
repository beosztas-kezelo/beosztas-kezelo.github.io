import {
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type Ref,
} from 'react';
import { STAFF_ROLE_FILE_LABELS, STAFF_ROLES } from '../domain/staffRoles';
import type { StaffRole } from '../domain/types';

export interface RoleFileView {
  role: StaffRole;
  status: 'empty' | 'loading' | 'success' | 'error';
  fileName?: string;
  monthCount?: number;
  errorMessage?: string;
}

interface FileUploadProps {
  files: Record<StaffRole, RoleFileView>;
  disabled?: boolean;
  sectionRef?: Ref<HTMLElement>;
  onFile: (role: StaffRole, file: File) => void;
  onRemove: (role: StaffRole) => void;
}

export function FileUpload({
  files,
  disabled,
  sectionRef,
  onFile,
  onRemove,
}: FileUploadProps) {
  const inputRefs = useRef<Partial<Record<StaffRole, HTMLInputElement | null>>>({});
  const [draggingRole, setDraggingRole] = useState<StaffRole>();

  const choose = (role: StaffRole, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onFile(role, file);
    event.target.value = '';
  };

  const drop = (role: StaffRole, event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDraggingRole(undefined);
    const file = event.dataTransfer.files[0];
    if (file) onFile(role, file);
  };

  return (
    <section ref={sectionRef} className="panel workflow-section" aria-labelledby="upload-heading">
      <div className="section-heading">
        <span className="eyebrow">1. lépés</span>
        <h2 id="upload-heading">Excel-beosztások kiválasztása</h2>
      </div>
      <p className="muted">
        Legalább egy munkaköri beosztás szükséges. A fájl szerepét az határozza meg, melyik
        mezőben választod ki.
      </p>
      <div className="role-file-grid">
        {STAFF_ROLES.map((role) => {
          const item = files[role];
          return (
            <article
              className={`role-file-card role-file-${item.status}${
                draggingRole === role ? ' is-dragging' : ''
              }`}
              key={role}
              onDragEnter={(event) => {
                event.preventDefault();
                setDraggingRole(role);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDraggingRole(undefined);
                }
              }}
              onDrop={(event) => drop(role, event)}
            >
              <h3>{STAFF_ROLE_FILE_LABELS[role]}</h3>
              <input
                ref={(element) => {
                  inputRefs.current[role] = element;
                }}
                type="file"
                accept=".xlsx,.xls"
                onChange={(event) => choose(role, event)}
                hidden
                data-testid={role === 'driver' ? 'file-input' : `file-input-${role}`}
              />
              <p className="role-file-drop-hint">Húzd ide, vagy válaszd ki az Excel-fájlt.</p>
              {item.status === 'empty' && <p className="muted">Nincs fájl kiválasztva.</p>}
              {item.status === 'loading' && (
                <p role="status">A munkafüzet feldolgozása…</p>
              )}
              {item.status === 'success' && (
                <div className="role-file-status" aria-live="polite">
                  <p>
                    <strong>{item.fileName}</strong>
                  </p>
                  <p className="status-inline success">
                    Sikeresen feldolgozva · {item.monthCount} felismert hónap
                  </p>
                </div>
              )}
              {item.status === 'error' && (
                <div className="role-file-status" role="alert">
                  {item.fileName && <strong>{item.fileName}</strong>}
                  <p className="status-inline error">
                    Hibás feldolgozás{item.errorMessage ? `: ${item.errorMessage}` : '.'}
                  </p>
                </div>
              )}
              <div className="role-file-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => inputRefs.current[role]?.click()}
                  disabled={disabled || item.status === 'loading'}
                >
                  {item.status === 'success' ? 'Fájl cseréje' : 'Fájl kiválasztása'}
                </button>
                {item.status !== 'empty' && item.status !== 'loading' && (
                  <button
                    type="button"
                    className="button tertiary-outline"
                    onClick={() => onRemove(role)}
                    disabled={disabled}
                  >
                    Fájl eltávolítása
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <p className="privacy-note">
        <span aria-hidden="true">◆</span>A fájl feldolgozása helyben, a böngészőben történik.
        Ez minden kiválasztott beosztásra érvényes; a fájlok nem kerülnek feltöltésre vagy
        eltárolásra.
      </p>
    </section>
  );
}
