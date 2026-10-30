# CSAPP-04-v1 — Wrike, PAP y bugs de producto VFS/VSW

Repositorio único: https://github.com/bateman37/cs-app.
Entrega: CSAPP-04 de diez. DOC-00 sigue fuera del roadmap.
Rama propuesta: feature/CSAPP-04-wrike-pap-bugs.
Archivo obligatorio: prompts/CSAPP-04-v1.md, con este texto íntegro.

## 1. Resultado requerido

Implementa sobre el motor existente cuatro perfiles operativos: wrike, pap, bugs-vfs y bugs-vsw. Dennis podrá cargar el CSV original de Wrike, el XLSX de PAP y cada CSV de bugs por separado, revisar, confirmar y consultar datos, atribuciones y vínculos desde Administración › Cargas.

La dedicación PMO desde 2025 tendrá por fin su fuente Wrike sin sumar también Zendesk. PAP conservará todas sus causas con una identidad única. Los bugs serán Work Items con observaciones y afectaciones explícitas a tickets/clientes; no inferencias por título. Repetición, actualización, reproceso y reversión deben ser reales y verificables.

No construyas todavía finanzas, Comparativa, Análisis Cliente, Pulse Rent, semáforos o Client Health. Mantén las cuatro vistas y Administración; los listados de esta entrega están dentro de Cargas y su detalle. No avances a CSAPP-05 ni despliegues. Las cargas reales de estas cuatro fuentes las hará Dennis; no las ejecutes automáticamente.

## 2. Base comprobada y continuidad

El ayudante ha podido leer por Git documentos y partes relevantes del código, sin ejecutar pruebas de la aplicación. El 30/10/2026, main era 3c08fc0c647088d2b226d1385b95e1daa8142843, merge de PR 4, e incluía 171d63ea3960d53ebdb6226a7b82e12598bef720. El push hasta b7b1883 era anterior al commit documental final. Por tanto la información de PR 4 sin fusionar del informe ya estaba desactualizada al revisar Git.

Verifica otra vez remoto y HEAD al ejecutar. Parte del main actualizado que contenga CSAPP-03, registra el SHA completo y crea una rama propia. El nombre propuesto es orientativo si el entorno designa otra rama, pero la PR debe aislar esta entrega. No modifiques PR anteriores. Si el estado remoto cambió, documenta la base real y conserva las dependencias, sin reconstruir las entregas previas.

Archiva este prompt literal antes de editar código. Respeta trabajo local ajeno; usa un checkout aislado si hace falta. No uses --force ni --force-with-lease, tampoco como intento: comprueba ascendencia y usa push normal o una rama nueva permitida. No reescribas historia para hacer coincidir un nombre de rama.

Conserva stack, versiones, autenticación, permisos, migraciones y datos existentes. No actualices dependencias por novedad ni montes otro motor. Añade migraciones incrementales, sin reset ni limpieza de bases. No declares aceptado por Dennis o probado en Windows lo que solo figura probado en Linux.

## 3. Lectura y reutilización

Leer AGENTS.md, CLAUDE.md, docs/00-index.md, docs/plan/estado.md y CSAPP-04 en el roadmap. Después:

- docs/importaciones/wrike.md, pap.md y bugs-producto.md completos.
- docs/importaciones/proceso-comun.md y docs/plan/precarga-y-pruebas.md.
- docs/producto/maestros.md; diagnóstico y Calidad solo para preservar unidades, causas y ámbitos.
- docs/arquitectura/motor-cargas-contrato.md, lectores-xlsx-csv.md y zendesk-csapp03.md.
- ZDT 11–13 y ZTM 06–08 al final de los contratos Zendesk, más las pruebas pertinentes.

Código ya existente relevante: src/server/uploads/registry.ts y profile.ts; src/server/zendesk/; src/domain/zendesk.ts; identidades y PERSONAL con vigencias; prisma/schema.prisma. Los IDs wrike, pap, bugs-vfs y bugs-vsw ya están reservados en PENDING_SOURCES: habilítalos conservando sus nombres. El registro tendrá seis perfiles operativos; las tres fuentes financieras continúan pendientes.

Reutiliza cola PostgreSQL, trabajador, leases/fencing, staging, procedencias, activación atómica, almacenamiento privado, permisos, REDERIVE y reversión. Reutiliza lectura por bloques y correcciones explícitas donde corresponda, resolviendo las carencias indicadas abajo. No pegues toda la documentación en contexto ni generes catálogos paralelos.

## 4. Revisión acotada de las interpretaciones y correcciones sin ID

Continuar no constituye aceptación de las interpretaciones pendientes. Registra una tabla breve que contraste cada ZDT 11–13 y ZTM 06–08 con el encargo original, comportamiento y prueba. No conviertas por tu cuenta una propuesta en decisión confirmada de Dennis.

Preserva las garantías ya encargadas: revisión distinta de observación, export anterior sin sobrescritura silenciosa, errores contradictorios sin elección por posición, partición de horas conciliable y reproceso sin cambiar la fecha original. El desempate técnico entre observaciones de igual fecha debe seguir explícito y con incertidumbre visible; no acredita el instante real de transición de estado. No reutilices ciegamente una clasificación de ticket a fecha de creación para clasificar horas a fecha del trabajo.

Carencia concreta observada: src/server/zendesk/corrections.ts solo permite decidir una fila ya candidata y exige igualdad de sourceId con typed.id. Sin id no hay candidato ni corrección manual posible. Eso no cubre completamente ZTM 05/CSAPP-03 y no sirve para Wrike, que carece de ID de imputación.

Amplía el mecanismo para que, dentro de un lote listo para revisar, el Administrador pueda seleccionar explícitamente un registro activo de la misma fuente como corregido, incluso sin ID externo. Filtros ayudan a localizarlo; no deciden la relación. Mostrar ambos registros, diferencias y minutos antes/después; exigir confirmación de esa sustitución concreta, controlar versión/concurrencia y auditar. Permitir confirmar otro trabajo o retirar la decisión. No sustituir por parecido, ni generar candidatos masivos para todas las filas sin ID.

El servidor valida fuente, lote, fila, estado, objetivo activo y versión; no acepta un target arbitrario de otra fuente o un registro obsoleto. La activación no suma duración antigua más nueva y revertir restaura lo que corresponda respetando lotes posteriores/compartidos. Cubre la ampliación para Zendesk sin id y para Wrike; conserva el aviso por coincidencia id+contexto ya existente sin imponer unicidad global a ese id.

No sobrecargues ZdTimeEntry.sourceId como discriminador WRIKE/ZENDESK: actualmente significa ID externo del log. No hace falta fusionar físicamente tablas para compartir reglas. Ofrece una consulta/representación común con origen inequívoco, minutos decimales y elegibilidad histórica, sin romper los datos Zendesk.

## 5. Reglas comunes de los nuevos perfiles

Cabeceras por contenido, orden libre y normalización consistente con el motor; faltantes/duplicadas ambiguas se rechazan. Extra de columnas se informa y conserva como procedencia sin inventar su significado. Todos los campos fuente canónicos participan en la huella antes de enriquecer. Archivo/lote, año, intervalo o fecha de extracción no crean un nuevo espacio para volver a contar la misma fila.

Las fuentes pueden contener varios años. No filtres por el actual ni uses sustitución anual de finanzas. Diferencia checksum de archivo, huella de fila y clave de entidad revisable. Una entidad revisada conserva ID e historia; la misma fila repetida conserva procedencias sin otra actividad.

Originales, filas y archivos privados; ninguna ejecución de macros, IQY, HTML o enlaces. No visites Zendesk, SharePoint o DevOps para completar una carga. Datos/fechas válidos sin correspondencia se conservan con aviso y cobertura; no inventes clientes, personas, usuarios, producto o causa para rellenar.

Reutiliza fechas de negocio 1900/1904 y dd/mm donde corresponda. Los CSV de producto aportan fecha/hora sin zona: preserva esa información local y no inventes UTC exacto. Una conversión a instante requiere zona de origen declarada. La extracción observada y su frescura son distintas de creación/cambio/carga. Los campos informativos vacíos no se convierten en ceros o fechas fabricadas.

En PAP y Work Items, separar contenido revisado y observación de presencia. Un export declarado anterior no pisa contenido reciente; reimportar el mismo contenido puede registrar una nueva observación sin otra entidad. REDERIVE conserva la fecha original. Resolver observaciones empatadas con criterio explícito e incertidumbre visible, nunca por posición de fila. Revertir recalcula lo sustentado por lotes restantes sin restaurar una revisión por encima de otra posterior vigente.

## 6. Wrike: CSV original, unidades e identidad

Perfil wrike. Referencia DETALLESOPORTEN3, CSV UTF8 con BOM, coma y seis cabeceras:

| Campo | Significado |
| --- | --- |
| Usuario | Alias/identidad Wrike de PERSONAL |
| Proyecto | Equivalencia de proyecto hacia el ámbito conocido |
| Nombre de la tarea | Texto completo; puede incluir comas, comillas y referencias |
| Ticket Zendesk | ID explícito si está informado |
| Fecha registro | Día de trabajo, dd/mm/yyyy |
| Dedicación (horas) | Horas decimales, no minutos |

Parser CSV real, preservando campos citados y saltos interiores; nunca split por coma. En el archivo inspeccionado las 3546 filas tienen seis campos, incluida la fila 1078. No reproduzcas el paso de abrir/separar/pegar en Excel.

La macro antigua no corresponde a este esquema: aquí E es fecha y F son horas. No dividir Dedicación entre 60. Para la representación común en minutos, multiplicar por 60 con decimal exacto. El CSV usa coma decimal dentro del campo citado: 0,5 horas son 30 minutos. El parseDecimal actual de Zendesk rechaza comas; añade normalización específica de este perfil, no cambies globalmente la interpretación de otras fuentes. Rechaza notaciones ambiguas en lugar de adivinar miles/decimales.

Normaliza puntos de miles solo en Ticket Zendesk y con gramática válida: 216.527 → 216527. Cero o vacío significa sin ticket. No impongas seis dígitos ni elimines puntuación de horas, fechas o tarea para fabricar números. Conserva los valores originales.

Las 73 filas observadas sin usuario, sin fecha y con cero horas son tareas sin imputación: conservar bruto y excluir del hecho de dedicación, con motivo. No inventar fecha/persona. Horas positivas sin fecha válida son error obligatorio. Los conteos observados son evidencia del ejemplo, no cuotas fijas del importador.

Deduplica por los seis campos tipados. No hay ID de log: no uses persona/tarea/proyecto/día como clave única, porque pueden existir imputaciones distintas. Una modificación real utiliza la corrección manual explícita, no una revisión inferida por parecido.

## 7. Wrike: resolución y corte histórico compartido

Resolver Usuario por alias/ID Wrike explícito de PERSONAL, con asignación vigente al día del trabajo. Grupo/Cliente/implantación se obtienen mediante equivalencias de Proyecto y, cuando existe, el ticket. No crear otra tabla de personal PMO ni atribuir por nombres aproximados.

Prioridad de ticket:

1. Campo explícito sintácticamente válido. Si aún no existe en tickets, conservar esa referencia pendiente; no sustituirla por un número del nombre que sí exista.
2. Solo si falta/vale cero: extraer referencias de contexto inequívoco, como URL Zendesk, prefijo ticket/# y un ID inicial delimitado que no sea una fecha/versión. Validar con el catálogo de tickets. Con varios candidatos no elegir el primero ni el mayor.
3. Una referencia inequívoca todavía no cargada se conserva como candidata pendiente, sin afirmar vínculo confirmado. Siempre registrar método y evidencia. No tratar números de versiones, fechas o Bug IDs como tickets por contener dígitos.

Nombre y campo explícito contradictorios se muestran con su prioridad aplicada; el texto no sobrescribe el campo. Si el ticket confirmado y el proyecto señalan clientes/grupos incompatibles, conserva las horas y el conflicto, sin escoger silenciosamente un cliente para sumarlas.

Proyecto puede identificar solo Grupo Cliente BC. Usa ese ámbito: no inventes un Cliente hijo ni repartas horas. Un ticket que identifica Cliente dentro de ese mismo grupo puede completar el desglose. Grupo conocido sin ticket sigue permitiendo dedicación de grupo, pero no causa de ticket probada. Implantación exige una clave real; compartir grupo no la identifica.

Política única, usando fecha del trabajo y pertenencia PMO histórica:

| Situación | Zendesk | Wrike |
| --- | --- | --- |
| Antes de 01/01/2025 | Fuente elegible según contrato | No sustituye el histórico Zendesk |
| Desde 01/01/2025, PMO | Excluido por fuente, conservado | Fuente elegible |
| Desde 01/01/2025, no PMO | Fuente elegible | Fuera del tiempo PMO elegible |
| PMO no conocido en el periodo relevante | No asumir CS | No asumir PMO |

No dedupliques entre sistemas por ticket/persona/día para solucionar el doble conteo: la selección de fuente histórica lo evita. Rol ANA/DEV se desglosa cuando existe; rol desconocido no elimina horas con PMO y ámbito ya conocidos.

No reproduzcas como verdad de Calidad la heurística del libro DEV = incidente Vincle y causa customización si no había ticket. Sin evidencia, causa no clasificada. Con ticket, aplicar causa/servicio/alojamiento a las fechas pertinentes; CLOUD actual no corrige retroactivamente OP. Los modos de conciliación históricos quedan documentados, no activados como hechos confirmados.

## 8. PAP: 29 columnas e ID estable comprobado

Perfil pap, XLSX CARGA PAP. IQY es una consulta y no se ejecuta. Cabeceras A–AC:

| Columna | Cabecera |
| --- | --- |
| A | Fecha de Solicitud |
| B | Title |
| C | Proyecto |
| D | Resultado |
| E | Responsable Técnico |
| F | Project Manager |
| G | Fecha puesta en producción |
| H | Hora |
| I | Duración |
| J | Plataforma |
| K | Tipología |
| L | Changelog |
| M | Urgente |
| N | Versión del remoto |
| O | Tareas Asociadas al CS |
| P | Afectaciones al servicio |
| Q | ¿Requiere formación? |
| R | Tickets asociados |
| S | CAL's asociados |
| T | ¿Notificar a Key Account? |
| U | Key Account |
| V | Seguidores del ticket |
| W | Ticket PAP Asociado |
| X | Causa raíz |
| Y | Workaround |
| Z | Nº de BUG |
| AA | Motivo incidente |
| AB | Tipo de elemento |
| AC | Ruta de acceso |

Todas las cabeceras pertenecen al perfil; los valores informativos pueden faltar. En la muestra hay 123 Fecha de Solicitud vacías: no rechaces esos PAP si su identidad es válida. Fecha puesta en producción determina su ubicación temporal, no Fecha de Solicitud ni una fecha extraída del título. Si no está informada, conservar y mostrar sin fecha de producción, sin inventar una ejecución.

Identidad comprobada en los 5629 registros: Title empieza por ID número: o por número:. Patrón anclado, sin exigir PAP en el texto posterior: ^(?:ID\s+)?([0-9]+)\s*: (sin distinguir mayúsculas, tras trim). Hay dos títulos sin el literal ID y uno sin la palabra PAP tras los dos puntos; no los pierdas. Los 5629 IDs extraídos son distintos en la muestra.

Clave = ámbito estable de la lista/origen PAP + ID extraído, no Title completo. El resto de Title puede cambiar; no es otra intervención. Ruta de acceso aporta procedencia; el ámbito se configura/valida como lista de origen, no se inventa por archivo, año, proyecto o posición. Si no se reconoce la identidad, error claro; no usar un hash del título o el primer número encontrado en cualquier posición como sustituto.

Un mismo ID con cambios crea revisión. Mantén observaciones/orden trazable sin escoger última fila contradictoria o interpretar fecha de producción como updated_at. La ausencia en otra descarga no borra. Preserva datos originales y fechas/resultado, incluidas revisiones y títulos anteriores.

## 9. PAP: causas, relaciones y unidades

Parsea Causa raíz como multiselección; el separador observado es ;#. Conservar tokens originales y normalizados y todas sus pertenencias. Si cualquiera es correctiva, el PAP es correctivo, aunque otra sea evolutiva/mantenimiento. No hardcodees solo las etiquetas antiguas y pierdas un nuevo Correctivo (…); vacío/desconocido se identifica, sin falso no correctivo confirmado.

Mantener Correctivo de origen cliente y desglosarlo, conforme al contrato vigente. Total por PAP distinto, no suma de categorías ni multiplicación por tickets. Un PAP con tres causas y dos tickets sigue siendo una intervención. Tipología, Plataforma y Causa raíz son campos distintos.

Proyecto/alias PAP se resuelve hacia el ámbito real conocido: Grupo Cliente, Cliente o implantación. Un grupo solo no autoriza reparto entre hijos. Conserva relaciones de afectación por tickets como evidencia aparte, sin sobrescribir el contexto del proyecto ni repartir horas inexistentes. Contradicciones de ámbitos se muestran.

Tickets asociados y Ticket PAP Asociado se conservan con roles de relación distintos. Reconoce IDs explícitos, como #123456, listas de IDs con separadores declarados y URLs Zendesk permitidas. No concatenes números ni extraigas cualquier dígito de notas/fechas. Deduplica pares de relación; preserva texto no interpretable y motivo. Las referencias todavía no cargadas pueden resolverse después. CAL's asociados no son tickets Zendesk por contener números.

Nº de BUG conserva su texto. Puede relacionarse explícitamente a un Work Item si su ID y producto/ámbito son inequívocos por URL o metadatos validados. Un número coincidente con IDs VFS y VSW no decide el producto. No deducirlo por que solo una de las fuentes esté cargada. Mantener referencia pendiente si todavía no hay Work Item; no crear un bug ficticio.

Resultado se conserva íntegro como información/filtro: la muestra contiene OK, Rollback, Cancelado, Hotfix e Iniciado. No impongas Resultado=OK ni llames ejecutados con éxito a todos los registros. La decisión analítica sobre resultados se hace explícita cuando corresponda, sin eliminar datos al importar. No sumar Duración PAP a horas Zendesk/Wrike: puede ser el mismo trabajo y la unidad fuente es textual.

## 10. Bugs: dos perfiles CSV independientes

Perfiles bugs-vfs y bugs-vsw, elegidos separadamente por Dennis. UTF8/BOM, coma, parser citado; Created Date y Changed Date donde exista tienen d/M/yyyy HH:mm:ss. No infieras producto por título ni mezcles perfiles por coincidencia de ID.

| Perfil | Cabeceras comprobadas |
| --- | --- |
| VFS | Work Item Type; ID; Title; Created By; Created Date; Assigned To; State; Area Path; Tags; Comment Count; Changed Date; Reported by; Zendesk Ticket ID |
| VSW | ID; Work Item Type; Title; Assigned To; State; Tags; Created By; Created Date; Zendesk Ticket ID; Clients |

El punto y coma de esta tabla separa nombres de columnas, no es el delimitador del archivo. Conserva campos originales y metadatos. Clave estable por producto/ámbito DevOps configurado + Work Item ID. No uses archivo, año, estado, título o Area Path completo mutable como identidad. Cargar VSW no altera VFS; números iguales en ambos productos no se fusionan.

Guardar todos los Work Item Type, pero solo Bug_ participa en defectos. Request o Enhancement con BUG en Title no pasan a ser bugs. Revisar el mismo elemento no añade otro. La creación no cambia cada vez que se recibe; las variaciones reales quedan versionadas con observación y procedencia.

PR confirmado: desarrollo terminado en su rama y pendiente de crear la pull request; no PR ya en revisión ni merge. Done (Ready for Release) no acredita despliegue al cliente. No clasificar por prefijo Done y darlo por cerrado. Mantener State original, categorías conocidas/pendientes y cobertura; un estado nuevo no se convierte en abierto/cerrado por parecido. Changed Date es modificación, no fecha de cierre o despliegue. Estado del Work Item y status de Zendesk son independientes.

## 11. Fotografías, alcance y afectaciones de bugs

Admite vistas de abiertos, por intervalo o más amplias; registrar alcance y extracción declarada. El VSW de referencia contiene 145 elementos, 128 Bug_, de 2025 y 2026. No exijas un solo año ni descartes 2025 por describirse la vista como 2026. VFS de ejemplo contiene 79 Bug_ entre 82 elementos, de varios años. Son evidencia de formatos, no cuotas o precargas.

La ausencia en otra vista no borra, cierra o resuelve el Work Item. Conserva presencia por fotografía y última observación; elementos no observados en la vista actual no son abiertos actuales confirmados por defecto. Una fotografía estrecha no sustituye silenciosamente la cobertura de otra más amplia. Comparar stocks solo en ámbitos compatibles y rotular frescura/cobertura; no reconstruir estados de meses anteriores al primer dato disponible.

Zendesk Ticket ID puede señalar al ticket central interno o a uno de Cliente. Resuelve contra tickets del sistema. VINCLE BUGS no se distribuye a toda la cartera: un vínculo interno no identifica todos los afectados.

Clients VSW puede contener HTML/Markdown y URLs. Extrae IDs solo de URLs de tickets reconocidas para los hosts Zendesk configurados (en la muestra vincle.zendesk.com), como /agent/tickets/ID o /hc/idioma/requests/ID. Deduplica pares Work Item–ticket aunque la URL aparezca varias veces. href=# y menciones a empleados no son tickets. No renderizar HTML activo, ejecutar scripts o abrir enlaces.

Reported by y nombres libres en Clients son contexto o propuestas revisables de alias, no asignaciones automáticas a todas las implantaciones. La revisión explícita de un vínculo se hace en el detalle administrativo y queda auditada, sin otra bandeja principal. No ocultes referencias no resueltas: conservar ID/URL/origen permite completar después.

Un bug puede vincular varios problemas/clientes y un problema varios bugs. Mantén roles/procedencia del vínculo y type real del ticket: un incident asociado no se convierte en problem. No reconstruyas hijos de problemas sin problem_id. Los vínculos no sobrescriben causa raíz.

Deja preparado el dato para el sexto indicador aprobado: problemas externos distintos con vínculo a Bug_ o causa estándar, en unión de IDs; no implementes su semáforo ni sumes bugs+problemas+incidentes. Los bugs únicos del producto y las afectaciones confirmadas son magnitudes distintas con cobertura parcial.

Distingue relaciones observadas en cada revisión de las validadas manualmente. Cambiar un CSV actualiza su evidencia, sin borrar una relación manual por accidente. Los vínculos históricos conservan procedencia y estado de observación; no se presentan todos como reconfirmados por la última fotografía.

## 12. Reproceso, reversión e interfaz

Cada perfil usa el motor común y soporta previsualización, confirmación, resumen, detalle, cancelación previa, reproceso y reversión conforme al estado. Staging no altera activos. Activación, procedencias, estado final y auditoría son atómicos; doble confirmación, reintento y dos trabajadores no duplican efectos. Revertir A respeta filas y revisiones sustentadas por B.

REDERIVE de un lote completado recalcula relaciones con maestros/tickets actuales sin releer el archivo ni mover fechas originales. Cargar tickets o bugs más tarde puede completar Wrike/PAP/afectaciones sin duplicar. Extiende las dependencias de recálculo existentes con un orden de bloqueos/coordinación coherente; no introduzcas carreras, deadlocks o recálculos recursivos de todos los archivos.

Las fichas usan instantáneas indexadas y versiones donde corresponda; si quedaron obsoletas, lo muestran y permiten reprocesar. No vuelvas a crear consultas cuadráticas o derivaciones pesadas por cada fila visible. Resolver por conjuntos/bloques y hacer DISTINCT antes de sumar tras joins múltiples.

Resúmenes y detalle filtrable por motivo:

- Wrike: filas/tareas sin imputación, minutos brutos/duplicados, elegibilidad de fuente, persona, ticket explícito/inferido/pendiente, atribución a grupo/Cliente, conflictos y causa no clasificada. Partición de filas/minutos que reconcilie; flags secundarios no vuelven a sumar.
- PAP: entidades/revisiones, correctivos únicos, pertenencias no aditivas, fechas/resultado, ámbito y referencias pendientes. No convertir categorías o enlaces en más intervenciones.
- Bugs: elementos por tipo, Bug_ distintos por producto/estado, fotografía/alcance, tickets centrales/externos y vínculos pendientes. No igualar número de enlaces al de bugs/clientes.

UI en castellano y permisos en servidor existentes; solo Administrador carga, decide relaciones/correcciones, cancela, reprocesa, revierte o accede a brutos/archivos. Los cuatro perfiles deben funcionar por navegador y worker compilados. Nada de botones sin efecto, importador comodín, datos de ejemplo en la base de trabajo o scripts como única forma de usar la funcionalidad.

## 13. Validación exigida

Pruebas con PostgreSQL, trabajador y navegador reales; migración limpia y sobre CSAPP-03 con datos conservados. Typecheck, lint, build y regresiones pertinentes. Conserva guiones/generadores sintéticos pequeños en Git, sin fuentes reales, archivos grandes o secretos.

| Caso | Resultado requerido |
| --- | --- |
| CSV Wrike | Coma en tarea, comillas escapadas y salto interior preservan seis campos; 0,5 h = 30 min, sin dividir por 60 |
| ID en Wrike | 216.527 normaliza solo el ticket; cero/vacío no inventa ID; explícito no encontrado no se reemplaza por el del nombre |
| Ambigüedad | Varios números/versión/fecha no eligen ticket por posición; Bug #123456 no es ticket solo porque ese número exista en Zendesk; conflicto proyecto–ticket visible |
| Grupo solo | Proyecto que solo identifica grupo conserva ese ámbito sin inventar Cliente |
| Sin imputación | Persona/fecha vacías y cero horas son tarea; horas positivas sin fecha dan error |
| Fuente PMO | PMO dic-2024: Zendesk 2h elegibles, Wrike no sustituye; ene-2025: Zendesk 3h excluidas y Wrike 4h elegibles; total combinado 6h |
| Persona y rol | PMO desconocido no se fuerza; ANA/DEV por vigencia; rol no informado no borra horas PMO conocidas |
| Corrección sin ID | Selección manual en Zendesk sin id y Wrike crea revisión, no dos duraciones; objetivo de otra fuente/inactivo/versión obsoleta se rechaza |
| PAP identidad | ID 42: PAP texto y 42: texto cambiado, mismo ámbito, son el mismo PAP; cambiar fecha/título crea revisión; otra lista con 42 es otra identidad |
| PAP multicausa | Correctivo+evolutivo y varios tickets cuentan un PAP; conservar origen cliente; orden de tokens no duplica |
| Campos PAP | Solicitud vacía válida; periodo por producción; Resultado conservado sin filtro OK; Duración no suma horas |
| Bug explícito PAP | Nº de BUG con producto ambiguo no se asigna por coincidencia; referencia inequívoca se resuelve cuando llega su Work Item |
| VFS/VSW | ID numérico igual sigue separado por producto; cargar/repetir uno no altera el otro; varios años conservados |
| Tipos/estados | Request llamado BUG no cuenta; PR y Ready for Release no acreditan producción; Changed Date no crea cierre |
| URL y texto | Links Zendesk repetidos se deduplican; menciones/HTML no se ejecutan; ticket interno no asigna todos los Clientes |
| Grafo | Un bug–dos problemas y un problema–dos bugs no multiplican PAP, tiempos o problemas al agregar |
| Fotografías | Archivo más estrecho/ausencia no cierra ni borra; cobertura observada y frescura explícitas |
| Relaciones tardías | Fuentes en distinto orden y cambio de alias/ticket permiten REDERIVE sin duplicar ni rejuvenecer observaciones |
| Fallos/reversión | Cancelar antes de activar, doble confirmación, reinicio y reversión respetan atómicos, versiones posteriores y aportaciones compartidas |
| UI/permisos | Circuito completo de los cuatro perfiles en navegador; Consulta/sin sesión no mutan ni leen archivos |

Mide lotes del orden de las fuentes reales (≈3500 Wrike, ≈5600 PAP y ambos CSV de bugs) por el circuito completo. No extrapoles de un parser aislado ni hardcodees esos tamaños. Si modificas el motor/derivación compartida, repite una regresión de Zendesk a escala suficiente para detectar los problemas ya encontrados. No repitas benchmarks ajenos sin motivo ni ejecutes matrices interminables de pruebas de presentación.

Reporta comandos, datos/tamaños, tiempos, memoria donde se mida y resultados reales; no atribuyas al ayudante o a Dennis pruebas que no hicieron. Una espera agotada no se arregla ocultando el caso: diferencia límite del entorno, volumen y fallo funcional, y conserva cobertura significativa. Windows/PowerShell queda pendiente salvo ejecución real.

## 14. Documentación, primer uso y entrega

Actualizar los tres contratos de importación, la ampliación de correcciones, el modelo físico de esta entrega, guía de uso/PowerShell, índice, validación, estado y prompts/README.md. Si una interpretación cambia, registrar decisión y prueba concreta; no declararla aceptada por Dennis por estar implementada. Corregir el estado documental de PR 4 según Git actual.

Incluir el contrato exacto de PAP y su extracción de ID, formatos de referencias admitidos, precisión/unidades, política temporal y alcance de las fotografías. Cada tema conserva propietario; no copiar toda la especificación en otro archivo gigante.

Guía breve para Dennis: migrar sin borrar; arrancar web y trabajador reiniciados; comprobar equivalencias de PERSONAL y proyectos; cargar Wrike original sin macro, PAP XLSX y bugs VFS/VSW por separado; repetir archivos; completar una correspondencia y Reprocesar; revisar minutos/PAP únicos/vínculos y probar reversión en un lote propio. Aclarar que maestros vacíos permiten recepción pero dejan atribución pendiente, no actividad cero.

No precargar las fuentes operativas reales ni pedir a Dennis que haga tus pruebas con ellas. Las fuentes privadas pueden faltar en el entorno: este prompt contiene los esquemas y hay sintéticos suficientes para construir. Las precargas de maestros ya autorizadas solo se realizan si se aportan sus fuentes, sin inventar valores o pisar modificaciones existentes.

Preparar una PR propia, sin fusionar ni desplegar. Título/descripción sobre las funcionalidades resultantes, corrección sin ID, validación y límites. Informar rama, SHA base/final y PR reales, migraciones, comandos exactos para probar, resultados y medidas, estado de las fuentes y cuestiones pendientes. Si una parte esencial no se verificó, no declarar completa su aceptación. Detenerse antes de CSAPP-05.
