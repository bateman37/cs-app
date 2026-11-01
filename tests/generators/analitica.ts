import { prisma } from "../../src/lib/db";
import { addClient, addGroup, addTicket, addWrike, addZd, fakeBatch, seedFinance, serviceAssignment, setUsers } from "../economia-helpers";

/**
 * Datos SINTÉTICOS para el recorrido de navegador y la revisión visual de Comparativa y Análisis Cliente (CSAPP-06). Solo se usan en bases
 * `_test` aisladas; nunca se cargan en la base de desarrollo. Las fechas son relativas a «hoy» para no depender de años fijos.
 */
const d = (v: string) => new Date(`${v}T00:00:00Z`);
const pad = (n: number) => String(n).padStart(2, "0");

export async function seedAnalitica(adminId: string, today: string, extraGroups = 30) {
  const Y = Number(today.slice(0, 4));
  const M = Number(today.slice(5, 7));
  const day = (y: number, m: number, dd: number) => `${y}-${pad(m)}-${pad(Math.min(dd, 28))}`;
  const b = await fakeBatch(adminId);
  const tb = await fakeBatch(adminId);

  const atlas = await addGroup("Grupo Atlas");
  const boreal = await addGroup("Grupo Boreal");
  const cenit = await addGroup("Grupo Cénit");
  const delta = await addGroup("Grupo Delta");
  const eco = await addGroup("Grupo Eco");
  const fenix = await addGroup("Grupo Fénix");
  await prisma.clientGroup.update({ where: { id: fenix.id }, data: { isActive: false } });
  await prisma.clientGroup.update({ where: { id: atlas.id }, data: { bcDenomination: "ATLAS SERVICIOS, S.A." } });
  const a1 = await addClient("Atlas Norte", atlas.id);
  const a2 = await addClient("Atlas Sur", atlas.id);
  const b1 = await addClient("Boreal Central", boreal.id);
  const c1 = await addClient("Cénit Uno", cenit.id);
  const c2 = await addClient("Cénit Dos", cenit.id);
  await addClient("Sin grupo SL", null);
  const ident = (org: string, clientId: string) => prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: org, searchValue: org, clientId } });
  await ident("7001", a1.id); await ident("7002", a2.id); await ident("7003", b1.id); await ident("7004", c1.id); await ident("7005", c2.id);
  await prisma.implementation.create({ data: { clientId: a1.id, name: "Atlas Norte producción" } });
  await prisma.product.create({ data: { name: "VFS" } });
  await prisma.product.create({ data: { name: "VSW" } });

  const term = (attribute: "SUPPORT" | "HOSTING" | "COMPLEXITY" | "PRODUCT", value: string, o: { groupId?: string; clientId?: string; validFrom?: string; validTo?: string }) =>
    prisma.serviceTerm.create({ data: { attribute, value, groupId: o.groupId, clientId: o.clientId, validFrom: o.validFrom ? d(o.validFrom) : null, validTo: o.validTo ? d(o.validTo) : null } });
  await term("SUPPORT", "GOLD", { groupId: atlas.id }); await term("HOSTING", "CLOUD", { groupId: atlas.id }); await term("PRODUCT", "VFS", { groupId: atlas.id }); await term("COMPLEXITY", "ENTERPRISE", { groupId: atlas.id });
  await term("SUPPORT", "SILVER_ON_DEMAND", { groupId: boreal.id }); await term("HOSTING", "OP", { groupId: boreal.id });
  await term("SUPPORT", "GOLD", { clientId: c1.id }); await term("SUPPORT", "SILVER_RECURRENTE", { clientId: c2.id }); await term("HOSTING", "CLOUD", { clientId: c1.id });
  await term("SUPPORT", "PLATINUM", { groupId: delta.id }); await term("HOSTING", "CLOUD", { groupId: delta.id });
  await prisma.milestone.create({ data: { type: "START", date: d(day(Y, 1, 10)), groupId: atlas.id, note: "Arranque sintético" } });
  await prisma.milestone.create({ data: { type: "CLOUD_MIGRATION", date: d(day(Y, Math.max(2, M - 2), 5)), clientId: a1.id } });

  const rows = (y: number) => [
    { groupId: atlas.id, income: "96000" }, { groupId: boreal.id, income: "30000" }, { groupId: cenit.id, income: "48000" }, { groupId: delta.id, income: "18000" }, { groupId: fenix.id, income: "6000" },
    ...Array.from({ length: extraGroups }, (_, i) => ({ groupId: null as string | null, income: String(1200 * (i + 1) * (y === Y ? 1 : 0.9)), label: `Extra ${i}` })),
  ];
  const extra = await Promise.all(Array.from({ length: extraGroups }, (_, i) => addGroup(`Grupo Z${pad(i + 1)}`)));
  const finRows = (y: number) => rows(y).map((r, i) => (i >= 5 ? { ...r, groupId: extra[i - 5].id } : r));
  await seedFinance(adminId, "SOPORTE", Y, finRows(Y).filter((r) => r.groupId !== eco.id));
  await seedFinance(adminId, "SOPORTE", Y - 1, finRows(Y - 1));
  await serviceAssignment({ matchKind: "ENTORNO", matchValue: "soporte", service: "SOPORTE" });

  const team = await prisma.staffCatalogItem.create({ data: { kind: "TEAM", name: "CS" } });
  const it = await prisma.staffCatalogItem.create({ data: { kind: "TEAM", name: "IT" } });
  const n1 = await prisma.staffCatalogItem.create({ data: { kind: "LEVEL", name: "N1" } });
  const n2 = await prisma.staffCatalogItem.create({ data: { kind: "LEVEL", name: "N2" } });
  const n3 = await prisma.staffCatalogItem.create({ data: { kind: "LEVEL", name: "N3" } });
  const ana = await prisma.staffCatalogItem.create({ data: { kind: "PMO_ROLE", name: "ANA" } });

  const causes = ["incidente_estándar_plataforma", "Sistemas del Cliente", "Uso Indebido", "incidente_infraestructura", null];
  let t = 0;
  const mkTicket = async (org: string, created: string, type: string, dest: string[] = []) => {
    t++;
    await addTicket(tb.id, { ticketId: `S${t}`, entorno: "Soporte", org, cause: causes[t % causes.length], created, type, status: t % 3 === 0 ? "solved" : "open", destinations: dest });
    return `S${t}`;
  };
  const hoursFor = async (g: { id: string }, c: { id: string } | null, org: string, y: number, m: number, h: number, lvl: string, tm: string) => {
    const tk = await mkTicket(org, day(y, m, 5), t % 4 === 0 ? "problem" : "incident", t % 5 === 0 ? ["PMO_N3", "IT_N3"] : []);
    await addZd({ batchId: b.id, date: day(y, m, 8), minutes: h * 60, groupId: g.id, clientId: c?.id ?? null, ticketId: tk, teamId: tm, levelId: lvl });
  };
  for (const y of [Y - 1, Y]) {
    for (let m = 1; m <= (y === Y ? M : 12); m++) {
      await hoursFor(atlas, a1, "7001", y, m, 60 + m * 3, n1.id, team.id);
      await hoursFor(atlas, a2, "7002", y, m, 25 + (y === Y ? 10 : 0), n2.id, team.id);
      await hoursFor(boreal, b1, "7003", y, m, 40, n1.id, team.id);
      await hoursFor(cenit, c1, "7004", y, m, 30 + m, n3.id, it.id);
      if (m % 2 === 0) await hoursFor(cenit, c2, "7005", y, m, 8, n2.id, team.id);
      await addWrike({ batchId: b.id, date: day(y, m, 12), minutes: 180, groupId: atlas.id, clientId: a1.id, project: "Atlas PMO", pmo: true, roleId: ana.id });
    }
  }
  await serviceAssignment({ matchKind: "WRIKE_PROJECT", matchValue: "atlas pmo", service: "SOPORTE" });
  for (const g of extra.slice(0, 8)) await addZd({ batchId: b.id, date: day(Y, Math.max(1, M - 1), 10), minutes: 600, groupId: g.id, ticketId: await mkTicket("7003", day(Y, Math.max(1, M - 1), 3), "incident") });
  await addZd({ batchId: b.id, date: day(Y, M, 1), minutes: 120, groupId: eco.id, ticketId: await mkTicket("7003", day(Y, M, 1), "incident") });

  for (const [g, base] of [[atlas, 120], [boreal, 45], [cenit, 60], [delta, 12]] as const) await setUsers(adminId, { groupId: g.id }, Y, Array.from({ length: 12 }, (_, i) => base + (i >= 5 ? 3 : 0)));
  await setUsers(adminId, { groupId: atlas.id }, Y - 1, Array(12).fill(110));

  // PAP, bugs y vínculos mínimos para que las pestañas tengan hechos reales de muestra.
  const pb = await fakeBatch(adminId, "pap");
  for (let i = 1; i <= 6; i++) {
    const it2 = await prisma.papItem.create({ data: { listKey: "L1", papId: String(i), firstBatchId: pb.id, drvScope: "CLIENT", drvGroupId: atlas.id, drvClientId: a1.id } });
    const rev = await prisma.papRevision.create({ data: { itemId: it2.id, fingerprint: `p${i}`, revisionNo: 1, title: `PAP sintético ${i}`, result: i === 4 ? "Revertido" : "OK", productionDate: i === 6 ? null : d(day(Y, Math.max(1, M - (i % 3)), 10)), correctiveState: i % 2 ? "CORRECTIVE" : "NON_CORRECTIVE", data: {}, batchId: pb.id } });
    await prisma.papCause.create({ data: { revisionId: rev.id, rawToken: i % 2 ? "Correctivo estándar" : "Evolutivo", normalized: i % 2 ? "correctivo estándar" : "evolutivo", category: i % 2 ? "CORRECTIVE" : "EVOLUTIVE", origin: i % 2 ? "STANDARD" : null } });
    await prisma.papItem.update({ where: { id: it2.id }, data: { currentRevisionId: rev.id } });
  }
  return { atlas, boreal, cenit, delta, eco, fenix, a1, a2, b1, c1, c2, extra };
}
