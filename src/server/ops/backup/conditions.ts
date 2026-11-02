import type { Client } from "pg";
import { healthThresholds } from "../health";
import { readRunFile, runFileLive, stateDir } from "../runfile";
import { uploadConfig } from "@/server/uploads/config";

/**
 * Condiciones de parada controlada (CSAPP-10 §7). La vía inicial es una copia CON PARADA: sin copia en caliente. La herramienta no anuncia una copia
 * coherente si no acredita TODAS estas condiciones, y no fuerza nunca un estado (no detiene ni reclama nada):
 *  - ningún supervisor vigente (archivo de ejecución con PID vivo y latido reciente);
 *  - ningún trabajador vivo (WorkerInstance ≠ STOPPED con latido reciente según `workerAliveMs`);
 *  - ningún trabajo de carga RUNNING ni de exportación PREPARING/GENERATING con lease vigente;
 *  - ningún lote RECEIVING reciente (subida en curso);
 *  - la web no responde (o la persona lo declara con `--web-parada`, con aviso).
 * Las colas pendientes (QUEUED/PENDING) NO bloquean: se conservan en la copia y se retoman al restaurar.
 */
export type Condition = { code: string; ok: boolean; message: string; warning?: boolean };
export type ConditionDeps = { stateDir?: string; now?: number; fetchImpl?: typeof fetch; env?: Record<string, string | undefined> };

export async function checkStopConditions(c: Client, opts: { webStopped: boolean } & ConditionDeps): Promise<Condition[]> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now();
  const out: Condition[] = [];

  const run = await readRunFile(opts.stateDir ?? stateDir(env));
  const live = runFileLive(run, now);
  out.push(live
    ? { code: "SUPERVISOR", ok: false, message: `Hay un supervisor vigente (PID ${run!.supervisorPid}, latido ${run!.heartbeatAt}). Deténgalo con «npm run stop:todo».` }
    : { code: "SUPERVISOR", ok: true, message: run ? "El archivo de ejecución existe pero su supervisor no está vigente." : "Sin supervisor registrado." });

  const aliveMs = healthThresholds(env).workerAliveMs;
  const workers = await c.query<{ id: string; state: string; age: string }>(
    `SELECT id, state::text AS state, extract(epoch FROM (now() - "lastSeenAt"))::text AS age FROM "WorkerInstance" WHERE state <> 'STOPPED' AND "lastSeenAt" > now() - ($1 * interval '1 millisecond') ORDER BY id`,
    [aliveMs],
  );
  out.push(workers.rows.length
    ? { code: "TRABAJADOR", ok: false, message: `${workers.rows.length} trabajador(es) vivo(s): ${workers.rows.map((w) => `${w.id} (${w.state}, latido hace ${Math.round(Number(w.age))} s)`).join(", ")}. Espere a que terminen o deténgalos (npm run stop:todo).` }
    : { code: "TRABAJADOR", ok: true, message: "Ningún trabajador vivo." });

  const uj = await c.query<{ id: string }>(`SELECT id FROM "UploadJob" WHERE status = 'RUNNING' AND "leaseExpiresAt" > now() ORDER BY id LIMIT 10`);
  out.push(uj.rows.length ? { code: "TRABAJO_CARGA", ok: false, message: `Trabajo(s) de carga en curso con lease vigente: ${uj.rows.map((j) => j.id).join(", ")}.` } : { code: "TRABAJO_CARGA", ok: true, message: "Ningún trabajo de carga en curso con lease vigente." });
  const ej = await c.query<{ id: string }>(`SELECT id FROM "ExportJob" WHERE status IN ('PREPARING', 'GENERATING') AND "leaseExpiresAt" > now() ORDER BY id LIMIT 10`);
  out.push(ej.rows.length ? { code: "TRABAJO_EXPORTACION", ok: false, message: `Exportación(es) en curso con lease vigente: ${ej.rows.map((j) => j.id).join(", ")}.` } : { code: "TRABAJO_EXPORTACION", ok: true, message: "Ninguna exportación en curso con lease vigente." });

  const recvMin = uploadConfig().incompleteMinutes;
  const rb = await c.query<{ id: string }>(`SELECT id FROM "UploadBatch" WHERE status = 'RECEIVING' AND "createdAt" > now() - ($1 * interval '1 minute') ORDER BY id LIMIT 10`, [recvMin]);
  out.push(rb.rows.length ? { code: "SUBIDA_EN_CURSO", ok: false, message: `Subida(s) recibiéndose (hace menos de ${recvMin} min): ${rb.rows.map((b) => b.id).join(", ")}.` } : { code: "SUBIDA_EN_CURSO", ok: true, message: "Ninguna subida recibiéndose." });

  out.push(await webCondition(opts.webStopped, opts.fetchImpl ?? fetch, env));
  return out;
}

async function webCondition(webStopped: boolean, fetchImpl: typeof fetch, env: Record<string, string | undefined>): Promise<Condition> {
  const base = env.BETTER_AUTH_URL;
  let responding: "si" | "no" | "desconocido" = "desconocido";
  if (base) {
    try {
      await fetchImpl(new URL("/api/salud", base), { signal: AbortSignal.timeout(3000), redirect: "manual" });
      responding = "si"; // cualquier respuesta HTTP (incluso 503) significa que hay una web escuchando
    } catch {
      responding = "no";
    }
  }
  if (webStopped) {
    return { code: "WEB", ok: true, warning: true, message: `AVISO: la web se da por PARADA porque la persona operadora lo declaró (--web-parada); la herramienta no lo ha comprobado${responding === "si" ? " Y la web SÍ responde ahora en BETTER_AUTH_URL: detenga la web o quite la declaración" : ""}.` };
  }
  if (responding === "no") return { code: "WEB", ok: true, message: "La web no responde en BETTER_AUTH_URL/api/salud." };
  if (responding === "si") return { code: "WEB", ok: false, message: "La web responde en BETTER_AUTH_URL/api/salud: debe estar parada para una copia coherente (npm run stop:todo)." };
  return { code: "WEB", ok: false, message: "BETTER_AUTH_URL no está definida: no se puede comprobar que la web esté parada. Defínala o declare la parada con --web-parada." };
}

export const allOk = (cs: readonly Condition[]) => cs.every((c) => c.ok);
