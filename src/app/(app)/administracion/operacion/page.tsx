import type { Metadata } from "next";
import { requirePageAdmin } from "@/lib/session";
import { collectHealth, type WorkerVerdict } from "@/server/ops/health";

export const metadata: Metadata = { title: "Operación" };
export const dynamic = "force-dynamic";

const VERDICT: Record<WorkerVerdict, string> = {
  ausente: "Trabajador ausente: ningún trabajador ha dado señales recientes.",
  presente_en_reposo: "Trabajador presente, en reposo (sin trabajos).",
  presente_procesando: "Trabajador presente, procesando.",
  presente_sin_avance: "Trabajador presente, pero su trabajo no avanza.",
  detenido: "Trabajador detenido de forma ordenada.",
};
const OVERALL = { ok: "Todo correcto", degradado: "Degradado: hay problemas que requieren atención", caido: "Base de datos no disponible" } as const;
const SCHEMA = { ok: "Esquema compatible con el código", pendiente: "Faltan migraciones por aplicar", adelantado: "Esquema más nuevo que el código", desconocido: "No comparable (sin build-info.json)", fallida: "Hay migraciones fallidas", sin_base: "Sin acceso a la base" } as const;
const when = (iso: string) => new Date(iso).toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
const mb = (n: number | null) => (n === null ? "—" : `${(n / 1048576).toLocaleString("es-ES", { maximumFractionDigits: 0 })} MB`);

/** Comprobación técnica mínima (CSAPP-10 §4). Solo Administrador. El texto no depende del color: cada estado se enuncia. */
export default async function OperacionPage() {
  await requirePageAdmin();
  const h = await collectHealth();
  return (
    <>
      <h1>Operación</h1>
      <p className="muted">Estado técnico de la instalación: versión, esquema, base, trabajador, colas y almacenes privados. No muestra secretos ni datos de clientes.</p>
      <p role="status" className={h.overall === "ok" ? "notice notice-info" : "notice notice-warn"}><strong>{OVERALL[h.overall]}.</strong> Versión {h.version.version} · SHA {h.version.sha.slice(0, 12)}{h.version.dirty ? " (con cambios sin confirmar)" : ""} · comprobado {when(h.generatedAt)}. <a href="/api/administracion/salud?descargar=1">Descargar diagnóstico redactado</a></p>
      {h.problems.length > 0 ? (
        <section aria-labelledby="problemas"><h2 id="problemas">Problemas detectados</h2>
          <ul>{h.problems.map((p) => <li key={p.code}><strong>{p.level === "error" ? "Error" : "Aviso"}</strong> ({p.code}): {p.message}</li>)}</ul>
        </section>
      ) : <p>Sin problemas detectados.</p>}
      <section aria-labelledby="componentes"><h2 id="componentes">Componentes</h2>
        <ul>
          <li>Web: responde (esta página).</li>
          <li>Base de datos: {h.database.ok ? `disponible (${h.database.latencyMs} ms)` : "no disponible"}.</li>
          <li>Esquema: {SCHEMA[h.schema.state]} ({h.schema.applied} aplicadas de {h.schema.expected} esperadas).</li>
          <li>Trabajador: {VERDICT[h.workers.verdict]}</li>
          <li>Cargas: {h.queues.uploads.pending} en cola, {h.queues.uploads.running} en curso{h.queues.uploads.expiredLeases ? `, ${h.queues.uploads.expiredLeases} con lease vencido` : ""}.</li>
          <li>Exportaciones: {h.queues.exports.pending} en cola, {h.queues.exports.running} en curso{h.queues.exports.expiredLeases ? `, ${h.queues.exports.expiredLeases} con lease vencido` : ""}.</li>
        </ul>
      </section>
      <section aria-labelledby="trabajadores"><h2 id="trabajadores">Trabajadores</h2>
        <p className="hint">Vivo = latido de menos de {Math.round(h.workers.thresholds.aliveMs / 1000)} s. «Sin avance» = trabajo en curso sin confirmar bloques desde hace más de {Math.round(h.workers.thresholds.stallMs / 60000)} min.</p>
        {h.workers.instances.length === 0 ? <p>Ninguna instancia registrada en las últimas 24 h.</p> : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Trabajadores (desplazable)">
            <table><caption className="visually-hidden">Instancias de trabajador</caption>
              <thead><tr><th scope="col">Instancia</th><th scope="col">Estado</th><th scope="col">Versión</th><th scope="col">Último latido</th><th scope="col">Trabajo</th><th scope="col">Avance</th></tr></thead>
              <tbody>{h.workers.instances.map((w) => (
                <tr key={w.id}><td>{w.id}</td><td>{w.alive ? "Vivo" : "Sin latido"} · {w.state}{w.stopRequested ? " · cierre solicitado" : ""}{w.stalled ? " · SIN AVANCE" : ""}</td><td>{w.sha.slice(0, 8)}{w.versionMatches ? "" : " (distinta de la web)"}</td><td>hace {w.ageSec} s</td><td>{w.currentKind ?? "—"}</td><td>{w.progressAgeSec === null ? "—" : `hace ${w.progressAgeSec} s`}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      <section aria-labelledby="almacenes"><h2 id="almacenes">Almacenes privados</h2>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Almacenes (desplazable)">
          <table><caption className="visually-hidden">Almacenes privados</caption>
            <thead><tr><th scope="col">Almacén</th><th scope="col">Acceso</th><th scope="col">Libre</th><th scope="col">Enlace a la instalación</th></tr></thead>
            <tbody>{h.stores.map((s) => (
              <tr key={s.kind}><td>{s.kind === "uploads" ? "Originales" : "Exportaciones"}</td><td>{!s.exists ? "No existe" : s.writable ? "Lectura y escritura" : "Sin escritura"}</td><td>{mb(s.freeBytes)}</td><td>{{ ok: "Correcto", ajena: "De otra instalación", sin_marca: "Sin marca", ausente: "—" }[s.marker]}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}
