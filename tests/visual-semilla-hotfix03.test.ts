import { describe, it } from "vitest";
import { prisma } from "@/lib/db";
import { databaseNameOf } from "@/lib/env";
import { resetDatabase, makeUsers } from "./helpers";
import { addClient, addGroup, addTicket, addZd, fakeBatch, seedFinance, setUsers } from "./economia-helpers";
import { batchOf, declareAllSources, seedPap, seedTicket } from "./calidad-helpers";

/**
 * SEMILLA SINTÉTICA para la verificación visual de HOTFIX-03 (no es una prueba): se salta sin CSAPP_VISUAL_SEED=1 y exige una base de pruebas aislada («vis»).
 * Nombres inventados; ningún dato real. Cuenta: admin@test.local / clave-de-prueba-123.
 */
const enabled = process.env.CSAPP_VISUAL_SEED === "1";
const RATIOS = [300, 330, 400, 440, 500, 550, 600, 660, 800, 450, 700, 350];
describe.skipIf(!enabled)("semilla visual sintética", () => {
  it("crea Grupos, Clientes, equivalencias, finanzas, horas, usuarios, tickets y PAP", async () => {
    if (!/vis/.test(databaseNameOf(process.env.DATABASE_URL ?? ""))) throw new Error("Base no aislada para la semilla visual");
    await resetDatabase();
    const { admin } = await makeUsers();
    const tb = await fakeBatch(admin.id);
    await addTicket(tb.id, { ticketId: "SOP", entorno: "Soporte", adminDelegada: false });
    const pb = await batchOf(admin.id, "pap");
    const tkb = await batchOf(admin.id, "zendesk-tickets", "2026-10-31");
    const finRows: { groupId: string; income: string; label: string }[] = [];
    const names = ["Aurora", "Bahía", "Cedro", "Delta Sur", "Éter", "Faro", "Granito", "Horizonte", "Isla", "Jade", "Kilo", "Lumen"];
    for (let i = 0; i < names.length; i++) {
      const g = await addGroup(`${names[i]} S.A.`);
      await prisma.clientGroup.update({ where: { id: g.id }, data: { bcDenomination: `${names[i].toUpperCase()} S.A.` } });
      const c1 = await addClient(`${names[i]} Retail`, g.id);
      const c2 = i % 3 === 0 ? await addClient(`${names[i]} Logística`, g.id) : null;
      if (i === 5) await prisma.client.update({ where: { id: c1.id }, data: { isActive: false } });
      if (i === 9) { await prisma.client.updateMany({ where: { groupId: g.id }, data: { isActive: false } }); }
      const zd = (n: number, id: string, cid: string) => prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_ID", rawValue: String(n), searchValue: String(n), clientId: cid } }).then(() => prisma.externalIdentity.create({ data: { system: "ZENDESK", kind: "ORG_NAME", rawValue: id, searchValue: id.toLowerCase(), clientId: cid } }));
      await zd(810000 + i * 2, `${names[i]} Retail`, c1.id);
      if (c2) await zd(810001 + i * 2, `${names[i]} Logística`, c2.id);
      if (i !== 7) await prisma.externalIdentity.create({ data: { system: "WRIKE", kind: "PROJECT_NAME", rawValue: `W-${names[i].toUpperCase()}`, searchValue: `w-${names[i].toLowerCase()}`, groupId: g.id } });
      if (i !== 4) await prisma.externalIdentity.create({ data: { system: "PAP", kind: "PROJECT_NAME", rawValue: `P-${names[i].toUpperCase()}`, searchValue: `p-${names[i].toLowerCase()}`, groupId: g.id } });
      const support = i === 2 ? "SILVER_ON_DEMAND" : i % 2 === 0 ? "GOLD" : "PLATINUM";
      for (const own of [{ clientId: c1.id }, ...(c2 ? [{ clientId: c2.id }] : [])]) {
        await prisma.serviceTerm.create({ data: { attribute: "SUPPORT", value: support, ...own } });
        await prisma.serviceTerm.create({ data: { attribute: "HOSTING", value: i % 2 === 0 ? "OP" : "CLOUD", ...own } });
        await prisma.serviceTerm.create({ data: { attribute: "COMPLEXITY", value: i % 3 === 0 ? "ENTERPRISE" : "MEDIUM", ...own } });
      }
      await setUsers(admin.id, { groupId: g.id }, 2026, Array(12).fill(20 + i * 7));
      await setUsers(admin.id, { clientId: c1.id }, 2026, Array(12).fill(20 + i * 7));
      if (i === 3) continue; // Delta Sur: sin ingreso (fuente ausente) para ver «—» con causa
      finRows.push({ groupId: g.id, income: "13200", label: names[i] }); // un único conjunto financiero: cada carga sustituye el año/categoría
      const minutes = Math.round(528000 / RATIOS[i]);
      await addZd({ batchId: tb.id, date: "2026-10-12", minutes, groupId: g.id, clientId: c1.id, ticketId: "SOP" });
      if (i === 6) await addZd({ batchId: tb.id, date: "2026-10-13", minutes: 600, groupId: g.id, clientId: c1.id }); // 10 h sin servicio → cifra provisional
      for (let k = 1; k <= (i % 5) + 1; k++) await seedPap(pb.id, { id: String(i * 100 + k), groupId: g.id, clientId: c1.id, date: `2026-10-${String(k + 2).padStart(2, "0")}`, state: "CORRECTIVE", causes: [{ category: "CORRECTIVE", origin: "STANDARD" }] });
      if (i % 2 === 0) await seedTicket(tkb.id, { id: `T${i}`, org: String(810000 + i * 2), type: "incident", created: "2026-10-05", observedOn: "2026-10-31", destinations: i % 4 === 0 ? ["IT_N3"] : [] });
    }
    await seedFinance(admin.id, "SOPORTE", 2026, finRows);
    await declareAllSources(admin.id, "2026-01-01", "2026-10-31");
    // Personal sintético
    const staff: [string, string, string, string, boolean | null][] = [
      ["Ana Ejemplo", "CS", "N1", "ANA", false], ["Beto Muestra", "CS N2", "N2", "", false], ["Carla Prueba", "PMO", "N3", "ANA", true], ["Dario Dato", "IT", "N3", "", false], ["Elena Test", "PLAT", "N4", "", null],
    ];
    for (const [name, team, level] of staff.map((s) => [s[0], s[1], s[2]] as const)) {
      const p = await prisma.person.create({ data: { name } });
      await prisma.personAlias.create({ data: { personId: p.id, system: "ZENDESK", kind: "NAME", rawValue: name, searchValue: name.toLowerCase() } });
      await prisma.personAlias.create({ data: { personId: p.id, system: "PAP", kind: "NAME", rawValue: name.split(" ")[0], searchValue: name.split(" ")[0].toLowerCase() } });
      if (name !== "Dario Dato") await prisma.personAlias.create({ data: { personId: p.id, system: "WRIKE", kind: "NAME", rawValue: `${name} (W)`, searchValue: `${name} (w)`.toLowerCase() } });
      const t = await prisma.staffCatalogItem.upsert({ where: { id: `${team}-t` }, update: {}, create: { id: `${team}-t`, kind: "TEAM", name: team } });
      const l = await prisma.staffCatalogItem.upsert({ where: { id: `${level}-l` }, update: {}, create: { id: `${level}-l`, kind: "LEVEL", name: level } });
      await prisma.personTerm.create({ data: { personId: p.id, attribute: "TEAM", catalogItemId: t.id } });
      if (name !== "Elena Test") await prisma.personTerm.create({ data: { personId: p.id, attribute: "LEVEL", catalogItemId: l.id } });
      if (name !== "Elena Test") await prisma.personTerm.create({ data: { personId: p.id, attribute: "PMO_MEMBER", flag: team === "PMO" } });
    }
  });
});
