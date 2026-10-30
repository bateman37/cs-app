# CSAPP-03-v1 — Importadores operativos de tickets y tiempos Zendesk

Repositorio único: https://github.com/bateman37/cs-app.
Entrega: CSAPP-03 de diez. CSAPP-DOC-00 permanece fuera del roadmap.
Rama propuesta: feature/CSAPP-03-zendesk-tickets-y-tiempos.
Archivo obligatorio: prompts/CSAPP-03-v1.md, con este texto íntegro.

## 1. Resultado visible y alcance

Implementa los dos primeros importadores operativos sobre el motor de CSAPP-02: Tickets Zendesk y Tiempos Zendesk. Debo poder subir cada XLSX desde Administración › Cargas, validar, revisar, confirmar y consultar lo importado con sus relaciones y motivos de exclusión. Repetir archivos no duplica entidades ni horas; cambiar un ticket crea una revisión; completar maestros o cargar fuentes en otro orden permite resolver lo pendiente.

No basta que el lector funcione desde un script: upload web, trabajador, staging, activación y consultas deben funcionar de extremo a extremo. No precargues los archivos reales: Dennis hará esas cargas cuando estén los importadores. Usa sintéticos en test.

No implementes todavía Wrike, PAP, bugs, finanzas, dashboards, semáforos o pesos. Las cuatro vistas de negocio siguen donde están; el detalle de datos cargados pertenece a Administración, no a una quinta vista principal. No avances a CSAPP-04 ni despliegues.

## 2. Continuidad real y controles de partida

El informe recibido sitúa CSAPP-02 en PR https://github.com/bateman37/cs-app/pull/3, abierta, rama claude/new-session-omvsmd; base d0a58f3a82633cf5a88ccde14ca2d593b45f51b0 y final 43bc2fda4bf7e5ee8ef0f14b7cb3565a2281d10a. Son referencias del informe, no una auditoría independiente. Verifica remoto, estado, SHA y código actuales. Archiva este prompt literal antes de modificar código y respeta cambios ajenos.

Si PR 3 está fusionada, parte del main actualizado. Si sigue abierta, crea una rama propia desde su HEAD actual y una PR dependiente con ella como base, dejando el diff de esta entrega aislado. Respeta restricciones de rama del entorno, pero no añadas CSAPP-03 a la PR 3 abierta por comodidad. No fusiones, cierres ni reescribas PR 3; no hagas force-push. Si la publicación está impedida, conserva un checkout/rama aislado y concreta ese impedimento.

Reutiliza stack, versiones, autenticación, permisos, auditoría, vigencias y motor existentes. No actualices dependencias por defecto ni crees un segundo sistema de cargas. Conserva migraciones 20261029200318_base_acceso_y_maestros y 20261029220244_personal_usuarios_cargas; añade migraciones incrementales sin reset ni borrado. No alteres maestros o usuarios introducidos por Dennis.

El informe declara 144 pruebas PostgreSQL y 78 de navegador en Linux; no demuestra aceptación manual ni Windows probado. Inspecciona las pruebas versionadas y preserva las garantías. Las bases de test deben estar explícitamente aisladas; un sufijo o prefijo de nombre no autoriza tocar cualquier base de trabajo.

## 3. Lectura selectiva

Leer AGENTS.md, CLAUDE.md, docs/00-index.md, docs/plan/estado.md y el apartado CSAPP-03 del roadmap. Después:

- docs/importaciones/zendesk-tickets.md y zendesk-tiempo.md completos.
- docs/importaciones/proceso-comun.md.
- docs/producto/maestros.md, para identidades, grupos, personal y vigencias.
- docs/producto/diagnostico-origen.md y backlog-antiguedad.md, solo para conservar correctamente dimensiones y observaciones; no construir sus pantallas.
- docs/arquitectura/modelo.md, propuesta.md y contratos técnicos del motor de CSAPP-02 localizados desde el índice.
- docs/plan/precarga-y-pruebas.md y DEC-003 de v0.4.
- docs/validacion/csapp-02.md y docs/plan/guia-powershell-csapp02.md si siguen siendo las rutas vigentes.

La evidencia fuentes-v04 contiene el perfil de tickets vigente. Las versiones anteriores de tickets son históricas, no alternativas aceptadas. No releas toda la conversación ni todos los archivos históricos para sustituir los contratos.

## 4. Validación común de los XLSX

Registra dos perfiles operativos identificables y versionados en el registro existente. Valida contenido y cabeceras, no nombre de archivo. El orden de columnas puede cambiar; normalización limitada de espacios/Unicode de cabeceras, sin confundir campos. Detecta cabeceras duplicadas o ambiguas. Si hay varias hojas compatibles, exige selección explícita antes de preparar; no elijas una arbitrariamente.

Cabecera obligatoria y valor desconocido son problemas diferentes. Un formato sin columnas obligatorias se rechaza sin tocar activos. Filas con ID principal, fecha o duración ilegibles se informan con fila/campo/motivo y no activan datos inválidos; mientras queden errores obligatorios sin resolver el lote no se confirma. Una organización, persona o ticket todavía sin equivalencia son avisos de atribución, no errores de estructura que bloqueen todo el archivo.

Acepta columnas adicionales informándolas; no las incorpores silenciosamente a fórmulas o identidad del perfil. Los campos fuente canónicos de cada tabla son los enumerados abajo. Guarda originales, hoja/fila, esquema y lote. No ejecutes fórmulas, macros, IQY o contenido de texto. No conviertas celdas vacías en números o identificadores inventados.

Los archivos pueden abarcar varios años. Conserva todos los registros incluidos, sin filtrar automáticamente por el año en curso ni exigir un año único como en Finanzas. Un intervalo declarado describe cobertura; no es una orden de borrar o limitar los datos del XLSX.

IDs exactos, sin notación científica destructiva o conversión a flotantes. Fechas Excel respetando el sistema 1900/1904 del libro y fechas de texto de formatos explícitos del perfil. No interpretes dd/mm como mm/dd ni desplaces un día por UTC. El día de trabajo es una fecha de negocio; presentar en Europe/Madrid no transforma su significado.

## 5. Tickets: único esquema vigente

Referencia: DATA ZENDESK TICKET_TAG_CREATED_TYPE_STATUS.xlsx. Las ocho cabeceras son obligatorias:

| Campo | Semántica |
| --- | --- |
| ticket_id | Identidad estable del ticket |
| organization_id | Organización Zendesk; puede no estar informada o no existir aún en el maestro |
| Entorno y Tipología | Dimensión de entorno/tema, distinta del tipo nativo |
| CausaRaiz(Agr) | Causa raíz registrada; conservar el texto fuente |
| tags | Array JSON de strings observado en la fuente |
| fecha_creación | Creación; el export inspeccionado aporta fecha Excel sin hora |
| type | Tipo nativo del ticket |
| status | Estado observado |

No admitas como perfiles alternativos los antiguos exports de cuatro, cinco o siete campos. No exijas descripción, subject, problem_id, updated_at, fecha de resolución o cierre: no existen. No clasifiques bugs por una palabra en una descripción inexistente.

ticket_id, creación, type y status requieren contenido válido/no vacío y tags un array válido, incluido [] si no hay tags. organization_id puede estar vacío; entorno y causa vacíos se conservan como sin informar. No exijas que una organización o causa esté ya catalogada para conservar el ticket.

Type conocido: incident, problem, task, question. Status conocido: new, open, pending, hold, solved, closed. Conserva valor fuente y clasificación. Un token nuevo/desconocido se informa como no clasificado, sin convertirlo en incident, open o cero; no equivale a una cabecera ausente. Un campo obligatorio vacío no es ese mismo caso.

Parsea tags como array JSON: sin split por coma o búsqueda de subcadenas. JSON malformado no se reemplaza por []. Conserva los tags desconocidos; para derivar usa un conjunto de elementos completos. Cambiar solo el orden o repetir un tag no crea más tickets o escalados. El bruto conserva la representación recibida; la comparación funcional de tags usa el conjunto.

## 6. Tickets: identidad, observaciones y revisiones

Un ticket_id es una entidad, aunque cambien causa, organización, estado o tags. Filas idénticas se deduplican y conservan procedencias. Datos funcionalmente iguales no crean otra revisión ficticia. Una variación real crea revisión con diferencias y lote. Dos filas contradictorias del mismo ticket dentro del mismo archivo no se resuelven escogiendo la última: muestra el conflicto y no actives una elección arbitraria.

Separa revisión de contenido y observación. Una nueva extracción que vuelve a observar el mismo ticket sin cambios puede añadir evidencia de presencia/estado sin materializar otro ticket ni otra actividad. El checksum o la huella ya conocida no deben impedir registrar una observación válida con su fecha y cobertura. Reprocesar un lote, en cambio, conserva su observación original: no rejuvenece un estado antiguo.

La carga permite registrar extracción declarada y guarda recepción/importación aparte. Si no se conoce extracción, registra observación recibida y advierte frescura desconocida; no deduzcas extracción de creación, nombre o fecha del archivo. No afirmes que el estado era ese en cualquier fecha entre dos observaciones.

Una extracción declarada anterior no sobrescribe silenciosamente la observación vigente más reciente. Conserva el histórico y muestra cómo se resolverá la vigencia en la previsualización. Si no puede determinarse el orden, registra el criterio explícito y la incertidumbre; nada de desempate por posición de fila. Reprocesar un lote viejo no revierte el estado de uno nuevo.

La ausencia en el siguiente archivo no elimina ni resuelve un ticket. Mantén todos los tickets válidos, con o sin horas. Al revertir un lote se recalcula qué observaciones/revisiones siguen sustentadas por otros lotes, sin eliminar datos ajenos. No inventes cierres mensuales o fecha de resolución a partir de status.

## 7. Vínculos y campos derivados de tickets

Resuelve organization_id mediante las equivalencias existentes hacia Cliente y Grupo Cliente. No crees clientes automáticamente por el nombre ni mezcles organizaciones que comparten grupo BC. Si no hay organización/equivalencia, conserva el ticket y su bruto y muestra cobertura pendiente en el lote. El Cliente conocido sin Grupo BC sigue identificado como Cliente; solo su agrupación económica queda pendiente.

Organizaciones internas: usa el indicador del maestro, incluidas VINCLE, VINCLE BUGS, VINCLE INFRAESTRUCTURAS y pruebas cuando estén registradas. No clasifiques VINCLE BUGS como cliente externo solo por tener otro nombre. No generes esas entidades reales como semillas sin fuente.

Clasificación histórica y preparación del diagnóstico, separadas de type/status:

- Admin delegada: el libro busca la cadena delegada, sin distinción de mayúsculas, en Entorno y Tipología. Implementa ese indicador trazable. Si el campo falta, queda desconocido. Este flag no autoriza llamar SOPORTE a todo lo restante ni inventar OTROS.
- Incidente Vincle histórico: causas exactas incidente_configuración_plataforma, incidente_customización_plataforma, incidente_estándar_plataforma e incidente_integración/procesos. Añade incidente_infraestructura cuando el alojamiento vigente sea CLOUD. En OP no se considera infraestructura SaaS; si no se conoce alojamiento aplicable, mostrar clasificación pendiente.
- Para el ticket por creación usa su fecha de referencia; al clasificar dedicación usa la fecha del trabajo y la vigencia del servicio. No apliques CLOUD actual a todos los años anteriores.
- Conserva aparte causa raíz, entorno y tipo. Sistemas del Cliente y Uso Indebido permanecen en los datos y diagnóstico; no son filas a eliminar. Causa sin informar no se fuerza a una familia.

Los tags exactos derivados son:

| Tag | Destino |
| --- | --- |
| team_n2 | CS N2 |
| team_n3_pmo | PMO N3 |
| team_it | IT N3 |
| team_plataforma o team_plataformavfs | VFS N4 |
| team_plataformaarq | Arquitectura VFS N4 |
| team_plataformavsw | VSW N4 |

Un ticket con PMO e IT cuenta una vez en la unión N3 y puede aparecer en ambos desgloses. El mes disponible es creación con tags conocidos a la extracción; no hay fecha de evento de escalado. No atribuyas producto del Cliente únicamente por el destino del tag.

Deja disponibles campos/servicios de datos para Calidad futura, sin construir sus KPIs. La afectación estándar por causa ya puede identificarse; los vínculos a Work Items de producto llegarán en 04. No crees un número de bugs a partir del número de tickets.

## 8. Tiempos: once campos y duración correcta

Referencia: DATA ZENDESK TIME.xlsx, columnas A–K originales:

| Campo | Uso |
| --- | --- |
| ticket_id | Ticket del trabajo, no identidad de log |
| user_id | Identidad Zendesk de la persona |
| user_name | Nombre fuente/alias secundario revisado |
| date | Fecha de trabajo |
| hour | Hora del registro, no duración |
| logged_hours | Componente de horas |
| logged_minutes | Componente de minutos |
| Día de la semana | Etiqueta fuente conservada |
| Segmentador app time | Etiqueta fuente conservada |
| id | Campo fuente opcional en valor; no clave global fiable |
| type | Canal/tipo del registro de tiempo, distinto de type del ticket |

Las once cabeceras son obligatorias, aunque id esté vacío. Las columnas calculadas del libro posterior a K no son entrada. Conserva los once valores para huella y auditoría; no recalcules etiquetas fuente antes de compararlas.

ticket_id, date y componentes de duración deben poder tiparse. La falta de user_id/alias útil es un problema de atribución, sin inventar persona; las etiquetas auxiliares o la hora sin informar no se convierten en duración ni en identidad. Preserva esos vacíos y avisa donde afecten cobertura. id vacío no es error.

Duración en horas = logged_hours + logged_minutes / 60. Hour se conserva como hora del día aunque Excel lo guarde como fracción; nunca se suma. Ambos componentes deben ser numéricos válidos; cero es válido y no equivale a vacío. Datos negativos o ilegibles no se convierten en positivos/cero ni se activan como ajustes sin una regla aprobada.

Conserva precisión de los componentes y evita redondear cada fila a dos decimales. Puede almacenarse una duración base decimal en minutos y convertir al agregar; no acumules floats ni 0,08 como representación definitiva de cinco minutos. Pruebas: 1 h + 30 min = 1,5 h; 0 h + 5 min = 1/12 h; doce registros de cinco minutos suman una hora; hour=08:25 no añade 8,416 horas.

Resolver persona por user_id con equivalencia validada; el nombre solo es alternativa por alias explícito y vigente, nunca parecido de texto. El ID reconocido no se reasigna a otra persona por el nombre visible; una contradicción se muestra con procedencia y criterio aplicado. No crees PERSONAL automáticamente. Su nivel, equipo y PMO provienen del maestro vigente a la fecha del trabajo, no del canal type o de un tag del ticket.

Resolver ticket y organización/Cliente desde los datos de tickets. Sin ticket conocido, persona o Cliente necesarios para atribución, conserva el registro y su motivo y no lo sumes a un Cliente inventado. Si solo falta Grupo BC o producto, no pierdas la atribución válida al Cliente; informa la cobertura de esos desgloses. Una implantación solo se asigna cuando existe clave real; no repartas entre varias por pertenecer al mismo grupo.

## 9. Corte histórico PMO

| Fecha del trabajo | Pertenencia vigente | Elegibilidad de Zendesk |
| --- | --- | --- |
| Hasta 31/12/2024 | Cualquier equipo | Fuente permitida; atribución según relaciones disponibles |
| Desde 01/01/2025 | PMO | Excluida por fuente: corresponde Wrike |
| Desde 01/01/2025 | No PMO | Fuente permitida |
| Desde 01/01/2025 | PMO desconocido | Elegibilidad pendiente; no asumir que es CS |

La regla usa fecha del trabajo y asignación histórica de PERSONAL, no fecha de carga, estado actual o nivel N3/N4. No excluyas IT/Plataforma por ser niveles altos si no pertenecen a PMO. Mantén las filas PMO excluidas y sus horas como trazabilidad, sin borrarlas.

Antes de 2025, que falte la persona sigue impidiendo desglosar/atribuir donde sea necesario, pero no significa que la fuente Zendesk esté prohibida. Distingue elegibilidad de fuente y atribución. Si la pertenencia histórica es desconocida, no inventes una trayectoria laboral para completar el informe.

En 03 todavía no hay importador Wrike: no rellenes sus horas con ceros confirmados ni fabriques una sustitución. El resumen explica que las horas PMO posteriores al corte no se toman de Zendesk. Las reglas deben ser reutilizables por el importador de 04.

## 10. Identidad de tiempos, duplicados y correcciones

La identidad de deduplicación en este perfil es la huella de los once campos fuente tipados, según el motor común. No incluye lote, posición o archivo ni los enriquecimientos derivados. Misma fila repetida dentro o entre archivos se materializa una vez y conserva todas sus procedencias. Varios tiempos distintos del mismo ticket/persona/día son trabajos válidos distintos.

El ámbito de deduplicación debe ser estable para la fuente Zendesk: no uses intervalo exportado, año elegido, organización resuelta o fecha de extracción como un nuevo espacio que vuelva a contar una fila ya importada. La misma fila en un export enero–junio y otro mayo–octubre se deduplica en el solapamiento.

La muestra inspeccionada tiene 247140 filas, 183 repeticiones exactas y 58372 id vacíos. Entre los id no vacíos hay uno reutilizado para registros con distinto ticket, persona, fecha y duración. Son evidencia del perfil, no cuotas del importador.

Por tanto id no tiene restricción única global ni se usa por sí solo para descartar/reemplazar. Dos filas con ese id pero distintos trabajos se conservan como filas distintas; la anomalía del campo puede informarse sin bloquear la carga o eliminar horas por conjetura.

Una corrección real sin ID estable no puede identificarse con seguridad solo por parecido. No reemplaces automáticamente por coincidencia ticket/persona/día, ni generes una bandeja masiva de supuestos duplicados. Permite una decisión explícita dentro del lote para vincular una fila nueva con un registro concreto como corrección, o confirmar que es otro trabajo, mostrando antes/después y horas afectadas.

Una posible corrección con evidencia concreta, como mismo id y mismo contexto de trabajo pero duración distinta, se muestra como advertencia, no como sustitución automática. La decisión queda auditada. Si una fila está expresamente en conflicto de corrección sin resolver, conserva su bruto y no añadas actividad confirmada por defecto; el resto válido puede activarse con ese alcance explicado. No sometas a revisión los 58372 id vacíos por el mero hecho de estar vacíos.

Una sustitución explícita crea una revisión del registro interno y conserva bruto/procedencias; no suma duración antigua más nueva ni borra lotes ajenos. La guía explica el límite: no se puede prometer detección automática de todas las correcciones sin identidad estable. No elimines registros ausentes de otro export ni trates los tiempos como un snapshot financiero anual.

## 11. Relaciones tardías, reproceso y reversión

Admite cargar tickets antes o después de tiempos. Un archivo estructuralmente válido puede incorporarse aunque los maestros estén vacíos, con datos sin atribución y resumen visible. No es un defecto de Calidad ni obliga a resolver todas las identidades antes de continuar.

Al llegar tickets, equivalencias de clientes/personas o vigencias aplicables, permite resolver y recalcular los registros afectados mediante trabajo de reproceso y la acción del lote existente. No pidas editar el XLSX ni volver a introducir las horas. La llegada de tickets debe poder enriquecer tiempos que ya estaban; la acción Reprocesar también debe funcionar con maestros actualizados.

El reproceso no duplica hechos, no cambia la fecha de trabajo o de observación y no convierte un lote antiguo en una extracción reciente. Cambiar un ticket puede modificar causa, organización o clasificación de sus tiempos vinculados: actualiza lo derivado con versión y trazabilidad, sin reingestar el log. No sobrescribas observaciones nuevas con el reproceso de las viejas.

Activación y reversión usan el motor existente, con integridad de datos de dominio y procedencia. Revertir un lote compartido no elimina filas sustentadas por otro activo. Revertir tickets no borra tiempos de otros lotes: actualiza su atribución/cobertura según las observaciones aún válidas. No restaures una revisión antigua por encima de otra posterior todavía vigente.

Mantén atómicas activación, estado final y auditoría; fallos y reintentos no dejan efectos parciales ni dobles. Usa migraciones e índices adecuados a ticket_id, fechas, persona, organización y claves de procedencia. Resuelve relaciones por bloques/cachés acotadas en lugar de una consulta completa por cada fila.

## 12. Panel operativo y resúmenes verificables

Habilita únicamente Tickets Zendesk y Tiempos Zendesk en Administración › Cargas. Mantén los otros perfiles operativos pendientes. Respeta permisos actuales: Cargas, archivos y acciones solo para Administrador, también por API, descarga o Server Action directa.

Ficha de lote con perfil/versión, archivo, extracción declarada/recepción, progreso persistente, previsualización paginada, validaciones, resumen final y acciones válidas. Permite consultar las filas/tickets importados dentro de esa ficha y abrir el detalle necesario, sin una nueva vista de negocio o bandeja independiente.

Tickets: recibidos, duplicados exactos, nuevos, revisados, sin cambios, observaciones, organizaciones pendientes, internos/externos y clasificación incompleta. Diferencia tickets distintos de observaciones y de filas; un cambio de estado no es un ticket nuevo.

Tiempos: filas y horas recibidas, duplicadas, materializadas, atribuibles, excluidas por PMO y pendientes de atribución/eligibilidad con motivos. Las cifras deben reconciliar. Define una partición contable sin doble suma, con un motivo principal por fila y flags secundarios cuando una fila tenga varios problemas. No sumes varias veces sus horas por faltar persona y ticket a la vez. Las clasificaciones de servicio/equipo son desgloses, no más horas.

Permite filtrar los motivos en el detalle y llegar a la fila/lote fuente. Un dato no atribuible se conserva y se distingue de un cero. Los brutos no se cambian al completar un maestro. Los mensajes de UI explican qué ocurrió y qué acción se puede hacer, sin SQL, trazas o credenciales.

## 13. Cerrar las pruebas de uso y volumen pendientes

En CSAPP-02 se midió CSV completo de un millón de filas, pero el XLSX de 500000 solo pasó por el lector aislado. No uses esa cifra como benchmark del motor XLSX. Tampoco se probó subida grande por navegador ni los botones Reprocesar, Cancelar y Revertir en el recorrido.

Añade pruebas de navegador versionadas del circuito real de ambos perfiles: selección, subida de archivo, validación, previsualización, confirmación, progreso del trabajador y consulta del resultado. Cubre las tres acciones pendientes con sus efectos, no solo que aparezcan sus botones. Cancelar debe probarse antes de activación; no inventes una cancelación a mitad de transacción.

Prueba XLSX por el motor completo y subida web con un sintético de tamaño representativo del origen: orden de 250000 tiempos y 114000 tickets. Puedes generar archivos por streaming; no los subas a Git. Registra filas, bytes comprimidos/descomprimidos cuando se midan, límites configurados, tiempos de recepción/preparación/activación y memoria máxima. La prueba de carga debe superar tamaños triviales que oculten límites HTTP.

Memoria acotada, servidor navegable, progreso recuperable, archivos privados persistentes y trabajador de build/start local. Reinicia/mata y recupera durante procesamiento con estos perfiles operativos, sin duplicados. Conservar las garantías de leases/reclamación de 02. No hace falta repetir benchmarks ajenos sin cambios que lo justifiquen; sí demostrar la nueva ruta XLSX y su activación.

Si límites o entorno impiden la medición completa, informa exactamente lo probado y lo que falta; no declares verificado el circuito real grande. Windows/PowerShell continúa pendiente hasta ejecutarlo allí, aunque la guía sea correcta. El despliegue final permanece en su entrega.

## 14. Casos de aceptación mínimos

Además de regresiones relevantes de 01/02, prueba con PostgreSQL y worker reales:

| Caso | Resultado exigido |
| --- | --- |
| Perfil de tickets antiguo | Sin status o sin otra cabecera obligatoria se rechaza y conserva activos |
| Fecha/ID | Orden de columnas variable, ID exacto y fechas 1900/1904 y dd/mm sin desplazamiento |
| Ticket sin horas | Persiste para Calidad; no necesita join con tiempos |
| Revisión | Mismo ticket_id pasa open a solved sin crear otro ticket; no inventa solved_at |
| Observación | Nueva extracción sin cambio de contenido registra presencia sin duplicar actividad |
| Export viejo | No pisa estado reciente; reproceso conserva observación original |
| Ausencia | Ticket que falta en otro export no se elimina ni se cierra |
| Tags | Array y conjunto correcto; PMO+IT una unidad N3; subcadena parecida no cuenta |
| Causas | Sistemas del Cliente/Uso Indebido conservados; entorno y causa separados |
| Infraestructura | OP y CLOUD por fecha; alojamiento histórico desconocido no se inventa |
| Duración | 1h30m=1,5h; doce registros de cinco minutos=1h; hour no suma duración |
| Sin id | Tiempo válido con id vacío carga; dos filas distintas mismo ticket/persona/día suman ambas |
| id reutilizado | Mismo id en trabajos distintos no descarta uno ni impone unicidad global |
| Duplicado | Misma fila en dos lotes computa una vez y conserva ambas procedencias |
| Corrección explícita | Sustituir duración conserva revisión y no suma ambas; no hay revisión automática por parecido |
| Corte PMO | 2h Zendesk PMO diciembre 2024 son permitidas; 3h enero 2025 quedan excluidas |
| Otros equipos | IT/Plataforma no PMO desde 2025 siguen elegibles; PMO desconocido queda explicado |
| Orden de cargas | Tiempos antes que tickets se resuelven después sin recrear/doblar tiempos |
| Maestros | Alias o grupo completado permite reprocesar; Cliente sin grupo no pierde su identidad |
| Reversión | Respeta filas compartidas y revisiones posteriores; no borra tiempos de otro lote |
| Fallos/concurrencia | Doble confirmación/dos workers/crash no duplican ni dejan activación parcial |
| Browser y permisos | Recorrido de ambos perfiles y acciones; Consulta/sin sesión no leen archivos ni mutan |

Conserva comandos y generadores sintéticos en el repositorio, sin datos privados ni fixtures grandes. No añadas tests que solo reproduzcan la implementación; verifica efectos de dominio, estados y conciliación con resultados conocidos. No declares una prueba ejecutada por el mero hecho de haberla definido.

## 15. Guía para Dennis, documentación y PR

Actualiza contratos de tickets/tiempos, decisiones técnicas nuevas, índice si corresponde, validación de CSAPP-03, guía PowerShell, estado y prompts/README.md. Cada tema conserva su documento propietario; no pegues toda la especificación en otro archivo gigante. Registra diferencias justificadas con el Excel, especialmente la ampliación CLOUD y las correcciones sin ID.

Guía breve para el primer uso real:

1. Comprobar/crear equivalencias de Clientes y PERSONAL cuando se disponga de sus maestros, sin inventarlos.
2. Arrancar web y trabajador con los comandos reales y almacenamiento privado configurado.
3. Subir el XLSX canónico de tickets, revisar esquema/observación/cobertura y confirmar.
4. Subir tiempos, revisar horas y exclusiones PMO/relaciones y confirmar.
5. Repetir ambos para verificar que no duplican; completar una correspondencia y reprocesar su lote.
6. Consultar detalle y, sobre un lote de prueba propio, comprobar cancelación previa y reversión disponible sin borrar datos ajenos.

La guía explica que los datos pueden recibirse con maestros vacíos y entonces no estarán atribuidos; no se muestran como horas cero de clientes. También explica que la parte PMO posterior a 2025 vendrá de Wrike en 04 y que las vistas analíticas aún no están implementadas.

No cargues archivos operativos reales en la base de trabajo de Dennis ni los copies a Git para validar. Si no están las fuentes privadas en el entorno, las cabeceras/contratos y sintéticos bastan para construir; el primer import real lo hará Dennis. No uses esa ausencia para omitir los tests de formato y volumen.

Entregar migraciones aplicables a una instalación limpia y sobre CSAPP-02 con datos conservados; comandos exactos para migrar sin borrar, build, web, worker, tests y navegador. Reporta Linux y Windows por separado. No conviertas el nombre de base o un script de test en permiso para limpiar la base de trabajo.

Prepara commit y PR propia sin merge, indicando base/dependencia y validación real. Si no puedes publicarla, conserva el trabajo y describe el impedimento. Termina con rama, SHA base/final y PR reales; funcionalidades disponibles; migraciones; pruebas/medidas; conciliaciones verificadas; limitaciones y pasos para Dennis. No atribuyas una auditoría al ayudante o una aceptación manual a Dennis. Después detente antes de CSAPP-04.

## Referencia técnica de fechas

Microsoft, sistemas de fechas Excel: https://support.microsoft.com/en-us/excel/date-systems-in-excel

Para lector, motor, ORM y framework utiliza documentación de las versiones ya instaladas y registra referencias pertinentes cuando haya una decisión nueva; no actualices dependencias por copiar un ejemplo de otra versión.
