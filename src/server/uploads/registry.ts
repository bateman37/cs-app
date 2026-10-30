import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { databaseNameOf } from "@/lib/env";
import type { ImportProfile, PendingSource } from "./profile";
import { zendeskTickets } from "../zendesk/tickets";
import { zendeskTiempo } from "../zendesk/time";
import { wrike } from "../wrike/time";
import { pap } from "../pap/profile";
import { bugsVfs, bugsVsw } from "../bugs/profile";
import { SYNTHETIC_SCHEMA, syntheticIncorporar, syntheticSustituir } from "./synthetic/profile";

/** Perfiles operativos: Tickets y Tiempos Zendesk (CSAPP-03); Wrike, PAP y bugs VFS/VSW (CSAPP-04). Las finanzas llegan en CSAPP-05. */
const OPERATIONAL: ImportProfile[] = [zendeskTickets, zendeskTiempo, wrike, pap, bugsVfs, bugsVsw];

/** Fuentes previstas, mostradas como pendientes (no disponibles). */
export const PENDING_SOURCES: PendingSource[] = [
  { id: "zendesk-tickets", label: "Zendesk · tickets", delivery: "CSAPP-03" },
  { id: "zendesk-tiempo", label: "Zendesk · tiempos", delivery: "CSAPP-03" },
  { id: "facturacion-soporte", label: "Facturación · soporte", delivery: "CSAPP-05" },
  { id: "facturacion-admin-delegada", label: "Facturación · administración delegada", delivery: "CSAPP-05" },
  { id: "facturacion-otros", label: "Facturación · otros", delivery: "CSAPP-05" },
];

const SYNTHETIC = [syntheticIncorporar, syntheticSustituir];

let cache: { key: string; at: number; enabled: boolean } | null = null;
export function resetRegistryCache() {
  cache = null;
}

/**
 * Los perfiles sintéticos se habilitan solo si se cumplen LAS TRES condiciones, comprobadas en
 * servidor (nunca por parámetro del navegador ni solo por el prefijo del nombre de la base):
 *  1. CSAPP_ENABLE_SYNTHETIC_PROFILES es igual al nombre exacto de la base conectada;
 *  2. ese nombre acaba en «_test»;
 *  3. existe el esquema csapp_synthetic con su fila marcador (lo crea el arranque de pruebas).
 */
export async function syntheticProfilesEnabled(): Promise<boolean> {
  const flag = process.env.CSAPP_ENABLE_SYNTHETIC_PROFILES;
  const dbName = databaseNameOf(process.env.DATABASE_URL ?? "");
  if (!flag || !dbName || flag !== dbName) return false;
  if (!/^cs_app(_[a-z0-9]+)*_test$/.test(dbName)) return false;
  const key = `${flag}|${dbName}`;
  if (cache && cache.key === key && Date.now() - cache.at < 10_000) return cache.enabled;
  let enabled = false;
  try {
    const t = await prisma.$queryRaw<{ ok: boolean }[]>(
      Prisma.sql`SELECT to_regclass(${`${SYNTHETIC_SCHEMA}.settings`}) IS NOT NULL AS ok`,
    );
    if (t[0]?.ok) {
      const m = await prisma.$queryRaw<{ n: bigint }[]>(
        Prisma.sql`SELECT count(*) AS n FROM csapp_synthetic.settings WHERE key = 'marker'`,
      );
      enabled = Number(m[0]?.n ?? 0) > 0;
    }
  } catch {
    enabled = false;
  }
  cache = { key, at: Date.now(), enabled };
  return enabled;
}

export async function getProfiles(): Promise<ImportProfile[]> {
  return (await syntheticProfilesEnabled()) ? [...OPERATIONAL, ...SYNTHETIC] : [...OPERATIONAL];
}

export async function getProfile(id: string): Promise<ImportProfile | null> {
  return (await getProfiles()).find((p) => p.id === id) ?? null;
}

/** Fuentes futuras para mostrar deshabilitadas (excluye las que ya tienen perfil disponible). */
export async function getPendingSources(): Promise<PendingSource[]> {
  const have = new Set((await getProfiles()).map((p) => p.id));
  return PENDING_SOURCES.filter((p) => !have.has(p.id));
}
