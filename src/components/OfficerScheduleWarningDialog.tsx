import { useEffect, useRef } from 'react';

interface OfficerScheduleWarningDialogProps {
  open: boolean;
  onUploadOfficerSchedule: () => void;
  onContinueWithoutOfficer: () => void;
}

export function OfficerScheduleWarningDialog({
  open,
  onUploadOfficerSchedule,
  onContinueWithoutOfficer,
}: OfficerScheduleWarningDialogProps) {
  const uploadButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) uploadButtonRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="dialog-backdrop">
      <section
        className="warning-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="officer-warning-heading"
        aria-describedby="officer-warning-description"
      >
        <h2 id="officer-warning-heading">A mentőtiszti beosztás hiányzik</h2>
        <p id="officer-warning-description">
          A kiválasztott dolgozónak Esetszolgálata is van. Az esetkocsis szolgálati társak teljes
          listájához a mentőtiszti beosztás feltöltése szükséges.
        </p>
        <div className="button-row">
          <button
            ref={uploadButtonRef}
            type="button"
            className="button primary"
            onClick={onUploadOfficerSchedule}
          >
            Mentőtiszti beosztás feltöltése
          </button>
          <button type="button" className="button secondary" onClick={onContinueWithoutOfficer}>
            Folytatás mentőtiszti beosztás nélkül
          </button>
        </div>
      </section>
    </div>
  );
}
