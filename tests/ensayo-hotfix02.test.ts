import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { databaseNameOf } from "@/lib/env";
import { decideFinance } from "@/server/finance/review";
import { readRefreshStatus } from "@/server/relations/refresh";
import { confirmUpload } from "@/server/uploads/batches";
import { batch, drain, freshEnvironment, removeUploadDir, uploadText, useUploadDir } from "./cargas-helpers";
import { importFin } from "./finanzas-helpers";
import { importFile, importWrike, PAP } from "./csapp04-helpers";
import { papBuffer, papRow, wrikeCsv, wrikeRow } from "./generators/csapp04";
import { ticket, ticketsBuffer, timeRow, timesBuffer, excelSerial } from "./generators/zendesk";
import { importZd, TICKETS, TIEMPO } from "./zendesk-helpers";
import { seedPersonal } from "./hotfix02-helpers";

/**
 * ENSAYO MANUAL de HOTFIX-02 con el CLIENTES.xlsx REAL en una base aislada («maestro real + operativos SINTÉTICOS»). Se SALTA si no se indica el archivo:
 *
 *   CSAPP_ENSAYO_HF02_XLSX=/ruta/CLIENTES.xlsx TEST_DATABASE_URL=postgresql://…/cs_app_ensayo_hf02_test?schema=public npx vitest run tests/ensayo-hotfix02.test.ts
 *
 * Los hechos operativos son SINTÉTICOS y se fabrican en memoria con las claves fuente del archivo (nada operativo real). Los esperados salen de una lectura
 * INDEPENDIENTE del XML (scripts/ensayo/lectura-independiente-clientes.py), no de los resolvers. Las cifras del archivo se calculan, no se fijan en el código.
 * El informe nominativo (si lo hay) se escribe fuera del repositorio; en la salida solo hay conteos. El archivo no se copia al repositorio ni a fixtures.
 */
const FILE = process.env.CSAPP_ENSAYO_HF02_XLSX ?? "";
const enabled = FILE !== "" && existsSync(FILE);

type Row = Record<string, string | null> & { row: number };
const key = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
const SUPPORTS = new Set(["gold", "platinum", "silver on demand", "silver recurrente"]);

describe.skipIf(!enabled)("ensayo HOTFIX-02: maestro real + operativos sintéticos (base aislada)", () => {
  let dir: string;
  let admin: { id: string };
  beforeAll(async () => {
    expect(databaseNameOf(process.env.DATABASE_URL ?? "")).toMatch(/ensayo/); // nunca una base que no sea la del ensayo
    dir = useUploadDir();
    ({ admin } = await freshEnvironment());
  });
  afterAll(() => removeUploadDir(dir));

  it("atribuye todo lo operativo sintético por las rutas del libro real, sin reprocesar lote a lote, y repetir el libro no cambia nada", async () => {
    const bytes = readFileSync(FILE);
    const sha = createHash("sha256").update(bytes).digest("hex");
    const script = path.resolve("scripts/ensayo/lectura-independiente-clientes.py");
    const facts = JSON.parse(execFileSync("python3", ["-I", script, FILE], { maxBuffer: 64 * 1024 * 1024 }).toString()) as { sheets: number; rows: Row[] };
    const rows = facts.rows.filter((r) => r.C);
    expect(facts.sheets).toBe(1); // el libro actual solo trae CLIENTES

    // ---- Esperados INDEPENDIENTES (lectura directa del XML)
    const orgGroup = new Map<string, string | null>(); // ID Zendesk → clave del Grupo (F)
    const variants = new Map<string, Set<string>>();
    for (const r of rows) {
      orgGroup.set(r.C as string, r.F ? key(r.F) : null);
      const v = variants.get(r.C as string) ?? new Set<string>();
      v.add(`${key(r.D ?? "")}|${r.F ? key(r.F) : ""}`);
      variants.set(r.C as string, v);
    }
    // Un ID con nombres o Grupos distintos entre filas es un conflicto concreto: no se crea el Cliente y sus tickets quedan sin asignar (esperado: sin Grupo).
    const conflictIds = new Set([...variants].filter(([, v]) => v.size > 1).map(([id]) => id));
    for (const id of conflictIds) orgGroup.set(id, null);
    const wrikeGroups = new Map<string, { raw: string; groups: Set<string> }>();
    for (const r of rows) if (r.A) {
      const k = key(r.A);
      const e = wrikeGroups.get(k) ?? { raw: r.A, groups: new Set<string>() };
      if (r.B) e.groups.add(key(r.B));
      wrikeGroups.set(k, e);
    }
    const papGroups = new Map<string, { raw: string; groups: Set<string>; orgs: Set<string> }>();
    for (const r of rows) if (r.I) {
      const k = key(r.I);
      const e = papGroups.get(k) ?? { raw: r.I, groups: new Set<string>(), orgs: new Set<string>() };
      if (r.J) e.groups.add(key(r.J));
      e.orgs.add(r.C as string);
      papGroups.set(k, e);
    }
    const bcGroups = new Map<string, string>();
    for (const r of rows) for (const g of [r.B, r.F, r.J]) if (g) bcGroups.set(key(g), g);
    const orgIds = [...orgGroup.keys()];
    const okIds = orgIds.filter((id) => !conflictIds.has(id));
    const externalOrgs = okIds.filter((id) => orgGroup.get(id) !== null);

    // ---- Operativos SINTÉTICOS con esas claves
    await seedPersonal();
    const d = (iso: string) => ({ date: excelSerial(iso) });
    const tid = (i: number) => String(9_100_000 + i);
    const tickets = orgIds.map((id, i) => ticket({ ticket_id: tid(i), organization_id: id, creada: d("2024-03-05") }));
    await importZd(admin.id, TICKETS, await ticketsBuffer(tickets));
    await importZd(admin.id, TIEMPO, await timesBuffer(orgIds.map((_, i) => timeRow({ ticket_id: tid(i), logged_hours: 1, logged_minutes: 0, date: d("2024-06-10") }))));
    const ticketOfOrg = new Map(orgIds.map((id, i) => [id, tid(i)]));
    const wr: ReturnType<typeof wrikeRow>[] = [];
    const wrExpect = new Map<string, string | null | "CONFLICT">(); // tarea → clave de Grupo esperado
    for (const [k, e] of wrikeGroups) {
      wr.push(wrikeRow({ usuario: "pmo.uno", proyecto: e.raw, tarea: `solo:${k}`, fecha: "03/02/2025", horas: "1" }));
      wrExpect.set(`solo:${k}`, e.groups.size === 1 ? [...e.groups][0] : null);
      if (e.groups.size > 1) {
        const cand = rows.find((r) => r.A && key(r.A) === k && r.F && e.groups.has(key(r.F)) && !conflictIds.has(r.C as string)) as Row; // organización de uno de los candidatos
        wr.push(wrikeRow({ usuario: "pmo.uno", proyecto: e.raw, tarea: `ok:${k}`, ticket: ticketOfOrg.get(cand.C as string), fecha: "04/02/2025", horas: "1" }));
        wrExpect.set(`ok:${k}`, key(cand.F as string));
        const other = rows.find((r) => r.F && !e.groups.has(key(r.F)) && !conflictIds.has(r.C as string)) as Row; // organización de un Grupo que NO es candidato
        wr.push(wrikeRow({ usuario: "pmo.uno", proyecto: e.raw, tarea: `no:${k}`, ticket: ticketOfOrg.get(other.C as string), fecha: "05/02/2025", horas: "1" }));
        wrExpect.set(`no:${k}`, "CONFLICT");
      }
    }
    await importWrike(admin.id, wrikeCsv(wr));
    const pp: ReturnType<typeof papRow>[] = [];
    const papExpect = new Map<string, string | null>();
    let n = 0;
    for (const [k, e] of papGroups) {
      n++;
      pp.push(papRow({ Title: `ID ${700000 + n}: solo`, Proyecto: e.raw }));
      papExpect.set(String(700000 + n), e.groups.size === 1 ? [...e.groups][0] : null);
      if (e.groups.size > 1) {
        const cand = rows.find((r) => r.I && key(r.I) === k && r.F && e.groups.has(key(r.F)) && !conflictIds.has(r.C as string)) as Row | undefined;
        if (!cand) continue; // todos sus candidatos son organizaciones en conflicto: no hay evidencia de ticket que fabricar
        n++;
        pp.push(papRow({ Title: `ID ${700000 + n}: con ticket`, Proyecto: e.raw, "Tickets asociados": ticketOfOrg.get(cand.C as string) as string }));
        papExpect.set(String(700000 + n), key(cand.F as string));
      }
    }
    await importFile(admin.id, PAP, await papBuffer(pp));
    const finRows = [...bcGroups.values()].map((g) => ({ grupo: g, vta: 100 }));
    await importFin(admin.id, "SOPORTE", 2025, finRows, {
      total: { vta: 100 * finRows.length }, unassigned: true,
      decide: async (id) => { await decideFinance(admin.id, id, { kind: "ACCEPT_UNASSIGNED" }); },
    });
    const zdBefore = Number((await prisma.$queryRaw<{ s: string }[]>`SELECT COALESCE(sum(minutes),0)::text AS s FROM "ZdTimeEntry"`)[0].s);
    const wrBefore = Number((await prisma.$queryRaw<{ s: string }[]>`SELECT COALESCE(sum(minutes),0)::text AS s FROM "WrikeTimeEntry"`)[0].s);
    const unassignedBefore = Number((await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "ZdTimeEntry" WHERE "drvGroupId" IS NOT NULL`)[0].n);

    // ---- El libro real (una hoja) y la actualización automática
    const { id } = await uploadText(admin.id, bytes, { profileId: "precarga-maestros", name: "CLIENTES.xlsx" });
    await drain();
    const prepared = await batch(id);
    expect(prepared.status, prepared.statusDetail ?? "").toBe("READY");
    expect(prepared.rowsError).toBe(0); // un ID contradictorio ya no convierte sus filas en error
    expect(prepared.rowsReceived).toBe(rows.length); // las filas útiles que cuenta la lectura independiente
    await confirmUpload(admin.id, id);
    await drain();
    expect((await batch(id)).status).toBe("COMPLETED");
    await drain();
    const status = await readRefreshStatus();
    expect(status.state).toBe("UP_TO_DATE");

    // ---- Comprobaciones contra lo esperado independiente (conteos de discrepancias; nombres solo en el informe privado)
    const names: string[] = [];
    const zd = await prisma.$queryRaw<{ ticket: string; org: string | null; grp: string | null; minutes: string }[]>`
      SELECT e."ticketId" AS ticket, e."drvOrganizationId" AS org, lower(g.name) AS grp, e.minutes::text AS minutes FROM "ZdTimeEntry" e LEFT JOIN "ClientGroup" g ON g.id = e."drvGroupId"`;
    let zdWrong = 0;
    for (const r of zd) {
      const exp = orgGroup.get(r.org as string) ?? null;
      if ((r.grp === null ? null : key(r.grp)) !== exp) { zdWrong++; names.push(`ZD ${r.ticket}`); }
    }
    expect(zdWrong).toBe(0);
    expect(zd.filter((r) => r.grp !== null)).toHaveLength(externalOrgs.length);

    const wk = await prisma.$queryRaw<{ task: string; grp: string | null; conflict: boolean }[]>`
      SELECT e."taskName" AS task, lower(g.name) AS grp, e."drvConflict" AS conflict FROM "WrikeTimeEntry" e LEFT JOIN "ClientGroup" g ON g.id = e."drvGroupId"`;
    let wkWrong = 0;
    for (const r of wk) {
      const exp = wrExpect.get(r.task);
      const ok = exp === "CONFLICT" ? r.conflict && r.grp === null : !r.conflict && (r.grp === null ? null : key(r.grp)) === exp;
      if (!ok) { wkWrong++; names.push(`WK ${r.task}`); }
    }
    expect(wkWrong).toBe(0);
    expect(wk).toHaveLength(wrExpect.size);

    const pa = await prisma.$queryRaw<{ pap: string; grp: string | null }[]>`
      SELECT t."papId" AS pap, lower(g.name) AS grp FROM "PapItem" t LEFT JOIN "ClientGroup" g ON g.id = t."drvGroupId"`;
    let paWrong = 0;
    for (const r of pa) if ((r.grp === null ? null : key(r.grp)) !== (papExpect.get(r.pap) ?? null)) { paWrong++; names.push(`PAP ${r.pap}`); }
    expect(paWrong).toBe(0);
    expect(pa).toHaveLength(papExpect.size);

    const fin = await prisma.$queryRaw<{ n: bigint; s: string }[]>`
      SELECT count(*) FILTER (WHERE r."groupId" IS NOT NULL) AS n, COALESCE(sum(r.income),0)::text AS s FROM "FinanceScope" sc JOIN "FinanceRow" r ON r."batchId" = sc."activeBatchId" WHERE sc.year = 2025 AND sc.category = 'SOPORTE'`;
    expect(Number(fin[0].n)).toBe(bcGroups.size);
    expect(Number(fin[0].s)).toBe(100 * bcGroups.size);

    // Cantidades fuente intactas; nada atribuido antes del libro.
    expect(unassignedBefore).toBe(0);
    expect(Number((await prisma.$queryRaw<{ s: string }[]>`SELECT COALESCE(sum(minutes),0)::text AS s FROM "ZdTimeEntry"`)[0].s)).toBe(zdBefore);
    expect(Number((await prisma.$queryRaw<{ s: string }[]>`SELECT COALESCE(sum(minutes),0)::text AS s FROM "WrikeTimeEntry"`)[0].s)).toBe(wrBefore);

    // Maestros: conteos independientes.
    const supportPending = okIds.filter((id) => {
      const vals = new Set(rows.filter((r) => r.C === id).flatMap((r) => [r.E, r.H]).filter((v): v is string => !!v).map(key));
      return !(vals.size === 1 && SUPPORTS.has([...vals][0]));
    }).length;
    const internal = okIds.filter((id) => orgGroup.get(id) === null).length;
    const counts = {
      gruposBc: await prisma.externalIdentity.count({ where: { system: "BC", kind: "GROUP_KEY" } }),
      clientes: await prisma.client.count(), internos: await prisma.client.count({ where: { isInternal: true } }),
      aliasWrike: await prisma.externalIdentity.count({ where: { system: "WRIKE", kind: "PROJECT_NAME" } }),
      candidatosWrike: await prisma.aliasCandidate.count({ where: { system: "WRIKE" } }),
      aliasPap: await prisma.externalIdentity.count({ where: { system: "PAP", kind: "PROJECT_NAME" } }),
      candidatosPap: await prisma.aliasCandidate.count({ where: { system: "PAP" } }),
      soportePendiente: okIds.length - (await prisma.serviceTerm.count({ where: { attribute: "SUPPORT" } })),
    };
    expect(counts.gruposBc).toBe(bcGroups.size);
    expect(counts.clientes).toBe(okIds.length);
    expect(counts.internos).toBe(internal);
    expect(counts.aliasWrike).toBe([...wrikeGroups.values()].filter((e) => e.groups.size === 1).length);
    expect(counts.aliasPap).toBe([...papGroups.values()].filter((e) => e.groups.size === 1).length); // implantación (1 Cliente) o Grupo (varios Clientes del mismo Grupo)
    expect(counts.soportePendiente).toBe(supportPending);

    // Repetir el libro: ni una entidad nueva ni un derivado distinto.
    const snap = async () => ({
      counts: await Promise.all(["ClientGroup", "Client", "Implementation", "ExternalIdentity", "ServiceTerm", "AliasCandidate"].map(async (t) => Number((await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${t}"`))[0].n))),
      v: Number((await prisma.zdTimeEntry.aggregate({ _sum: { drvVersion: true } }))._sum.drvVersion) + Number((await prisma.wrikeTimeEntry.aggregate({ _sum: { drvVersion: true } }))._sum.drvVersion),
    });
    const a = await snap();
    const again = await uploadText(admin.id, bytes, { profileId: "precarga-maestros", name: "CLIENTES (repetido).xlsx" });
    await drain();
    await confirmUpload(admin.id, again.id);
    await drain();
    await drain();
    expect(await snap()).toEqual(a);

    // Informe privado (conteos; los nombres solo fuera del repositorio y solo si algo no coincidió).
    const report = {
      archivo: { sha256: sha, bytes: bytes.length, hojas: facts.sheets, filasUtiles: rows.length },
      lecturaIndependiente: { gruposBc: bcGroups.size, organizacionesZendesk: orgIds.length, internas: internal, wrike: wrikeGroups.size, wrikeVariosGrupos: [...wrikeGroups.values()].filter((e) => e.groups.size > 1).length, pap: papGroups.size, papVariosGrupos: [...papGroups.values()].filter((e) => e.groups.size > 1).length, soportePendiente: supportPending },
      maestros: counts,
      operativosSinteticos: { tickets: tickets.length, tiemposZendesk: orgIds.length, filasWrike: wr.length, filasPap: pp.length, filasFinanzas: finRows.length },
      idsZendeskConflicto: conflictIds.size,
      resultado: { zendeskAtribuidos: zd.filter((r) => r.grp !== null).length, wrikeFilas: wk.length, papItems: pa.length, discrepancias: { zd: zdWrong, wrike: wkWrong, pap: paWrong } },
      actualizacion: { generacion: status.completedGeneration, actualizadas: status.lastReport?.updated, clasificacion: status.lastReport?.classification },
    };
    const out = process.env.CSAPP_ENSAYO_INFORME ?? path.join(mkdtempSync(path.join(tmpdir(), "informe-hf02-")), "informe.json");
    writeFileSync(out, JSON.stringify({ ...report, discrepanciasNominativas: names }, null, 1));
    console.log(`Informe privado (maestro real + operativos sintéticos): ${out}\n${JSON.stringify(report)}`);
  }, 600000);
});
