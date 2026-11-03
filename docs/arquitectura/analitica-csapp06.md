# Analítica de CSAPP-06: decisiones técnicas

Sin migración nueva (las cinco anteriores quedan intactas). Todo es lectura.

## Servicios (`src/server/analytics`)

| Módulo | Función |
| --- | --- |
| `snapshot.ts` | `readSnapshot`: una transacción `REPEATABLE READ` por petición, con el cliente de la transacción en todos los ayudantes; no queda abierta mientras la persona decide. Gancho de sincronización **solo en pruebas** (`NODE_ENV=test`), no accesible desde navegador ni producción |
| `stamp.ts` | Sello de datos por dominio (tiempos, tickets, finanzas, usuarios, maestros, personal, servicios, configuración, PAP, bugs). Contraejemplo probado: una fila 1→2 con otra en 100 cambia el sello y no el máximo |
| `portfolio.ts` | Maestros con vigencia al corte, filtros de grupos completos, orden estable con nulos al final, paginación y cartera sobre el conjunto filtrado completo |
| `ficha.ts` / `operational.ts` | Ficha por ámbito; dedicación por perfil y causa, PAP, tickets/escalados y bugs con SQL por conjuntos. Resumen y detalle comparten fragmentos SQL (`*Base`) |
| `detail.ts` | Lecturas de negocio para ADMIN y Consulta con totales sobre todas las filas filtradas. Las funciones de `economics/detail.ts` (Cargas) siguen **solo ADMIN** |
| `export.ts` / `src/domain/csv.ts` | CSV: UTF-8 con BOM, `;`, decimales con coma, CRLF, escape de comillas/saltos y neutralización de `= + - @ tab CR` solo en texto (los números negativos no se tocan). Desconocido = vacío + estado; cero = `0` |

## Contrato de consulta

`src/domain/analytics-query.ts`: fecha, modo, servicio, revisión, filtros, orden (lista cerrada de columnas), página, tamaño, bloques, pestaña y sello; valores no válidos vuelven al inicial y se avisa. Nada se interpola en SQL. El enlace `volver` se reconstruye con lista permitida (sin redirecciones externas).

## Coherencia y frescura

Los enlaces de detalle y CSV llevan el sello de la lectura de origen; si difiere, la pantalla declara «nueva lectura» y el CSV añade `X-Referencia-Solicitada`/`X-Lectura-Nueva`. Respuestas `private, no-store`, `Vary: Cookie`. Prueba con dos conexiones y barrera: sustitución financiera + usuarios + atribución confirmados durante la lectura no se mezclan (mutación a READ COMMITTED: la prueba falla).

## Rutas y permisos

`/api/analitica/comparativa.csv` y `/api/analitica/ficha.csv`: sesión real y rol ADMIN/Consulta leídos de la base; ámbito/tabla validados (400). Consulta no llega a archivos originales ni acciones de carga; sus páginas no enlazan a `/administracion`.

## Decisiones

- Prescinde de caché de resultados (sin claves compartidas): rendimiento por consultas de conjunto (≈22 sentencias para la cartera, independientes del nº de grupos).
- La serie del comparable anterior se calcula con sus propios datos; solo el grupo en foco recibe series mensuales.
- Evolutivos PAP «no facturables»: la fuente no trae evidencia de facturación; se rotulan «sin evidencia de facturación».
- Clasificación de causas: lista de causas de `INCIDENT_APP_CAUSES` + infraestructura según alojamiento **a la fecha del trabajo**.
