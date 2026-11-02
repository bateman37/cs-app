# CSAPP-10-v1 — Cierre técnico, instalación, recuperación y aceptación

## 1. Encargo, alcance y base Git

Trabaja exclusivamente en `bateman37/cs-app`. Implementa **CSAPP-10 completa**, décima y última entrega del roadmap. Deja una aplicación instalable y operable, una copia realmente restaurada, los pendientes técnicos de 09 resueltos y un recorrido de aceptación preparado para Dennis. Esta entrega incluye código, pruebas y documentación; no es únicamente redactar guías.

Antes de modificar aplicación, migraciones o pruebas, archiva **este prompt literal**, sin resumirlo ni corregirlo, en `prompts/CSAPP-10-v1.md` y actualiza `prompts/README.md`. Las decisiones y discrepancias se registran aparte. Conserva exactamente **Comparativa, Análisis Cliente, Pulse Rent, Calidad y Administración**. Sin quinta vista de negocio, séptimo KPI, funcionalidades ajenas o entrega CSAPP-11 creada por iniciativa propia.

Referencias comprobadas al redactar el prompt el **02/11/2026**:

| Referencia | Estado |
| --- | --- |
| `main` `f71b5b7283ab1081802cc6256899a02f70460a74` | Incluye CSAPP-05; no contiene 06–09 |
| Cabeza de PR 7 `31009c99398af314a87fe3eedef5b457ede31559` | Contiene 06, 07 y 08 |
| Cabeza de PR 10 `223b8810846efc33f2ab8a23f460acee2fa5197b` | CSAPP-09; rama `feature/CSAPP-09-conciliacion-exportaciones-rendimiento`, apilada sobre la rama de PR 7 |

Vuelve a comprobar el grafo y las PR al ejecutar. Si `main` contiene 01–09, parte de él. En caso contrario crea una rama propia desde la cabeza vigente que contiene 09, con **PR apilada contra esa rama**, mostrando solo 10. No añadas 10 a PR 7 o PR 10 ni reconstruyas las entregas que faltan en `main`. Rama sugerida: `feature/CSAPP-10-instalacion-recuperacion-cierre`.

Respeta cambios ajenos e historia publicada. Sin force-push, rebase publicado, borrado de ramas, fusiones automáticas o publicación de releases/tags. Si una restricción impide separar la rama, informa del impedimento sin contaminar otra PR. La integración en Git y la aceptación funcional son estados distintos.

El encargo autoriza desarrollo, verificaciones y ensayos locales aislados. **No autoriza desplegar en producción, fusionar PR, cargar archivos reales o borrar datos de Dennis.** Completa la preparación sin pedir permisos para trabajo reversible ya autorizado. Si existe una autorización previa explícita para un entorno concreto, respétala; no la supongas a partir de «última entrega».

## 2. Lecturas selectivas y diagnóstico de partida

Lee `AGENTS.md`, `CLAUDE.md`, `docs/00-index.md`, `docs/plan/estado.md`, este prompt y los apartados 09/10 del roadmap. Después:

- `docs/validacion/aceptacion.md`, `docs/validacion/csapp-09.md` y contrato de conciliación.
- `docs/arquitectura/exportaciones-csapp09.md`, guía del trabajador, configuración de entorno, instalación/base web y guías PowerShell anteriores solo cuando sean necesarias.
- Contratos de las cuatro vistas, cobertura y configuración para comprobar que el cierre respeta sus reglas, sin cargar toda la documentación en cada tarea.
- Entradas técnicas: `package.json`, `src/lib/{env,db,test-guard}.ts`, `scripts/worker.ts`, trabajador de cargas, `src/server/exports/`, `src/server/quality/{detail,engine,facts}.ts`, rutas de subida/descarga y arnés de navegador.

La revisión para preparar este prompt fue lectura dirigida de Git, código y documentación, **sin ejecutar aplicación ni suites**. Las 564 pruebas y 338 comprobaciones son resultados de 09, no de 10. Confirma por ti mismo el estado relevante antes de modificarlo.

Puntos comprobados que deben cerrarse:

| Punto de partida | Cierre exigido |
| --- | --- |
| Evolución mensual: 15,72 s y 189 sentencias para 1.500 entidades; invoca el cálculo de cartera por cada mes | Precargar hechos por mes/familia y reutilizar evaluación; conservar exactitud de 09 y reducir sustancialmente el coste (§5) |
| XLSX de 250.000 filas y CSV de un millón recibidos mediante función de servidor | Probar ambos desde el navegador y ruta real de subida hasta activación/repetición (§6) |
| Descarga grande implementada con stream, pero sin medir RSS web | Medir descarga completa y lenta, memoria y liberación al abortar; verificar archivo (§6) |
| Presencia del trabajador inferida de latidos de trabajos | Detectar también un trabajador vivo e inactivo, y distinguirlo de uno detenido (§4) |
| Conciliación sin puente automático Comparativa/Pulse por servicio | Completar el puente verificable de los perímetros comunes, explicando diferencias legítimas (§10) |
| README todavía presenta CSAPP-03 y vistas pendientes | Una entrada vigente, breve, con instalación y estado reales, sin nueve guías contradictorias (§12) |
| No existe prueba de copia/restauración completa | Herramientas y ensayo real con base, archivos, configuración recuperable y arranque (§7–8) |

No actives propuestas ni cambies decisiones de negocio para que el resultado parezca terminado. Conserva pendientes ECO 08, ZDT 11–13, ZTM 06–08, lista de origen PAP, estados de bugs, signo de «Diferencia» y Silver On Demand. Mapeos, perfiles, umbrales, referencias, muestras y composición/global siguen siendo elecciones del Administrador. Usa parámetros elegidos expresamente en fixtures aisladas para probarlos, sin activarlos en la base de trabajo.

## 3. Instalación reproducible y arranque compilado

La vía principal para Dennis es **Windows con PowerShell, Node y PostgreSQL**, manteniendo la aplicación web actual. Conserva stack y versiones fijadas por el repositorio; Node 22 y PostgreSQL 16 son la base ensayada en 09. No actualices dependencias por conveniencia ni declares probado todo el rango permitido por `engines`. No conviertas el proyecto en Electron ni impongas Docker, WSL, un proveedor cloud u otro stack. Producción necesita proceso Node web, trabajador persistente y almacenamiento privado persistente; documenta esas condiciones para IT sin inventar el destino.

Entrega un único recorrido vigente desde checkout limpio de un SHA que incluya 01–10:

1. Comprobar versiones soportadas y herramientas realmente utilizadas, conectividad y permisos PostgreSQL, puerto, origen de la aplicación, secreto, carpetas privadas y espacio libre. Mensajes accionables, sin imprimir credenciales.
2. Instalar con lockfile; generar cliente; aplicar migraciones **incrementales** con el comando de producción, sin `reset`, `db push`, semillas o `migrate dev` en una instalación operativa.
3. Compilar web y trabajador. El arranque habitual reutiliza esos artefactos: `npm start` y `npm run worker:start`, o un envoltorio equivalente. No recompiles el trabajador en cada reinicio de servicio.
4. Crear el primer Administrador mediante la herramienta existente con entrada segura; sin contraseña por defecto, registro público, cuenta sembrada o secreto impreso en argumentos/logs. Repetir instalación/migración no crea otra cuenta ni sobrescribe su clave.
5. Arrancar, comprobar salud, entrar y verificar estado vacío honesto, persistencia después de reiniciar y parada ordenada.

Añade comandos npm/CLI pequeños para comprobación, arranque/parada coordinados y diagnóstico si reducen errores. Deben funcionar sin Bash, identificar sus propios procesos y cerrar web/trabajador sin dejar hijos huérfanos. Nunca mates por nombre todos los `node.exe` ni servicios PostgreSQL ajenos. Puerto ocupado o un segundo arranque no deben crear una instancia accidental con otro almacén.

Web y trabajador deben usar la **misma configuración efectiva**, versión, base y almacenes aunque el directorio de trabajo o la cuenta de servicio cambien. Exige rutas absolutas para instalaciones operativas o una resolución estable documentada. Comprueba que originales y exportaciones son directorios privados distintos, fuera de `public/`, `.next/` y carpetas de release sustituibles. No copies los archivos al actualizar el código ni los borres al reinstalar dependencias.

Mantén `.env.example` y el catálogo de variables sincronizados con el código: obligatorias/opcionales, unidades, valores técnicos iniciales y efecto. Producción no hereda test/shadow ni perfiles sintéticos. Las opciones de pruebas no pueden habilitarse accidentalmente en el arranque operativo. Secretos, respaldos y fuentes quedan fuera de Git.

No confundas documentar PowerShell con ejecutarlo. Si no hay Windows disponible, verifica lo posible, registra comandos/sistema reales y deja la prueba Windows pendiente de Dennis/IT; no bloquees las demás verificaciones ni inventes compatibilidad demostrada.

## 4. Operación, salud y parada

Implementa una comprobación técnica mínima, consultable por CLI y por el Administrador, reutilizando Administración: versión/SHA, esquema compatible, conexión a la base, estado del trabajador incluso sin trabajos, colas, trabajos atascados y disponibilidad de los almacenes. Sin otra plataforma de monitorización.

Un latido por trabajador debe identificar instancia/versión y vigencia tanto en reposo como procesando. No uses la inexistencia de trabajos recientes como prueba de que está caído. Distingue «web responde», «base disponible», «trabajador ausente», «trabajador presente pero trabajo sin avanzar» y «almacén sin acceso/espacio». Umbrales técnicos documentados y pruebas con reloj controlado; no aumentes tiempos arbitrariamente para ocultar fallos.

La comprobación pública, si la hay, devuelve únicamente salud mínima. Detalles, rutas, colas y configuración efectiva se restringen a Administrador. Ninguna devuelve secretos, DSN, sesiones, SQL o contenido de clientes. Los diagnósticos descargables se redactan para excluirlos.

Prueba parada/reinicio de web y trabajador, pérdida temporal de base y almacén no accesible. Reintentos acotados, error identificable y recuperación sin duplicados. El cierre permite terminar o devolver el trabajo en una frontera segura, con tiempo máximo y mensaje claros. No declares listo un trabajo por recibir una señal de parada.

Documenta operación manual con los procesos compilados y un ejemplo para supervisión por IT, sin instalar servicios del sistema o programar tareas en equipos reales. Logs con fecha, nivel, instancia y correlación de lote/trabajo; sin volcar filas privadas. No publiques una instancia sin autenticación para facilitar el ensayo.

## 5. Cierre de rendimiento de la evolución de Calidad

En 09 la serie es correcta porque evalúa cada mes con sus hechos, cobertura, fotografía y cohorte; su coste creció al repetir lecturas de cartera. **Conserva esa corrección.** Cargar la sección aparte con `Suspense` mejora la percepción, pero no resuelve las 189 sentencias ni los 15,7 segundos.

Separa obtención de hechos y evaluación. Lee por conjuntos, agrupados por mes cuando sea posible: tickets, horas elegibles, PAP, usuarios, Health, criterios de cohorte y declaraciones. Resuelve fotografías compatibles por periodo y consulta sus stocks sin multiplicar lecturas por entidad. Compártelo con la ficha/evaluador mensual; no crees otra fórmula de colores. Mantén una lectura coherente, misma revisión activa identificada y dependencias del sello.

No uses un caché para ocultar el coste inicial ni reutilices la referencia del último mes. Se conservan ceros confirmados/nulos/parciales, política EXACT/última anterior, fechas y usuarios propios de la observación, Client Health del mes y seis pesos. No inventes historia publicada: sigue siendo **serie recalculada con revisión activa**. Prueba también borrador simulado frente a publicado.

Antes y después, misma fixture/comando/equipo que 09: 1.500 y 750 grupos, usuarios propios, 250.000 tiempos, 116.000 tickets y varias fotografías. Al menos tres medidas por tamaño, consultas, mediana/rango, RSS y resultado íntegro. La paridad incluye valores, estados, colores, percentiles, muestra, denominadores y explicación relevante; no basta comparar una captura.

**Objetivo técnico de cierre:** reducir al menos un 50 % la mediana de la evolución frente a 09 en el mismo entorno y eliminar la repetición del cálculo completo por cada mes. No es un SLA productivo. Si no se alcanza, continúa investigando y no declares este pendiente resuelto por haberlo explicado. No mejores tiempos quitando entidades, meses, cobertura o referencias. Comprueba que las otras vistas y cargas no sufren una regresión sistemática superior al 20 % sin causa/corrección justificada.

## 6. Cargas y descargas grandes por navegador

Completa las pruebas omitidas en 09 con web y trabajador **compilados**, PostgreSQL y almacenes `_test` aislados. Desde una sesión real de navegador, selecciona el fichero, súbelo por el control habitual, sigue el lote, revisa y confirma. No sustituyas esta prueba por llamar `receiveUpload`, una Server Action directamente o un cliente HTTP externo.

- XLSX de tiempos Zendesk de **al menos 250.000 filas**.
- CSV original compatible de Wrike de **al menos 1.000.000 de filas**.
- Repetición de ambos: conteos/minutos conciliados, sin duplicación. Prueba además interrupción de una subida y rechazo de un formato incorrecto sin lote activable.

Genera sintéticos por streaming fuera de Git, con importadores operativos. Registra bytes, límites efectivos, red/ruta, tiempos de subida/preparación/activación, memoria y comportamiento de la UI. Si aparece un límite del framework, proxy o payload, corrige/configura la ruta real conservando validación y límites; no reduzcas el fichero o aumentes todos los límites sin justificarlo.

Descarga por navegador el CSV de **al menos un millón de hechos** —aproximadamente 230 MB en la prueba de 09—; verifica bytes, SHA-256, filas, unicidad y total contra manifiesto. Prueba lectura lenta y cancelación de una descarga. Mide RSS de web y trabajador durante todo el intervalo, no solo al iniciar. Contrasta también un archivo menor para detectar crecimiento proporcional al tamaño.

La descarga usa streams con contrapresión, cierra descriptor al abortar y no acumula el archivo en la web mediante `arrayBuffer`, `Buffer.concat` o equivalente. Cancelar la descarga no elimina un export listo ni sus fuentes. Los controles de sesión, propietario, caducidad y caché privada siguen operativos. Mantén una consulta ligera utilizable durante la transferencia y documenta su latencia; no afirmes que la UI responde solo porque un servicio interno lo hace.

Documenta los límites que el proxy de producción deberá respetar. Si no existe ese proxy todavía, no declares probado ese salto. Conserva la distinción entre prueba local de navegador, prueba Windows y capacidad productiva.

## 7. Copia coherente de base y archivos

Implementa herramientas mantenibles de **crear, verificar y restaurar** respaldos, invocables por npm/Node y documentadas para PowerShell. Utiliza herramientas oficiales PostgreSQL (`pg_dump`/`pg_restore`) mediante procesos sin interpolación insegura; no inventes un volcado SQL propio. Valida que las herramientas estén disponibles y sean compatibles. No pases contraseñas por argumentos visibles ni las imprimas.

La vía inicial será **copia con parada controlada de las instancias de CS App**. Documenta indisponibilidad y secuencia: impedir nuevas operaciones, detener web y todos sus trabajadores, esperar cierre/rollback seguro y asegurar ausencia de escritores, incluidas caducidad y limpieza de archivos. Después copiar base y almacenes. Un dump consistente no hace coherentes por sí solo los archivos copiados mientras otro proceso los cambia. No impongas backup en caliente ni alta disponibilidad.

La herramienta no anuncia copia coherente si no puede acreditar la condición operativa requerida. Coordina procesos supervisados para que no reaparezcan a mitad de la copia. Bloqueo propio para impedir dos copias/operaciones incompatibles. Tiempo máximo y salida controlada ante trabajo que no termina; nunca fuerces una activación a estado completado para continuar.

Contenido mínimo:

- Volcado de la base, migraciones aplicadas, maestros, personal, usuarios, lotes/procedencia, hechos/revisiones/observaciones, cobertura, Health, configuraciones/auditoría, conciliaciones y trabajos/materializaciones de exportación.
- Archivos fuente conservados y artefactos referenciados de los almacenes privados. Clasifica temporales y exportaciones ya caducadas; cualquier exclusión debe concordar con el estado restaurado, no dejar un archivo `READY` inexistente.
- Manifiesto: formato del backup, identificador, SHA de aplicación, versiones PostgreSQL/herramientas, fecha, esquema/migraciones, inventario relativo de archivos con bytes/checksum y comprobaciones de totales/identidades. Nada de claves o valores secretos.
- Inventario de configuración que deberá recuperarse por un canal seguro separado: secreto de autenticación y demás variables necesarias. No metas `.env`, credenciales o claves en un ZIP sin protección ni en el manifiesto público. La guía indica qué custodiar y cómo suministrarlo al restaurar.

Escribe en destino temporal, valida todos los pasos y publica el conjunto mediante renombrado/estado final solo si está completo. Backup interrumpido, sin espacio o con `pg_dump` fallido no aparece como recuperable. Directorio fuera de los almacenes copiados para evitar recursión; tratamiento seguro de nombres, rutas y enlaces. Hash/copia por bloques, sin cargar archivos enteros.

No establezcas borrado automático de fuentes o backups históricos sin política aprobada. Propón frecuencia, custodia, acceso y retención para IT como opciones explícitas; no declares RPO/RTO contratados ni programes tareas reales. Los respaldos contienen datos privados y requieren almacenamiento restringido.

## 8. Restauración realmente ejecutada y verificada

Ensaya en base y carpetas **nuevas, vacías y aisladas**. Por defecto, el restaurador rechaza un destino existente con datos; nunca utiliza `--clean`, `DROP DATABASE`, `TRUNCATE` o un reset para hacer sitio. Verifica servidor/base efectiva y destino de archivos, no solo que dos URLs sean distintas. Nunca restaura encima de `cs_app`, otras aplicaciones o el origen.

Antes de mutar destino valida manifiesto, integridad y compatibilidad. Prueba copia corrupta/truncada, versión incompatible y destino equivocado: rechazo previo, sin tocar datos. Rutas del inventario no pueden escapar del destino. No anuncies restauración terminada por el código de salida de `pg_restore` únicamente.

Secuencia mínima demostrada:

1. Preparar una instalación de prueba con datos sintéticos representativos de 01–09: usuarios variables, vigencias, fuentes, más de una observación, sustitución financiera y su predecesora, Health/configuración, cobertura, un informe de conciliación y exportaciones con propietario.
2. Registrar resultados y manifiestos de referencia; detenerla de forma controlada y crear/verificar el respaldo completo.
3. Restaurar en otra base `cs_app_…_test` y almacenes nuevos, con origen/secretos de prueba propios; no arrancar trabajadores automáticamente ni reutilizar conexiones al origen.
4. Comprobar migraciones, recuentos, identidades, relaciones, revisiones inmutables, lotes activos y checksums. Preservar el historial y las versiones de configuración; no recalibrar ni reprocesar todo para hacer coincidir cifras.
5. Arrancar web restaurada, entrar con cuenta de prueba y comparar las cuatro vistas, detalles, cobertura y conciliación con la referencia. Los timestamps técnicos legítimamente nuevos se distinguen de diferencias de datos.
6. Descargar como propietario una exportación restaurada aún vigente y verificar checksum. Caducadas siguen caducadas: no amplíes su vida útil para pasar el test. Verificar también disponibilidad de originales según permisos.
7. Revisar trabajos pendientes/leases y arrancar el trabajador restaurado de forma deliberada; demostrar que retoma sin duplicación ni publicación parcial. Normalización de estado operativo, si hace falta, debe ser explícita y auditada, sin confirmar trabajos ficticiamente.
8. Conservar fuente intacta y medir tiempo de copia, verificación, restauración y puesta operativa. Documentar también espacio requerido y resultado de la comparación.

Ensaya una cola pendiente mediante parada segura, sin necesidad de respaldar archivos que están escribiéndose. Separa restauración para prueba de recuperación real: cambia origen de la app, impide conexiones/notificaciones externas y trata las sesiones restauradas para que no se conviertan en accesos válidos al entorno equivocado. No cambies silenciosamente el secreto de la instalación de origen.

Las herramientas deben funcionar con rutas Windows con espacios y directorios persistentes explícitos. Si solo se ejecutan en Linux, identifica ese límite y entrega el recorrido Windows pendiente. **Reiniciar un proceso, aplicar migraciones vacías o restaurar únicamente el dump no satisface esta sección.**

## 9. Actualización, vuelta atrás y preparación de producción

Entrega una guía ensayada para actualizar **09 → 10** sin perder datos y otra de vuelta a la versión anterior. Separa reversión de código y restauración de datos: Prisma no garantiza un downgrade automático del esquema. Migraciones nuevas, si hacen falta, serán incrementales; no modifiques las ocho anteriores ni los payloads inmutables.

Antes de actualizar: respaldo verificado, identificación de SHA/versiones/esquema, parada coordinada, migración explícita, build/artefactos compatibles, comprobación y arranque. Ensaya desde una base con datos de 09, no solo desde vacío. Si código anterior es compatible con el esquema nuevo, demuestra el rollback sin borrar datos. Si no, ensaya restauración completa en destino separado y documenta la conmutación y la pérdida potencial de escrituras posteriores al backup.

La guía de IT debe especificar: procesos persistentes, supervisor/reinicio, usuario de servicio y permisos mínimos, volúmenes privados compartidos por web/trabajador, secretos, URL/orígenes confiables, TLS/cookies, proxy y límites de carga/descarga, migración, salud, logs y copia/restauración. No inventes dominio, servidor, presupuesto, SSO, proveedor o disponibilidad de Windows en el entorno de Claude.

Prepara un candidato identificable por SHA, lockfile, migraciones y comandos. No exige fusionar antes para poder ensayarlo. No se publica ni se aprovisiona infraestructura por este prompt. Si falta destino/autorización de producción, deja **preparación completa y despliegue pendiente**, con los datos concretos que IT deberá aportar, sin detener el cierre técnico por esa ausencia.

## 10. Aceptación funcional y datos reales de Dennis

Completa el puente de conciliación pendiente de 09 para los perímetros compartidos de Comparativa, Análisis Cliente y Pulse, por periodo/servicio/ámbito. Parte de las comprobaciones existentes; muestra numeradores, denominadores, método/unidad, diferencias y exclusiones, en la misma lectura. Calidad se contrasta con sus indicadores y detalles, no forzando igualdad con horas de otro perfil o filtro financiero. No construyas otro motor ni compares números solo porque comparten nombre.

Prepara un recorrido de aceptación con IDs estables, resultado esperado, evidencia, ejecutor, fecha y estado: **pendiente, aprobado o fallido**. Un resultado sintético de Claude y una aceptación con datos reales de Dennis van en registros diferentes. No rellenes su firma/fecha ni conviertas PR fusionada en aceptación.

Recorrido mínimo:

- Arranque compilado, acceso Admin/Consulta, rechazo en servidor y cierre de sesión; Consulta sin mutaciones de Administración ni acceso a originales/exports ajenos.
- Grupo Cliente/Cliente, equivalencias, personal histórico y matriz de usuarios. 2025 fijo; 2026 mensual; 65 hasta mayo y 68 desde junio produce 665 usuarios mes enero–octubre y stock 68. Nulo distinto de cero; total propio del grupo sin sumar usuarios compartidos.
- Nueve perfiles operativos, estado del trabajador, carga/repetición/corrección/reproceso/reversión. Tickets sin horas conservados; PMO desde 2025 de Wrike; originales sin alteración ni deduplicación por parecido.
- Finanzas 2025/2026 de tres categorías, cada una con sustitución anual completa e independiente; 12.000 €/año con corte 15/30 da 500 € del mes. No inventar reparto de ingreso agrupado entre Clientes.
- Comparativa y ficha: mes/corte, mes anterior, CUM actual, año anterior completo y comparable, curva y detalle conciliados; parámetros económicos configurables.
- Pulse: perfiles, usuarios mes, referencias independientes del filtro de filas, ceros sustentados, percentiles y CSV. M11 no facturable no se inventa sin fuente.
- Calidad: Health mensual propio, seis indicadores/global, pesos exactos y cobertura, borrador/simulación/activación solo cuando lo elija el Administrador. Health en blanco redistribuye; técnico ausente no. Sin calibración/datos no hay verde.
- Tickets antiguos abiertos en backlog por fotografía compatible, fechas/edades propias; flujo por creación y stock separados. N3 único con varios tags; PAP multicausa único y causa cliente conservada; unión de problemas estándar/vinculados a `Bug_`, sin duplicación por relaciones múltiples.
- Diagnóstico distingue estándar, configuración/personalización/procesos, Sistemas del Cliente, Uso Indebido e infraestructura CLOUD/OP, sin excluir carga ni afirmar causas no demostradas.
- Exportación completa, informe de conciliación y recuperación desde la copia; persistencia después de reinicio.

Las cargas reales, incluidas finanzas completas 2025/2026 y bugs VFS/VSW separados, **las realiza Dennis**. No precargues fuentes privadas o sintéticos en su base. Si ya hay datos autorizados, puedes revisar lo disponible en lectura; no sustituyas/reviertas lotes reales por iniciativa propia. Las dos cuentas residuales de 06 siguen pendientes de su decisión: no las borres ni las reutilices como cuentas de producción.

Entrega una guía de puesta en marcha de datos: maestros mínimos, orden flexible de cargas y reproceso cuando lleguen relaciones, declaración de cobertura, usuarios, interpretación de faltantes y calibración/simulación antes de activar. No exige que todos los datos lleguen en un orden rígido ni crea una bandeja nueva. Explica que un cuadro sin colores puede estar funcionando correctamente por falta de configuración/evidencia.

Lista aparte las decisiones pendientes con su efecto concreto y pantalla/documento dueño. No repitas preguntas ya resueltas ni pidas toda la calibración para poder completar pruebas técnicas. Mantén visibles qué condiciones faltan para usar un indicador con confianza, sin declarar el negocio aceptado.

## 11. Verificación final y seguridad del ensayo

Todo test, benchmark, migración/restauración de prueba y proceso hijo usa guard central: `TEST_DATABASE_URL` explícita, nombre de test, distinta del origen operativo y comprobación de `current_database()` en la conexión que mutará. Archivos de test aislados, limpieza restringida a sus propios destinos y procesos. Casos negativos con dobles o recursos aislados, nunca lanzando un borrado real contra `cs_app` para comprobar si se bloquea.

Ejecuta, como mínimo:

1. Instalación limpia reproducible, migraciones desde vacío y actualización desde 09 con datos; schema sin deriva; web/trabajador compilados, tipos y lint.
2. Suite rápida y regresión pertinente de las cuatro vistas, consistencia/percentiles, permisos y nuevas herramientas. Pruebas negativas de backup/restore antes de mutar destino.
3. Recorrido completo de navegador compilado y los casos grandes de §6, incluyendo contenido descargado y memoria. Revisión a 1.440 y 390 px, teclado, foco, estados anunciados y alternativas textuales a colores/gráficos.
4. Comparación de rendimiento de §5 y ensayo completo de copia/restauración/arranque de §8.
5. Trabajador real, recuperación e idempotencia afectados por el cierre/latido/almacenes; no reduzcas los tests heredados de 300.000 filas ni excluyas fallos para declarar verde.
6. Actualización y rollback ensayados; comprobación de aislamiento entre instalación original/restaurada y sesiones/propietarios.

Registra comandos, sistema, versiones, CPU/RAM, semilla, tamaños, resultados y evidencias. Ejecuta las suites necesarias una vez después de los cambios finales; repite solo por cambios, fallos o incertidumbres nuevas. No versionar binarios grandes, datos privados, respaldos, secretos o capturas con información real.

La advertencia de `pg` de 09 no autoriza actualizar el stack por conveniencia. Si puedes atribuirla a consultas concurrentes sobre el mismo cliente transaccional y corregirla localmente, hazlo con prueba. Si pertenece a la dependencia y no hay corrección verificable dentro del alcance, conserva el límite exacto y versiones, sin afirmar que se resolvió ni saltar a pg 9.

Si no hay Windows o lector de pantalla, informa **no ejecutado**; no llames a una revisión estática prueba de ese entorno. Ausencia de datos reales o host de producción no impide completar ensayos aislados. Un impedimento técnico real se identifica con comando/error/alcance, trabajo independiente completado y pasos de resolución; no se oculta como propuesta futura.

## 12. Documentación modular, estado final y PR

Reorganiza la entrada documental para que Dennis e IT no tengan que reconstruir diez entregas. Mantén historia y prompts intactos; crea una guía vigente y marca las guías por entrega como históricas cuando corresponda. Sin duplicar fórmulas, contratos o instrucciones ejecutables en diez sitios.

Organización mínima, adaptándola al índice existente:

| Documento/área | Contenido dueño |
| --- | --- |
| README e índice | Qué existe, versión/estado, arranque breve, mapa de lectura y enlaces vigentes |
| Instalación y operación | Windows/PowerShell, procesos compilados, variables, salud, incidencias y rutas persistentes |
| Copia/restauración | Herramientas, coherencia, custodia de configuración, verificación, ensayo y límites |
| Actualización/despliegue IT | SHA/artefactos, migración, proxy/servicios, rollback y requisitos de destino |
| Guía de Dennis | Primer acceso, maestros, usuarios, cargas, cobertura, calibración y lectura de las cuatro vistas |
| `docs/validacion/csapp-10.md` | Evidencia técnica ejecutada, cifras, comparación, fallos corregidos y no ejecutado |
| Registro de aceptación | Casos y estado de Dennis/IT, separado de pruebas sintéticas; decisiones pendientes |
| Estado/roadmap/prompts | Diez entregas, relación real de PR, cambios incluidos y límites, sin declarar aceptación inexistente |

Verifica enlaces internos, rutas y comandos desde checkout limpio. Los pasos no pueden depender de un archivo temporal, una base sembrada oculta o un proceso que quedó vivo de otro test. `AGENTS.md`/`CLAUDE.md` continúan siendo entradas breves; no les añadas el informe completo.

Clasifica el cierre con precisión:

- **Implementación técnica:** secciones de este prompt realizadas y verificaciones ejecutadas, con límites concretos.
- **Datos y aceptación funcional:** cargas/calibraciones y recorrido que Dennis haya ejecutado realmente, o pendientes.
- **Producción:** destino, autorización, instalación y despliegue efectivos, o preparación entregada y despliegue pendiente.

La última entrega del roadmap no convierte automáticamente los tres estados en aprobados. No declares «listo para producción» si quedan pruebas relevantes o condiciones de operación sin verificar. Tampoco inventes una entrega 11 para apartar los requisitos técnicos de esta.

Abre **PR propia sin fusionar ni desplegar**. Descripción para un revisor sin contexto: problemas concretos, comportamiento final, base/pila, migraciones, compatibilidad, pruebas, rendimiento, restauración, riesgos y limitaciones. Antes de cerrar, contrasta cada sección de este prompt con implementación y evidencia.

Informe final a Dennis, breve y comprobable:

1. Rama, base/SHA inicial/final, PR y relación con las anteriores; confirmar diff exclusivo de 10.
2. Qué puede arrancar y con qué comandos de producción; versiones/configuración/rutas necesarias.
3. Pendientes de 09 cerrados y comparación medida; no llamar resuelto a una carga grande que no pasó por navegador.
4. Copia/restauración realmente ejecutada: tamaño, destino aislado, tiempos, checksums y paridad funcional.
5. Pruebas ejecutadas/no ejecutadas, Windows/lector, cambios de esquema y rollback.
6. Recorrido inmediato de Dennis, decisiones concretas pendientes y estado separado de implementación, aceptación y despliegue.

Detente al completar **CSAPP-10**. Conserva las cargas reales y decisiones del Administrador, no firmes la aceptación de Dennis y no publiques la aplicación por iniciativa propia.
