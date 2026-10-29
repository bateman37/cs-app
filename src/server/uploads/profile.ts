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

export type HeaderMatch = { ok: true; schemaVersion: string } | { ok: false; message: string };

export type ParsedRow = {
  /** Todos los campos fuente tipados y normalizados (base de la huella; sin enriquecer con maestros). */
  typed: Record<string, Json>;
  issues: Issue[];
  /** Clave de entidad revisable, si la fuente la tiene. No equivale a la huella. */
  entityKey?: string;
  /** Fila válida pero fuera del cálculo por una relación no resuelta (conserva el bruto). */
  exclude?: { code: string; message: string };
};

export type Db = PrismaClient | Prisma.TransactionClient;

export type ActivationContext = {
  batchId: string;
  profileId: string;
  scopeKey: string | null;
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
  parseRow(cells: Cell[]): ParsedRow;
  /** Clave repetida con contenido distinto dentro del archivo. Por defecto «revision». */
  entityConflictPolicy?: "revision" | "conflict";
  /** Reglas y versiones de maestros relevantes; si cambia entre previsualización y activación, se revalida. */
  rulesFingerprint(db: Db): Promise<string>;
  /** Escribe los datos activos de su ámbito dentro de la transacción del motor. */
  activate(tx: Prisma.TransactionClient, ctx: ActivationContext): Promise<{ inserted: number; revised: number }>;
  /** Opcional: sin él, el perfil no admite revertir. */
  revert?(tx: Prisma.TransactionClient, ctx: ActivationContext): Promise<void>;
}

/** Fuentes futuras: solo metadatos para que la interfaz las muestre como pendientes. */
export type PendingSource = { id: string; label: string; delivery: string };
