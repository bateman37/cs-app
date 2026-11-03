# Precarga de maestros (hojas de carga)

Parte de [CSAPP-HOTFIX-01-v2](../../prompts/CSAPP-HOTFIX-01-v2.md), §8 (Clientes) y §9 (Personal y PMO). Reglas de producto: [Maestros](../producto/maestros.md), MST 03, 05 y 06. Motor común: [Importación y resumen de cargas](proceso-comun.md) y [contrato del motor](../arquitectura/motor-cargas-contrato.md).

Estado: **implementado y probado con PostgreSQL real** (HOTFIX-01; ajustes de HOTFIX-02 al final) (pruebas sintéticas y ensayo del libro real en una base aislada); **no aceptado** por Dennis ni aplicado en su instalación. El libro real nunca está en Git, en fixtures ni en logs nominativos.

## Perfil

| Elemento | Decisión |
| --- | --- |
| Identificador | `precarga-maestros` («Precarga de maestros (hojas de carga)»), solo XLSX |
| Formulario | Solo el archivo. Sin año, hoja, vista ni declaraciones (`metadataFields = []`) |
| Hojas | Las tres hojas **del mismo libro en un solo lote**: CLIENTES, PERSONAL y PERSONAL PMO. Cada hoja se reconoce por sus cabeceras y **posiciones** (no por el nombre de la pestaña ni por el orden de las hojas); el staging guarda la hoja y la fila de origen como procedencia, no como clave |
| Política | `INCORPORATE`: la activación es idempotente (crea lo ausente, reutiliza lo inequívoco, no borra ni recrea) |
| Revertir | **No se ofrece.** Lo creado puede haberse editado, usado en hechos o desactivado después; deshacerlo sería destructivo o falso. Se deshace desactivando en el maestro (Clientes, Grupos, Personal). La auditoría de cada alta lleva el lote |
| Permisos | Solo Administrador sube, decide y consulta la ficha; se revalida en servidor y en el trabajador. **No se crean cuentas de acceso** (Better Auth) a partir de los correos del libro |
| Huella de fila | Todos los campos fuente tipados de la fila (sin número de fila): una fila idéntica se consolida (duplicado exacto del archivo y de otros lotes) |
| Fórmulas | No se ejecutan: se usa el valor almacenado. La columna PMO de PERSONAL es una fórmula simple; se contrasta con el Equipo (ver abajo) |

Una cabecera distinta (columnas movidas, hoja desconocida) rechaza el lote sin escribir nada. Columnas adicionales al final se conservan sin usarse y se anotan.

## CLIENTES

| Columnas | Destino |
| --- | --- |
| A / B | Nombre Wrike y su Grupo BC. Equivalencia `WRIKE · PROJECT_NAME` **a Grupo** |
| C / D / F | ID de organización Zendesk (**texto exacto**, sin notación científica), nombre del Cliente y Grupo BC. Cliente + equivalencia `ZENDESK · ORG_ID`; el Grupo del Cliente es el de F |
| E / H | Dos columnas de nivel de servicio con el mismo encabezado. Coinciden → `SUPPORT` (Gold, Platinum, Silver On Demand, Silver Recurrente); discrepan → atributo pendiente (se carga el Cliente y lo demás) |
| G | Servidor OP/CLOUD → `HOSTING` del Cliente |
| I / J | Organización/proyecto PAP y su Grupo BC. Ver reglas de PAP |
| K | Complejidad Basic/Medium/Enterprise **del proyecto** (implantación), no del Cliente ni de usuarios |

Reglas:

- **Grupo.** Una denominación BC distinta (sin distinguir mayúsculas ni espacios) es un Grupo (`ClientGroup`, con `bcDenomination`) con su equivalencia `BC · GROUP_KEY` (la que usa finanzas). No se inventan códigos ERP. Un Grupo existente con ese nombre o esa equivalencia se reutiliza.
- **Cliente.** Un ID Zendesk con equivalencia activa reutiliza ese Cliente; si no, un Cliente del mismo Grupo con el mismo nombre y sin ID Zendesk lo adopta; si no, se crea. Un Zendesk repetido por varios PAP sigue siendo un Cliente. El mismo ID con nombre o Grupo distintos en otras filas es una contradicción de la fuente: esas filas son error y no se activan (el resto sí).
- **Internos.** Las filas sin ningún Grupo BC cuyo nombre empieza por «VINCLE» o «Test» se cargan como organizaciones internas (`isInternal`) con su ID Zendesk y **sin Grupo inventado**: quedan fuera de la cartera externa.
- **Wrike.** Un alias que identifica **un único Grupo** apunta al Grupo (nunca al primer Cliente: compartir fila no conecta Wrike con un Cliente). Un alias que identifica **varios Grupos** no se asigna por semejanza ni crea identidades activas solapadas: revisión pendiente.
- **PAP.** Un nombre PAP de **un único Cliente** identifica una implantación de ese Cliente (se crea o reutiliza con la equivalencia `PAP · PROJECT_NAME` y su complejidad, y se muestra en la ficha). De **varios Clientes de un mismo Grupo** se atribuye al Grupo (un único destino, sin implantaciones ficticias). De **varios Grupos** (o con un Grupo que no coincide con el del Cliente) no se asigna ni se corrigen grafías: revisión pendiente. No se promete reparto de tickets por implantación si la fuente no lo identifica.
- **Complejidad.** Solo en la implantación; dos proyectos del mismo Cliente con distinto tipo conservan cada uno el suyo. Nunca se toma el primer o último tipo al nivel Cliente.
- **Faltas.** La falta de Wrike, PAP o TIPO no invalida un Cliente identificable. Una fila sin ID Zendesk, con ID no entero o sin nombre es error (no identifica un Cliente).
- **Filas vacías finales** no crean nada ni cuentan como filas.

## PERSONAL y PERSONAL PMO

PERSONAL es la fuente principal; PERSONAL PMO la enriquece y **no añade automáticamente** empleados.

| Fuente | Campo |
| --- | --- |
| PERSONAL A | Alias PAP: correo (`EMAIL`) si lo parece (comprobación laxa, conserva el original) y, si no, nombre |
| PERSONAL B / G | **Un único** alias Zendesk (`NAME`); G repite B. Si no coinciden se carga B y se avisa |
| PERSONAL C / D | Nivel y equipo del catálogo real (N1–N4; CS, CS N2, IT, PMO, PLAT). Un valor ausente o no previsto no se inventa ni se da de alta |
| PERSONAL E | `PMO_MEMBER` 0/1 conocido (distinto de ausente). Se contrasta con el Equipo: PMO=1 solo con equipo PMO; el 0 de una fórmula con Equipo vacío **no** prueba «No PMO» (queda sin informar) |
| PERSONAL F | Alias Wrike (`NAME`) |
| PMO Persona / PERFIL | Enlace por **alias Wrike exacto** a la misma persona y rol ANA/DEV (`PMO_ROLE`) |

- **Identidad exacta.** Una persona del libro reutiliza la persona del maestro que ya tiene alguno de sus alias activos (alias normalizado en espacios y mayúsculas; **no se quitan tildes ni palabras**); si no, la que tiene ese nombre canónico; si no, se crea. Alias de personas distintas del maestro → conflicto, no se carga ni se fusiona. Se conservan los originales.
- **Duplicado exacto** (misma fila repetida): una persona; la procedencia de ambas filas queda en el staging.
- **Variantes** (nombres/correos que solo difieren en tildes o signos): se cargan como personas distintas y se proponen como **revisión**; nunca se fusionan por semejanza.
- **Prueba y marcador.** «test user» y «(en blanco)» no son empleados: filas excluidas con su motivo (no se crean personas activas).
- **Incompletos** (sin equipo o nivel): identidad y alias conocidos sin equipo ni nivel inventados.
- **Roles.** Primero se consolidan los exactos y después se enlazan los roles por alias Wrike. El rol solo se crea si la persona pertenece a PMO (con la misma vigencia inicial que esa pertenencia). Un nombre PMO sin alias exacto no se une solo: se propone el posible nombre extendido (palabras iniciales coincidentes, comparación aproximada **solo para proponer**) y se confirma, o se añade como persona PMO nueva «con lo conocido, sin nivel», o se deja.
- **Interfaz.** Personal (equipo interno), Usuarios contratados (licencias de clientes por mes) y cuentas de acceso (Admin/Consulta) siguen siendo tres cosas distintas.

## Reglas de maestros comunes

- Crear lo ausente; reutilizar identidad inequívoca; **preservar** ediciones posteriores e inactivos: un maestro inactivo no se reactiva ni se duplica, una equivalencia o alias desactivados no se vuelven a crear, y un dato de servicio o tramo de persona que ya existe (de cualquier vigencia) no se toca —el valor distinto se anota como diferencia en el informe—. No se pisa una migración CLOUD ni una pertenencia PMO históricas.
- Los datos nuevos nacen con **vigencia inicial desconocida** (`validFrom = null`, «por revisar»): no acreditan toda la historia. No se usa hoy ni 01-01-2025.
- Vigencias `[desde, hasta)`, solapamientos, versión optimista y auditoría (`recordAudit`, con el lote) igual que en los servicios de Maestros; las restricciones de la base (`*_no_overlap`, claves únicas sin distinguir mayúsculas) siguen siendo la última barrera.
- Un alias activo de otro destino, un nombre ya en uso o un destino inactivo no se resuelven por semejanza: se omiten y quedan en el informe de la ficha.
- Repetir o reordenar la misma fuente no crea entidades nuevas ni pisa cambios posteriores (fila y celda son procedencia, no clave).

## Revisiones y decisiones (en la ficha del lote)

Las revisiones están en la **ficha de la carga** (sección «Precarga de maestros»); no hay bandeja nueva. Cargar lo válido no confirma las correspondencias pendientes.

| Revisión | Opciones |
| --- | --- |
| Soporte o servidor con valores distintos | Adoptar uno de los valores del libro (vigencia inicial desconocida) o dejar pendiente |
| Alias Wrike / nombre PAP de varios Grupos | Asignar a uno de los Grupos candidatos o dejar sin asignar |
| Posibles variantes de una persona | Fusionar (se conserva una; alias activos y tramos pasan a ella; la otra queda inactiva con su historia) o mantener separadas |
| Rol PMO sin persona con alias exacto | Enlazar con el candidato (añade el alias Wrike y el rol), crear persona PMO nueva sin nivel, o dejar |
| Informativas | Atribuciones a Grupo aplicadas, filas excluidas, incompletas, PMO incoherente con Equipo, alias Zendesk distintos |

- Cada decisión guarda **autor, motivo, checksum del archivo y la clave de CONTENIDO** de la revisión (nunca un número de fila) en `MasterLoadDecision`; se aplica al maestro en la misma transacción, con auditoría del lote.
- **Idempotente**: repetir la misma decisión no cambia nada; otra distinta se rechaza (los cambios posteriores se hacen en el maestro). Una revisión que el maestro ya resuelve (por decisión o edición manual) figura «resuelta».
- **Ligadas al checksum**: el mismo archivo subido otra vez muestra la decisión; otro archivo (otro checksum) vuelve a plantear la revisión. Las decisiones solo se toman con la carga completada.

## Actualización de relaciones (HOTFIX-02)

Desde HOTFIX-02 confirmar la carga, editar una equivalencia o decidir una revisión **actualiza solo** todo lo ya cargado (tickets, tiempos Zendesk y Wrike, PAP, vínculos y finanzas) con el trabajador existente, sin límite de lotes y sin releer originales: ver [contrato de enlace automático](../arquitectura/hotfix02-enlace-automatico.md). Administración muestra «Actualizando relaciones» y la acción única «Actualizar relaciones de los datos cargados». La antigua lista «Reproceso necesario» (máximo 100 lotes con «Reprocesar» uno a uno) se retiró.

## Cambios de HOTFIX-02 en el libro

- **Una hoja basta.** El libro con solo CLIENTES se admite; PERSONAL y PERSONAL PMO son opcionales y no se sustituyen ni se vacían por no venir.
- **ID Zendesk contradictorio** (mismo ID con nombres o Grupos distintos): ya **no** convierte las filas en error; no se crea ese Cliente ni se elige uno (aviso en la ficha) y los alias Wrike y PAP de esas filas se cargan.
- **PAP con Grupo J distinto del F del Cliente:** se atribuye al Grupo J, sin implantación.
- **Alias de varios Grupos:** se guardan como candidatos (`AliasCandidate`); solo los resuelve el propio registro (ticket y organización compatibles). Sin evidencia queda el conflicto concreto.
- **Normalización:** NFC + espacios (también no separables) + caja, igual en escritura, búsqueda y SQL.

## Cifras del libro real (ensayo en base aislada, solo conteos)

CLIENTES 74 filas útiles (A1:K77; dos filas finales vacías ignoradas) → 46 denominaciones BC, 63 organizaciones Zendesk (4 internas), 38 alias Wrike (37 asignados al Grupo; 1 con 3 Grupos pendiente), 64 nombres PAP (62 implantaciones; 1 atribuido a Grupo; 1 con 4 Grupos pendiente), 4 discrepancias de soporte pendientes. PERSONAL 75 filas → 1 duplicado exacto, 2 excluidas (prueba y marcador), 72 personas, 3 pares de variantes en revisión, 1 incompleta. PERSONAL PMO 17 roles → 16 enlaces exactos y 1 por revisar (posible nombre extendido). Cuentas de acceso nuevas: 0. Repetir el mismo libro y una versión reordenada: 0 entidades nuevas.

## Estado: confirmado y propuesto

| Confirmado por el encargo | Propuesto (por validar con Dennis) |
| --- | --- |
| Un perfil, tres hojas, solo archivo; reutilizar maestros; sin cuentas; sin tildes para confirmar identidades; fórmulas no ejecutadas; revisiones en la ficha | Wrike siempre a **Grupo** (incluso si un alias solo cubre un Cliente) |
| 74 filas útiles; 46/63/38/64; 75 filas de personal; duplicado exacto; variantes; prueba/marcador; PMO 17/16/1 | Soporte y servidor a nivel **Cliente**; complejidad solo en la implantación |
| Internos sin Grupo inventado; PAP único → implantación; varios Grupos → revisión | Reglas de reconocimiento de internos («VINCLE»/«Test» sin Grupo) y de prueba/marcador («test user», «(en blanco)») |
| Vigencia inicial desconocida; preservar ediciones e inactivos | Catálogo de equipos y niveles dado de alta con los valores reales (CS, CS N2, IT, PMO, PLAT; N1–N4) |
| Resoluciones con autor y motivo, idempotentes | Sin revertir (ver arriba); aviso de reproceso conservador |

## Pruebas y límites

`tests/precarga-maestros.test.ts` (PostgreSQL real, libro **sintético** generado en código con la estructura del real), `tests/precarga-maestros-dominio.test.ts` (reglas puras) y el ensayo manual `tests/ensayo-precarga-maestros.test.ts` (se salta si no se indica `CSAPP_ENSAYO_MAESTROS_XLSX`; exige una base `cs_app…ensayo…_test`; el informe nominativo va fuera del repositorio).

Límites: no se probó la pantalla con navegador compilado ni en Windows; las decisiones solo se toman en lotes completados; no hay deshacer de decisiones (se corrige en el maestro); la fusión de personas traslada alias y tramos pero no reescribe hechos ya atribuidos (para eso, «Reprocesar»); un libro con una hoja desconocida se rechaza entero.
