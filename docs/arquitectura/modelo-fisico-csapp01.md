# Modelo físico implementado en CSAPP-01

Concreta solo las entidades de acceso, maestros, vigencias, hitos y auditoría del [modelo lógico](modelo.md). No existen aún tablas de tickets, PAP, facturación, calidad, personal, usuarios mensuales ni cargas. Esquema: `prisma/schema.prisma`; SQL adicional en `prisma/migrations/*_base_acceso_y_maestros`.

| Tabla | Contenido |
| --- | --- |
| User, Session, Account, Verification, RateLimit | Acceso (Better Auth); `User.role` ADMIN/CONSULTA e `isActive` |
| ClientGroup | Grupo BC: nombre canónico, denominación BC, estado |
| Client | Organización (Zendesk); `groupId` nulo = grupo no asignado; `isInternal` |
| Implementation | Implantación identificada de un Cliente: nombre, clave opcional |
| Product | Catálogo explícito de productos |
| ExternalIdentity | Sistema (BC/Zendesk/Wrike/PAP), tipo, valor original y de búsqueda, destino (grupo, cliente o implantación), vigencia |
| ServiceTerm | Soporte, servidor, complejidad o producto con vigencia en un único ámbito |
| Milestone | Arranque, migración cloud o cambio mayor de versión: fecha, ámbito, nota |
| AuditEvent | Actor, fecha, acción, entidad, resumen y antes/después |

## Reglas garantizadas en la base

- Nombres únicos sin distinguir mayúsculas (grupo; cliente dentro de su grupo; implantación y clave dentro del cliente; producto) y no vacíos.
- Equivalencias: un único destino; sistema, tipo y destino coherentes (BC→grupo, Zendesk→cliente, Wrike/PAP→cliente o implantación); restricción de exclusión (`btree_gist`) que impide solapar vigencias de la misma identidad activa (sistema + tipo + valor de búsqueda), incluso bajo concurrencia. Una equivalencia inactiva no bloquea; reactivarla se revalida.
- ServiceTerm: un único ámbito, valores del catálogo y exclusión de solapamientos por ámbito y dato.
- Sin borrado físico: claves ajenas `RESTRICT`; la aplicación solo desactiva.
- Versión entera en cada maestro: la edición exige la versión leída; si cambió, se rechaza con aviso (`StaleVersionError`).

## Convenciones

**Vigencia** [desde, hasta): «desde» inclusivo, «hasta» exclusivo; extremo nulo = sin límite conocido (inicio nulo = fecha de inicio desconocida, nunca inventada). Una migración OP→CLOUD con fecha efectiva 1/6 deja OP hasta el 31/5 y CLOUD desde el 1/6. Se resuelve en `src/domain/vigencia.ts`. Fechas como `date`, sin zona; instantes en UTC y presentación Europe/Madrid. «Sin informar» = ausencia de tramo en esa fecha, distinto de un valor.

**Valor de búsqueda**: se recorta y colapsan espacios; los nombres se comparan en minúsculas; los IDs se guardan como texto exacto (Zendesk: solo dígitos). No se quitan acentos, puntuación ni palabras.

**Ámbito**: un dato del grupo no se copia a sus Clientes ni el del Cliente a sus implantaciones; la ficha muestra ambos por separado.

**Cambio con fecha efectiva** (`changeTerm`): cierra el tramo vigente en esa fecha y abre el nuevo hasta el siguiente tramo conocido; rechaza fechas que coincidan con el inicio de otro tramo o valores sin cambio; marca como retroactivo (auditoría) si la fecha es anterior a hoy. `addTermPeriod` añade tramos históricos explícitos y `updateTerm` corrige uno existente.

**Auditoría**: cada alta, cambio, desactivación/reactivación, equivalencia, vigencia e hito se registra en la misma transacción que el cambio; un fallo no deja cambios ni eventos. Se guarda el contexto (grupo y cliente) para consultar el historial desde la ficha (solo administradores). No se registran credenciales.
