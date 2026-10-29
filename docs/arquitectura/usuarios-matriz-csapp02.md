# Matriz de usuarios contratados (CSAPP-02)

Implementa MST/USR 01–05 de [maestros](../producto/maestros.md). Son usuarios que **pagan** por mes; no son usuarios activos de la aplicación, cuentas de acceso ni personas del maestro Personal. Estado: implementado y probado con PostgreSQL real en Linux; no aceptado por Dennis. Sin precarga: no hay fuente privada en el entorno.

## Modelo

- `UserMatrix`: cabecera por ámbito (Grupo Cliente, Cliente o implantación; exactamente uno, con claves foráneas reales a los maestros de CSAPP-01) y año. Clave única por ámbito y año; `version` para el control de edición obsoleta.
- `UserMatrixMonth`: clave `(matrixId, month)`, `value` entero ≥ 0, `kind`, `isLocked`, `source`, `revision`, autor (`updatedById`) y fecha. **Un mes sin fila es «sin informar»; una fila con 0 es un cero confirmado.** Nunca se rellenan huecos con cero, ni en la base ni en los servicios ni en la interfaz.
- `kind`: `INITIAL` (carga inicial 2025, bloqueada), `COPIED` (base copiada del mismo mes del año anterior), `PROPAGATED` (resultado de «aplicar desde este mes»), `ADJUSTED` (ajuste explícito).
- Auditoría: eventos `UserMatrix` con contexto de grupo/cliente (visibles en el historial de la ficha de maestros), antes/después de los meses afectados, autor y fecha.

## Reglas de edición (`src/domain/usuarios.ts`, `src/server/usuarios.ts`)

| Regla | Comportamiento |
| --- | --- |
| Año editable | Solo el año natural en curso, calculado en servidor con Europe/Madrid (`currentYear`). El reloj solo se inyecta por parámetro de servidor/pruebas (`opts.now`), nunca desde el navegador. Se comprueba en cada servicio, también ante una petición directa. Años anteriores se consultan; un año futuro no sirve de atajo. |
| Editar un mes (`SET_MONTH`) | Cambia solo ese mes y lo marca `ADJUSTED`. No propaga. |
| Aplicar desde este mes (`APPLY_FROM`) | Cambia el mes elegido (`ADJUSTED`, decisión explícita) y los posteriores del año (`PROPAGATED`), preservando los posteriores que ya son `ADJUSTED` o están bloqueados. Los meses sin informar pasan a informados. |
| Vista previa | `previewMatrixChange` devuelve por mes antes/después, resultado y meses protegidos, sin escribir. La confirmación recalcula en la transacción con la cabecera bloqueada: la autoridad es el servidor. |
| Confirmación atómica | `confirmMatrixChange`: comprueba permiso, año editable y versión (`expectedVersion`; 0 = la matriz aún no existe), aplica los meses y audita en una sola transacción. Una edición obsoleta o una creación simultánea de la cabecera dan `StaleVersionError` sin cambios parciales. |
| Valores | Enteros ≥ 0; se rechazan vacío, decimales, negativos y texto. El cero se escribe explícitamente. |
| Histórico 2025 | `initializeHistoric`: solo 2025, solo si el ámbito está vacío; crea doce meses iguales `INITIAL` bloqueados y audita (`INITIALIZE`). Idempotente con el mismo valor (sin duplicar ni auditar de nuevo, también con llamadas simultáneas); con otro valor o con datos incompatibles se rechaza sin sobrescribir y exige resolver la discrepancia fuera de la edición ordinaria. No es una reapertura. Un mes bloqueado no se edita aunque el reloj estuviera en 2025. Cada ámbito se inicializa por separado: un dato de grupo no se copia a Cliente ni implantación. |
| Copia al año en curso | `copyFromPreviousYear`: copia el mismo mes del año anterior del mismo ámbito solo donde el destino está sin informar (`COPIED`, procedencia «Copia de AAAA-MM»); nunca pisa valores ni ajustes; sin origen deja el hueco y permite edición manual. |
| No implementado (propuestas) | Reapertura histórica excepcional (USR 03) y copia automática a años futuros. |

Grupo, Cliente e implantación son datos independientes: no se suman los hijos, no se exige que coincidan con el grupo y no se copia el denominador del grupo a cada hijo. Una implantación sin usuarios muestra falta de dato, no un reparto.

## Servicios de consulta (permiso de lectura; Consulta puede usarlos)

- `getMatrix`, `listMatrices` (año, ámbito, búsqueda, estado, paginación).
- `usersAtMonth` y `usersAtCutoff`: stock del mes; **no se prorratea ni se suma enero a diciembre**.
- `userMonthsExposure`: usuarios mes de un periodo [desde, hasta] con fechas inclusivas, también entre años. Cada mes pesa días incluidos / días reales (mes completo = 1). Si falta algún mes requerido devuelve `complete = false`, `userMonths = null`, la suma parcial en `knownUserMonths` y la lista de `missingMonths`; nunca ignora el hueco ni lo convierte en cero. Decimales sin redondear (se redondea solo al presentar).
- Ejemplo verificado: enero–octubre con 65 hasta mayo y 68 desde junio → 665 usuarios mes y 68 usuarios a octubre.

## Interfaz (Administración › Usuarios)

`/administracion/usuarios`: selector de año y ámbito, búsqueda y matriz enero–diciembre («—» sin informar, «0» cero confirmado, tipo y bloqueo indicados con letra y texto, no solo con color). Ficha por ámbito y año con detalle por mes, formularios «editar un mes» y «aplicar desde este mes» (ambos pasan por una página de vista previa antes de confirmar), inicialización 2025 y copia del año anterior. Consulta lee y no ve formularios; las mutaciones forjadas las rechaza el servicio.

## Pruebas

`tests/usuarios-dominio.test.ts` (reglas puras) y `tests/usuarios.test.ts` (PostgreSQL real: 65→68, ajustes y protegidos, histórico, reloj controlado, nulos/cero, ámbitos independientes, copia, concurrencia, atomicidad con fallo de auditoría simulado, permisos, ámbito inactivo e integridad de la base). Resultados en la [validación](../validacion/csapp-02.md).
