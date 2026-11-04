import { prisma } from "../../src/lib/db";
import { addClient, addGroup, addTicket, addWrike, addZd, fakeBatch, seedFinance, serviceAssignment, setUsers } from "../economia-helpers";

/**
 * Datos SINTÉTICOS para la revisión visual de la ficha de Análisis Cliente (HOTFIX-02 §12). Solo bases `_test` aisladas. Mezcla deliberada:
 * Grupo con nombre muy largo y varios Clientes e implantaciones, cinco años de historia, mes en curso parcial, febrero, valores grandes,
 * un Grupo sin ingreso 2026 (ausente), un Grupo cuyo año anterior no tiene horas (base cero), un Grupo heterogéneo y PAP solo de Grupo.
 * Ningún nombre ni cifra procede de datos reales.
 */
const d = (v: string) => new Date(`${v}T00:00:00Z`);
const pad = (n: number) => String(n).padStart(2, "0");
/** Generador pseudoaleatorio determinista (mulberry32) para que las capturas sean reproducibles. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const LONG_NAME = "Cooperativa Agroalimentaria de Productores del Valle del Guadalquivir y Extremadura S. Coop. Ltda.";
export const LONG_CLIENT = "Extremadura Logística y Transporte Internacional de Mercancías Perecederas SL";

export async function seedFicha(adminId: string, today: string) {
  const Y = Number(today.slice(0, 4));
  const M = Number(today.slice(5, 7));
  const D0 = Number(today.slice(8, 10));
  const r = rng(20260101);
  const b = await fakeBatch(adminId);
  const tb = await fakeBatch(adminId);

  const big = await addGroup(LONG_NAME);
  const vn = await addClient("Valle Norte", big.id);
  const vs = await addClient("Valle Sur", big.id);
  const ex = await addClient(LONG_CLIENT, big.id);
  const ident = (org: string, clientId: string) => prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: org, searchValue: org, clientId } });
  await ident("8001", vn.id); await ident("8002", vs.id); await ident("8003", ex.id);
  const implA = await prisma.implementation.create({ data: { clientId: vn.id, name: "Valle Norte producción" } });
  await prisma.implementation.create({ data: { clientId: vn.id, name: "Valle Norte preproducción" } });

  const nov = await addGroup("Sin Facturación Actual SA"); // ingreso del año en curso ausente
  const novC = await addClient("Sin Facturación Actual Central", nov.id);
  await ident("8101", novC.id);
  const zero = await addGroup("Base Cero Industrial SL"); // el año anterior no tiene horas
  const zeroC = await addClient("Base Cero Industrial", zero.id);
  await ident("8201", zeroC.id);
  const mixed = await addGroup("Grupo Heterogéneo");
  const mx1 = await addClient("Mixto Uno", mixed.id);
  const mx2 = await addClient("Mixto Dos", mixed.id);
  await ident("8301", mx1.id); await ident("8302", mx2.id);
  const mega = await addGroup("Mega Cuenta Global Holdings");
  const megaC = await addClient("Mega Cuenta Central", mega.id);
  await ident("8401", megaC.id);

  const term = (attribute: "SUPPORT" | "HOSTING", value: string, o: { groupId?: string; clientId?: string }) => prisma.serviceTerm.create({ data: { attribute, value, groupId: o.groupId, clientId: o.clientId } });
  await term("SUPPORT", "GOLD", { groupId: big.id }); await term("HOSTING", "CLOUD", { groupId: big.id });
  await term("SUPPORT", "PLATINUM", { groupId: nov.id }); await term("HOSTING", "OP", { groupId: nov.id });
  await term("SUPPORT", "SILVER_RECURRENTE", { groupId: zero.id }); await term("HOSTING", "CLOUD", { groupId: zero.id });
  await term("SUPPORT", "GOLD", { clientId: mx1.id }); await term("SUPPORT", "PLATINUM", { clientId: mx2.id }); await term("HOSTING", "OP", { groupId: mixed.id });
  await term("SUPPORT", "PLATINUM", { groupId: mega.id }); await term("HOSTING", "CLOUD", { groupId: mega.id });

  await prisma.milestone.create({ data: { type: "START", date: d(`2022-03-10`), groupId: big.id, note: "Arranque sintético" } });
  await prisma.milestone.create({ data: { type: "CLOUD_MIGRATION", date: d(`${Y}-${pad(Math.max(1, M - 4))}-15`), clientId: vs.id } });

  const income: Record<number, number> = { 2022: 54053.32, 2023: 63128.36, 2024: 57190.69, 2025: 49133.26, [Y]: 55000 };
  for (let y = 2022; y <= Y; y++) {
    await seedFinance(adminId, "SOPORTE", y, [
      { groupId: big.id, income: String(income[y]) },
      { groupId: zero.id, income: "9600" },
      { groupId: mixed.id, income: "24000" },
      { groupId: mega.id, income: "2345678.9" },
      ...(y === Y ? [] : [{ groupId: nov.id, income: "18000" }]),
    ]);
  }
  await serviceAssignment({ matchKind: "ENTORNO", matchValue: "soporte", service: "SOPORTE" });
  await serviceAssignment({ matchKind: "WRIKE_PROJECT", matchValue: "valle pmo", service: "SOPORTE" });

  const cs = await prisma.staffCatalogItem.create({ data: { kind: "TEAM", name: "CS" } });
  const it = await prisma.staffCatalogItem.create({ data: { kind: "TEAM", name: "IT" } });
  const plat = await prisma.staffCatalogItem.create({ data: { kind: "TEAM", name: "PLAT" } });
  const n1 = await prisma.staffCatalogItem.create({ data: { kind: "LEVEL", name: "N1" } });
  const n2 = await prisma.staffCatalogItem.create({ data: { kind: "LEVEL", name: "N2" } });
  const n3 = await prisma.staffCatalogItem.create({ data: { kind: "LEVEL", name: "N3" } });
  const n4 = await prisma.staffCatalogItem.create({ data: { kind: "LEVEL", name: "N4" } });
  const ana = await prisma.staffCatalogItem.create({ data: { kind: "PMO_ROLE", name: "ANA" } });
  const dev = await prisma.staffCatalogItem.create({ data: { kind: "PMO_ROLE", name: "DEV" } });

  const causes = ["incidente_estándar_plataforma", "incidente_configuración_plataforma", "incidente_customización_plataforma", "incidente_integración/procesos", "incidente_infraestructura", "incidente_sistemas_del_cliente", "incidente_uso_indebido", null, "consulta"];
  const org = (i: number) => String(8001 + (i % 3));
  const tk: string[] = [];
  for (let i = 0; i < causes.length * 2; i++) {
    const id = `V${i}`;
    await addTicket(tb.id, { ticketId: id, entorno: "Soporte", org: org(i), cause: causes[i % causes.length], created: `${Y}-01-05`, type: i % 4 === 0 ? "problem" : "incident" });
    tk.push(id);
  }
  const pick = () => tk[Math.floor(r() * tk.length)];
  const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const profiles = [
    { team: cs.id, level: n1.id, base: 34 }, { team: cs.id, level: n2.id, base: 18 }, { team: it.id, level: n3.id, base: 3 }, { team: plat.id, level: n4.id, base: 1.2 },
  ];
  const clients = [vn, vs, ex];
  for (let y = 2022; y <= Y; y++) {
    const lastM = y === Y ? M : 12;
    for (let m = 1; m <= lastM; m++) {
      const dMax = y === Y && m === M ? D0 : lastDay(y, m);
      const season = 1 + 0.35 * Math.sin((m / 12) * Math.PI * 2 + y);
      for (const p of profiles) {
        for (const c of clients) {
          const h = Math.max(0.25, Math.round(p.base * season * (0.5 + r()) * 4) / 4 / (c === ex ? 3 : 1.4));
          const day = 1 + Math.floor(r() * Math.max(1, dMax - 1));
          await addZd({ batchId: b.id, date: `${y}-${pad(m)}-${pad(Math.min(day, dMax))}`, minutes: h * 60, groupId: big.id, clientId: c.id, ticketId: pick(), teamId: p.team, levelId: p.level });
        }
      }
      if (y >= 2025) {
        await addWrike({ batchId: b.id, date: `${y}-${pad(m)}-${pad(Math.min(12, dMax))}`, minutes: Math.round((3 + r() * 4) * 10) * 6, groupId: big.id, clientId: vn.id, implId: implA.id, project: "Valle PMO", pmo: true, roleId: ana.id, teamId: cs.id });
        if (m % 2 === 0) await addWrike({ batchId: b.id, date: `${y}-${pad(m)}-${pad(Math.min(20, dMax))}`, minutes: Math.round((4 + r() * 5) * 10) * 6, groupId: big.id, clientId: vn.id, project: "Valle PMO", pmo: true, roleId: dev.id, teamId: cs.id });
      }
      // otros grupos
      await addZd({ batchId: b.id, date: `${y}-${pad(m)}-${pad(Math.min(9, dMax))}`, minutes: 600 + Math.round(r() * 600), groupId: mega.id, clientId: megaC.id, ticketId: pick(), teamId: cs.id, levelId: n1.id });
      if (y === Y || y === Y - 1) await addZd({ batchId: b.id, date: `${y}-${pad(m)}-${pad(Math.min(10, dMax))}`, minutes: 360, groupId: nov.id, clientId: novC.id, ticketId: pick(), teamId: cs.id, levelId: n1.id });
      if (y === Y) await addZd({ batchId: b.id, date: `${y}-${pad(m)}-${pad(Math.min(11, dMax))}`, minutes: 420, groupId: zero.id, clientId: zeroC.id, ticketId: pick(), teamId: cs.id, levelId: n2.id });
      if (y === Y) {
        await addZd({ batchId: b.id, date: `${y}-${pad(m)}-${pad(Math.min(4, dMax))}`, minutes: 300, groupId: mixed.id, clientId: mx1.id, ticketId: pick(), teamId: cs.id, levelId: n1.id });
        await addZd({ batchId: b.id, date: `${y}-${pad(m)}-${pad(Math.min(6, dMax))}`, minutes: 240, groupId: mixed.id, clientId: mx2.id, ticketId: pick(), teamId: cs.id, levelId: n1.id });
      }
    }
  }
  await setUsers(adminId, { groupId: big.id }, Y, Array.from({ length: 12 }, (_, i) => 120 + i));
  await setUsers(adminId, { groupId: big.id }, Y - 1, Array(12).fill(112));

  // PAP: del Cliente (Valle Norte) y solo de Grupo (no aparece en los Clientes).
  const pb = await fakeBatch(adminId, "pap");
  let n = 0;
  const pap = async (date: string | null, o: { client: string | null; scope: "CLIENT" | "GROUP_ONLY" }) => {
    n++;
    const item = await prisma.papItem.create({ data: { listKey: "L1", papId: String(n), firstBatchId: pb.id, drvScope: o.scope, drvGroupId: big.id, drvClientId: o.client } });
    const rev = await prisma.papRevision.create({ data: { itemId: item.id, fingerprint: `pv${n}`, revisionNo: 1, title: `PAP sintético ${n}`, result: n % 7 === 0 ? "Revertido" : "OK", productionDate: date ? d(date) : null, correctiveState: n % 2 ? "CORRECTIVE" : "NON_CORRECTIVE", data: {}, batchId: pb.id } });
    await prisma.papCause.create({ data: { revisionId: rev.id, rawToken: n % 2 ? "Correctivo estándar" : "Evolutivo", normalized: n % 2 ? "correctivo estándar" : "evolutivo", category: n % 2 ? "CORRECTIVE" : "EVOLUTIVE", origin: n % 2 ? "STANDARD" : null } });
    await prisma.papItem.update({ where: { id: item.id }, data: { currentRevisionId: rev.id } });
  };
  for (let y = Y - 1; y <= Y; y++) {
    for (let m = 1; m <= (y === Y ? M : 12); m++) {
      const k = 1 + Math.floor(r() * 4);
      for (let i = 0; i < k; i++) await pap(`${y}-${pad(m)}-${pad(Math.min(3 + i, 28, y === Y && m === M ? D0 : 28))}`, { client: vn.id, scope: "CLIENT" });
      if (m % 3 === 0) await pap(`${y}-${pad(m)}-${pad(Math.min(2, y === Y && m === M ? D0 : 28))}`, { client: null, scope: "GROUP_ONLY" });
    }
  }
  return { big, vn, vs, ex, implA, nov, novC, zero, zeroC, mixed, mx1, mega, megaC };
}
