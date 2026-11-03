import Link from "next/link";
import { prisma } from "@/lib/db";
import { PRECARGA_PROFILE_ID, REVIEW_LABEL } from "@/domain/precarga-maestros";
import { getPrecargaReview, type ReviewItem } from "@/server/precarga/review";
import { readRefreshStatus } from "@/server/relations/refresh";
import { formatDateTime } from "@/lib/format";
import { MastersDecisionForm } from "./maestros-forms";

type Report = { created: Record<string, number>; reused: Record<string, number>; preserved: Record<string, number>; notes: { code: string; message: string }[] };

const STATE_LABEL: Record<string, string> = { PENDING: "Pendiente", DECIDED: "Decidida", RESOLVED: "Resuelta en el maestro", APPLIED: "Aplicada (confirmar)", INFO: "Informativa" };
const KEY_LABEL: Record<string, string> = {
  grupos: "Grupos Cliente", clientes: "Clientes", implantaciones: "Implantaciones", "identidades.BC": "Equivalencias BC (denominación)", "identidades.ZENDESK": "Equivalencias Zendesk (ID de organización)",
  "identidades.WRIKE": "Equivalencias Wrike (a Grupo)", "identidades.PAP": "Equivalencias PAP", "datosServicio.SUPPORT": "Soporte", "datosServicio.HOSTING": "Servidor", "datosServicio.COMPLEXITY": "Complejidad (implantación)",
  personas: "Personas", alias: "Alias de personas", "tramosPersona.LEVEL": "Nivel", "tramosPersona.TEAM": "Equipo", "tramosPersona.PMO_MEMBER": "Pertenencia a PMO", "tramosPersona.PMO_ROLE": "Rol PMO",
  "catalogo.LEVEL": "Catálogo de niveles", "catalogo.TEAM": "Catálogo de equipos", "catalogo.PMO_ROLE": "Catálogo de roles PMO", "roles.enlazados": "Roles PMO enlazados por alias Wrike exacto", "roles.sinPersona": "Roles PMO sin persona (revisión)",
};

function Table({ title, data }: { title: string; data: Record<string, number> }) {
  const keys = Object.keys(data).sort();
  if (keys.length === 0) return null;
  return (
    <div className="table-wrap">
      <table>
        <caption className="skip">{title}</caption>
        <thead><tr><th>{title}</th><th>Cantidad</th></tr></thead>
        <tbody>{keys.map((k) => <tr key={k}><td>{KEY_LABEL[k] ?? k}</td><td>{data[k].toLocaleString("es-ES")}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Item({ it, batchId, completed }: { it: ReviewItem; batchId: string; completed: boolean }) {
  return (
    <li key={it.key} style={{ marginBottom: "0.75rem" }}>
      <strong>{it.title}</strong> <span className={it.state === "PENDING" ? "badge badge-warn" : it.state === "DECIDED" || it.state === "RESOLVED" ? "badge badge-ok" : "badge"}>{STATE_LABEL[it.state]}</span>
      <br />
      <span>{it.message}</span>
      {it.decision ? (
        <p className="muted">
          Decisión «{it.options.find((o) => o.decision === it.decision?.decision && (o.value ?? "") === (it.decision?.value ?? ""))?.label ?? it.decision.decision}» de {it.decision.by} el {formatDateTime(it.decision.at)}
          {it.decision.otherBatch ? " (en otra carga del mismo archivo)" : ""}. Motivo: {it.decision.reason}
        </p>
      ) : null}
      {it.state === "PENDING" && it.decidable && completed ? (
        <details className="edit">
          <summary>Decidir</summary>
          <MastersDecisionForm batchId={batchId} itemKey={it.key} options={it.options} />
        </details>
      ) : null}
      {it.state === "PENDING" && it.decidable && !completed ? <small className="muted">Se podrá decidir cuando la carga esté completada.</small> : null}
      {it.state === "PENDING" && !it.decidable && it.kind !== "INFO" ? <small className="muted">Todavía no hay un maestro sobre el que decidir (se carga al confirmar).</small> : null}
    </li>
  );
}

/**
 * Ficha de la precarga de maestros: qué contiene el libro, qué se creó o conservó, las revisiones pendientes (con decisión, autor y motivo)
 * y el recálculo necesario de hechos ya cargados. Las revisiones viven aquí, en la ficha del lote; no hay una bandeja independiente.
 */
export async function MaestrosPanel({ userId, batch }: { userId: string; batch: { id: string; profileId: string; status: string } }) {
  if (batch.profileId !== PRECARGA_PROFILE_ID) return null;
  const review = await getPrecargaReview(userId, batch.id);
  if (!review) return null;
  const completed = batch.status === "COMPLETED";
  const row = await prisma.uploadBatch.findUnique({ where: { id: batch.id }, select: { summary: true } });
  const report = ((row?.summary ?? {}) as { precarga?: Report }).precarga;
  const rel = completed ? await readRefreshStatus() : null;
  const by = (k: ReviewItem["kind"]) => review.items.filter((i) => i.kind === k && i.kind !== "INFO");
  const groupsOfKinds: ReviewItem["kind"][] = ["SUPPORT", "HOSTING", "WRIKE_ALIAS", "PAP_ALIAS", "PERSON_VARIANT", "PMO_ROLE"];
  const info = review.items.filter((i) => i.kind === "INFO");
  return (
    <section className="card" aria-labelledby="sec-maestros">
      <h2 id="sec-maestros">Precarga de maestros</h2>
      <p className="muted">
        Un solo libro con las hojas CLIENTES, PERSONAL y PERSONAL PMO. Crea lo que falta en los maestros y reutiliza lo que ya existe (identidad exacta; no se quitan tildes ni palabras para confirmar);
        lo ambiguo queda abajo como revisión y <strong>no se asigna por semejanza</strong>. Los datos nuevos nacen con vigencia inicial desconocida (por revisar): no acreditan toda la historia ni pisan una migración o
        pertenencia PMO conocida. No se crean cuentas de acceso. Repetir o reordenar el mismo libro no duplica nada ni sobrescribe cambios posteriores.
      </p>
      <p className="muted">
        <strong>Revertir no se ofrece:</strong> lo creado puede haberse editado, usado o desactivado después. Para deshacer algo, desactívelo en su maestro (Clientes, Grupos o Personal).
      </p>
      <dl className="kv">
        <dt>Contenido del libro</dt>
        <dd>{review.plan.groups} denominaciones BC · {review.plan.clients} organizaciones Zendesk · {review.plan.wrike} alias Wrike · {review.plan.pap} nombres PAP · {review.plan.persons} personas distintas · {review.plan.roles} roles PMO · {review.plan.excluded} filas de personal excluidas</dd>
        <dt>Revisiones</dt>
        <dd>{review.counts.pending} pendientes · {review.counts.decided} decididas · {review.counts.resolved} resueltas en el maestro · {review.counts.applied} aplicadas por confirmar</dd>
      </dl>

      {rel ? (
        rel.state === "UP_TO_DATE" ? (
          <p className="notice notice-ok" role="status">
            <strong>Relaciones al día.</strong> Los datos ya cargados (tickets, tiempos, Wrike, PAP y finanzas) se actualizan solos cuando cambian los maestros; no hace falta reprocesar cada carga.
          </p>
        ) : (
          <p className="notice notice-info" role="status">
            <strong>{rel.state === "FAILED" ? "La actualización de relaciones ha fallado." : "Actualizando relaciones…"}</strong>{" "}
            Los maestros de esta carga están guardados; el análisis de lo ya cargado se actualiza en segundo plano (estado y reintento en <Link href="/administracion/cargas">Cargas</Link>).
          </p>
        )
      ) : null}

      {report ? (
        <>
          <h3>Resultado de la aplicación</h3>
          <Table title="Creado" data={report.created} />
          <Table title="Reutilizado (ya existía)" data={report.reused} />
          <Table title="Conservado sin tocar (editado después, inactivo o ya informado)" data={report.preserved} />
          {report.notes.length > 0 ? (
            <details>
              <summary>Conflictos y datos conservados ({report.notes.length})</summary>
              <ul>{report.notes.slice(0, 200).map((n, i) => <li key={i}><code>{n.code}</code> — {n.message}</li>)}</ul>
            </details>
          ) : null}
        </>
      ) : null}

      <h3>Revisiones</h3>
      {!completed ? <p className="muted">Las decisiones se registran cuando la carga está completada; cargar lo válido no confirma las correspondencias pendientes.</p> : null}
      {review.items.length === 0 ? <p className="notice notice-ok" role="status">No hay revisiones: todo se resolvió de forma inequívoca.</p> : null}
      {groupsOfKinds.map((k) => {
        const list = by(k);
        if (list.length === 0) return null;
        return (
          <div key={k}>
            <h4>{REVIEW_LABEL[k]} ({list.filter((i) => i.state === "PENDING").length} pendientes de {list.length})</h4>
            <ul style={{ listStyle: "none", padding: 0 }}>{list.map((it) => <Item key={it.key} it={it} batchId={batch.id} completed={completed} />)}</ul>
          </div>
        );
      })}
      {info.length > 0 ? (
        <details>
          <summary>{REVIEW_LABEL.INFO} ({info.length})</summary>
          <ul style={{ listStyle: "none", padding: 0 }}>{info.map((it) => <Item key={it.key} it={it} batchId={batch.id} completed={completed} />)}</ul>
        </details>
      ) : null}
    </section>
  );
}
