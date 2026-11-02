/**
 * Inventario de configuración (CSAPP-10 §7): NOMBRES de variables, para que quien restaure sepa qué debe reunir. Jamás valores, ni `.env`, ni claves.
 * Lo marcado `custodiaAparte` NO viaja en la copia: se custodia por un canal seguro distinto (gestor de secretos, sobre sellado…); la copia de datos sin
 * esos valores no basta para arrancar y, a la vez, un robo de la copia no entrega las credenciales.
 */
export type ConfigVar = { name: string; obligatoria: boolean; custodiaAparte: boolean; uso: string };

export const CONFIG_VARS: readonly ConfigVar[] = [
  { name: "DATABASE_URL", obligatoria: true, custodiaAparte: true, uso: "Conexión a la base (contiene usuario y clave)." },
  { name: "BETTER_AUTH_SECRET", obligatoria: true, custodiaAparte: true, uso: "Secreto de sesión; la instalación restaurada usa el suyo propio (no se reutiliza el del origen)." },
  { name: "BETTER_AUTH_URL", obligatoria: true, custodiaAparte: false, uso: "URL pública de la aplicación (origen de confianza de cookies y formularios)." },
  { name: "CSAPP_UPLOAD_DIR", obligatoria: true, custodiaAparte: false, uso: "Almacén privado de originales (ruta absoluta fuera de la carpeta de la aplicación)." },
  { name: "CSAPP_EXPORT_DIR", obligatoria: true, custodiaAparte: false, uso: "Almacén privado de exportaciones (ruta absoluta, distinta de la anterior)." },
  { name: "CSAPP_STATE_DIR", obligatoria: false, custodiaAparte: false, uso: "Directorio de estado del supervisor y del bloqueo de copia." },
  { name: "CSAPP_HOME", obligatoria: false, custodiaAparte: false, uso: "Carpeta de la aplicación compilada." },
  { name: "CSAPP_HOST", obligatoria: false, custodiaAparte: false, uso: "Dirección de escucha de la web." },
  { name: "CSAPP_PORT", obligatoria: false, custodiaAparte: false, uso: "Puerto de la web (alternativa: PORT)." },
  { name: "PORT", obligatoria: false, custodiaAparte: false, uso: "Puerto de la web." },
  { name: "CSAPP_BACKUP_DIR", obligatoria: false, custodiaAparte: false, uso: "Directorio de destino de las copias (valor por defecto de --destino)." },
  { name: "CSAPP_PG_BIN", obligatoria: false, custodiaAparte: false, uso: "Carpeta de las herramientas cliente de PostgreSQL (pg_dump, pg_restore) si no están en el PATH." },
  { name: "CSAPP_EXPORT_TTL_HOURS", obligatoria: false, custodiaAparte: false, uso: "Vida útil de las exportaciones (ajuste técnico)." },
  { name: "CSAPP_EXPORT_MIN_FREE_BYTES", obligatoria: false, custodiaAparte: false, uso: "Espacio libre mínimo de los almacenes (ajuste técnico)." },
  { name: "CSAPP_UPLOAD_MAX_BYTES", obligatoria: false, custodiaAparte: false, uso: "Tamaño máximo de una carga (ajuste técnico)." },
  { name: "CSAPP_WORKER_LEASE_MS", obligatoria: false, custodiaAparte: false, uso: "Duración del lease del trabajador (ajuste técnico)." },
  { name: "CSAPP_WORKER_HEARTBEAT_MS", obligatoria: false, custodiaAparte: false, uso: "Intervalo del latido (ajuste técnico)." },
  { name: "CSAPP_ZENDESK_HOSTS", obligatoria: false, custodiaAparte: false, uso: "Servidores de Zendesk reconocidos (ajuste)." },
  { name: "CSAPP_DEVOPS_PRODUCTS", obligatoria: false, custodiaAparte: false, uso: "Productos de DevOps reconocidos (ajuste)." },
  { name: "CSAPP_BUG_TERMINAL_STATES", obligatoria: false, custodiaAparte: false, uso: "Estados terminales de bugs (ajuste)." },
];

export type ConfigInventory = {
  nota: string;
  variables: { name: string; obligatoria: boolean; custodiaAparte: boolean; uso: string; definidaEnElOrigen: boolean }[];
  noIncluido: string[];
};

export function buildConfigInventory(env: Record<string, string | undefined> = process.env): ConfigInventory {
  return {
    nota: "Solo nombres de variables. Esta copia NO contiene valores de configuración, ni el archivo .env, ni claves ni secretos.",
    variables: CONFIG_VARS.map((v) => ({ ...v, definidaEnElOrigen: !!env[v.name] })),
    noIncluido: [".env y cualquier valor de variable", "BETTER_AUTH_SECRET", "usuario y contraseña de la base (DATABASE_URL)", "carpetas .next, worker-dist y node_modules (se reinstalan desde el código)"],
  };
}
