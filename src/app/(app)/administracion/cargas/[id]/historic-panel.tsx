import Link from "next/link";
import { prisma } from "@/lib/db";
import { computeHistoricAnalysis, type HistoricResult } from "@/server/finance/historic";
import { HISTORIC_PROFILE_ID } from "@/domain/finance-history";
import { CATEGORY_LABEL, Dec, type FinanceCategory } from "@/domain/finance";
import { formatDecimalEs } from "@/lib/money";

const eur = (v: string | null) => (v === null ? "—" : `${formatDecimalEs(Dec.parse(v)?.toString() ?? v)} €`);
const OUTCOME = { NUEVO: "Nuevo (sin conjunto vigente)", SUSTITUYE: "Sustituye el conjunto vigente", SIN_CAMBIOS: "Sin cambios (idéntico al vigente)" } as const;

/** Resumen del libro de histórico económico: impacto por año+categoría antes de confirmar y resultado conciliado después (HOTFIX-01 §6-§7). */
export async function HistoricPanel({ batch, base }: { batch: { id: string; profileId: string; status: string; metadata: unknown }; base: string }) {
  if (batch.profileId !== HISTORIC_PROFILE_ID) return null;
  const a = await computeHistoricAnalysis(prisma, batch.id);
  if (!a) return null;
  const done = batch.status === "COMPLETED";
  const result = ((batch.metadata ?? {}) as { __hist?: { result?: HistoricResult } }).__hist?.result ?? null;
  // Conciliación tras activar: Σ de B del libro frente a Σ de lo aplicado en cada conjunto (FinanceRow), por año y categoría.
  const applied = done && result
    ? new Map(
        (
          await prisma.$queryRaw<{ id: string; n: bigint; total: string }[]>`
            SELECT "batchId" AS id, count(*) AS n, coalesce(sum(income), 0)::text AS total FROM "FinanceRow" WHERE "batchId" = ANY(${result.scopes.map((r) => r.batchId)}) GROUP BY "batchId"`
        ).map((r) => [r.id, { rows: Number(r.n), total: Dec.parse(r.total)?.toString() ?? "0" }]),
      )
    : null;
  const batchOf = new Map((result?.scopes ?? []).map((r) => [`${r.year}|${r.category}`, r.batchId]));
  return (
    <section className="card" aria-labelledby="sec-historico">
      <h2 id="sec-historico">Histórico económico y usuarios</h2>
      <p className="muted">
        Cada fila del libro aporta el importe anual (columna «Facturación anual») de un Grupo en un año y una categoría. «Confirmar y activar» aplica <strong>todos</strong> los conjuntos de abajo
        o ninguno; cada uno sustituye el conjunto vigente de su año+categoría y los años o categorías que el libro no incluye no se tocan. No se ejecutan fórmulas ni enlaces del libro: se usan
        los valores almacenados. La referencia «Facturación mes» no se suma al ingreso.
      </p>
      {a.blockers.length > 0 ? <ul className="notice notice-error" role="alert">{a.blockers.map((b) => <li key={b}>{b}</li>)}</ul> : null}

      <h3>Impacto por año y categoría</h3>
      <div className="table-wrap">
        <table>
          <caption className="skip">Conjuntos año+categoría del libro</caption>
          <thead>
            <tr><th>Año</th><th>Categoría</th><th>Filas</th><th>Σ importe anual</th><th>Σ referencia mensual (no se suma)</th><th>Conjunto vigente</th><th>Resultado de confirmar</th>{done ? <th>Aplicado (conciliación)</th> : null}</tr>
          </thead>
          <tbody>
            {a.scopes.map((s) => {
              const ap = applied?.get(batchOf.get(`${s.year}|${s.category}`) ?? "");
              const ok = ap ? ap.rows === s.rows && ap.total === s.total : null;
              return (
                <tr key={`${s.year}|${s.category}`} style={!done && s.outcome === "SUSTITUYE" ? { background: "var(--warn-bg)" } : undefined}>
                  <td>{s.year}</td>
                  <td>{CATEGORY_LABEL[s.category]}</td>
                  <td>{s.rows}</td>
                  <td>{eur(s.total)}</td>
                  <td>{eur(s.referenceTotal)}{s.rowsWithB6 > 0 ? <><br /><small className="muted">{s.rowsWithB6} referencia(s) con B/6 en lugar de B/12</small></> : null}</td>
                  <td>
                    {s.current ? (
                      <>
                        <Link href={`/administracion/cargas/${s.current.batchId}`}>{s.current.rows} filas · {eur(s.current.total)}</Link>
                        <br /><small className="muted">{s.current.origin === "HISTORICAL" ? "histórico" : "carga financiera"}</small>
                      </>
                    ) : <span className="muted">sin conjunto</span>}
                  </td>
                  <td>
                    <strong>{OUTCOME[s.outcome]}</strong>
                    {s.difference !== null ? <><br /><small>Diferencia sobre el vigente: {eur(s.difference)}</small></> : null}
                    {s.outcome === "SUSTITUYE" && s.year === 2025 ? <><br /><small>El año 2025 ya estaba cargado: la sustitución es explícita al confirmar.</small></> : null}
                  </td>
                  {done ? <td>{ap ? `${ap.rows} filas · ${eur(ap.total)} ${ok ? "(concilia)" : "(NO concilia)"}` : "—"}</td> : null}
                </tr>
              );
            })}
            <tr>
              <th scope="row" colSpan={3}>Total del libro</th>
              <td><strong>{eur(a.total)}</strong></td>
              <td colSpan={done ? 4 : 3} className="muted">{a.rowsValid} filas válidas de {a.rowsRead} leídas ({a.rowsError} con error, {a.rowsDuplicate} duplicadas idénticas).</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>Grupos Cliente</h3>
      <ul>
        <li>{a.groups.distinct} grupos económicos distintos; {a.groups.inMaster} ya están en el maestro (por su equivalencia BC).</li>
        {a.groups.toCreate.length > 0 ? (
          <li>
            {a.groups.toCreate.length} no están en el maestro y se crearán como «Grupo Cliente de procedencia histórica» (sin Cliente Zendesk, IDs, implantaciones ni usuarios inventados; su estado comercial actual no se deduce de su ausencia en CLIENTES):{" "}
            {a.groups.toCreate.map((g) => g.label).join(", ")}.
          </li>
        ) : null}
        {a.groups.ambiguous.length > 0 ? <li>{a.groups.ambiguous.length} con equivalencias a Grupos distintos en el año: su ingreso se conserva sin atribuir hasta resolverlo en el maestro ({a.groups.ambiguous.join(", ")}).</li> : null}
        {a.groups.outOfValidity.length > 0 ? <li>{a.groups.outOfValidity.length} con equivalencia BC fuera de vigencia para algún año: ingreso conservado sin atribuir ({a.groups.outOfValidity.join(", ")}).</li> : null}
      </ul>

      <h3>Usuarios de 2025 (columna «Usuarios»)</h3>
      <ul>
        <li>{a.users.values} valores para {a.users.groupsWithValues} Grupos: las filas no se suman entre categorías.</li>
        <li>{a.users.unique} Grupos con un único valor: se inicializan los doce meses de 2025 con ese número, 2026 desde esa base y 2022–2024 como «Estimado a partir de 2025» (solo donde el Grupo existe), sin pisar valores ya informados.</li>
        {a.users.fromFormula.length > 0 ? <li>Valor leído de una fórmula con resultado almacenado (no se ejecuta): {a.users.fromFormula.join(", ")}.</li> : null}
        <li>
          {a.users.discrepancies.length} Grupo(s) con valores distintos entre categorías: se conservan ambos y quedan sin denominador (no cero) hasta elegir uno en la ficha de usuarios del Grupo.
        </li>
      </ul>
      {a.users.discrepancies.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Grupo</th><th>Valores por categoría (celda)</th></tr></thead>
            <tbody>
              {a.users.discrepancies.map((d) => (
                <tr key={d.key}><td>{d.label}</td><td>{d.entries.map((e) => `${CATEGORY_LABEL[e.category as FinanceCategory]}: ${e.value} (${e.cell})`).join(" · ")}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <h3>Controles conservados</h3>
      <ul>
        <li>
          Referencia mensual B/6 en lugar de B/12: {a.controls.b6Cells.length > 0 ? a.controls.b6Cells.join(", ") : "ninguna"}. Se conserva y se señala; no se deduce un mes de arranque ni se multiplica por 12 para el anual.
        </li>
        <li>
          Servidor con error de búsqueda: {a.controls.serverErrorCells.length > 0 ? a.controls.serverErrorCells.join(", ") : "ninguno"}. Alojamiento conservado como no informado; el ingreso no se descarta y no se sigue el enlace del libro.
        </li>
        <li>No hay pie de control de Power BI en este libro: se concilian las sumas del importe anual y sus filas; no se declara certificación externa.</li>
        <li>La etiqueta histórica del plan (Gold, Platinum, Silver…) se conserva tal cual; no se convierte en Silver On Demand ni Recurrente y el subtipo queda «no informado».</li>
      </ul>

      {done && result ? (
        <>
          <h3>Resultado de la activación</h3>
          <ul>
            {result.scopes.map((r) => (
              <li key={`${r.year}|${r.category}`}>
                {r.year} · {CATEGORY_LABEL[r.category]}: {r.outcome === "SIN_CAMBIOS" ? "sin cambios" : r.outcome === "NUEVO" ? "incorporado" : "sustituyó al vigente"} ({r.rows} filas, {eur(r.total)}) ·{" "}
                <Link href={`${base.replace(batch.id, r.batchId)}`}>ver conjunto</Link>
              </li>
            ))}
            <li>Grupos de procedencia histórica creados: {result.groupsCreated.length}. Usuarios 2025: {result.users.initialized} Grupo(s) inicializados, {result.users.conflicts} en discrepancia sin resolver, {result.users.skippedUnresolved} sin atribución inequívoca.</li>
          </ul>
        </>
      ) : null}
    </section>
  );
}

/** Ficha de un conjunto año+categoría escrito por un libro de histórico: enlaza al original y muestra lo conservado de cada fila. */
export async function HistoricChildPanel({ batch, base }: { batch: { id: string; status: string; metadata: unknown }; base: string }) {
  const meta = (batch.metadata ?? {}) as { origen?: string; loteOrigenId?: string; checksumOrigen?: string };
  if (meta.origen !== "HISTORICO_ECONOMICO") return null;
  const fb = await prisma.financeBatch.findUnique({ where: { batchId: batch.id } });
  if (!fb) return null;
  const h = (fb.controls as { historic?: { annualTotal: string; referenceTotal: string; rows: { sourceRow: number; label: string; supportLabel: string; monthlyRef: string | null; monthlyRefKind: string; serverStatus: string; server: string | null; users: number | null }[] } }).historic;
  const sc = await prisma.financeScope.findUnique({ where: { year_category: { year: fb.year, category: fb.category } } });
  return (
    <section className="card" aria-labelledby="sec-hist-hijo">
      <h2 id="sec-hist-hijo">Histórico económico · {CATEGORY_LABEL[fb.category as FinanceCategory]} {fb.year}</h2>
      <p className="muted">
        Conjunto escrito por el libro <Link href={base.replace(batch.id, meta.loteOrigenId ?? "")}>{meta.loteOrigenId}</Link> (checksum {meta.checksumOrigen?.slice(0, 12)}…): sin pie de control, cobertura no confirmada. Es el conjunto{" "}
        {sc?.activeBatchId === batch.id ? "vigente" : "no vigente"} de su año y categoría. Se revierte desde el lote del libro.
      </p>
      <p>Σ importe anual: <strong>{eur(h?.annualTotal ?? null)}</strong> · Σ referencia mensual (no se suma): {eur(h?.referenceTotal ?? null)}</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Fila del libro</th><th>Grupo</th><th>Plan histórico (D)</th><th>Referencia mensual</th><th>Servidor</th><th>Usuarios</th></tr></thead>
          <tbody>
            {(h?.rows ?? []).map((r) => (
              <tr key={r.sourceRow}>
                <td>{r.sourceRow}</td><td>{r.label}</td><td>{r.supportLabel}</td>
                <td>{r.monthlyRef ?? "—"}{r.monthlyRefKind === "B6" ? " (B/6, excepción)" : ""}</td>
                <td>{r.serverStatus === "ERROR" ? `${r.server} (error de búsqueda; no informado)` : (r.server ?? "—")}</td>
                <td>{r.users ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
