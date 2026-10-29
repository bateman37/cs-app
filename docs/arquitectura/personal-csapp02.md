# Personal único (CSAPP-02)

Resultado de la parte PERSONAL de [CSAPP-02-v1](../../prompts/CSAPP-02-v1.md). Reglas de producto: [Maestros](../producto/maestros.md), MST 05 y MST 06. Esquema físico: `Person`, `PersonAlias`, `PersonTerm` y `StaffCatalogItem` en `prisma/schema.prisma`; restricciones en la migración `20261029220244_personal_usuarios_cargas`.

Estado: **implementado y probado con PostgreSQL real en Linux** (ver pruebas abajo); **no aceptado** por Dennis. Sin precarga: no hay fuente privada y las tablas quedan vacías (salvo los roles PMO iniciales ANA y DEV del catálogo, sembrados por la migración).

## Modelo

| Entidad | Contenido |
| --- | --- |
| Persona | Identificador interno y nombre canónico estables, único sin distinguir mayúsculas; nota; activa/inactiva; versión |
| Alias | Por sistema (PAP, Zendesk, Wrike) y tipo (nombre/alias, ID, correo), con valor original, valor de búsqueda y vigencia [desde, hasta). PAP admite nombre, ID y correo; Zendesk y Wrike, ID y nombre. Sin columnas duplicadas: el ID y el nombre de Zendesk son dos alias de la misma persona |
| Tramo (nivel, equipo, pertenece a PMO, rol PMO) | Un valor con vigencia [desde, hasta). Nivel, equipo y rol salen del catálogo mínimo; PMO es sí/no. Ausencia de tramo = sin informar |
| Catálogo | Niveles, equipos y roles PMO. La migración solo siembra ANA y DEV (MST 05). Niveles y equipos no se inventan |

Las personas **no son cuentas de acceso**: sus alias no conceden permisos ni crean cuentas Better Auth.

## Reglas implementadas

- **Identidad explícita.** Una coincidencia parcial de nombres no fusiona personas. La búsqueda por alias (`findPersonByAlias`) es solo exacta tras normalizar (espacios y mayúsculas; IDs exactos como texto; no se quitan acentos) y solo con alias activo vigente en la fecha.
- **Un alias, una persona.** El mismo (sistema, tipo, valor) activo no puede pertenecer a dos personas, ni repetirse, en vigencias solapadas. Se comprueba en el servicio (mensaje que nombra a la persona en conflicto) y lo garantiza la restricción de exclusión `PersonAlias_no_overlap` de la base, también ante altas concurrentes. Desactivar un alias libera el valor; reactivarlo revalida.
- **Vigencias.** Convención [desde, hasta) como en CSAPP-01: «cambio con fecha efectiva» (cierra el tramo vigente ese día y abre el nuevo), tramo histórico explícito y corrección, con rechazo de solapamientos en el servicio y en la base (`PersonTerm_no_overlap`). Cambiar de equipo conserva la asignación anterior.
- **Fecha inicial desconocida.** Un tramo sin fecha de inicio es válido y se señala en la interfaz como «Fecha inicial por revisar»; no se reconstruye trayectoria laboral.
- **PMO y rol.** El rol solo aplica si pertenece a PMO: (1) la resolución a una fecha solo devuelve el rol con `pmoMember === true`; (2) crear un tramo de rol exige pertenencia a PMO en su fecha de inicio; (3) al fijar PMO = No con fecha D, el rol vigente ese día se cierra en D (misma transacción, auditado, historia conservada). No hay rol por defecto: desconocido queda sin informar.
- **Edición.** Control de versión optimista (`StaleVersionError`): una edición obsoleta no sobrescribe. Cada cambio y su auditoría (con `personId`) se confirman en una única transacción. Desactivar y reactivar conservan historia y alias; una persona inactiva no admite alias ni tramos nuevos.
- **Permisos.** Consulta lee personas, alias, tramos y catálogo; no ve formularios ni historial; cualquier mutación forjada se rechaza en el servicio sin cambios ni auditoría. El historial de la persona es solo de Administrador.

## Servicios para CSAPP-03 (sin selección de horas)

`resolvePersonAt(actorId, personId, fecha)` devuelve equipo, nivel, pertenencia a PMO, rol PMO (solo si pertenece) y avisos de fecha inicial por revisar. `findPersonByAlias(actorId, { system, kind, value, date })` devuelve la persona o `null`. Ambos exigen sesión válida. No se ha implementado la selección de horas Zendesk/Wrike ni ningún importador.

## Interfaz

Administración › Personal (`/administracion/personal`): lista con búsqueda por nombre/alias/ID/correo, filtros de estado, equipo y PMO a una fecha, ordenación y paginación; alta; ficha con datos, situación a una fecha, alias por sistema, historia de nivel/equipo/PMO/rol, desactivación/reactivación e historial; catálogo en `/administracion/personal/catalogo`.

## Pruebas ejecutadas

`tests/personal.test.ts`: 24 casos con PostgreSQL real (cs_app_pers_test) que cubren varios alias con una sola identidad; resolución antes/después de cambios de equipo y de PMO; rol oculto y cierre automático al salir de PMO; solapamientos rechazados (servicio y base); alias en conflicto concurrente y cambios concurrentes de equipo sin efectos parciales; alias antiguos resolubles por fecha; coincidencia parcial que no fusiona; edición obsoleta; atomicidad cambio/auditoría; Consulta y actores inexistentes o inactivos sin mutaciones; validación de sistema/tipo, IDs Zendesk y correos; filtros de lista a una fecha. Además, comprobación manual de las páginas contra `next start` (administrador y Consulta). No probado: Windows/PowerShell, lectores de pantalla.
