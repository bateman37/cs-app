# Resultados de validación de CSAPP-02

Entorno de ejecución: Linux (contenedor en la nube), Node 22.22.0, PostgreSQL 16.15 local, 29/10/2026. **No se ha probado en Windows ni con PowerShell**: las guías están escritas, no ejecutadas allí. Todas las pruebas usan bases `*_test` aisladas; nunca `cs_app` salvo la aplicación de migraciones incrementales (`prisma migrate deploy`, sin reset ni borrado).

## Qué se ejecutó

| Comprobación | Comando | Resultado |
| --- | --- | --- |
| Instalación reproducible | `npm ci` | Correcta, 0 vulnerabilidades |
| Tipos y lint | `npm run typecheck`, `npm run lint` | Sin errores |
| Build de producción | `npm run build` (y `npm run e2e:build`, que añade el trabajador) | Correcto |
| Migración sobre base vacía | `prisma migrate deploy` sobre una base recién creada | Aplica las dos migraciones |
| Migración sobre datos de CSAPP-01 | `tests/migracion.test.ts` (esquema y datos sintéticos de CSAPP-01 + migración nueva) | Datos conservados, tablas nuevas, roles ANA/DEV; repetir no cambia nada |
| Suite completa con PostgreSQL real | `npm run test:todo` | **11 archivos, 144 pruebas, 144 correctas** (680 s). Incluye las 31 de CSAPP-01 |
| Recorrido de navegador (Chromium, `next start`, trabajador real) | `npm run e2e` | **78 comprobaciones, 78 correctas**: 40 de CSAPP-01 (cuentas, acceso, mutación forjada, sesión, persistencia, límite), 27 de Cargas y 11 de Personal y usuarios |

Desglose de las pruebas de PostgreSQL: CSAPP-01 31; personal 24; matriz de usuarios 32 (10 puras + 22 con base); motor de cargas 37 + 5 (rutas API con sesión real) + 3 (trabajador real: SIGKILL durante preparación y reanudación, SIGTERM limpio, dos trabajadores) + volumen; lectores 10; migración 1. `npm test` ejecuta lo rápido; `npm run test:largo` las del trabajador y volumen.

## Medidas reales

- **Volumen (motor completo)**: CSV sintético de 1 000 000 filas (46 MB), trabajador real construido, límite de heap de 384 MB. Subida 0,3 s; preparación (lectura, validación, staging) 264 s ≈ 3 800 filas/s; activación 153 s; pico de RSS del trabajador 314 MB; durante la preparación una consulta de lectura siguió respondiendo (1 025 lecturas, p95 10 ms, máx. 30 ms). Con bloques de 5 000 filas se agotó la memoria: el bloque por defecto es 1 000.
- **Lectores sueltos** (`npm run benchmark:lectores`): CSV 1 000 001 filas en 6,1 s (≈165 000 filas/s, RSS 159→161 MB); XLSX 500 001 filas en 15,9 s (≈31 500 filas/s, RSS 130→143 MB). Ver [lectores](../arquitectura/lectores-xlsx-csv.md).
- El XLSX grande solo se midió con el lector aislado, no con el motor completo. No es el benchmark exhaustivo con datos reales del roadmap (CSAPP-09).

## Cobertura frente a la tabla de aceptación del prompt

Personal (varios alias, PMO y rol en el mismo maestro), vigencias (resolución antes y después de cambios, solapamientos), identidades (alias concurrente), matriz 65→68 (665 usuarios mes y stock 68), ajustes (un mes no propaga; aplicar desde junio preserva septiembre), histórico 2025 (idempotente, rechazo también por petición directa), año corriente por reloj controlado, nulos y cero, grupo y Cliente independientes, copia 2025→2026, concurrencia y atomicidad, validación de archivos (BOM, CSV citado, XLSX sin dimensión), duplicados y procedencias, activación única con dos trabajadores y rollback, reinicio del trabajador durante la preparación sin duplicados, cancelación, reversión con fila compartida, reproceso con el bruto, alcance (sustituir A no altera B), obsolescencia, permisos (Consulta, sin sesión, cookie falsa, sin efectos previos al rechazo) y volumen. Cada caso tiene prueba automática concreta, listada en los documentos de cada módulo.

## Defectos encontrados y corregidos durante la entrega

El historial de Grupo/Cliente no compilaba con las nuevas acciones de auditoría (etiquetas ampliadas); el error de tipos de `benchmark-lectores.ts`; la vista previa de Cargas mostraba filas vacías porque `raw` guarda pares `[valor, tipo]`; un `node_modules` convertido en enlace simbólico versionado por error se retiró del repositorio; dos esperas incorrectas del guion de navegador. Con 5 000 filas por bloque el trabajador agotaba la memoria (bloque por defecto fijado en 1 000).

## No ejecutado / límites

- Windows/PowerShell (pendiente de CSAPP-01 y de esta entrega).
- Subida de archivos grandes por la interfaz del navegador; acciones Reprocesar, Cancelar y Revertir desde el navegador (cubiertas por pruebas del servicio, no del navegador); lector de pantalla.
- Reiniciar la web en un proceso real durante una carga: lo cubre que todo el estado está en PostgreSQL y el recorrido reinicia `next start` con datos y sesión intactos, pero no hay una prueba que lo haga con una preparación en curso.
- El recorrido de navegador es nuevo: no se encontró el guion original de las 41 comprobaciones de CSAPP-01 y no se atribuyen.

## Fuentes y precarga

No hay fuentes privadas en el entorno. **No se precargó nada**: ni personal, ni matriz 2025/2026, ni maestros. Las funciones de inicialización 2025 y copia a 2026 existen y están probadas con datos sintéticos; la precarga queda pendiente hasta disponer de la fuente. Las tablas operativas de Zendesk, Wrike, PAP, bugs y facturación siguen sin existir ni cargarse. El perfil sintético solo existe en el entorno de test aislado.
