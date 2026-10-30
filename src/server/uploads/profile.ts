import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { z } from "zod";
import type { Cell } from "./readers/types";

/**
 * Contrato de un perfil de importación. Se define en servidor; el usuario nunca sube código,
 * SQL ni expresiones. Cada fuente operativa (CSAPP-03 en adelante) implementará uno.
 */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export type Issue = { severity: "error" | "warning"; code: string; message: string; column?: string };

export type MetadataField = {
  name: string;
  label: string;
  type: "text" | "select" | "date";
  required: boolean;
  options?: { value: string; label: string }[];
};

/**
 * `context` viaja de matchHeaders a parseRow (p. ej. el orden de columnas); `notes` son informaciones
 * del esquema (columnas adicionales...) que se guardan en el resumen del lote.
 */
export type HeaderMatch = { ok: true; schemaVersion: string; context?: unknown; notes?: string[] } | { ok: false; message: string };

export type ParsedRow = {
  /** Todos los campos fuente tipados y normalizados (base de la huella; sin enriquecer con maestros). */
  typed: Record<string, Json>;
  issues: Issue[];
  /** Clave de entidad revisable, si la fuente la tiene. No equivale a la huella. */
  entityKey?: string;
  /**
   * Datos que se derivan de forma determinista del propio texto fuente (causas, referencias, candidatos de ticket...).
   * Se guardan junto a la fila pero NO entran en la huella: no cambian la identidad de la fila ni usan maestros.
   */
  derived?: Record<string, Json>;
  /** Fila válida pero fuera del cálculo por una relación no resuelta (conserva el bruto). */
  exclude?: { code: string; message: string };
};

export type Db = PrismaClient | Prisma.TransactionClient;

export type ActivationContext = {
  batchId: string;
  profileId: string;
  scopeKey: string | null;
  /** Fechas del lote que el perfil necesita (p. ej. la fecha de observación). */
  batch: { declaredExtractionDate: string | null; createdAt: Date };
  /** Dominio de deduplicación: scopeKey ?? "". */
  dedupeKey: string;
  /** REPLACE_SCOPE: lote vigente que se sustituye (o al que se restaura al revertir). */
  previousBatchId: string | null;
  metadata: Record<string, unknown>;
};

export interface ImportProfile {
  id: string;
  label: string;
  description: string;
  /** Versión del perfil: se guarda en cada lote. */
  version: number;
  formats: ("xlsx" | "csv")[];
  delimiter?: string;
  sheet?: string;
  /** Política de activación de su ámbito. */
  policy: "INCORPORATE" | "REPLACE_SCOPE";
  metadataFields: MetadataField[];
  metadataSchema: z.ZodType<Record<string, unknown>>;
  /** Obligatorio en REPLACE_SCOPE (año/categoría, ámbito...). */
  scopeKey?(metadata: Record<string, unknown>): string | null;
  /** Identifica esquema, cabeceras y versión. */
  matchHeaders(headerRow: string[]): HeaderMatch;
  parseRow(cells: Cell[], context?: unknown): ParsedRow;
  /**
   * Clave repetida con contenido distinto dentro del archivo. Por defecto «revision».
   * «conflict»: las filas posteriores son error; «conflict_all»: TODAS las filas de la clave son error
   * (no se activa una elección arbitraria entre contradictorias).
   */
  entityConflictPolicy?: "revision" | "conflict" | "conflict_all";
  /** Con errores pendientes el lote no se confirma (el usuario corrige el archivo y vuelve a subirlo). */
  blocksConfirmOnErrors?: boolean;
  /** XLSX: con varias hojas compatibles se exige la hoja explícita (metadato «hoja»); nunca se elige una al azar. */
  selectsSheet?: boolean;
  /** Se ejecuta dentro de la transacción de preparación, tras las disposiciones y antes de los contadores. */
  postPrepare?(tx: Prisma.TransactionClient, batchId: string): Promise<void>;
  /** Recalcula lo derivado de un lote completado (relaciones tardías, maestros nuevos) sin releer el archivo. */
  rederive?(tx: Prisma.TransactionClient, ctx: ActivationContext): Promise<{ updated: number }>;
  /** Reglas y versiones de maestros relevantes; si cambia entre previsualización y activación, se revalida. */
  rulesFingerprint(db: Db): Promise<string>;
  /** Escribe los datos activos de su ámbito dentro de la transacción del motor. */
  activate(tx: Prisma.TransactionClient, ctx: ActivationContext): Promise<{ inserted: number; revised: number }>;
  /** Opcional: sin él, el perfil no admite revertir. */
  revert?(tx: Prisma.TransactionClient, ctx: ActivationContext): Promise<void>;
  /** Sin él, el perfil usa el nombre de la hoja de `sheet`. */
  sheetFromMetadata?(metadata: Record<string, unknown>): string | undefined;
}

/** Fuentes futuras: solo metadatos para que la interfaz las muestre como pendientes. */
export type PendingSource = { id: string; label: string; delivery: string };
