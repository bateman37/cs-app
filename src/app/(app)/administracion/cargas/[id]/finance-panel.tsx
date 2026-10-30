import Link from "next/link";
import { prisma } from "@/lib/db";
import { computeAnalysis, DECISION_LABEL, type DecisionKind } from "@/server/finance/review";
import { CATEGORY_LABEL, Dec } from "@/domain/finance";
import { formatDate } from "@/domain/vigencia";
import { DecisionForm, ReviewForm, RevokeForm } from "./finance-forms";

const eur = (v: string | null) => (v === null ? "—" : `${(Dec.parse(v) as Dec).toFixed(2).replace(".", ",")} €`);

/** Ficha financiera: controles, conciliación, impacto de la sustitución, decisiones y revisión (CSAPP-05). */
export async function FinancePanel({ batch, base }: { batch: { id: string; profileId: string; status: string; version: number; supersedesBatchId: string | null; supersededByBatchId: string | null; declaredExtractionDate: Date | null; createdAt: Date }; base: string }) {
  if (!batch.profileId.startsWith("facturacion-")) return null;
  const a = await computeAnalysis(prisma, batch.id);
  if (!a) return null;
  const ready = batch.status === "READY";
  const groups = a.ambiguousList.length ? await prisma.clientGroup.findMany({ where: { id: { in: a.ambiguousList.flatMap((x) => x.candidates.map((c) => c.groupId)) } }, select: { id: true, name: true } }) : [];
  const [prev, next] = await Promise.all([
    batch.supersedesBatchId ? prisma.uploadBatch.findUnique({ where: { id: batch.supersedesBatchId }, select: { id: true, originalName: true, status: true } }) : null,
    batch.supersededByBatchId ? prisma.uploadBatch.findUnique({ where: { id: batch.supersededByBatchId }, select: { id: true, originalName: true, status: true } }) : null,
  ]);
  const has = (k: DecisionKind, key = "") => a.decisions.find((d) => d.kind === k && d.key === key);
  const codes = new Set(a.blockers.map((b) => b.code));
  return (
    <section className="card" aria-labelledby="sec-finanzas">
      <h2 id="sec-finanzas">Facturación anual · {CATEGORY_LABEL[a.category]} {a.year}</h2>
      <p className="muted">
        Esta carga <strong>sustituye por completo</strong> el conjunto de {CATEGORY_LABEL[a.category]} del año {a.year}; no se suma al anterior. «Vta Potencial» es el ingreso anual realizado más la
        cartera casi confirmada («Ingreso anual: facturado + potencial»); «Diferencia» compara con el Budget y se guarda aparte, sin sumarse al ingreso.
      </p>

      <h3>Lotes del ámbito</h3>
      <ul>
        <li>Extracción declarada: {a.declaredExtraction ? formatDate(a.declaredExtraction) : "no declarada"}; fecha de recepción: {batch.createdAt.toISOString().slice(0, 10)} (son datos distintos).</li>
        <li>Lote al que sustituye: {prev ? <Link href={`${base.replace(batch.id, prev.id)}`}>{prev.originalName} ({prev.status})</Link> : a.impact.activeBatchId && ready ? <Link href={`${base.replace(batch.id, a.impact.activeBatchId)}`}>{a.impact.activeBatchName} (vigente actual)</Link> : "ninguno (primer conjunto del ámbito)"}</li>
        <li>Lote que lo sustituyó: {next ? <Link href={`${base.replace(batch.id, next.id)}`}>{next.originalName} ({next.status})</Link> : "ninguno"}</li>
      </ul>

      <h3>Controles del archivo</h3>
      <dl className="kv">
        <dt>Pie «Filtros aplicados»</dt>
        <dd>{a.controls.footer.status === "ok" ? "verificado" : a.controls.footer.status === "mismatch" ? "categoría equivocada" : "no verificable"} — {a.controls.footer.message}
          {a.controls.footer.lines.length ? <><br /><code>{a.controls.footer.lines.join(" · ")}</code></> : null}</dd>
        <dt>Año</dt><dd>{a.year} (seleccionado en servidor){a.controls.footer.currentYearFilter ? "; el pie «Año Actual es Año Actual» no informa un año numérico" : ""}{a.controls.footer.explicitYear ? `; el pie declara ${a.controls.footer.explicitYear}` : ""}</dd>
        <dt>Hoja</dt><dd>{a.controls.sheet ?? "—"}</dd>
        <dt>Filas</dt><dd>{a.counts.economic.toLocaleString("es-ES")} económicas únicas · {a.counts.duplicates} duplicadas idénticas · {a.counts.control} de control (Total, pie) · {a.counts.errors} con error · {a.counts.emptyIncome} con Vta Potencial vacía</dd>
      </dl>

      <h3>Conciliación</h3>
      <div className="table-wrap"><table>
        <caption className="skip">Conciliación del lote</caption>
        <tbody>
          <tr><th scope="row">Suma bruta de filas económicas</th><td>{eur(a.sums.gross)}</td></tr>
          <tr><th scope="row">Duplicados idénticos (no se cuentan)</th><td>{eur(a.sums.duplicates)}</td></tr>
          <tr><th scope="row">Suma de filas únicas</th><td>{eur(a.sums.unique)}</td></tr>
          <tr><th scope="row">Total declarado (control; no es un ingreso)</th><td>{a.reconciliation.totalPresent ? eur(a.reconciliation.controlIncome) : "ausente"}</td></tr>
          <tr><th scope="row">Diferencia con el Total (tolerancia {eur(a.tolerance)})</th><td>{a.reconciliation.difference === null ? "—" : `${eur(a.reconciliation.difference)} — ${a.reconciliation.reconciled ? "concilia" : "NO concilia"}`}</td></tr>
          <tr><th scope="row">Atribuido a Grupo Cliente / sin asignar</th><td>{eur(a.sums.attributed)} / {eur(a.sums.unassigned)}</td></tr>
          <tr><th scope="row">Control de Diferencia (suma / Total)</th><td>{a.reconciliation.diffControl ? `${eur(a.reconciliation.diffControl.sum)} / ${eur(a.reconciliation.diffControl.total)}` : `suma ${eur(a.sums.uniqueDiff)}; sin Total de Diferencia`}</td></tr>
        </tbody>
      </table></div>

      <h3>Impacto de la sustitución</h3>
      <div className="table-wrap"><table>
        <caption className="skip">Impacto frente al conjunto vigente</caption>
        <tbody>
          <tr><th scope="row">Conjunto vigente que se reemplaza</th><td>{a.impact.activeBatchId ? <Link href={`${base.replace(batch.id, a.impact.activeBatchId)}`}>{a.impact.activeBatchName}</Link> : "ninguno"}{a.impact.activeExtraction ? ` (extracción ${formatDate(a.impact.activeExtraction)})` : ""}</td></tr>
          <tr><th scope="row">Total anterior → nuevo</th><td>{eur(a.impact.previousTotal)} → {eur(a.impact.newTotal)}{a.impact.variation !== null ? ` (variación ${eur(a.impact.variation)})` : ""}</td></tr>
          <tr><th scope="row">Filas fuente (anterior → nuevo)</th><td>{a.impact.sourceRows.previous} → {a.impact.sourceRows.next}</td></tr>
          <tr><th scope="row">Grupos canónicos (anterior → nuevo)</th><td>{a.impact.previousGroups} → {a.impact.newGroups}</td></tr>
          <tr><th scope="row">Grupos nuevos / modificados / retirados / sin cambios</th><td>{a.impact.groups.added} / {a.impact.groups.modified} / {a.impact.groups.retired} / {a.impact.groups.unchanged}</td></tr>
          <tr><th scope="row">Sin asignar a un grupo</th><td>{a.resolution.unresolved} filas, {eur(a.sums.unassigned)}</td></tr>
        </tbody>
      </table></div>
      <p className="muted">«Retirado» significa que el grupo deja de aportar ingreso en este ámbito; no es una baja del maestro. Las filas sin asignar siguen formando parte del conjunto activo y de su conciliación, y la cobertura queda parcial.</p>

      {ready ? (
        <>
          <h3>Pendientes antes de confirmar</h3>
          {a.blockers.length === 0 ? <p className="notice notice-ok" role="status">No hay nada pendiente: el lote puede confirmarse.</p> : (
            <ul>{a.blockers.map((b) => <li key={b.code}><code>{b.code}</code> — {b.message}</li>)}</ul>
          )}

          {codes.has("EMPTY_INCOME") || codes.has("EMPTY_ZERO_STALE") || codes.has("EMPTY_ZERO_INVALID") || has("EMPTY_AS_ZERO") ? (
            <details className="edit" open={codes.has("EMPTY_INCOME")}>
              <summary>Vta Potencial vacía ({a.counts.emptyIncome} filas): {DECISION_LABEL.EMPTY_AS_ZERO}</summary>
              <p className="muted">No es una regla global: se aplica solo a este lote, exige Total presente y conciliado, y no usa «Diferencia». Se conserva el vacío original, el valor derivado cero, el actor y el motivo.</p>
              <DecisionForm batchId={batch.id} version={batch.version} kind="EMPTY_AS_ZERO" label="Tratar los vacíos como cero en este lote" reasonRequired />
            </details>
          ) : null}
          {a.ambiguousList.map((x) => (
            <details key={x.key} className="edit" open>
              <summary>«{x.label}» apunta a grupos distintos en {a.year}: asignación anual explícita</summary>
              <ul>{x.candidates.map((c) => <li key={c.groupId}>{c.groupName}: {c.intervals.map((i) => `${i.from ?? "…"} → ${i.to ?? "…"}`).join("; ")}</li>)}</ul>
              <DecisionForm batchId={batch.id} version={batch.version} kind="YEAR_ASSIGNMENT" keyValue={x.key} label="Asignar el año a este grupo" reasonRequired groups={groups.filter((g) => x.candidates.some((c) => c.groupId === g.id))} />
            </details>
          ))}
          {a.collisions.filter((c) => !has("ACCEPT_COLLISION", c.groupId)).map((c) => (
            <details key={c.groupId} className="edit" open>
              <summary>Colisión en «{c.groupName}»: {c.keys.map((k) => k.label).join(", ")}</summary>
              <DecisionForm batchId={batch.id} version={batch.version} kind="ACCEPT_COLLISION" keyValue={c.groupId} label="Son ingresos distintos" reasonRequired />
            </details>
          ))}
          {a.resolution.unresolved > 0 ? (
            <details className="edit" open={codes.has("UNASSIGNED")}>
              <summary>{a.resolution.unresolved} grupos de origen sin Grupo Cliente ({eur(a.sums.unassigned)}): {DECISION_LABEL.ACCEPT_UNASSIGNED}</summary>
              <ul>{a.unresolvedList.map((u) => <li key={u.key}>{u.label} — {eur(u.income)}</li>)}</ul>
              <p className="muted">Puede completar el maestro (equivalencia BC/GROUP_KEY del grupo) y usar «Reprocesar». Si activa así, quedarán fuera de los informes atribuidos {eur(a.sums.unassigned)} y la cobertura será parcial: la ausencia de un grupo no probará ingreso cero.</p>
              <DecisionForm batchId={batch.id} version={batch.version} kind="ACCEPT_UNASSIGNED" label="Aceptar que queden fuera de los informes atribuidos" />
            </details>
          ) : null}
          {codes.has("FOOTER_UNVERIFIED") ? (
            <details className="edit" open><summary>{DECISION_LABEL.ACK_UNVERIFIED_FOOTER}</summary>
              <DecisionForm batchId={batch.id} version={batch.version} kind="ACK_UNVERIFIED_FOOTER" label="Declaro categoría, filtros y cobertura completa" reasonRequired /></details>
          ) : null}
          {codes.has("NO_TOTAL") ? (
            <details className="edit" open><summary>{DECISION_LABEL.ACK_NO_TOTAL}</summary>
              <DecisionForm batchId={batch.id} version={batch.version} kind="ACK_NO_TOTAL" label="He revisado la ausencia del Total" reasonRequired /></details>
          ) : null}
          {codes.has("RETROCESO") ? (
            <details className="edit" open><summary>{DECISION_LABEL.ACK_RETROCESO}</summary>
              <DecisionForm batchId={batch.id} version={batch.version} kind="ACK_RETROCESO" label="Reconozco el retroceso" /></details>
          ) : null}

          <h3>Decisiones registradas</h3>
          {a.decisions.length === 0 ? <p className="muted">Ninguna.</p> : (
            <ul>{a.decisions.map((d) => (
              <li key={`${d.kind}${d.key}`}>
                {DECISION_LABEL[d.kind]}{d.key ? ` (${d.key})` : ""} — {d.decidedByEmail}, {d.decidedAt.slice(0, 16).replace("T", " ")}{d.reason ? `: ${d.reason}` : ""}
                <RevokeForm batchId={batch.id} version={batch.version} kind={d.kind} keyValue={d.key} />
              </li>
            ))}</ul>
          )}

          <h3>Revisión del impacto</h3>
          <p>
            {a.review.reviewedAt ? `Revisado el ${a.review.reviewedAt.slice(0, 16).replace("T", " ")}${a.review.reviewedByEmail ? ` por ${a.review.reviewedByEmail}` : ""} sobre el conjunto vigente ${a.review.reviewedActiveBatchId ?? "(ninguno)"} versión ${a.review.reviewedScopeVersion}. ` : "Sin revisar. "}
            {a.review.reviewedAt && !a.review.upToDate ? "El conjunto vigente cambió desde entonces: actualice la revisión." : ""}
          </p>
          <ReviewForm batchId={batch.id} version={batch.version} upToDate={a.review.upToDate} />
        </>
      ) : null}
    </section>
  );
}
