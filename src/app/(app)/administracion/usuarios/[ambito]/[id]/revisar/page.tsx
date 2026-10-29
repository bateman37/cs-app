import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageAdmin } from "@/lib/session";
import { copyPreviousYearAction, confirmChangeAction, initializeHistoricAction } from "../../../actions";
import { previewCopyFromPreviousYear, previewInitializeHistoric, previewMatrixChange } from "@/server/usuarios";
import { DomainError } from "@/server/errors";
import { AccessError } from "@/lib/access";
import { KIND_LABEL, type MonthState, type Plan } from "@/domain/usuarios";
import { first, type SearchParams } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/form-kit";
import { fichaHref, monthName, SLUG_SCOPE } from "../../../_lib";

export const metadata: Metadata = { title: "Revisar cambio de usuarios" };

const show = (s: MonthState | null) => (s ? `${s.value} (${KIND_LABEL[s.kind]})` : "Sin informar");
const STATUS_TEXT = { changed: "Cambia", protected: "Se conserva (protegido)", unchanged: "Sin cambios" } as const;

function PlanTable({ plan }: { plan: Plan }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Mes</th><th>Antes</th><th>Después</th><th>Resultado</th></tr></thead>
        <tbody>
          {plan.rows.map((r) => (
            <tr key={r.month} style={r.status === "changed" ? { background: "var(--warn-bg)" } : undefined}>
              <td>{monthName(r.month)}</td>
              <td>{show(r.before)}</td>
              <td>{show(r.after)}</td>
              <td>{STATUS_TEXT[r.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function RevisarPage({ params, searchParams }: { params: Promise<{ ambito: string; id: string }>; searchParams: Promise<SearchParams> }) {
  const user = await requirePageAdmin();
  const { ambito, id } = await params;
  const sp = await searchParams;
  const type = SLUG_SCOPE[ambito];
  if (!type) notFound();
  const accion = first(sp.accion);
  const year = Number(first(sp.anio));
  const back = fichaHref(type, id, year || new Date().getFullYear());
  const scope = { targetType: type, targetId: id };

  type View =
    | { kind: "cambio"; pv: Awaited<ReturnType<typeof previewMatrixChange>> }
    | { kind: "inicializar"; pv: Awaited<ReturnType<typeof previewInitializeHistoric>> }
    | { kind: "copiar"; pv: Awaited<ReturnType<typeof previewCopyFromPreviousYear>> }
    | { kind: "error"; message: string; details: string[] };
  let view: View;
  try {
    if (accion === "cambio") {
      view = { kind: "cambio", pv: await previewMatrixChange(user.id, { ...scope, year, op: first(sp.op), month: first(sp.mes), value: first(sp.valor) }) };
    } else if (accion === "inicializar") {
      view = { kind: "inicializar", pv: await previewInitializeHistoric(user.id, { ...scope, value: first(sp.valor), source: first(sp.procedencia) }) };
    } else if (accion === "copiar") {
      view = { kind: "copiar", pv: await previewCopyFromPreviousYear(user.id, { ...scope, year }) };
    } else {
      notFound();
    }
  } catch (e) {
    if (e instanceof DomainError) view = { kind: "error", message: e.message, details: Object.values(e.fields) };
    else if (e instanceof AccessError) view = { kind: "error", message: e.message, details: [] };
    else throw e;
  }

  let body: React.ReactNode;
  if (view.kind === "error") {
    body = (
      <>
        <h1>No se puede continuar</h1>
        <p className="notice notice-error" role="alert">{view.message}</p>
        {view.details.length ? <ul>{[...new Set(view.details)].map((f) => <li key={f}>{f}</li>)}</ul> : null}
      </>
    );
  } else if (view.kind === "cambio") {
    const pv = view.pv;
    body = (
      <>
        <h1>Revisar cambio: {pv.scopeName}</h1>
        <p>
          {pv.op === "SET_MONTH"
            ? `Editar solo ${monthName(pv.month)} ${pv.year}: pasa a ${pv.value} como ajuste explícito. No se propaga a otros meses.`
            : `Aplicar ${pv.value} desde ${monthName(pv.month)} ${pv.year}: cambia ese mes y los posteriores, salvo los ajustes explícitos protegidos.`}
        </p>
        <PlanTable plan={pv.plan} />
        {pv.plan.protectedMonths.length ? (
          <p className="notice notice-info">Meses protegidos (ajuste explícito o bloqueados): {pv.plan.protectedMonths.map(monthName).join(", ")}.</p>
        ) : null}
        {pv.plan.changedCount === 0 ? (
          <p className="notice notice-error" role="alert">No hay cambios que guardar: los meses afectados ya tienen ese valor.</p>
        ) : (
          <ActionForm action={confirmChangeAction} hidden={{ ...scope, year: pv.year, op: pv.op, month: pv.month, value: pv.value, expectedVersion: pv.version }}>
            <div className="form-actions"><SubmitButton>Confirmar y guardar {pv.plan.changedCount} {pv.plan.changedCount === 1 ? "mes" : "meses"}</SubmitButton></div>
          </ActionForm>
        )}
      </>
    );
  } else if (view.kind === "inicializar") {
    const pv = view.pv;
    body = (
      <>
        <h1>Inicializar histórico 2025: {pv.scopeName}</h1>
        {pv.status === "conflict" ? (
          <p className="notice notice-error" role="alert">{pv.message}</p>
        ) : pv.status === "unchanged" ? (
          <p className="notice notice-info">El histórico ya está inicializado con ese mismo valor: no hay nada que cambiar.</p>
        ) : (
          <>
            <p>Se crearán los doce meses de 2025 con el mismo valor y quedarán bloqueados. Esta carga inicial no se puede repetir con otro valor.</p>
            <PlanTable plan={pv.plan} />
            <ActionForm action={initializeHistoricAction} hidden={{ ...scope, value: first(sp.valor), source: first(sp.procedencia) }}>
              <div className="form-actions"><SubmitButton>Confirmar inicialización</SubmitButton></div>
            </ActionForm>
          </>
        )}
      </>
    );
  } else {
    const pv = view.pv;
    body = (
      <>
        <h1>Copiar base de {year - 1}: {pv.scopeName}</h1>
        {pv.message ? <p className="notice notice-info" role="note">{pv.message}</p> : <p>Se copia cada mes del año anterior solo donde {year} está sin informar. No se pisa ningún valor ni ajuste existente.</p>}
        <PlanTable plan={pv.plan} />
        {pv.canApply ? (
          <ActionForm action={copyPreviousYearAction} hidden={{ ...scope, year, expectedVersion: pv.version }}>
            <div className="form-actions"><SubmitButton>Confirmar copia</SubmitButton></div>
          </ActionForm>
        ) : null}
      </>
    );
  }
  return (
    <>
      <p><Link href={back}>← Volver a la ficha</Link></p>
      {body}
    </>
  );
}
