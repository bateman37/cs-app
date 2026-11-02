# CSAPP-09-v1 — Conciliación, rendimiento, exportaciones y recuperación

## 1. Encargo y punto de partida

Trabaja exclusivamente en `bateman37/cs-app`. Implementa **CSAPP-09 completa**, novena de las diez entregas: comprobar y corregir la coherencia de las cuatro vistas, completar las exportaciones grandes, mejorar el rendimiento con medidas y demostrar la recuperación de cargas y trabajos. No avances a CSAPP-10.

Antes de modificar aplicación, migraciones o pruebas, archiva **este prompt literal**, sin resumirlo ni corregirlo, en `prompts/CSAPP-09-v1.md` y actualiza `prompts/README.md`. Las discrepancias y decisiones técnicas van en otros documentos. Mantén exactamente **Comparativa, Análisis Cliente, Pulse Rent, Calidad y Administración**. No añadas una quinta vista de negocio, un séptimo KPI, otro sistema de autenticación ni una reescritura de los motores.

Git comprobado al redactar el prompt el **02/11/2026**:

| Referencia | Situación comprobada |
| --- | --- |
| `main` `f71b5b7283ab1081802cc6256899a02f70460a74` | Incluye CSAPP-05; todavía no contiene 06–08 |
| Cabeza de PR 9 `d7bc52bbf3a987ffd3691ea0ce4e9f606612001d` | Entrega CSAPP-08 |
| Cabeza de PR 7 `31009c99398af314a87fe3eedef5b457ede31559` | Merge de PR 9 en `claude/new-session-omvsmd`; contiene 06, 07 y 08; mismo contenido que la cabeza de PR 9 |

Por tanto, el informe pegado por Dennis ya está desactualizado respecto a PR 9: está integrada **en la rama de PR 7**, no en `main`. Vuelve a comprobar referencias, ancestros y PR al ejecutar. Si `main` ya contiene 06–08, parte de él. Si no, crea una rama propia desde la cabeza que los contiene y abre **PR apilada contra esa rama**, con un diff exclusivo de 09. No añadas commits de 09 a PR 7 ni reconstruyas 06–08 desde 05. Rama sugerida: `feature/CSAPP-09-conciliacion-exportaciones-rendimiento`.

Respeta los cambios ajenos y la historia publicada: sin force-push, rebase publicado, borrado de ramas ni fusiones por iniciativa propia. Si el entorno impide separar la rama, informa del impedimento sin contaminar una entrega anterior. Abre PR propia, **sin fusionar ni desplegar**. Integración en Git no equivale a aceptación de Dennis.

## 2. Lecturas selectivas y límites de la revisión

Lee `AGENTS.md`, `CLAUDE.md`, `docs/00-index.md`, `docs/plan/estado.md`, las filas 09/10 del roadmap y este prompt. Después, por necesidad:

- `docs/validacion/aceptacion.md`, `docs/validacion/csapp-06.md`, `csapp-07.md` y `csapp-08.md`: invariantes, medidas y límites realmente declarados.
- Arquitectura de analítica, Pulse/configuración y `docs/arquitectura/calidad-csapp08.md`; catálogo de cálculos y contratos de producto de las cuatro vistas.
- Contrato del motor de cargas, guía del trabajador y contratos de importación cuando la conciliación o una recuperación los afecte.
- `src/server/analytics/{snapshot,stamp,export}.ts`, `src/server/pulse/`, `src/server/quality/{engine,detail,facts,export,coverage}.ts`, `src/domain/quality-config.ts`, cola/trabajador/almacenamiento de `src/server/uploads/`, guard de tests y esquema Prisma.

No leas todos los prompts y todos los documentos de una vez. Entra por el índice y abre el contrato dueño de cada regla; actualiza ese documento y enlázalo. La revisión usada para preparar este encargo fue **lectura dirigida de código y documentación**, no ejecución de la aplicación ni auditoría completa de PR 9. Las 529 pruebas y 318 comprobaciones son resultados declarados de 08: no los presentes como verificaciones de 09.

No conviertas en aceptadas ECO 08, ZDT 11–13, ZTM 06–08, lista de origen PAP, estados de bugs, signo de «Diferencia» o Silver On Demand. Tampoco actives mapeos, perfiles, umbrales, referencias, mínimos de muestra, composición del quinto KPI o plantilla global para obtener colores. Las decisiones pendientes no impiden corregir infraestructura y cálculos ya definidos. Usa configuraciones elegidas expresamente **solo en fixtures aisladas** para probar ambas situaciones.

## 3. Deficiencias concretas que debe cerrar 09

Primero reproduce estos casos con pruebas que fallen por el motivo indicado. Corrige el servicio compartido y verifica pantalla, detalle y archivo; no arregles únicamente el texto o el test.

| Punto observado en 08 | Resultado exigido en 09 |
| --- | --- |
| Las exportaciones existentes producen resúmenes y forman arrays/cadenas completas; los hechos grandes quedaron aplazados | Exportación completa de hechos con trabajador, memoria acotada, progreso, descarga privada, cancelación y recuperación, según §6 |
| La evolución de Calidad no recalcula referencias mensuales por percentiles | Misma evaluación que la ficha mensual, con cohorte, usuarios, cobertura, reglas y fotografía de cada mes; nunca umbrales prestados del último mes |
| `evolutionIn` convierte ausencias de flujo/PAP en 0 y elige una fotografía anterior dentro del mes sin aplicar la política EXACT/antigüedad máxima del dashboard | Un mes sin cobertura no se convierte en cero confirmado; el stock sigue la misma política que cartera/ficha. Una foto anterior conserva fecha/usuarios propios y carácter provisional o queda aparte |
| El CSV de Health pagina mediante llamadas independientes y devuelve un sello vacío | Exportar la matriz completa desde una lectura coherente, con sello y contexto; cambios entre páginas no producen una matriz mezclada |
| El sello se calcula recorriendo dominios y debe representar todos los cambios que afectan a un resultado | Auditar dependencias, incluidas observaciones de Work Items, vínculos, vigencias, cobertura y cambios sin nueva revisión de contenido. Corregir omisiones demostradas y medir el coste, según §7 |
| Arquitectura de Calidad dice que Pulse no adopta cobertura, pero código/validación indican que sí | Contrato y documentación consistentes con la implementación verificada; mantener la distinción entre cero sustentado, parcial y sin fuente |

En la evolución incluye los **seis indicadores**, sus componentes, global cuando sea calculable y magnitudes originales; no solo cinco conteos. Cada punto ha de poder explicar numerador, denominador, estado, muestra de referencia y revisión. Conserva tabla accesible y huecos. No inventes un global anual ni promedies colores.

Política de configuración de la serie: por defecto **serie recalculada con la revisión activa al solicitarla**, identificada expresamente. Usa esa misma revisión para todos los puntos y reconstruye los datos/cohortes de cada periodo. No afirmes que muestra el color que se publicó históricamente si no existe un archivo de ese cálculo. Un cambio retroactivo de datos, Health o maestros puede modificar la serie recalculada y debe cambiar su referencia. No uses información futura para reconstruir stocks.

Reutiliza evaluadores puros y consultas por conjuntos. No resuelvas doce meses mediante doce peticiones HTTP, transacciones independientes o una consulta por entidad/KPI. Un número acotado de consultas por mes/familia es admisible si se documenta, es coherente y se mide; no prometas una sola consulta artificialmente.

## 4. Conciliación compartida y comprobable

Implementa en **Administración**, ampliando las comprobaciones existentes, una comprobación de conciliación que permita seleccionar periodo/corte, ámbito y servicio cuando proceda. Debe devolver resultado, diferencias, identidades implicadas, exclusiones justificadas, fuentes, revisiones y fecha de lectura. Reutiliza consultas y contratos; no implementes una quinta calculadora de rentabilidad.

La comprobación no modifica fuentes, no activa configuración ni reprocesa lotes automáticamente. Registra una ejecución y su manifiesto para poder revisarla. Un informe anterior conserva sus resultados y avisa si los datos actuales han cambiado; no se reescribe silenciosamente. Permite descargar informe tabular y manifiesto estructurado. Los detalles privados de una base de Dennis nunca se versionan en Git.

Organiza las comprobaciones en tres niveles:

1. **Fuente y lote:** filas recibidas, inválidas, repetidas, sustituidas, excluidas y activas; identidad y unidades. Las particiones aditivas concilian exactamente; las pertenencias solapadas se etiquetan como no aditivas.
2. **Hechos elegibles:** desde el dato conservado hasta su atribución a Grupo/Cliente, servicio, persona y periodo, con explicación del corte PMO, internos, ausencia de relación y datos sin clasificar.
3. **Resultado:** tabla, ficha, detalle completo y CSV del mismo universo y referencia. Si las vistas tienen perímetros distintos, explica la diferencia y concilia mediante el puente correspondiente; no fuerces que todo total coincida.

Invariantes mínimos:

- Horas: identidad `(source, entryId)`, minutos precisos y conversión final, antes/después del 01/01/2025 por **fecha del trabajo** y pertenencia histórica a PMO. PMO desde 2025 viene de Wrike; resto de Zendesk. Wrike ya trae horas decimales: 0,5 h son 30 min. No dividas otra vez por 60. Desconocidos y exclusiones se conservan separados, sin sumarlos al numerador elegible ni ocultarlos.
- Finanzas: suma de líneas activas por año/categoría contra Total de origen; «Vta Potencial» y Budget separados; reemplazo de un año/categoría no modifica otro. No sumes nuevamente el importe anual al sumar sus meses. Conserva precisión y tolerancia monetaria configurada; no uses una tolerancia global para tapar diferencias de horas o conteos.
- Rentabilidad: grupo y cartera se calculan con sus sumas, no promediando ratios. Detalle y CSV reproducen el servicio/periodo del numerador y denominador. Ingresos de grupo no se reparten ficticiamente entre Clientes.
- Usuarios: valores propios de Grupo y Cliente, compartidos no sumados entre hijos; nulo distinto de cero. Usuarios mes para flujos y stock al corte observado para backlog. No sumes el stock mensual como si fueran usuarios distintos.
- Tickets: identidad única, revisiones/observaciones y atribución correctas; tickets sin horas permanecen para Calidad. Dos destinos N3 cuentan un ticket. El mes del escalado es la **cohorte de creación**, no una fecha de evento que no existe.
- PAP: identidad lista+ID; cualquier causa correctiva lo clasifica, varias causas no lo multiplican; origen cliente participa, con desglose. No añadas un filtro silencioso Resultado=OK. No conviertas M11 en disponible sin evidencia de no facturación.
- Sexto indicador: unión de problemas externos por causa estándar o vínculo válido a `Bug_`. Un problema con dos bugs cuenta una vez; un bug con dos problemas cuenta dos problemas. Bugs de producto y afectación a clientes son magnitudes separadas.
- Calidad: mismas reglas, unidades y resultados en cartera, ficha de Análisis Cliente, detalle, simulación y exportación. El simulador usa el borrador identificado, sin contaminar el cálculo publicado.
- Referencias: filtro/paginación visible no modifica la cohorte estadística. Media de ratios, mediana y percentiles no son la rentabilidad ponderada de cartera. Color de calidad requiere calibración y datos sustentados.

## 5. Casos de aceptación numéricos y temporales

Crea fixtures sintéticas pequeñas, legibles y versionadas, con **resultados esperados calculados independientemente** del motor. No uses el resultado de una API como única verdad de otra. Incluye al menos:

| Caso | Resultado conocido |
| --- | --- |
| Soporte anual 12.000 €, mes de 30 días, corte día 15 | Ingreso imputado 500 €; con 8 h elegibles, 500 €/jornada de 8 h. El objetivo inicial 550 se lee de configuración |
| 65 usuarios enero–mayo y 68 junio–octubre | 665 usuarios mes enero–octubre y stock 68; para el día 15/30 de junio la exposición del mes es 34, no 68 |
| Un Grupo tiene usuarios compartidos entre dos Clientes | El Grupo usa su matriz propia; no suma las matrices de hijos ni duplica sus ingresos |
| Dos envejecidos y 10 usuarios al corte | 20 por 100 usuarios, independientemente de la exposición acumulada |
| Health en blanco y un técnico ausente | Cinco pesos asignados del 20 %; cobertura del 80 %; el técnico ausente no redistribuye su peso. Con Health presente sin calibrar no se elimina su peso |
| Cero eventos con cobertura completa / sin cobertura | Primer caso: cero confirmado; segundo: ausencia no sustentada, sin semáforo saludable |
| Ticket antiguo abierto, sin horas ni altas en el mes | Participa en stock observado compatible; no en flujo de nuevas altas del mes |
| Ticket con tags PMO N3 e IT N3 | Uno en la unión N3, visible en los dos desgloses no aditivos |
| Dos problemas ligados al mismo Bug_, uno también estándar | Sexto numerador 2. Otro bug ligado a uno de ellos no lo incrementa |
| Foto a día 10 y corte día 30, política EXACT | No es stock exacto del día 30; se muestra aparte. Con política anterior expresamente elegida, solo se utiliza dentro del máximo y como provisional |

Añade fronteras: año/mes, febrero bisiesto, día de corte incluido, medianoche Europe/Madrid y cambios de horario sin desplazar fechas de negocio. El año anterior comparable distingue mes completo de corte diario y no utiliza días imposibles. Registros posteriores al corte no entran por conveniencia.

Para percentiles, usa una muestra pequeña conocida con ceros y nulos, resultados de interpolación inclusiva `(n−1)q`, empates y límites exactos. Prueba una serie donde cambian usuarios y cohorte entre meses: el color de enero debe coincidir con evaluar enero aisladamente, no con aplicar la referencia de octubre. Sin referencia mínima o cobertura: magnitud y motivo, sin color inventado.

Prueba causas del cliente —Sistemas del Cliente, Uso Indebido, PAP origen cliente—: se mantienen horas, escalados y magnitudes; se separa el diagnóstico. Infraestructura CLOUD/OP usa vigencia aplicable. Configuración/personalización/integración son señales que revisar, no una conclusión automática de falta de pruebas.

## 6. Exportaciones completas en segundo plano

Completa lo aplazado en 06–08. Mantén los CSV pequeños existentes, corrigiendo coherencia cuando proceda. Para hechos grandes, añade **trabajos persistentes en PostgreSQL** ejecutados por el trabajador, sin Redis ni tareas lanzadas dentro de una petición web y olvidadas después. Reutiliza primitivas de cola/lease/fencing; si `UploadJob` está ligado obligatoriamente a un lote, usa una entidad de exportación adecuada. No inventes un lote de carga o perfil sintético en producción para alojar un export.

Alcance mínimo, desde los detalles de las cuatro vistas:

- Hechos de dedicación elegibles y particiones de conciliación, con fuente, identidad, fecha y minutos/horas, ámbito y motivo de inclusión/exclusión.
- Tickets de cada conjunto: flujo, N3, afectación estándar/bugs y backlog de la fotografía elegida. Revisión/observación y pertenencias explican por qué entra cada identidad.
- PAP únicos, causas y vínculos; problemas–bugs con producto e identidad inequívoca, sin multiplicar el numerador por una relación uno a varios.
- Líneas financieras del perímetro que explica el ingreso imputado, sin copiar el archivo original ni ofrecer a Consulta campos privados de Administración.

Cada conjunto tiene contrato de columnas, granularidad, clave, unidad, orden estable y regla de conciliación. Cuando haga falta separar entidad y relaciones, entrega archivos distintos con sus claves, identificando cuáles son aditivos. No exportes todas las tablas internas indiscriminadamente.

**Experiencia:** «Exportar detalle completo», alcance y contexto visibles antes de solicitar; estado en cola/preparando/generando/listo/fallido/cancelado/caducado, progreso real por fase, cancelar, reintentar y descargar. Se puede salir de la pantalla y volver a encontrar los trabajos propios. Integra el historial en las vistas existentes y la supervisión técnica en Administración; sin nuevo módulo de negocio. Una ausencia de trabajador se muestra, no deja un spinner indefinido. Los resúmenes siguen siendo utilizables mientras se genera un archivo grande.

**Lectura coherente y reproducción:** el trabajo guarda consulta validada, solicitante, fecha, versiones de formato/motor, revisiones de configuración y sello solicitado. Al prepararse, congela **en una misma lectura coherente** los registros proyectados necesarios y el contexto para todo el archivo; después pagina/escribe sobre esa materialización inmutable. Metadatos, membresía, valores, etiquetas y denominadores también quedan fijados, no solo una lista de IDs cuyos registros cambian después. Un cursor por sí solo no garantiza una instantánea.

Documenta el esquema y frontera transaccional antes de implementarlo. No mantengas una transacción abierta durante una descarga del navegador. Si cambió la lectura respecto a la pantalla al comenzar la preparación, conserva ambos sellos y muestra «lectura posterior a la pantalla», con sus fechas y totales; no finjas haber recuperado una instantánea antigua. Una materialización ya completada se reutiliza al reintentar; si falló antes de completarse, el nuevo intento registra su nueva lectura y no se presenta como el mismo estado anterior.

**Memoria y archivos:** lectura/escritura por bloques con contrapresión; nunca `findMany` sin límite ni un array/cadena con todas las filas. UUID interno, almacenamiento privado separado de originales, checksum/tamaño/recuento y archivo temporal por intento. Publicación atómica con fencing: solo se ofrece un archivo terminado y validado. Si el proceso cae después de escribir y antes de marcar listo, recupera/verifica el resultado o regenera desde la materialización, sin anexar filas duplicadas ni publicar un parcial. Dos trabajadores no producen dos resultados vigentes.

CSV UTF-8 con BOM, separador `;`, comillas y saltos escapados, decimales compatibles con Excel español. Neutraliza fórmulas en **texto no confiable**; conserva negativos numéricos válidos. Estado/motivo acompaña a celdas vacías, cero es explícito. Añade manifiesto JSON descargable con contexto, totales y claves de conciliación; archivos comprimidos solo si aportan valor y sin ensamblarlos completos en memoria. Si excede el límite de filas de una hoja Excel, avisa y ofrece partición determinista, sin truncar silenciosamente.

**Permisos y vida útil:** vuelve a comprobar sesión/rol y propietario al crear, consultar, cancelar, reintentar y descargar; el trabajador comprueba permisos vigentes. Admin/Consulta conservan los permisos analíticos existentes: Consulta puede exportar el detalle que puede leer, pero no originales, administración privada o borradores. UUID no autoriza acceso. No hay URL pública ni archivos en `public/`; respuestas privadas sin caché compartida. Admin puede supervisar estados sin que ello habilite por defecto la descarga de archivos ajenos.

Configura límites de trabajos simultáneos, tamaño/almacenamiento y vida útil de artefactos temporales. Documenta valores técnicos iniciales; no impongas una nueva política de conservación de fuentes. Caducar un export limpia solo sus artefactos/materialización, conserva el registro mínimo de ejecución y no elimina lotes, auditoría o datos de negocio. Cancelar y falta de espacio tienen salida controlada. No envíes emails ni notificaciones externas.

## 7. Rendimiento y consistencia durante cambios

Mide antes de optimizar, sobre el mismo equipo, configuración, semilla y comando. Prioriza consultas repetidas, escaneos completos innecesarios, sello, selección de fotografía, resolución de identidades y volumen serializado. Examina planes con `EXPLAIN (ANALYZE, BUFFERS)` **solo en bases de test**. Añade índices respaldados por consultas y migraciones incrementales; verifica su coste en cargas.

Conserva la lectura `REPEATABLE READ` y el paso del mismo cliente transaccional a los servicios. Una tabla, sus tarjetas, referencias y CSV no pueden mezclar finanzas de un lote con horas o configuración leídas después. Escribe pruebas con barreras deterministas que activen otro lote, cambien usuarios/Health/cobertura o configuración mientras se lee. El resultado debe ser íntegramente anterior o posterior, nunca una combinación.

Audita el sello como **detector de cambios**, no certificado ni archivo histórico. Cubre los estados/revisiones que realmente consume cada vista: una nueva observación de Work Item sin cambio de contenido, reversión, edición manual de enlace, vigencia, usuario, servicio, feedback, declaración de cobertura y activación de configuración. Una observación nueva puede cambiar frescura sin crear un bug nuevo. Un máximo global o recuento aislado no basta para detectar cualquier modificación. Si introduces contadores o invalidación, su incremento debe ser transaccional, cubrir todas las rutas y poder verificarse después de fallos. No añadas escaneos enormes a cada petición para corregir una omisión.

No uses caché persistente como primera solución. Si las medidas la justifican, documenta clave e invalidación por datos/configuración/permisos, prueba dos sesiones y cambios concurrentes, y evita contaminación entre simulación y publicado. No sirvas cifras viejas con sello nuevo. Detalle/CSV con sello antiguo deben avisar de la nueva lectura o usar una materialización existente identificada; no fingir continuidad.

No hay un SLA de producción aprobado. Como criterio técnico de esta entrega: evitar crecimiento de consultas con el número de entidades/filas, memoria proporcional al archivo y regresiones sistemáticas. Compara varias ejecuciones; una regresión de mediana superior al 20 % en una operación heredada, con entorno comparable, exige explicación y corrección o evidencia de variación del entorno. No reduzcas silenciosamente datos o cobertura para mejorar el resultado. Documenta el límite operativo medido y los cuellos de botella restantes.

## 8. Recuperación, concurrencia e idempotencia

Prueba con trabajador compilado y PostgreSQL real en test, no únicamente mocks:

- Interrupción de subida: no deja un lote activable ni un archivo final incompleto; cancelación antes de activar conserva el conjunto anterior.
- Matar/reiniciar durante preparación, activación, `REDERIVE`, reversión y generación de exportación. Usa una prueba representativa por tipo de operación y fuentes diferentes donde cambie la semántica; no repitas nueve veces el mismo motor sin motivo.
- Sustitución financiera: fallo en medio de reemplazar soporte de 2026 mantiene todo el lote anterior o publica el nuevo completo. Otras categorías/años permanecen intactos. Una revisión obsoleta se rechaza también al activar, no solo en la pantalla.
- Revertir la sustitución vigente restaura el conjunto anterior completo. Revertir un lote antiguo no puede pisar una sustitución posterior. Prueba dos activaciones y activación/reversión concurrentes del mismo ámbito.
- Repetir tiempos exactos no duplica; correcciones ambiguas requieren la decisión explícita ya existente. Un export antiguo de tickets no pisa una observación reciente.
- Revertir un lote de tickets retira su sustento de observación y cobertura; una revisión sustentada por otro lote válido sigue disponible. Calidad, Pulse y serie cambian coherentemente y no conservan ceros/colores acreditados por el lote revertido.
- Completar equivalencia/persona después de cargar y reprocesar no modifica el dato de origen ni duplica hechos. Conserva el aviso de atribución pendiente hasta tener un resultado coherente.
- Lease vencido, trabajador antiguo y dos trabajadores concurrentes: fencing impide confirmar al antiguo. Reintentos agotados dejan un fallo visible y recuperable, sin bucle ni «en ejecución» eterno.

No amplíes «Cancelar» para deshacer una activación ya confirmada a medias: el contrato distingue cancelar y revertir. La cancelación durante una operación atómica se resuelve en una frontera segura y se comunica; no promete corte inmediato de una transacción confirmada. No cambies la semántica comercial de un importador como atajo para superar una prueba.

Todo arnés con procesos hijo debe cerrar trabajador, web y conexiones en `finally`, también cuando falla el test. Corrige el problema heredado del trabajador huérfano y las esperas fijas demasiado cortas con sincronización/progreso y límites globales explícitos. No ocultes un test de 300.000 filas bajándolo a 100.000 sin declarar el cambio y sin volver a medir el volumen exigido.

## 9. Seguridad de pruebas y rutas

Mantén el guard central: `TEST_DATABASE_URL` explícita, base de test separada de la de trabajo y comprobación de `current_database()` en **la conexión que mutará**. Aplícalo también a nuevos benchmarks, semillas, migraciones de prueba y procesos hijo. Los casos negativos usan dobles/entorno aislado; jamás prueban el bloqueo lanzando realmente un borrado contra `cs_app`.

No limpies las dos cuentas residuales de 06: su eliminación sigue pendiente de Dennis. No crees cuentas, fixtures ni millones de filas en la base de trabajo. Almacenes de prueba/exportación temporales separados y limpieza restringida a sus propios UUID/directorios. Nunca registres credenciales, sesiones, contraseñas o archivos privados.

Prueba rutas web/API/Server Actions con sin sesión, cookie falsa, Consulta y Admin según permisos existentes. Incluye manipulación de ID de trabajo/lote/archivo, propietario, rutas, filtros no válidos y actor revocado mientras el trabajo espera. Verifica rechazo en servidor y ausencia de mutaciones/filtraciones. No introduzcas un sistema nuevo de permisos económicos por interpretar documentos antiguos: aplica el vigente, documentando cualquier contradicción.

## 10. Volumen y validación ejecutada

Construye comandos repetibles para generar/cargar/medir **solo sintéticos aislados**, sin versionar binarios grandes. Ejecuta los controles pertinentes a los cambios; al aprobarlos no repitas toda la suite por rutina. Para esta entrega, por tocar trabajador, exportación y motores comunes, se requiere:

1. Instalación reproducible con lockfile, tipos, lint y build de web/trabajador. Mantén el stack fijado, sin actualizar dependencias por conveniencia. Resuelve el warning heredado si la corrección es local y verificable; de lo contrario identifica exactamente su origen.
2. Suite rápida, contratos numéricos, migraciones y pruebas de autorización/consistencia nuevas; regresión de 06–08. Si hay migración, instalación limpia y actualización desde 08 con datos y revisiones inmutables conservados, sin reset.
3. Suites largas pertinentes y fallos/reinicios de §8, con resultado y tiempos. Los tests no aprobados permanecen visibles; no declares éxito global con exclusiones ocultas.
4. Recorrido de navegador compilado de las cuatro vistas, Administración y flujo completo de exportación: solicitar, salir/volver, descargar, cancelar, reintentar, caducar y rechazo por permiso. Verificar el contenido descargado, no solo HTTP 200 o número de archivos.
5. Cargas completas por navegador/trabajador de **XLSX de tiempos de al menos 250.000 filas** y **CSV de al menos 1.000.000 de filas**, con importadores operativos existentes, activación y repetición. Declara perfil, tamaño, filas válidas/duplicadas y cualquier configuración de límite usada; no sustituyas la prueba por medir el lector aislado o usar solo el perfil sintético del motor.
6. Exportación de **al menos 1.000.000 de hechos**, además de los resúmenes de las cuatro vistas, con recuento, checksum, unicidad, totales y recuperación; mide RSS del trabajador y la web. La generación y descarga no deben reservar memoria proporcional al contenido completo ni bloquear las cargas indefinidamente.
7. Benchmark de las cuatro vistas y detalles/CSV, con al menos 1.500 grupos, Clientes con usuarios propios, 250.000 tiempos, 116.000 tickets y varias fotografías —aproximadamente 225.000 observaciones—, PAP, vínculos, Health y cobertura suficiente para probar percentiles. Compara con la base real de 08 en el mismo entorno. Mide dos tamaños de cartera para detectar N+1.

Registra equipo/CPU/RAM, versiones, configuración, semilla, volúmenes, tamaño de archivo, consultas, mediana/rango de al menos tres medidas representativas, RSS absoluto/pico y tiempos separados de preparación/activación/exportación. Distingue frío/caliente si hay caché. Una prueba de lector, llamada de servicio y recorrido web son medidas diferentes. No extrapoles capacidad productiva ni inventes cifras si el entorno no permite medirlas.

Revisión a 1.440 y 390 px; navegación con teclado, foco de diálogos, progreso/errores anunciados, texto además de color y tabla equivalente para curvas. Documenta lo probado; no declares lector de pantalla o Windows verificados sin ejecutarlos. Los comandos nuevos deben funcionar con Node y tener instrucciones PowerShell, sin exigir Bash para el flujo normal.

## 11. Conciliación real reservada a Dennis

Dennis hará sus cargas reales, incluidas finanzas completas 2025 y 2026 y bugs VFS/VSW separados. No importes muestras privadas por iniciativa propia ni rellenes faltantes con datos sintéticos en su base. Una entrega técnica no requiere simular que esos archivos ya están disponibles.

Entrega un recorrido breve para: cargar/repetir; sustituir año/categoría con cambio y fila ausente; abrir comprobación de conciliación; declarar cobertura; comprobar un cliente y su grupo en cuatro vistas; revisar un ticket antiguo; descargar detalle completo y probar reversión con un lote de prueba propio. Pide las calibraciones únicamente cuando Dennis llegue a ellas, sin bloquear ahora el trabajo técnico.

Si existen fuentes reales autorizadas o cargas ya realizadas, puedes **leer y conciliar lo disponible** dentro de sus permisos y registrar diferencias privadas fuera de Git; no sustituir, revertir o borrar datos reales sin la acción expresa correspondiente. Si no existen, marca la conciliación real **pendiente de ejecución por Dennis**, separada de la batería sintética aprobada. Un apartado «pendiente» no puede contener resultados inventados.

## 12. Documentación, cierre y entrega a revisión

Mantén documentación modular e indexada, sin un informe único gigante. Como mínimo:

- Arquitectura de exportaciones/instantáneas, seguridad, recuperación y límites medidos; enlaza contratos compartidos en lugar de copiarlos.
- Contrato de conciliación con IDs estables para comprobaciones, granularidades y reglas no aditivas; resultados conocidos pequeños reproducibles.
- `docs/validacion/csapp-09.md`: pruebas ejecutadas, resultados, regresiones, medidas comparables, fallos corregidos y límites. Separa observado, implementado, propuesto, activado y aceptado.
- `docs/plan/guia-powershell-csapp09.md`: comandos reales, proceso web/trabajador, exportación, revisión y recuperación, con Windows explícitamente sin probar si corresponde.
- Actualiza documentos dueños de evolución/cobertura/CSV, índice, estado, roadmap, pendientes y registro de prompts. Corrige el estado Git con evidencia actual, distinguiendo integración en rama de integración en `main`.

CSAPP-10 conserva instalación final, aceptación de Dennis, guías completas de IT y copia/restauración del conjunto base+archivos en entorno autorizado. No declares restauración o despliegue por haber probado reinicios del trabajador en 09. No traslades a 10 una exportación, corrección o prueba técnica exigida aquí por falta de tiempo; si aparece un impedimento real, documenta exactamente qué no pudo ejecutarse y por qué.

Antes de cerrar, contrasta cada sección de este prompt con implementación y evidencia. No vale entregar solo documentación de exportaciones o un benchmark sin corregir las divergencias. Tampoco vale alterar expectativas para hacer pasar la suite sin explicar la regla de negocio.

Abre PR sin fusionar ni desplegar. Su descripción explica problema y comportamiento final, base real de la pila, migraciones, pruebas, medidas, riesgos y límites. El informe final a Dennis debe incluir:

1. Rama, base/SHA inicial y final, PR, relación con las anteriores y si el diff contiene solo 09.
2. Qué puede usar: conciliación, exportaciones, evolución mensual corregida y mejoras medidas.
3. Migraciones incrementales, compatibilidad y cualquier cambio visible respecto a 08.
4. Comandos y resultados realmente ejecutados, tamaños/medidas y pruebas no ejecutadas.
5. Conciliación sintética frente a real, calibraciones/propuestas pendientes y recorrido breve de Dennis.

Detente al terminar **CSAPP-09**. No empieces CSAPP-10, no actives propuestas en la base de trabajo, no cargues los archivos reales de Dennis y no afirmes aceptación o despliegue.
