# Roadmap de diez entregas para Claude Code

Diez prompts de implementación, cada uno con varias funcionalidades coherentes, una rama y una PR sin merge. No hay una entrega separada para cargar históricos operativos. Los grandes ficheros los probará Dennis cuando exista su importador. Las correcciones se incorporan en la revisión de su entrega. Cada prompt se redacta antes de su entrega conforme al estado real y se guarda en prompts/CSAPP-XX-vN.md; no se redactan ahora.

Todas las entregas parten de las lecturas comunes (AGENTS, CLAUDE, [índice](../00-index.md), [estado](estado.md) y prompt activo) y añaden las lecturas mínimas indicadas aquí, que repiten la tabla de la [guía documental](guia-documental.md). Rutas relativas a docs/.

| Entrega | Funcionalidad completa | Cierre exigido cuando se implemente |
| --- | --- | --- |
| CSAPP-01 | Base web, acceso, PostgreSQL propia, marca, navegación y maestros Grupo Cliente/Cliente/equivalencias | Arranque limpio, permisos, maestros editables y cuatro vistas identificadas sin métricas ficticias |
| CSAPP-02 | Personal unificado, matriz mensual de usuarios y motor común de cargas | Alias/roles, 65 a 68 desde junio sin alterar meses anteriores, progreso y activación recuperable |
| CSAPP-03 | Tickets canónicos con tags/creación/type/status y tiempos Zendesk | Revisiones/deduplicación, tickets sin horas, estado observado y corte PMO; Dennis prueba ambos XLSX |
| CSAPP-04 | Wrike, PAP y cargas separadas bugs VFS/VSW | CSV sin pérdida, horas correctas, PAP multicausa único, vínculos explícitos, reimportación sin duplicar ni cerrar por ausencia; Dennis carga |
| CSAPP-05 | Tres importaciones financieras y motor económico | Sustitución atómica año/categoría, prorrateo y CUM; históricos permitidos; Dennis carga 2025/2026 y repite |
| CSAPP-06 | Comparativa y Análisis Cliente | Tabla/ficha/curvas coherentes, mes anterior y año anterior completo/comparable, detalle integrado |
| CSAPP-07 | Pulse Rent y configuración de Administración | Catálogo, media/mediana/percentiles y bandas, pesos exactos 100, umbrales/referencias versionados |
| CSAPP-08 | Calidad, Client Health, diagnóstico, afectación estándar y backlog/antigüedad | Seis indicadores explicables en ambos ámbitos; stocks/flujo separados, sin historia inventada; configuración visible |
| CSAPP-09 | Conciliación, fiabilidad, rendimiento, exportaciones y recuperación | Reimportación/reversión, volumen medido, permisos y cifras conciliadas con cargas reales de Dennis |
| CSAPP-10 | Aceptación, guías y preparación/ejecución del despliegue autorizado | Instalación y copia recuperable, guía Windows/IT, aceptación registrada y despliegue solo en entorno autorizado |

Estado de las diez entregas: ver [estado](estado.md). CSAPP-01 y CSAPP-02 implementadas y fusionadas; CSAPP-03 implementada y en PR sin fusionar; el resto no ha empezado.

## CSAPP-DOC-00 Arranque documental, fuera del roadmap

Una rama y PR solo con Markdown: incorporar el paquete v0.4 revisado, archivar el prompt literal, establecer índices y propietarios, contratos de ocho campos/status y de ambos CSV, backlog y reglas aprobadas, modelo lógico, cálculos, diez entregas y aceptación. Comprobar enlaces, coherencia y ausencia de fuentes/secretos. No escribir aplicación, migraciones, SQL, configuración ejecutable, tests de software o cargas; no comenzar 01. Al terminar, el estado es documentación incorporada; las diez entregas siguen sin iniciar. No es entrega 0 de implementación ni se descuenta de las diez.

## CSAPP-01 Base y clientes

**Objetivo.** Dennis arranca la aplicación en limpio, entra con permisos, ve las cuatro vistas identificadas y edita los maestros Grupo Cliente/Cliente.

**Alcance.** Aplicación Next.js/TypeScript en cs-app, PostgreSQL propia, Prisma, arranque Windows, autenticación y permisos básicos. Menú con Comparativa, Análisis Cliente, Pulse Rent y Calidad; acceso separado a Administración. Mantener AGENTS/CLAUDE, índice, plantilla y prompts ya incorporados en DOC-00 (solo actualizarlos si cambia una ruta o el estado). Maestros de grupo BC y proyectos, equivalencias, soporte/alojamiento, complejidad/producto e hitos.

**Lecturas mínimas.** producto/alcance.md; producto/maestros.md; arquitectura/propuesta.md; arquitectura/modelo.md.

**Dependencias.** Solo DOC-00 incorporado. En esta entrega se verifican versiones concretas de Node, Next, Prisma y lector XLSX.

**Aceptación.** Arranca limpio, no usa otras bases, un grupo admite varias identidades y proyectos sin duplicar facturación, y los cambios tienen trazabilidad. Precargar solo los maestros autorizados, de forma idempotente. Las vistas futuras se identifican como pendientes, sin métricas ficticias.

**Prueba manual de Dennis.** Arranque en Windows desde cero, acceso con y sin permiso, edición de un grupo con varios clientes y revisión del historial de cambios.

## CSAPP-02 Personal, usuarios e importación común

**Objetivo.** Dennis gestiona personal unificado y la matriz mensual de usuarios, y dispone del motor de cargas aún sin fuentes concretas.

**Alcance.** Unificar personal PMO y resto con roles y alias. Matriz mensual de usuarios 2025 fija y 2026 editable, preparada para grupo y proyecto. Infraestructura de carga: lectura por bloques, validación, progreso, previsualización, huellas, confirmación y resumen dentro de Administración, con historial y recuperación. No existe bandeja independiente.

**Lecturas mínimas.** producto/maestros.md; producto/administracion.md; importaciones/proceso-comun.md; plan/precarga-y-pruebas.md.

**Dependencias.** CSAPP-01 (maestros, permisos, base).

**Aceptación.** El cambio 65 a 68 desde junio conserva los meses anteriores; los pesos de usuarios no se duplican entre ámbitos; cargar dos veces una fixture de test no duplica y un fallo no altera un lote activo. Reutilizar Grupo Cliente y Cliente; mantener total de grupo independiente cuando haya usuarios compartidos.

**Prueba manual de Dennis.** Cambiar usuarios de un cliente de 65 a 68 desde junio y comprobar meses previos; lanzar una carga de prueba proporcionada por la entrega y ver progreso, resumen e historial.

## CSAPP-03 Tickets y tiempos Zendesk

**Objetivo.** Dennis carga sus XLSX de tickets y de tiempos y obtiene resúmenes fiables sin duplicados.

**Alcance.** Dos importadores completos: entidades de tickets con los ocho campos reales (ticket_id, organization_id, Entorno y Tipología, CausaRaiz(Agr), tags, fecha_creación, type y status) y once columnas de tiempo. Resolver cliente/proyecto y persona; calcular horas; aplicar corte histórico PMO de enero de 2025. Resumen de descartes y reproceso al llegar relaciones. El único perfil vigente de ocho columnas está comprobado; los anteriores están sustituidos. Versionar el estado por observación, preservando extracción y carga. No buscar BUG en una descripción inexistente. Mantener todos los tickets válidos de Calidad, aunque no tengan horas.

**Lecturas mínimas.** importaciones/zendesk-tickets.md; importaciones/zendesk-tiempo.md; importaciones/proceso-comun.md; arquitectura/modelo.md; producto/backlog-antiguedad.md.

**Dependencias.** CSAPP-01 y CSAPP-02 (maestros, personal, motor de cargas).

**Aceptación.** Deduplicación y revisiones, logs sin ID estable, N3 único, mes de creación y distinción explícita de organizaciones internas, incluida VINCLE BUGS. Rechazo claro de perfiles antiguos. Dennis realiza la carga real de sus XLSX; no precargar su base con los ficheros de la inspección.

**Prueba manual de Dennis.** Cargar tickets y tiempos, repetir los mismos ficheros y comprobar que no se duplican; cargar una versión con un status cambiado y ver la revisión; probar el rechazo de un XLSX sin status.

## CSAPP-04 Wrike, PAP y producto

**Objetivo.** Dennis carga Wrike, PAP y los dos CSV de bugs desde entradas separadas.

**Alcance.** Importar CSV original respetando comillas, horas y fechas. Ticket explícito primero, inferencia inequívoca después y cliente por proyecto si falta ticket. Importar PAP con sus 29 campos y relaciones múltiples; cualquier causa correctiva clasifica el PAP como correctivo, y origen cliente se conserva en la carga y su diagnóstico, sin excluirlo del semáforo. Incorporar los dos CSV de producto, Work Item Bug_ y vínculos mediante Zendesk Ticket ID y URLs de Clients. Separar internos, clientes y elementos sin atribución. Resultado de PAP se conserva como informativo sin exigir OK.

**Lecturas mínimas.** importaciones/wrike.md; importaciones/pap.md; importaciones/bugs-producto.md; importaciones/proceso-comun.md; producto/diagnostico-origen.md.

**Dependencias.** CSAPP-02 (motor de cargas, personal) y CSAPP-03 (tickets y vínculos por ticket_id).

**Aceptación.** Fila de tarea con comas sin pérdida, 0,5 horas sin dividir por 60, tareas sin imputación excluidas del tiempo y PAP único aunque tenga varias causas/tickets. Reimportar no duplica ni cierra por ausencia; cargar VSW no toca VFS. PR significa pendiente de crear pull request con desarrollo terminado en rama; Ready for Release no prueba despliegue. Las vistas por año o de abiertos declaran alcance.

**Prueba manual de Dennis.** Cargar el CSV Wrike, el PAP, VFS y VSW por separado; repetir cada carga; cargar un VSW de vista más estrecha y comprobar que no se cierra ningún bug por ausencia.

## CSAPP-05 Facturación y cálculos económicos

**Objetivo.** Dennis carga las tres categorías financieras y ve ingreso imputado, horas, euros por jornada y CUM calculados.

**Alcance.** Soporte, administración delegada y OTROS reemplazan su año completo y categoría. Vta Potencial es ingreso; Diferencia se guarda separada contra Budget. Preparar históricos financieros existentes anteriores a 2025, respetando datos ya cargados por Dennis. Motor de horas, ingreso prorrateado, CUM y periodo equivalente anterior.

**Lecturas mínimas.** importaciones/facturacion.md; calculos/catalogo.md; plan/precarga-y-pruebas.md.

**Dependencias.** CSAPP-01 y CSAPP-02 (maestros, usuarios, motor de cargas); CSAPP-03 y CSAPP-04 para las horas que consume el motor.

**Aceptación.** 12000 anuales con corte 15/30 produce 500 del mes; sustituir admin 2026 de 100 a 120 deja 120 y no 220; otras categorías/años permanecen; filas ausentes del nuevo archivo dejan de estar activas; un fallo conserva el conjunto anterior.

**Prueba manual de Dennis.** Cargar 2025 y 2026 completos de cada categoría, repetir una categoría/año con un fichero revisado y comprobar sustitución, retirada de filas ausentes y conservación del resto.

## CSAPP-06 Comparativa y Análisis Cliente

**Objetivo.** Dennis consulta cartera y ficha con las mismas cifras.

**Alcance.** Completar las dos vistas sobre el mismo motor: bloques de cartera, media ponderada, mes anterior, año completo y CUM anterior comparable. Ficha con gráficos, equipos, causas, PAP, ingresos y detalle paginado/descargable integrado. Mes en curso inicial y selector de mes completo.

**Lecturas mínimas.** producto/comparativa.md; producto/analisis-cliente.md; calculos/catalogo.md.

**Dependencias.** CSAPP-03, 04 y 05 (hechos y motor económico).

**Aceptación.** Ficha y tabla coinciden con filtros idénticos; enero compara diciembre anterior; ingresos y horas respetan el corte y no se promedian ratios. Mostrar rentabilidad al ámbito real de BC sin repartirla en proyectos sin datos.

**Prueba manual de Dennis.** Elegir un cliente, comparar su fila con su ficha, cambiar a mes completo y verificar mes anterior, año anterior completo y comparable.

## CSAPP-07 Pulse Rent y configuración

**Objetivo.** Dennis analiza dispersión por usuario y administra pesos, umbrales y referencias.

**Alcance.** Catálogo de métricas por usuario, media/mediana y P10/P25/P75/P90, referencia visible y cinco bandas históricas. Administración incorpora pesos iguales exactos, editor personalizado que exige 100 por ciento, límites/dirección de cada KPI, referencias y opciones del global. La configuración no es una quinta vista de negocio.

**Lecturas mínimas.** producto/pulse-rent.md; producto/administracion.md; calculos/catalogo.md.

**Dependencias.** CSAPP-02 (usuarios) y CSAPP-03 a 05 (datos); CSAPP-06 comparte motor.

**Aceptación.** Percentiles conocidos, usuarios variables y nulos, total exacto de pesos, rechazo de 99 o 101 por ciento y cinco pesos efectivos de 20 si falta Health. Las propuestas de umbrales se identifican como tales antes de activarlas.

**Prueba manual de Dennis.** Intentar guardar pesos que sumen 99 y 101, guardar 20+20+15+15+15+15, comprobar que quedan versionados y revisar bandas y referencia en Pulse Rent.

## CSAPP-08 Calidad completa

**Objetivo.** Dennis ve los seis indicadores explicables por Grupo Cliente y Cliente, con diagnóstico y backlog.

**Alcance.** Los seis KPI con igual peso inicial, matriz de feedback mensual dentro de Calidad, grupo y proyecto, selector de periodo, evolución y detalle de cálculo. Diagnóstico por origen con todas las causas del cliente; bugs de producto y afectación mediante vínculos y causa estándar. Escalados por creación. Aplicar el sexto numerador aprobado: problemas externos vinculados a Bug_ o con causa estándar, en unión de IDs únicos. Incorporar backlog observado y antigüedad de incidentes/problemas dentro de su indicador; separar stocks y flujos, usuarios al corte e historia observada. No reconstruir cierres sin fecha ni estados pasados sin fotografías. Configurar la composición y umbrales sin activar propuestas silenciosamente.

**Lecturas mínimas.** producto/calidad.md; producto/backlog-antiguedad.md; producto/diagnostico-origen.md; calculos/catalogo.md; producto/administracion.md.

**Dependencias.** CSAPP-02 a 05 y 07 (configuración y pesos).

**Aceptación.** Un correctivo origen cliente sigue siendo visible y participa en su magnitud, con origen separado; no duplicar tickets en grupo; Health ausente redistribuye; datos técnicos ausentes no son cero; un incidente antiguo open sigue en backlog aunque no se creara en el mes; solved queda fuera y no crea otro ticket. En proyecto sin usuarios informar del denominador faltante.

**Prueba manual de Dennis.** Revisar los semáforos con sus cargas reales en ambos ámbitos, abrir el detalle de numerador y denominador, comprobar un incidente antiguo abierto y la etiqueta sin calibrar.

## CSAPP-09 Fiabilidad y volumen

**Objetivo.** Dennis confía en que las cifras concilian, el volumen se soporta y las cargas se recuperan.

**Alcance.** Conciliar las cuatro vistas con las cargas realizadas por Dennis y casos sintéticos aislados. Comprobar índices, memoria, tiempos de consulta, lectura grande, reimportación, recuperación/reversión, exportaciones y autorizaciones. Benchmark documentado con tamaño y equipo, sin prometer cifras no medidas.

**Lecturas mínimas.** validacion/aceptacion.md; arquitectura/propuesta.md y modelo.md; los contratos que revelen discrepancias.

**Dependencias.** CSAPP-01 a 08.

**Aceptación.** Repetir lotes no duplica, archivos grandes mantienen progreso y no congelan la UI, una sustitución fallida preserva el año y un usuario sin permiso no accede a archivos/importe. No inyectar un millón de fixtures en la base de trabajo de Dennis.

**Prueba manual de Dennis.** Revertir una carga, repetir cargas grandes, probar exportaciones con y sin permiso y revisar el informe del benchmark.

## CSAPP-10 Aceptación y operación

**Objetivo.** Dennis acepta el recorrido completo y IT dispone de la guía de instalación y recuperación.

**Alcance.** Recorrido de instalación, maestros, cargas, cuatro vistas, configuración y copia/restauración en entorno de prueba. Guía breve para Dennis y comandos de Windows; guía de producción y rollback para IT. Desplegar solo en el entorno autorizado y conservar PR sin merge hasta revisión.

**Lecturas mínimas.** plan/roadmap.md; plan/estado.md; validacion/aceptacion.md; guías operativas creadas durante la implementación.

**Dependencias.** CSAPP-09.

**Aceptación.** Instalación limpia, copia recuperable, documentación indexada y registro de pruebas ejecutadas por Dennis. Si falta entorno de producción, entregar la preparación completa y señalar ese dato concreto sin declarar despliegue realizado.

**Prueba manual de Dennis.** Instalación limpia en el entorno de prueba, restauración de una copia y recorrido registrado de las cuatro vistas y Administración.

## Hitos

Al finalizar 03 se prueban tickets/tiempos; al 04 Wrike/PAP/bugs; al 05 finanzas; al 06 las dos primeras vistas; al 07 Pulse Rent y configuración; al 08 las cuatro vistas. 09 y 10 consolidan el resultado. Cada prompt carga solo sus contratos y las decisiones aplicables y queda guardado en prompts/CSAPP-XX-vN.md.
