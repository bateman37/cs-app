# Matriz de usuarios contratados (CSAPP-02)

Implementa MST/USR 01–05 de [maestros](../producto/maestros.md). Son usuarios que **pagan** por mes; no son usuarios activos de la aplicación, cuentas de acceso ni personas del maestro Personal. Estado: implementado y probado con PostgreSQL real en Linux; no aceptado por Dennis. La precarga de usuarios 2025 llega con el libro histórico ([contrato](../importaciones/historico-economico.md)); CSAPP-HOTFIX-01 §7 cambió la política de edición (ver abajo).

## Modelo

- `UserMatrix`: cabecera por ámbito (Grupo Cliente, Cliente o implantación; exactamente uno, con claves foráneas reales a los maestros de CSAPP-01) y año. Clave única por ámbito y año; `version` para el control de edición obsoleta.
- `UserMatrixMonth`: clave `(matrixId, month)`, `value` entero ≥ 0, `kind`, `isLocked`, `source`, `revision`, autor (`updatedById`) y fecha. **Un mes sin fila es «sin informar»; una fila con 0 es un cero confirmado.** Nunca se rellenan huecos con cero, ni en la base ni en los servicios ni en la interfaz.
- `kind`: `INITIAL` (valor inicial / base 2025, ya **sin bloqueo por fila**), `COPIED` (base copiada del mismo mes del año anterior, de diciembre anterior o la inicialización de 2026), `PROPAGATED` (resultado de «aplicar desde este mes»), `ADJUSTED` (ajuste explícito), `ESTIMATED` («Estimado a partir de 2025»: no es un dato observado ese año). `isLocked` es una marca heredada: la migración `20261108090000` la limpió sin tocar valor, tipo, procedencia, revisión ni auditoría y nada la vuelve a crear; manda la ventana de años.
- Auditoría: eventos `UserMatrix` con contexto de grupo/cliente (visibles en el historial de la ficha de maestros), antes/después de los meses afectados, autor y fecha.

## Reglas de edición (`src/domain/usuarios.ts`, `src/server/usuarios.ts`)

| Regla | Comportamiento |
| --- | --- |
| Año editable | **El año natural en curso y el anterior** (`editableYears`, `editability`), calculados en servidor con Europe/Madrid. En 2026: 2025 y 2026; en 2027: 2026 y 2027; en 2028: 2027 y 2028. El reloj solo se inyecta por parámetro de servidor/pruebas (`opts.now`), nunca desde el navegador ni desde el año enviado. Se comprueba en cada servicio (edición, vista previa, copia y valor inicial), también ante una petición directa o forjada. Los años más antiguos se consultan y un año futuro no sirve de atajo. Sustituye a «solo el año en curso» y al «histórico fijo 2025». |
| Editar un mes (`SET_MONTH`) | Cambia solo ese mes y lo marca `ADJUSTED`. No propaga. |
| Aplicar desde este mes (`APPLY_FROM`) | Cambia el mes elegido (`ADJUSTED`, decisión explícita) y los posteriores del año (`PROPAGATED`), preservando los posteriores que ya son `ADJUSTED` o están bloqueados. Los meses sin informar pasan a informados. |
| Vista previa | `previewMatrixChange` devuelve por mes antes/después, resultado y meses protegidos, sin escribir. La confirmación recalcula en la transacción con la cabecera bloqueada: la autoridad es el servidor. |
| Confirmación atómica | `confirmMatrixChange`: comprueba permiso, año editable y versión (`expectedVersion`; 0 = la matriz aún no existe), aplica los meses y audita en una sola transacción. Una edición obsoleta o una creación simultánea de la cabecera dan `StaleVersionError` sin cambios parciales. |
| Valores | Enteros ≥ 0; se rechazan vacío, decimales, negativos y texto. El cero se escribe explícitamente. |
| Valor inicial uniforme | `initializeHistoric` (parámetro `year`, ya no fijo a 2025): solo en un año editable y solo si el ámbito está vacío ese año; crea doce meses iguales `INITIAL` (sin bloqueo) y audita (`INITIALIZE`). Idempotente con el mismo valor (también con llamadas simultáneas); con otro valor o con datos incompatibles se rechaza sin sobrescribir. Fuera de la ventana se rechaza: no es un atajo. Cada ámbito se inicializa por separado: un dato de grupo no se copia a Cliente ni implantación. |
| Copia al año destino | `copyFromPreviousYear` (año editable): `SAME_MONTH` copia cada mes del año anterior (procedencia «Copia de AAAA-MM»); `DECEMBER` es la acción explícita **«copiar diciembre anterior»** (procedencia «Copia de diciembre AAAA»). Solo donde el destino está sin informar; nunca pisa valores ni ajustes; sin origen deja el hueco y permite edición manual. |
| Base 2025 del libro histórico | `seedGroupUsersFromBase` (solo la invoca la carga confirmada o `resolveUsersBase`): 2025 `INITIAL`, 2026 `COPIED`, 2022–2024 `ESTIMATED` solo donde el Grupo existe; rellena únicamente meses sin informar, solo en la matriz del Grupo y sin dejar marcas ni bypass. Discrepancias entre categorías: sin denominador hasta una elección explícita (`HistoricUserBase`, `HistoricUserResolution`). |
| Nuevas matrices anuales | Se crean desde la interfaz con año numérico (selector libre de año; la matriz se crea al editar, copiar o dar un valor inicial en un año editable). No se siembran años futuros ni hay anclas a 2025/2026. |
| No implementado (propuestas) | Reapertura histórica excepcional fuera de la ventana (USR 03) y copia automática a años futuros. |

Grupo, Cliente e implantación son datos independientes: no se suman los hijos, no se exige que coincidan con el grupo y no se copia el denominador del grupo a cada hijo. Una implantación sin usuarios muestra falta de dato, no un reparto.

## Servicios de consulta (permiso de lectura; Consulta puede usarlos)

- `getMatrix`, `listMatrices` (año, ámbito, búsqueda, estado, paginación).
- `usersAtMonth` y `usersAtCutoff`: stock del mes; **no se prorratea ni se suma enero a diciembre**.
- `userMonthsExposure`: usuarios mes de un periodo [desde, hasta] con fechas inclusivas, también entre años. Cada mes pesa días incluidos / días reales (mes completo = 1). Si falta algún mes requerido devuelve `complete = false`, `userMonths = null`, la suma parcial en `knownUserMonths` y la lista de `missingMonths`; nunca ignora el hueco ni lo convierte en cero. Decimales sin redondear (se redondea solo al presentar).
- Ejemplo verificado: enero–octubre con 65 hasta mayo y 68 desde junio → 665 usuarios mes y 68 usuarios a octubre.

## Interfaz (Administración › Usuarios)

`/administracion/usuarios`: año numérico libre, selector de ámbito, búsqueda y matriz enero–diciembre («—» sin informar, «0» cero confirmado, tipo indicado con letra y texto, no solo con color; «E» = estimado a partir de 2025) y aviso de Grupos con la base 2025 en discrepancia. Ficha por ámbito y año con detalle por mes (tipo y procedencia), formularios «editar un mes» y «aplicar desde este mes» (ambos pasan por una página de vista previa antes de confirmar), valor inicial uniforme, copia mes a mes y «copiar diciembre» solo en años editables, y, en Grupos, la sección «Base de usuarios 2025 del libro histórico» con sus candidatos y la elección explícita. Consulta lee y no ve formularios; las mutaciones forjadas las rechaza el servicio.

### Edición en la propia matriz (HOTFIX-04)

Desde HOTFIX-04 las celdas de enero a diciembre de un año editable son inputs numéricos y **se guardan por lote**: una única revisión/confirmación para varias celdas y varias filas, un único versionado por matriz, «sin informar» (celda vacía) distinto de 0, «Aplicar desde este mes» y la copia del año anterior desde la misma fila, y conflictos localizados por fila. Contrato: [HOTFIX-04](hotfix04-edicion-en-tablas.md#4-usuarios-contratados-guardado-por-lote). La ficha de cada fila (`/administracion/usuarios/{ámbito}/{id}`) queda como historial y gestión excepcional; los flujos de ficha anteriores siguen funcionando.

## Pruebas

`tests/usuarios-dominio.test.ts` (reglas puras, incluida la ventana actual+anterior) y `tests/usuarios.test.ts` (PostgreSQL real: 65→68, ajustes y protegidos, valor inicial, ventana 2026/2027/2028, copia mes a mes y de diciembre, nulos/cero, ámbitos independientes, concurrencia, atomicidad con fallo de auditoría simulado, permisos, ámbito inactivo e integridad de la base); `tests/historico-economico.test.ts` (base 2025, estimados, discrepancias, recarga, migración de bloqueos). Las pruebas que fijaban «solo año actual» y el 2025 bloqueado se reescribieron porque esas reglas fueron sustituidas por HOTFIX-01 §7. Resultados en la [validación](../validacion/csapp-02.md).
