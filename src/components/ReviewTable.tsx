import { Fragment, type Ref } from 'react';
import type {
  CalendarExportPreferences,
  GoogleEventState,
  ReviewRow,
} from '../domain/types';
import { STAFF_ROLE_LABELS, STAFF_ROLES } from '../domain/staffRoles';
import {
  createDefaultCalendarExportPreferences,
  resolveCalendarEventTitle,
} from '../services/calendarExportPreferences';
import { crewOverlapLabel } from '../services/crewTimeDisplay';
import { formatHungarianDate, weekdayHungarian } from '../services/dates';
import { isGoogleSelectionLocked } from '../utils/googleUpload';

interface ReviewTableProps {
  sectionRef?: Ref<HTMLElement>;
  rows: ReviewRow[];
  selected: Set<string>;
  googleStates: ReadonlyMap<string, GoogleEventState>;
  preferences?: CalendarExportPreferences;
  crewSearchEnabled?: boolean;
  onToggle: (eventId: string) => void;
  onSelectAll: (selected: boolean) => void;
}

function time(value?: string): string {
  return value?.slice(11, 16) ?? '—';
}

function yesNo(value: boolean | undefined): string {
  return value ? 'igen' : 'nem';
}

function TechnicalDetails({
  row,
  googleState,
  displayedStatus,
}: {
  row: ReviewRow;
  googleState?: GoogleEventState;
  displayedStatus: ReviewRow['status'];
}) {
  const inferredDiagnostic = row.dailyInference
    ? row.diagnostics.find((diagnostic) => diagnostic.displayedText.trim() === '12')
    : undefined;
  const assignment = row.roleAssignment;

  return (
    <details className="diagnostics">
      <summary>Technikai részletek</summary>
      <div className="technical-blocks">
        <section className="technical-block">
          <h4>Felismerés eredménye</h4>
          <p className="technical-message">{row.note}</p>
          {row.technicalNote && row.technicalNote !== row.note && <p>{row.technicalNote}</p>}
          <dl>
            <dt>Állapot</dt>
            <dd>{displayedStatus}</dd>
            <dt>Felismert jelölés</dt>
            <dd>{row.marker || '—'}</dd>
            <dt>Tényleges műszaktípus</dt>
            <dd>{row.shiftType ?? '—'}</dd>
            <dt>Tényleges szolgálati jelleg</dt>
            <dd>{row.serviceCategory ?? '—'}</dd>
          </dl>
        </section>

        {(row.timeRule ||
          row.pairingReferences?.length ||
          row.dailyInference ||
          row.serviceResolution) && (
          <section className="technical-block">
            <h4>Idő- és párosítási adatok</h4>
            <dl>
              {row.timeRule && (
                <>
                  <dt>Felismert időszabály</dt>
                  <dd>{row.timeRule}</dd>
                </>
              )}
              {row.pairingReferences?.map((reference) => (
                <Fragment key={`${reference.direction}-${reference.address}`}>
                  <dt>Párosításhoz használt cella</dt>
                  <dd>
                    {reference.direction === 'previous' ? 'előző' : 'következő'} –{' '}
                    {reference.address}
                  </dd>
                </Fragment>
              ))}
              {row.dailyInference && (
                <>
                  <dt>Eredeti érték</dt>
                  <dd>{inferredDiagnostic?.displayedText ?? row.marker}</dd>
                  <dt>Eredeti betűszín</dt>
                  <dd>{inferredDiagnostic?.fontColor ?? '—'}</dd>
                  <dt>Eredeti aláhúzás</dt>
                  <dd>{yesNo(inferredDiagnostic?.underline)}</dd>
                  <dt>24 órás Parti szolgálat jelen van</dt>
                  <dd>{yesNo(row.dailyInference.partyTwentyFourHourPresent)}</dd>
                  <dt>Kék 12 jelen van</dt>
                  <dd>{yesNo(row.dailyInference.blueTwelvePresent)}</dd>
                  <dt>Zöld-aláhúzott 12 jelen van</dt>
                  <dd>{yesNo(row.dailyInference.tenCarTwelvePresent)}</dd>
                  <dt>Fekete 12 jelöltek száma</dt>
                  <dd>{row.dailyInference.blackTwelveCandidateCount}</dd>
                  <dt>Következtetett korrekció történt</dt>
                  <dd>{yesNo(row.dailyInference.correctionApplied)}</dd>
                  <dt>Eredeti szolgálattípus</dt>
                  <dd>
                    {row.dailyInference.originalServiceCategory},{' '}
                    {row.dailyInference.originalShiftType}
                  </dd>
                  <dt>Végső szolgálattípus</dt>
                  <dd>
                    {row.dailyInference.finalServiceCategory}, {row.dailyInference.finalShiftType}
                  </dd>
                  <dt>Végső időintervallum</dt>
                  <dd>
                    {time(row.dailyInference.finalTime.start)}–
                    {time(row.dailyInference.finalTime.end)}
                  </dd>
                </>
              )}
              {row.serviceResolution && (
                <>
                  <dt>Eredeti szolgálati kategória</dt>
                  <dd>{row.serviceResolution.originalServiceCategory}</dd>
                  <dt>Végső szolgálati kategória</dt>
                  <dd>{row.serviceResolution.finalServiceCategory ?? '—'}</dd>
                  <dt>Formázási korrekció történt</dt>
                  <dd>{yesNo(row.serviceResolution.formattingCorrectionApplied)}</dd>
                  <dt>Napi összeállításból következtetve</dt>
                  <dd>{yesNo(row.serviceResolution.dailyInferenceApplied)}</dd>
                  <dt>Feltételezett hónaphatár-párosítás</dt>
                  <dd>{yesNo(row.serviceResolution.assumedBoundaryPairing)}</dd>
                  <dt>Párosítás forrása</dt>
                  <dd>{row.serviceResolution.pairingSource ?? 'nem szükséges'}</dd>
                  <dt>Tényleges vagy feltételezett párosító cella</dt>
                  <dd>{row.serviceResolution.pairingCell ?? 'nem szükséges'}</dd>
                  <dt>Végső listaidő</dt>
                  <dd>
                    {row.serviceResolution.finalShiftTime
                      ? `${row.serviceResolution.finalShiftTime.start} – ${row.serviceResolution.finalShiftTime.end}`
                      : '—'}
                  </dd>
                  <dt>Végső naptáridő</dt>
                  <dd>
                    {row.serviceResolution.finalCalendarTime
                      ? `${row.serviceResolution.finalCalendarTime.start} – ${row.serviceResolution.finalCalendarTime.end}`
                      : '—'}
                  </dd>
                </>
              )}
            </dl>
          </section>
        )}

        {assignment && (
          <section className="technical-block">
            <h4>Munkakör-átirányítás</h4>
            <dl>
              <dt>Alapmunkakör</dt>
              <dd>{STAFF_ROLE_LABELS[assignment.baseRole]}</dd>
              <dt>Tényleges napi munkakör</dt>
              <dd>{STAFF_ROLE_LABELS[assignment.effectiveRole]}</dd>
              <dt>Eredeti jelölés</dt>
              <dd>{assignment.marker}</dd>
              <dt>Eredeti fájl és sor</dt>
              <dd>
                {assignment.sourceFileName}, {assignment.sourceRow}. sor
              </dd>
              <dt>Eredeti cellák</dt>
              <dd>{assignment.sourceCells.join(', ') || '—'}</dd>
              <dt>Célmunkaköri fájl</dt>
              <dd>{assignment.targetFileName ?? 'nem áll rendelkezésre'}</dd>
              <dt>Megtalált célsor</dt>
              <dd>
                {assignment.targetRows && assignment.targetRows.length > 0
                  ? `${assignment.targetRows.join(', ')}. sor`
                  : assignment.targetRow
                    ? `${assignment.targetRow}. sor`
                    : 'nem található'}
              </dd>
              <dt>Célcellák</dt>
              <dd>{assignment.targetCells.join(', ') || '—'}</dd>
              <dt>Céloldali szolgálati jelölés</dt>
              <dd>{assignment.targetMarker ?? '—'}</dd>
              <dt>Céloldali párosító cellák</dt>
              <dd>{assignment.targetPairingCells.join(', ') || '—'}</dd>
              <dt>Tényleges műszaktípus</dt>
              <dd>{row.shiftType ?? '—'}</dd>
              <dt>Tényleges szolgálati jelleg</dt>
              <dd>{row.serviceCategory ?? '—'}</dd>
              <dt>Tényleges listaidő</dt>
              <dd>
                {row.event
                  ? `${row.event.shiftTime.start} – ${row.event.shiftTime.end}`
                  : '—'}
              </dd>
              <dt>Tényleges naptáridő</dt>
              <dd>
                {row.event
                  ? `${row.event.calendarTime.start} – ${row.event.calendarTime.end}`
                  : '—'}
              </dd>
              <dt>Exportcím utótagja</dt>
              <dd>{assignment.titleSuffix}</dd>
              <dt>Feloldás eredménye</dt>
              <dd>{assignment.resolution === 'resolved' ? 'sikeres' : 'sikertelen'}</dd>
              <dt>Feloldás oka</dt>
              <dd>{assignment.reason}</dd>
            </dl>
          </section>
        )}

        <section className="technical-block">
          <h4>Excel-cellák és formázás</h4>
          {row.diagnostics.length === 0 ? (
            <p>Nincs celladiagnosztika.</p>
          ) : (
            row.diagnostics.map((item) => (
              <dl key={item.address}>
                <dt>Cella</dt>
                <dd>
                  {item.address}
                  {item.isMerged ? ` (merge master: ${item.mergeMaster})` : ''}
                </dd>
                <dt>Nyers / megjelenített</dt>
                <dd>
                  {item.rawValue || '∅'} / {item.displayedText || '∅'}
                </dd>
                <dt>Napi cellacsoporton belüli pozíció</dt>
                <dd>{item.positionInDayGroup}.</dd>
                <dt>Stílus</dt>
                <dd>
                  #{item.styleId ?? '—'}, dőlt {yesNo(item.italic)}, félkövér {yesNo(item.bold)}
                </dd>
                <dt>Betűszín nyers értéke</dt>
                <dd>{item.fontColorRaw ?? 'alapértelmezett'}</dd>
                <dt>Betűszín normalizált értéke</dt>
                <dd>{item.fontColor ?? '—'}</dd>
                <dt>Aláhúzott</dt>
                <dd>{yesNo(item.underline)}</dd>
                <dt>Fill típusa</dt>
                <dd>{item.fillType ?? '—'}</dd>
                <dt>patternType</dt>
                <dd>{item.fillPatternType ?? '—'}</dd>
                <dt>fgColor nyers értéke</dt>
                <dd>{item.fillForegroundRaw ?? '—'}</dd>
                <dt>bgColor nyers értéke</dt>
                <dd>{item.fillBackgroundRaw ?? '—'}</dd>
                <dt>Van látható kitöltés</dt>
                <dd>{yesNo(item.hasVisibleFill)}</dd>
                <dt>Normalizált szín</dt>
                <dd>{item.fillColor ?? '—'}</dd>
                <dt>Végső fill kategória</dt>
                <dd>{item.fillCategory ?? '—'}</dd>
                <dt>Felismert szolgálati kategória</dt>
                <dd>{row.serviceCategory ?? '—'}</dd>
              </dl>
            ))
          )}
        </section>

        {googleState && (
          <section className="technical-block">
            <h4>Google API adatok</h4>
            <p>{googleState.message}</p>
            {googleState.technicalDetails && (
              <pre className="technical-pre">{googleState.technicalDetails}</pre>
            )}
          </section>
        )}
      </div>
    </details>
  );
}

export function ReviewTable({
  sectionRef,
  rows,
  selected,
  googleStates,
  preferences = createDefaultCalendarExportPreferences(),
  crewSearchEnabled = false,
  onToggle,
  onSelectAll,
}: ReviewTableProps) {
  const exportable = rows.filter(
    (row) => row.event && !isGoogleSelectionLocked(googleStates.get(row.event.id)),
  );
  const allSelected =
    exportable.length > 0 && exportable.every((row) => selected.has(row.event?.id ?? ''));

  return (
    <section
      ref={sectionRef}
      className="panel review-panel workflow-section"
      aria-labelledby="review-heading"
    >
      <div className="section-heading review-title-row">
        <div>
          <span className="eyebrow">5. lépés</span>
          <h2 id="review-heading">Ellenőrzés</h2>
        </div>
        <label className="select-all">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(event) => onSelectAll(event.target.checked)}
            disabled={exportable.length === 0}
          />
          Összes biztos kijelölése
        </label>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Kijelölés</th>
              <th scope="col">Dátum</th>
              <th scope="col">Nap</th>
              <th scope="col">Felismert Excel-jelölés</th>
              <th scope="col">Szolgálat típusa</th>
              <th scope="col">Szolgálati jelleg</th>
              <th scope="col">Kezdés</th>
              <th scope="col">Befejezés</th>
              <th scope="col">Naptáresemény neve</th>
              <th scope="col">Állapot</th>
              {crewSearchEnabled && <th scope="col">Szolgálati társak</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const eventId = row.event?.id;
              const googleState = eventId ? googleStates.get(eventId) : undefined;
              const displayedStatus = googleState?.status ?? row.status;
              const issue =
                displayedStatus === 'Bizonytalan' ||
                displayedStatus === 'Hibás párosítás' ||
                displayedStatus === 'Sikertelen';
              return (
                <tr
                  key={row.id}
                  className={issue ? 'row-issue' : displayedStatus === 'Kizárva' ? 'row-muted' : ''}
                >
                  <td data-label="Kijelölés">
                    <input
                      type="checkbox"
                      aria-label={`${formatHungarianDate(row.date)} exportálása`}
                      checked={eventId ? selected.has(eventId) : false}
                      disabled={!eventId || isGoogleSelectionLocked(googleState)}
                      onChange={() => eventId && onToggle(eventId)}
                    />
                  </td>
                  <td data-label="Dátum">{formatHungarianDate(row.date)}</td>
                  <td data-label="Nap">{weekdayHungarian(row.date)}</td>
                  <td data-label="Excel-jelölés">
                    <strong>
                      {row.roleAssignment?.resolution === 'resolved' && row.resolvedMarker
                        ? `${row.marker} → ${row.resolvedMarker}`
                        : row.marker || '—'}
                    </strong>
                  </td>
                  <td data-label="Szolgálat">
                    {row.shiftType ?? '—'}
                    {row.roleAssignment?.resolution === 'resolved' && (
                      <span className="assignment-badge">
                        {row.roleAssignment.marker} munkakörben
                      </span>
                    )}
                  </td>
                  <td data-label="Szolgálati jelleg">
                    {row.serviceCategory
                      ? `${row.serviceCategory}${
                          row.dailyInference?.correctionApplied ||
                          row.serviceResolution?.dailyInferenceApplied
                            ? ' – következtetett'
                            : ''
                        }`
                      : '—'}
                  </td>
                  <td data-label="Kezdés">{time(row.event?.shiftTime.start)}</td>
                  <td data-label="Befejezés">{time(row.event?.shiftTime.end)}</td>
                  <td data-label="Esemény">
                    {row.event ? resolveCalendarEventTitle(row.event, preferences) : '—'}
                  </td>
                  <td data-label="Állapot">
                    <span
                      className={`status status-${
                        displayedStatus === 'Létrehozás folyamatban'
                          ? 'pending'
                          : issue
                            ? 'issue'
                            : 'ok'
                      }`}
                    >
                      {displayedStatus}
                    </span>
                    <TechnicalDetails
                      row={row}
                      googleState={googleState}
                      displayedStatus={displayedStatus}
                    />
                  </td>
                  {crewSearchEnabled && (
                    <td data-label="Szolgálati társak" className="crew-cell">
                      {row.crewMatches && row.crewMatches.length > 0 ? (
                        <details className="crew-details">
                          <summary>{row.crewMatches.length} társ</summary>
                          {STAFF_ROLES.map((role) => {
                            const matches = row.crewMatches?.filter(
                              (match) => match.role === role,
                            );
                            if (!matches || matches.length === 0) return null;
                            return (
                              <div className="crew-role-group" key={role}>
                                <strong>{STAFF_ROLE_LABELS[role]}</strong>
                                <ul>
                                  {matches.map((match) => (
                                    <li
                                      key={`${match.role}-${match.normalizedName}-${match.employeeRow}-${match.overlap.start}-${match.overlap.end}`}
                                    >
                                      {match.displayName} – {crewOverlapLabel(match.overlap)}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            );
                          })}
                        </details>
                      ) : row.event ? (
                        <span className="muted">Nincs talált társ.</span>
                      ) : (
                        '—'
                      )}
                      {row.crewNotices && row.crewNotices.length > 0 && (
                        <ul className="crew-notices">
                          {row.crewNotices.map((notice, index) => (
                            <li key={`${notice.role}-${notice.kind}-${index}`}>
                              {notice.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
