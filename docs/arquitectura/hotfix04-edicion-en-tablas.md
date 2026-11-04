# HOTFIX-04: edición real en las tablas, guardado con confirmación y reparación de Comparativa

Contrato vigente de la entrega [CSAPP-HOTFIX-04-v1](../../prompts/CSAPP-HOTFIX-04-v1.md). Complementa [HOTFIX-03](hotfix03-gestion-estado-calculos-calidad.md) (tablas de gestión), [matriz de usuarios](usuarios-matriz-csapp02.md) y [enlace automático](hotfix02-enlace-automatico.md). No añade migraciones ni cambia el modelo físico.

## 1. Rutas (causa de «volver a la lista antigua» y corrección)

| Causa demostrada | Corrección |
| --- | --- |
| `src/components/nav.tsx` enlazaba «Administración» a `/administracion/clientes/grupos` (lista «Nombre / Denominación BC / Clientes…»). | El acceso superior apunta a `/administracion/clientes`, el **editor canónico**. |
| Las listas `/grupos` y `/clientes` seguían mostrando tablas de lectura. | Redirigen al editor traduciendo `q`, `status→estado`, `groupId→grupo`, `pending→pendientes`; se ignoran `sort`, `dir`, `page`, `internal` y cualquier parámetro desconocido (`domain/clientes-rutas.ts`; sin bucle). |
| Altas, «Volver», enlaces de Comparativa/Calidad/Análisis y `requirePageAdmin` apuntaban a las listas. | `grupos/nuevo` y `clientes/nuevo` abren borradores en la tabla (`?nuevo=grupo|cliente&grupo=`); «Volver» de las fichas devuelve a la tabla; las fichas se rotulan «Ficha de historial y gestión excepcional». El formulario antiguo de Cliente solo sigue para organizaciones internas (`?interno=1`). |

Las fichas históricas siguen accesibles para consulta, vigencias y ajustes excepcionales, pero no son el recorrido ordinario.

## 2. Patrón común de guardado (Clientes y Usuarios)

1. **Editar solo modifica el borrador local.** Perder el foco, Tab, Enter, cerrar o cancelar el diálogo **no** persisten.
2. **Guardar cambios (n)** llama a la acción de **vista previa**: el servidor ejecuta *exactamente el mismo plan* que el guardado dentro de una transacción que se **deshace** (otra sesión sigue viendo los valores anteriores; no hay auditoría ni versiones nuevas). Devuelve el antes → después, efectos y errores por clave.
3. Confirmación «¿Estás seguro de que deseas guardar estos cambios?» con **Cancelar** (cierra sin escribir y conserva el borrador) y **Sí, guardar**.
4. El guardado aplica **todo el borrador en una sola transacción** (todo o nada), con actor y antes/después auditados. La confirmación corresponde al borrador exacto: el cliente envía el `digest` de la vista previa y el servidor lo recalcula (si no coincide, rechaza y obliga a revisar de nuevo). Un doble clic o reintento con el mismo `operationId` es **idempotente** (la operación queda en `AuditEvent` con `entityType = "EditOperation"`; no hay tabla nueva).
5. Tras guardar, la tabla se limpia y se refresca en la misma pantalla (filtros, año, ámbito y scroll se conservan); un refresco o sondeo no reinicializa borradores.
6. Con borrador pendiente, cambiar filtro/página/año/ámbito o salir pide **Guardar / Descartar / Seguir editando** (`components/edit-kit.tsx`: intercepta enlaces internos en captura, `beforeunload` y los envíos de los filtros). **Guardar** abre la revisión; no guarda por navegar. **Cancelar cambios** pregunta antes de descartar.
7. **Conflictos**: el servidor compara el valor actual con el que el usuario vio (Clientes) o la versión esperada por matriz (Usuarios). Un conflicto se localiza en su celda/fila, **no guarda nada** (sin éxito parcial) y el resto del borrador se conserva; si los datos limpios cambian bajo una edición, se avisa sin perder lo escrito.
8. Sesión y rol Administrador se validan **en servidor** en las dos acciones (`requireAdminActor`) y en el servicio (`authorize ADMIN`). Consulta ve las mismas cifras sin controles y no puede forzar el guardado.

## 3. Clientes: campos, ámbitos y relaciones

Una celda edita un **campo canónico** con clave `g:<id>:name`, `c:<id>:SUPPORT`, `g:<id>:WRIKE`, etc. Un campo compartido que aparece en varias filas (nombre del Grupo, alias del Grupo) es **un solo cambio**; la confirmación indica a cuántas filas visibles afecta. El servidor rechaza el mismo campo dos veces.

| Columna | Qué modifica | Reglas |
| --- | --- | --- |
| A Grupo Cliente | `ClientGroup.name` | Único sin distinguir caja. Se **conservan** las claves BC anteriores y se añade la clave BC del nombre nuevo si es libre (si pertenece a otro Grupo: conflicto, no se reasigna). `bcDenomination` sigue al nombre si coincidía. |
| B Wrike / G PAP | Equivalencias `PROJECT_NAME` del ámbito de la fila (Grupo o Cliente); lo heredado del Grupo se muestra y se edita en su ámbito | Lista de valores. Un alias nuevo asignado a otro destino activo es un **conflicto explícito**. |
| C Id_Zendesk | Equivalencia `ORG_ID` del Cliente | Texto decimal exacto `^\d{1,30}$`: no se convierte a número ni se admite notación científica. Un ID ya usado por otro Cliente no crea un segundo Cliente. |
| D Zendesk | `Client.name` | El ID no cambia: la atribución sigue siendo por ID. |
| E Nivel de Servicio / F Servidor / H Tipo | `ServiceTerm` SUPPORT / HOSTING / COMPLEXITY del Cliente (o del Grupo sin Clientes) | Se **corrige el tramo vigente**; sin tramo se crea uno de inicio desconocido; con historial sin tramo vigente se remite a la ficha. No se aplana la complejidad de proyectos distintos. |
| Adicional | `isActive`, decisiones «No aplica» | Todo pasa por la confirmación. |

**Retirar una clave no borra nada**: se cierra su vigencia hoy (los hechos anteriores conservan su atribución, la confirmación lo dice y cuenta lo afectado en Wrike y tickets Zendesk). Reponer una clave retirada la reabre. Altas: «Nuevo grupo» y «Añadir Cliente/proyecto» crean borradores en la tabla; el Wrike de un Cliente nuevo se suma a las claves del Grupo y el PAP es del Cliente (sin producto cartesiano Wrike×Zendesk×PAP).

**Reenlace automático.** Las escrituras de maestros disparan por trigger el reenlace de HOTFIX-02 (una generación coalescida; no hay un job por celda ni N+1). El banner «Actualizando relaciones» del layout muestra el progreso real y la recuperación en caso de fallo. Los hechos brutos, ganadores y snapshots no cambian; las cantidades se conservan.

## 4. Usuarios contratados: guardado por lote

La matriz conserva su estructura (año/ámbito/estado, una fila por Grupo/Cliente/implantación, doce meses). Cada celda de un año editable es un input numérico. `domain/usuarios.ts › applySteps` (función pura compartida entre el navegador y el servidor) aplica **en orden** los pasos de cada matriz:

- `SET` mes (`null` = **sin informar**, distinto de 0; un valor igual al actual no cambia nada ni reclasifica un dato heredado).
- `APPLY_FROM` («Aplicar desde este mes», sin pisar ajustes explícitos posteriores).
- `COPY` (copia del año anterior solo a meses sin informar, desde la propia tabla).

`applyMatrixBatch` bloquea y versiona **cada matriz una vez por guardado** (no repite el guardado monomes con la misma `expectedVersion`), una fila sin cambios netos no crea cabecera ni versión, «sin informar» elimina la fila del mes dejando el valor anterior en la auditoría, y un conflicto de versión de cualquier fila aborta todo el lote con el error localizado en esa fila. El año editable se resuelve con el reloj del servidor (Europe/Madrid): en 2026, 2025/2026; en 2027, 2026/2027; los demás años son lectura también ante una petición forjada. Procedencia (`INITIAL/COPIED/PROPAGATED/ADJUSTED/ESTIMATED`) solo cambia en los meses realmente editados. Los cambios actualizan exposición, ratios por usuario y exportaciones por la misma lectura coherente existente.

## 5. Comparativa: causa demostrada y reparación

**Defecto 1 – esquema sin migración (demostrado).** Con la ruta de lectura de Comparativa (`getPortfolio → economicsInTx → getSettings`) sobre una base **sin** la migración `20261111090000_hotfix03_bandas_economicas`, Prisma lanza `P2022: The column EconomicSettingsRevision.bandFactors does not exist`. La página mostraba un texto genérico sin registrar la excepción. Ahora `server/analytics/read-failure.ts` clasifica (`SCHEMA`, `CONNECTION`, `UNKNOWN`), **registra en el servidor** un diagnóstico seguro (sin URL, credenciales ni rutas) y ofrece al Administrador, desplegado, el detalle técnico: excepción, SHA de la compilación, migración esperada que falta y migraciones pendientes, y la acción segura (`db:migrar`; nunca reset ni `db push`). No se inventan columnas en código ni se silencia el error. Con el esquema al día y revisiones con `bandFactors = NULL`, Comparativa carga con las bandas por defecto.

**Defecto 2 – lectura concurrente sin la revisión 1 (hallado en el recorrido de navegador, no demostrado en la base de Dennis).** `ensureInitialSettings` ejecutaba un `INSERT … ON CONFLICT DO NOTHING` dentro de la transacción `REPEATABLE READ` de lectura; dos lecturas simultáneas fallaban con `40001 could not serialize access` (Prisma `P2010`), sobre todo con los *prefetch* de Next. La migración inicial siempre crea la revisión 1, así que solo ocurre si la tabla se vació. Se garantiza ahora **antes** de abrir la instantánea (`readSnapshot` y `runEconomics`).

Una celda sin dato o un ratio no calculable afecta a su celda; un fallo real de base mantiene el error claro con **Reintentar**. R/H×jornada, objetivo 550, prorrateo mensual, CUM comparable, Activo/Inactivo/Todos y la provisionalidad no cambian.

## 6. Importadores

Se aceptan las cabeceras legibles **Grupo Cliente, Wrike, Id_Zendesk, Zendesk, Nivel de Servicio, SERVIDOR, PAP, TIPO** (mismas posiciones que el formato de gestión de ocho columnas) además de las técnicas. El archivo es referencia y fuente importable; no se aplica al actualizar. La misma organización con Grupo/servidor distintos conserva la identidad existente y se resuelve editando la celda (o con las decisiones de la precarga); no se crean dos Clientes para un ID.
