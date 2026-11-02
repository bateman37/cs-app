# CSAPP-08-v1 — Calidad, Client Health, diagnóstico y backlog

## 1. Encargo y base real

Trabaja exclusivamente en `bateman37/cs-app`. Implementa **CSAPP-08 completa**, octava de las diez entregas. Archiva este prompt literal, sin resumirlo ni corregirlo, en `prompts/CSAPP-08-v1.md` antes de cambiar aplicación, migraciones o pruebas, y actualiza su índice. Las decisiones técnicas y discrepancias se documentan aparte.

Completa **Calidad**: matriz mensual de Client Health, seis indicadores y resultado global explicables, Grupo Cliente/Cliente, diagnóstico por origen, backlog observado y antigüedad, evolución, detalles y CSV. Integra los resultados en Análisis Cliente sin otro motor. Mantén exactamente Comparativa, Análisis Cliente, Pulse Rent, Calidad y Administración. No crees una quinta vista de negocio ni un séptimo indicador. No avances a CSAPP-09.

Git comprobado el **02/11/2026**:

| Referencia | Estado |
| --- | --- |
| `main` `f71b5b7283ab1081802cc6256899a02f70460a74` | Incluye CSAPP-05, todavía no 06/07 |
| Cabeza de PR 8 `bd358cac60eaf205270d88955dabcee920e3e733` | Contiene CSAPP-07 |
| Cabeza de PR 7 `e0f17e4c8e1a47ad08d10b8eeaf2e5f407c66bb5` | Merge de PR 8 en la rama de CSAPP-06; contiene 06 y 07 y tiene el mismo contenido que la cabeza anterior |

Por tanto, PR 8 ya está integrada **en la rama de PR 7**, no en `main`. Comprueba de nuevo el grafo al ejecutar. Si `main` ya incluye 06/07, parte de él. Si no, crea una rama propia desde la cabeza que los contiene y una **PR apilada contra esa rama**, mostrando solo los cambios de 08. No añadas 08 a PR 7 ni reconstruyas las entregas desde 05. Si una restricción del entorno impide separar la rama, informa del impedimento antes de contaminar una PR anterior; no fusiones por iniciativa propia.

Rama sugerida: `feature/CSAPP-08-calidad-client-health`. Sin force-push, rebase de historia publicada, borrado de ramas o cambios locales ajenos. Abre PR propia, sin fusionar ni desplegar. Integración en Git no equivale a aceptación de Dennis ni a pruebas con sus archivos.

## 2. Lectura selectiva y revisión previa obligatoria

Lee `AGENTS.md`, `CLAUDE.md`, `docs/00-index.md`, `docs/plan/estado.md` y este prompt. Después:

- `docs/producto/calidad.md`, QLT 01–10/QHL 01; `docs/producto/backlog-antiguedad.md`, BACK 01–12; `docs/producto/diagnostico-origen.md`, DIA 01–07.
- `docs/producto/administracion.md`, `docs/calculos/catalogo.md`, configuración/usuarios, y `docs/arquitectura/pulse-configuracion-csapp07.md`.
- Contratos de tickets, PAP y bugs solo donde se necesiten observaciones, revisiones, fuentes y vínculos. No uses perfiles antiguos ni vuelvas a pedir campos que no existen.
- `docs/validacion/csapp-07.md`, política de pruebas y fila CSAPP-08 del roadmap.

Entradas reales: `src/domain/quality-config.ts`, `src/server/pulse/{config,service,sql}.ts`, `src/server/analytics/{snapshot,stamp,operational}.ts`, `src/server/zendesk/{tickets,derive}.ts`, `src/server/bugs/links.ts` y `prisma/schema.prisma`. Reutiliza esas piezas con sus garantías; no copies un segundo sistema de pesos, referencias o autenticación.

La revisión para este prompt fue **lectura dirigida**, sin ejecutar aplicación/suites ni auditar toda PR 8. Continuar no acepta automáticamente ECO 08, ZDT 11–13, ZTM 06–08, lista de origen PAP, estados de bugs ni signo de Diferencia: conserva su estado pendiente. Antes de conectar datos reales al simulador, escribe contraejemplos para estos puntos observados:

| Punto | Corrección exigida |
| --- | --- |
| Pesos y fuente técnica ausente | `effectiveWeights` elimina de su denominador todos los indicadores no disponibles, aunque bloquee el global. Solo la ausencia de Health autoriza redistribución. Mantén asignación y cobertura separadas: un técnico ausente no aumenta el peso de los disponibles. |
| Health no confirmado | El simulador puede devolver color con el mapeo propuesto aunque `health.confirmed=false`. Un feedback presente sin mapeo activo se muestra como categoría **sin calibrar**, no como color publicado ni como ausencia redistribuible. |
| Escala del backlog | `backlogStockRate` devuelve envejecidos/usuarios; BACK 06 usa **100 × envejecidos/usuarios**. Fija unidad y factor de cada componente; adapta de forma explícita las reglas anteriores para no cambiar un umbral por un factor 100. |
| Cobertura | `sourceCoverageSql` usa EXISTS de filas fechadas en el periodo. Eso no demuestra cobertura del cliente, completitud ni una fotografía de backlog; tampoco permite distinguir un periodo completo sin altas de una fuente ausente. Sustitúyelo por un contrato de cobertura sustentado y compartido. |
| Ámbitos de configuración | v1 tiene un `scope` por indicador, con Health inicialmente CLIENTE y otros GRUPO. Un global no puede mezclar Health de un Cliente con métricas del Grupo. Prepara reglas aplicables por ámbito sin copiar cifras entre ellos. |
| Composición de Incidentes y problemas | `worstOfFlowAndBacklog=false` significa que la composición propuesta no fue elegida. No lo interpretes como autorización para publicar un KPI saludable basado solo en altas, ignorando el backlog confirmado como relevante. |

Amplía configuración/simulador de forma compatible donde haga falta: regla/unidad por componente, ámbito, observación y diagnóstico. Conserva `ConfigRevision` inmutable y revisiones activadas por el Administrador. Si introduces una versión de payload nueva, lee v1 mediante un adaptador documentado, sin actualizar su JSON ni recalibrarla silenciosamente. Una nueva elección crea otra revisión; una incompatibilidad queda visible. Simulador y dashboard usarán el mismo evaluador.

## 3. Contexto de análisis y ámbitos

El resultado global principal es **mensual**: mes elegido hasta el corte, Health de ese mes, flujos del mismo periodo y stock observado compatible con ese corte. Por defecto hoy en Europe/Madrid, mes en curso provisional y ámbito Grupo Cliente. Permite Cliente; implantación solo como detalle parcial cuando las fuentes la identifiquen. No inventes tickets por implantación: actualmente solo hay horas/PAP atribuibles a ella.

Permite mes completo para meses anteriores, corte diario y acceso al último mes finalizado. Muestra fecha solicitada, corte efectivo, fechas reales de observación, configuración y cobertura. Un mes completo en curso no se certifica cerrado ni recibe datos futuros. CUM, año anterior comparable y año completo son contextos de evolución técnica: **no inventes un global anual promediando semáforos o combinando Health del último mes con flujos CUM**.

Grupo y Cliente son ámbitos propios. El grupo cuenta cada ticket/PAP/actividad una vez, incluye trabajo atribuido solo al grupo y utiliza sus usuarios independientes. No sumes usuarios compartidos de hijos, no promedies sus semáforos para obtener el grupo ni heredes feedback. En un Cliente sin grupo conserva sus hechos y su falta de relación. Las organizaciones internas, incluidas las de bugs/pruebas, no se convierten en clientes externos por llamarse distinto de VINCLE.

No mezcles filtro financiero con Calidad. Dedicación aplica el alcance de servicio y los perfiles **expresamente elegidos**; si falta esa elección, muestra magnitudes por servicio y «selección sin configurar». Los otros indicadores solo aceptan filtros que sus fuentes sustenten; no supongas que un PAP o ticket pertenece a Soporte por la categoría de ingresos del grupo. Cada sección explica sus filtros aplicables.

Filtros, revisión, periodo, ámbito, pestaña, orden y paginación quedan en URL/contrato validado en servidor. Búsqueda y filtros de presentación no cambian silenciosamente referencias de percentiles. Las referencias reutilizan los criterios de 07, pero sus **valores se calculan para la métrica de Calidad**, unidad y ámbito correctos, no copiando una columna parecida de Pulse. Una cohorte no mezcla Grupo, Cliente e implantación ni cambia por pasar de página.

## 4. Client Health real: matriz mensual y edición

Dentro de Calidad, implementa matriz enero–diciembre por año y ámbito, con búsqueda/paginación de entidades y edición de celda para ADMIN. Consulta puede leer. Por celda: estado **positivo, negativo, mixto o sin feedback**, comentario, periodo representado, autor/fecha y versión. Añade fecha concreta del feedback si se conoce; no conviertas la fecha de guardado en fecha de reunión.

Modelo con identidad estable y unicidad ámbito+entidad+año+mes, claves foráneas a maestros y control de destino único. La edición es atómica con historial/auditoría antes/después y `expectedVersion`; dos altas o ediciones concurrentes no se pisan. Limpiar una celda conserva su historial y equivale a «sin feedback», no a puntuación cero. Comentarios se tratan como texto, sin HTML ejecutable. No crea cuentas de acceso ni personas nuevas.

No arrastres el mes anterior, no prellenes verde y no propagues entre grupo/Cliente/implantación. «Mixto» es elección explícita, no sentimiento deducido del comentario. Se pueden registrar/corregir meses anteriores con trazabilidad; no copies aquí el bloqueo de edición anual de la matriz de usuarios. No registres feedback ocurrido en una fecha futura como si ya hubiese sucedido.

Temporalidad clara: el dato pertenece al mes elegido y puede haberse registrado después; muestra esa circunstancia. Si hay fecha conocida posterior al corte diario, no lo uses antes de ella. Si solo se conoce el mes, identifica «fecha dentro del mes no informada» y el carácter mensual/provisional de su uso; no afirmes precisión diaria. Una corrección retroactiva produce nueva referencia de cálculo, no reescribe un cierre certificado inexistente.

El estado/categoría se ve aunque el mapeo no esté activado. Color solo mediante `health.confirmed` y configuración activa aplicable. **Sin feedback** deja celda en blanco y permite redistribuir; **feedback presente sin calibrar** conserva su peso y bloquea un global que necesite su color. No son el mismo caso.

## 5. Magnitudes de los seis indicadores

Cada resultado devuelve valor bruto, numerador, denominador, unidad, periodo, ámbito, fuente, revisión, estado de datos, estado de calibración, color si procede y explicación. Cero confirmado, sin dato, parcial, sin configuración y no calculable son distintos.

| Indicador | Magnitud y reglas |
| --- | --- |
| Client Health | Categoría mensual propia del ámbito, según §4 |
| Dedicación | Horas elegibles de los perfiles/servicio seleccionados, por usuario mes; desglose CS N1/N2, PMO ANA/DEV/rol desconocido, IT y Plataforma |
| PAP correctivos | PAP únicos por lista+ID si cualquiera de sus causas es correctiva; tasa por 100 usuarios mes |
| Escalados N3 | Ticket_id únicos con destino PMO N3 o IT N3, por 100 usuarios mes; unión, no suma de destinos |
| Incidentes y problemas | Flujo único `type=incident/problem` por creación y 100 usuarios mes; stock/antigüedad por tipo y usuarios al corte, según §6; un único KPI compuesto |
| Bugs y afectación del estándar | Unión de problem ticket_id externos vinculados a Bug_ o con causa estándar; por creación y 100 usuarios mes, según abajo |

Usuarios mes = suma de usuarios de cada mes × días incluidos/días reales. En un mes parcial se pondera exposición; no se prorratean horas/eventos ya registrados. Stock usa usuarios del ámbito al corte observado, nunca exposición acumulada. Usuarios cero o desconocidos impiden tasas con motivos distintos; los conteos permanecen visibles. Las normalizaciones alternativas solo se aplican si regla/referencia tienen la misma unidad, sin cambios de escala ocultos.

Horas: reutiliza `TimeActivity`, elegibilidad PMO por fecha del trabajo —antes de 2025 Zendesk; desde 01/01/2025 PMO Wrike y resto Zendesk— y selección canónica de perfiles. Una actividad `(source, entryId)` cuenta una vez. Rol desconocido no borra horas PMO elegibles; falta de elegibilidad/servicio relevante se conserva y limita el indicador. No deduzcas causa por rol DEV. Conserva las horas en rentabilidad independientemente del origen del problema.

PAP: fecha de producción, resultados originales y multicausas, sin filtro silencioso Resultado=OK. Origen cliente participa. Las pertenencias pueden solaparse, pero el total correctivo no suma categorías. Sin causa o fecha, presenta falta de clasificación/ubicación y su cobertura; no asigna fecha del título ni transforma desconocido en no correctivo. M11 no facturable sigue sin evidencia: no se necesita inventar facturación PAP para Calidad.

Escalados: usa tags exactos existentes; dos tags N3 cuentan uno y desgloses separados. La fecha de la cohorte es **creación del ticket**, no fecha real del escalado. N4 no prueba N3 ni bug. Tickets sin horas y proactivos de CS en organización externa permanecen. Type, entorno/tipología y causa raíz son dimensiones distintas.

Sexto numerador aprobado: `S = problem externos con causa incidente_estándar_plataforma`; `B = problem externos con vínculo explícito válido a Work Item Bug_`; resultado **COUNT DISTINCT(S UNION B)**. Muestra «por causa», «por vínculo», «ambas» y total único. Varios bugs no multiplican un problema y un bug con dos problemas son dos problemas, no uno. Incidentes vinculados se consultan como afectación adicional, sin convertirse en problemas del numerador.

Un vínculo válido es externo resuelto, no rechazado y sustentado por evidencia vigente inequívoca o confirmación manual válida; referencias ambiguas/sin ticket resuelto no entran. Reutiliza decisiones de vínculos, sin exigir una relación que no existe entre incidentes hijos y problemas. Un ticket central interno no atribuye su bug a toda la cartera. No busques la palabra BUG, no sobreescribas una causa de uso indebido porque exista un enlace.

El indicador mide **afectación conocida**. Falta de una fuente aplicable o relaciones no resueltas se declara parcial, sin cero ficticio. Un cero sustentado significa cero evidencia registrada de esa definición, no ausencia probada de todos los defectos reales. Los bugs únicos/abiertos de VFS/VSW son contexto aparte, con su propia fotografía y cobertura; no se suman al sexto numerador. PR y Ready for Release no prueban despliegue ni cierre; Changed Date tampoco es una fecha de cierre.

## 6. Backlog por observación y antigüedad

Implementa una consulta específica; **no reutilices el filtro de tickets creados dentro del mes** para el stock.

- Activos: `new/open/pending/hold`, por ticket distinto. Solved y closed separados fuera del stock. Question/task no entran en envejecimiento incident/problem. Status desconocido conserva su conteo y limita cobertura.
- Un incidente de hace un año todavía open entra aunque no haya altas en el mes. Edad = días naturales entre creación y **observación usada**; no tiempo en estado ni desde escalado. Creación posterior a observación es error, no edad cero.
- Por tipo muestra cantidad activa, bandas, mediana, P90, máxima, envejecidos, porcentaje envejecido y tasas por 100 usuarios. Sin activos confirmados: conteo 0, edades no aplicables. Envejecido es **edad > umbral del tipo**, no >=.
- Flujo de altas y stock se presentan separados; no sumes ambos como tickets adicionales. No midas cierres, resolución, frecuencia de workarounds o incidentes hijos con campos inexistentes.

Usa `ZdTicketObservation` y la revisión asociada a la fotografía aplicable, no `currentRevisionId` para reconstruir cualquier fecha pasada. Solo cuentan observaciones sustentadas por lotes completados no revertidos: revertir el lote que creó una revisión no la elimina si otro lote válido sigue aportándola. No uses una observación posterior al corte. Ante empates contradictorios sin orden fiable, conserva la incertidumbre en lugar de afirmar el instante de una transición. El mismo contenido visto de nuevo es otra observación válida, no otro ticket.

Define una **fotografía compatible**: fecha de extracción/observación conocida, alcance y completitud respecto a la población consultada. Una unión de tickets abiertos vistos en fechas diferentes no se convierte en un snapshot completo. Una ausencia en otra selección no cierra ni borra. No mezcles retrospectivamente revisión antigua con estado o organización de otra revisión actual. La resolución de identidad/vigencias sigue el contrato de tickets, con sus límites documentados.

Política inicial conservadora: para un corte histórico, una fotografía del corte que sustente el ámbito; si solo existe una anterior, muestra su stock como «observado en D», con edad y usuarios de **D**, sin dibujarlo como valor de la fecha solicitada R. El stock exacto de R queda no disponible/parcial. Puede ofrecerse política configurable «última anterior dentro de X días» si el Administrador elige expresamente el máximo y su tratamiento provisional; nunca una tolerancia de frescura inventada o una foto futura.

Si falta extracción declarada, la recepción es observación de importación con **frescura desconocida**, no una extracción demostrada. MAX(creación), nombre/mtime del archivo o fecha del servidor no sustituyen extracción. Declara esta incertidumbre en color y cobertura conforme a la política elegida. No calcules edades hasta hoy sobre un estado antiguo como si se hubiera observado hoy.

Añade, si falta, metadata tipada de cobertura/fotografía **en Administración › Cargas**, incluyendo población y alcance temporal. Los campos actuales `declaredExtractionDate`, `declaredFrom/To`, `coverageNote` no garantizan por sí solos una población completa de estados. No exijas nuevas columnas al XLSX vigente de ocho campos. Un administrador puede declarar/revisar la cobertura de un lote con versión, motivo y auditoría, sin cambiar filas, extracción original, observaciones ni estados históricos. Las cargas antiguas sin declaración permanecen desconocidas, sin aprobación automática. No crees una bandeja independiente.

Una fuente presente no demuestra cobertura de todos los clientes; una fuente completa sin eventos dentro del periodo sí puede sustentar cero. La cobertura es por fuente, ámbito, periodo y métrica, contemplando atribuciones sin resolver. Compartirás este contrato con Pulse/ficha cuando corrija sus ceros, con pruebas de regresión.

Al cargar open→solved, el ticket sale del nuevo stock observado sin ser un ticket nuevo ni probar una fecha de resolución. Un export antiguo no pisa el reciente. Revertir restaura las observaciones sustentadas aplicables. Sin fotografía compatible, la serie histórica tiene hueco; nunca se rellena hacia atrás con el estado actual ni se interpola.

## 7. Colores, pesos y resultado global

Consume exclusivamente revisiones activas aplicables de Calidad y de perfiles/referencias. Un borrador o simulación no colorea la cartera publicada. Los valores se muestran aun sin calibración; **sin umbrales, método o referencia válidos no hay verde automático**. El mapeo de Health, la selección de Dedicación, «peor señal» y plantilla global siguen propuestas hasta elección explícita del Administrador. No actives datos de ejemplo para que la pantalla tenga colores.

Reglas numéricas y percentiles reutilizan el evaluador de 07 y sus igualdades. Comprueba unidad, normalización, ámbito, periodo, referencia y muestra mínima elegida antes de aplicar límites. Una referencia con métrica incompatible o un mínimo requerido sin definir no se usa silenciosamente. Calcula sus magnitudes con las mismas reglas de Calidad, incluyendo ceros confirmados y excluyendo no calculables; una entidad es una observación. El N válido puede variar por KPI/componente.

Habilita reglas por **Grupo y Cliente** dentro de la configuración existente. No apliques un umbral de Grupo a Cliente ni tomes un KPI de otro ámbito para completar seis. Conserva las elecciones v1 en su ámbito/unidad declarados mediante adaptación identificada; completar el otro ámbito requiere configuración explícita. Una implantación sin tickets nunca hereda los KPI de su Cliente para fingir seis completos.

Incidentes y problemas conserva un solo peso. Si se elige «peor señal», evalúa flujo y componentes envejecidos de incidentes y problemas, con sus reglas, tasas, fechas y cobertura. Prepara reglas por tipo o una compartida explícitamente aplicada a cada uno; no mezcles sus conteos antes de explicar la diferencia. No presentar «flujo verde» como color completo del KPI si el backlog está sin método/datos. Una señal roja conocida puede aparecer como alerta parcial aunque falten otros componentes, pero no convierte un global incompleto en completo.

Pesos iguales: fracciones exactas `1/6`. Personalizados: centésimas de porcentaje con suma exacta 100. Sin Health, redistribuye únicamente su peso entre los otros cinco; iguales → `1/5`, 20 %. Con Health presente sin calibrar no se redistribuye. Si solo falta un KPI técnico, conserva la asignación de pesos y muestra la parte no cubierta; no aumenta el peso de los demás. Separa asignación efectiva, contribución disponible y cobertura.

Ejemplo obligatorio: Health en blanco y un técnico ausente → los cinco técnicos conservan 20 % asignado, cobertura calculable de cuatro de ellos 80 %, **sin global completo**. Health=100 % y en blanco → no calculable. Un KPI de peso cero no bloquea por falta de datos, pero su hecho no se borra.

Usa el global configurado; plantilla actual de severidades 0/0,5/1 solo cuando se haya activado con límites elegidos. Suma ponderada exacta y división una vez; no seis 16,67. Valida severidades y límites coherentes —verde≤amarillo≤rojo, valores en [0,1]— sin imponer valores numéricos nuevos. El score es un índice configurado, no probabilidad de fallo. No actives una regla «un rojo fuerza rojo global» ni promedies los colores de los hijos si no existe una regla elegida.

Si falta calibración, color de un KPI con peso positivo o cobertura técnica necesaria, muestra global sin calibrar/incompleto con motivo y fuentes pendientes. Mantén alertas conocidas y datos brutos útiles, sin producir un verde tranquilizador por ausencia. El detalle del global muestra los seis pesos configurados/efectivos, valores, colores, contribuciones y regla, no solo una cifra final.

## 8. Diagnóstico por origen y actuaciones

Construye el apartado de diagnóstico de Calidad y de la ficha sobre los mismos hechos:

- Estándar del producto.
- Configuración, personalización e integración/procesos, separadas.
- Sistemas del Cliente y Uso Indebido, separadas.
- Infraestructura Vincle en CLOUD frente a infraestructura de cliente OP.
- Otros, sin causa y pendientes de atribución/alojamiento.

Conserva valores originales y catálogo controlado/versionado de correspondencias en Administración. Inicializa solo las correspondencias confirmadas del contrato DIA, no categorías inferidas por palabras sueltas. Entorno/tipología aporta una **señal** y causa raíz el diagnóstico registrado; no sobreescribas uno con otro. Si hay varios valores o causas, conserva pertenencias y marca la no aditividad; los totales por ID siguen únicos.

Infraestructura SaaS usa alojamiento vigente: para tickets, la fecha contractual de clasificación de su creación; para horas, fecha del trabajo. Una migración posterior no convierte retroactivamente OP en CLOUD. Sin alojamiento, pendiente. Los cambios de correspondencias crean revisión y referencia nueva, sin alterar el bruto ni el criterio aprobado de afectación estándar de forma oculta.

Ofrece matrices type×familia de causa y entorno/tipología×causa, con conteos, horas y tasas compatibles, y detalle de tickets/PAP/escalados implicados. Cualquier unión de tiempo y tickets agrega primero por identidad; no multiplica horas por tags o bugs. Conserva familias del cliente en magnitudes de los semáforos y rentabilidad.

Explica actuaciones como orientación: estándar→revisar corrección/versión; configuración/personalización/integración→revisar validación y pruebas; Sistemas del Cliente→revisar entradas/contratos de datos; Uso Indebido→formación/adopción; CLOUD Infra→operación SaaS. **No afirmes falta de pruebas ni culpa demostrada solo por la etiqueta.** Permite una nota sencilla de revisión QA con autor/fecha y vínculo al ámbito/periodo/evidencia, sin crear un gestor de tareas o planes de pruebas.

## 9. Pantalla Calidad y enlace con Análisis Cliente

Implementa `/calidad` con:

1. Contexto de mes/corte, ámbito, revisión y referencias; avisos concretos de cobertura.
2. Tarjetas de cartera: entidades verdes/amarillas/rojas y sin global calculable, siempre sobre todo el conjunto filtrado antes de paginar; no una media de scores de ámbitos diferentes.
3. Tabla de entidades con seis KPI, valor/unidad/color/estado, global, usuarios y cobertura. Orden estable y filtros por identidad, producto/soporte/alojamiento/complexidad vigentes, color y pendientes de datos/calibración. Los filtros de color son de presentación: no recalculan la referencia.
4. Detalle por entidad: seis KPI explicados, evolución, Client Health, diagnóstico, backlog por tipo y contexto de producto.
5. Matriz Client Health anual dentro de esta vista, sin módulo principal adicional.

La vista funciona con datos sin calibrar: muestra magnitudes y siguientes acciones para ADMIN; Consulta ve el motivo sin enlaces de escritura que terminan en 403. Un cero, celda vacía de Health y KPI técnico ausente no se representan igual. Usa nombres completos; no Q1/Q2 ambiguos.

Evolución mensual: datos propios de cada periodo/observación, con huecos cuando no hay backlog o configuración compatible. Una curva de cohortes históricas por creación con **clasificación actual** se identifica como recálculo, no estado histórico demostrado. Hitos de arranque/migración/versión se anotan sin excluir eventos automáticamente. CUM compara el mismo corte anterior para magnitudes técnicas, separado del global mensual y del año anterior completo.

En Análisis Cliente integra los mismos seis resultados, feedback y enlaces a diagnóstico/backlog. Ir y volver conserva ámbito, periodo y revisión. No recalcules un color distinto porque cambió de ruta o de página. Las otras tres vistas siguen operativas; Pulse mantiene sus cinco bandas descriptivas y rentabilidad no se convierte en KPI de Calidad.

Gráficos con leyenda, unidades, tooltips, texto de estados y tabla accesible equivalente. Verde/amarillo/rojo nunca solo por color. Revisión a 1440 y 390 px; desplazamiento contenido, teclado, foco y estados cargando/vacío/error/incompleto/sin calibrar. No rellenes una base vacía con datos demostrativos.

## 10. Servicios, detalle, exportación y consistencia

Crea un motor de Calidad reutilizable y consultas por conjuntos, con evaluador puro y una instantánea `REPEATABLE READ` compartida por datos, configuración, usuarios, referencia y agregados. No llames a Pulse/ficha por cada cliente o KPI ni consultes el estado actual después de seleccionar observaciones históricas fuera de la transacción.

Cada color/valor abre fórmula, numerador, denominador, exposición o stock, causas/destinos, fechas de observación, cobertura, cortes de referencia/N, reglas/revisiones y peso. Los detalles paginados usan los mismos predicados que el agregado y totalizan todas sus filas, no la página. Bug estándar tiene vista de las tres evidencias S/B/ambas con IDs distintos. Backlog muestra ticket, tipo, status, creación, observación, edad y motivo de envejecimiento.

CSV autenticado de cartera Calidad completa filtrada, resumen de ficha y matriz Health, con estados, unidades, colores textuales, pesos, revisiones, corte solicitado/observado y cobertura. Reutiliza escape/neutralización de fórmulas textuales de 06/07, sin alterar negativos válidos. No exportes solo la página, originales de Cargas o ficheros públicos. Descarga masiva de hechos/tareas de fondo queda para CSAPP-09; aquí detalle paginado y resúmenes reales, sin botones simulados.

Extiende el sello de datos con Health, cobertura declarada, diagnóstico y las fuentes/observaciones relevantes. Comprueba que una nueva observación **sin cambio de contenido**, una reversión, feedback editado, usuarios o configuración invalidan el resultado anterior. Un sello que solo mira la revisión actual no basta para backlog. Si los datos cambian entre agregado y detalle/exportación, indica nueva lectura o pide actualizar; no simules la instantánea vieja.

ADMIN edita Health/notas/configuración y declaraciones de cobertura; Consulta lee análisis/detalles/CSV. Verifica permiso real en servidor y trabajador si aplica; no basta ocultar botones. Configurar, simular o activar reglas no modifica datos fuente. No se envían notificaciones o mensajes a terceros como parte de esta entrega.

Amplía la simulación de Administración para previsualizar una configuración borrador sobre datos de la base, con comparación activa/propuesta y banner **SIMULACIÓN, NO PUBLICADO**. Solo ADMIN; no cambia feedback, observaciones, reglas activas o resultados publicados. Puede coexistir con los escenarios manuales de 07. El Administrador activa después mediante el circuito existente; no inventes otra aprobación externa.

## 11. Migraciones, datos y rendimiento

Migración incremental para Health, notas/metadata e índices necesarios, conservando las seis anteriores. Prueba instalación limpia y actualización desde CSAPP-07 con datos sintéticos. No cambies `ConfigRevision` anterior ni borres historiales. Mantén el guard `src/lib/test-guard.ts`: destino `_test` explícito y conexión efectiva comprobada antes de cualquier operación de pruebas que mute datos.

No limpies las dos cuentas residuales del incidente de CSAPP-06, no pruebes con `cs_app`, no ejecutes cargas reales ni financieros 2025/2026: Dennis hace esas pruebas. La continuación no autoriza reintentar la limpieza bloqueada por otra vía. No versiones archivos fuente, secretos, libros descifrados, nombres reales o capturas privadas.

Mide con al menos 1500 grupos, 250000 tiempos, aproximadamente 114000 tickets y PAP/vínculos sintéticos representativos, **varias observaciones mensuales** y estados antiguos. Tabla, filtros, referencia, ficha, backlog histórico, Health y CSV. Anota sentencias, tiempos, memoria y tamaño de respuesta; evita N+1 por entidad/mes y joins que multipliquen entidades. No prometas tiempos que no has medido ni conviertas cada celda en una consulta de toda la cartera. Detalles y series se cargan cuando se necesitan; gráficos reciben agregados, no todos los hechos.

Los costes de Pulse declarados en 07 eran 4,6–9,2 s/29 sentencias a escala, no un objetivo para Calidad. No repitas benchmarks financieros ajenos si no modificas su motor. Mantén la corrección de pruebas negativas del guard y limpieza de procesos propios ante fallo, sin afectar web/trabajadores de Dennis.

## 12. Validación mínima exigida

Pruebas de dominio, PostgreSQL real, migración y navegador con web/trabajador compilados. Resultados calculados de forma independiente, no copiados del código. Incluye:

| Caso | Resultado verificable |
| --- | --- |
| Health | Vacío inicial; positivo/negativo/mixto; edición y limpieza con historial; conflicto concurrente; grupo y Cliente independientes; fecha posterior al corte y registro retroactivo identificados |
| Calibración Health | Categoría presente con `confirmed=false` no colorea ni redistribuye; Health ausente sí; activar el mapeo cambia solo la evaluación/versionado |
| Pesos | Seis 1/6 exactos; sin Health cinco 20 %; técnico ausente no aumenta otros; sin Health+técnico ausente cobertura 80 %; 99/101/100,02 rechazados; peso cero no bloquea; Health=100 y ausente no calculable |
| Global | Sin método/límites no color; ejemplo de prueba con cinco técnicos verde/amarillo/rojo/verde/amarillo y sin Health → score **0,4** con severidades 0/0,5/1; límites de prueba elegidos explícitamente; sin técnico necesario no global completo |
| Dedicación | Fuente PMO 2024/2025 y comparativa 2026/2025; usuarios variables/corte parcial; perfiles desconocidos, elegibilidad/servicio pendiente; causas del cliente conservan horas |
| PAP | Una identidad con correctivo+otra causa y varios tickets cuenta una vez; estándar/origen cliente solapados no se suman; no OK y sin fecha/causa no desaparecen |
| Escalados | Ticket sin horas; dos destinos N3 total uno; N4 sin N3 no inventa N3; mes por creación, no fecha real del tag |
| Sexto indicador | Dos problemas vinculados a un Bug_ y uno además estándar → **2**, no 3; un problema con dos bugs →1; dos bugs/productos con mismo ID no colisionan; incidentes, internos, rechazados y sin resolver separados |
| Stock antiguo | Incidente creado hace un año open, cero altas del mes → entra en stock; question/task fuera de envejecimiento; solved/closed separados; estado desconocido limita cobertura |
| Edad y escala | 2026-01-01→2026-02-01 =31 días; umbral 30 → envejecido, edad30 no; 2 envejecidos/U=10 → **20 por 100 usuarios**, aunque la exposición mensual sea distinta |
| Fotos históricas | Open observado en enero y solved en febrero: enero conserva open, febrero sale; sin foto enero no se inventa; una foto futura no se usa; foto anterior muestra D, no R, según política explícita |
| Observaciones | Mismo contenido con nueva observación actualiza frescura/sello sin otro ticket; export viejo no pisa nuevo; reversión retira soporte y recompone snapshot sin borrar historia; revisión compartida por dos lotes sobrevive al revertir uno |
| Cobertura y ceros | Export completo sin nuevas altas puede sustentar cero flujo y stock antiguo; una fila de otro cliente no acredita cobertura del consultado; sin fuente/no declaración no genera cero verde; revisiones huérfanas/revertidas no prueban cobertura |
| Composición | Al elegir peor señal, flujo verde y backlog rojo no producen KPI verde; sin regla/foto se muestra incompleto y señales conocidas, no solo flujo saludable |
| Ámbitos | Usuarios de grupo propios, sin suma de compartidos; grupo no promedio de hijos; Cliente sin grupo; implantación sin tickets no hereda seis completos; regla de otro ámbito no se aplica |
| Diagnóstico | Sistemas del Cliente/Uso Indebido participan y se separan; entorno personalización+causa estándar conserva ambos; CLOUD/OP a fecha correcta; vínculo bug no sobreescribe causa distinta |
| Compatibilidad | Configuración v1 preservada/inmutable, unidades antiguas con conversión explícita, umbrales por ámbito, borrador y simulación sin activar; rollback crea otra revisión |
| Percentiles | Referencia de métrica/unidad/ámbito correcto; N y muestra mínima; ceros válidos y no calculables; filtros de presentación/página no mueven cortes |
| Coherencia | Carrera con dos conexiones y barreras: cambio de Health/usuarios/configuración/observación no mezcla instantáneas; detalle y CSV avisan nueva referencia |
| Seguridad | ADMIN/Consulta leen; Consulta/anónimo no editan Health, cobertura, notas o reglas; originales y decisiones privadas siguen protegidos; peticiones forjadas no mutan ni auditan un éxito |

Navegador: cartera sin datos/sin calibrar, matriz Health, editar celda y ver efecto, un global completamente configurado **solo con fixtures aisladas**, vista parcial, cambio de ámbito y mes, backlog de ticket antiguo, diagnóstico, detalle de un KPI/global, CSV completo y vuelta desde ficha. Simular borrador sobre datos no modifica cartera activa. Revisión visual/escritorio/móvil y teclado; no declares lector de pantalla probado si no se usa.

Ejecuta instalación reproducible, typecheck, lint, build, suites afectadas, E2E y regresión apropiada de 06/07 y de importadores cambiados. Las 475 pruebas/291 comprobaciones de 07 son su informe, no resultados de 08. Documenta comandos, entorno, fallos, ajustes y límites reales. No silencies pruebas fallidas, reduzcas volumen sin declararlo o desactives el guard para continuar.

## 13. Documentación y entrega final

Actualiza por propietario y con enlaces, sin crear un documento gigante:

- `docs/producto/calidad.md`: pantallas, seis KPI, global mensual, estados, ámbitos y Health; conserva IDs QLT/QHL y añade nuevos donde corresponda.
- `docs/producto/backlog-antiguedad.md`: selección de fotografía, cobertura, cortes/políticas, edad, componentes y límites históricos.
- `docs/producto/diagnostico-origen.md` y `docs/calculos/catalogo.md`: correspondencias, unidades, fórmulas, pesos, referencia y no aditividad.
- Contratos de Administración/configuración y Cargas solo en las partes ampliadas; diferencia confirmado, propuesto y activado. No cambies perfiles fuente de ocho campos para justificar nuevas necesidades.
- `docs/arquitectura/calidad-csapp08.md`: esquema físico/compatibilidad, servicios comunes, observaciones, configuración y referencias; enlaza contratos en lugar de duplicarlos.
- `docs/plan/guia-powershell-csapp08.md`, guía breve de Calidad y `docs/validacion/csapp-08.md`: pasos de Dennis, comandos ejecutados/no ejecutados, evidencias y medidas. Windows sigue sin probar salvo ejecución real.
- Estado, índice documental/prompts, roadmap y guía de lectura selectiva. Corrige estado real de PR 7/8 y registra la base apilada si corresponde, sin llamar aceptado lo integrado.

Terminado significa: las cuatro vistas están operativas según su alcance; Calidad tiene Health editable, seis magnitudes, semáforos/global cuando están sustentados y calibrados, diagnóstico, backlog observado con historia honesta, detalles/CSV y su integración en ficha; configuración reutilizada y simulación útiles, migración y pruebas completas. Una maqueta con colores, seis números sin evidencia o un global siempre verde no cumplen. Una base sin calibrar debe funcionar con magnitudes y razones, sin datos de muestra automáticos.

Abre PR propia sin fusionar/desplegar, con diff de CSAPP-08 y base correcta. Respuesta final: PR/rama y SHA base/final, migración, qué puede usar Dennis, correcciones con pruebas, comandos/cifras/entorno, propuestas pendientes y lo no verificado. Recorrido manual: consultar mes actual, completar Health, calibrar/simular/activar una regla elegida, abrir seis KPI y global, revisar un incidente antiguo, comparar origen cliente/estándar, navegar Grupo→Cliente y comprobar una fecha sin fotografía y un CSV. No afirmes que Dennis ya lo hizo. Detente al terminar CSAPP-08.
