# CSAPP-02-v1 — Personal, usuarios mensuales y motor común de cargas

Repositorio único: https://github.com/bateman37/cs-app.
Entrega: CSAPP-02 de diez. CSAPP-DOC-00 queda fuera del roadmap.
Rama propuesta: feature/CSAPP-02-personal-usuarios-cargas.
Archivo obligatorio: prompts/CSAPP-02-v1.md, con este texto íntegro.

## 1. Resultado requerido

Continúa la aplicación entregada en CSAPP-01. Debo poder gestionar PERSONAL unificado desde Administración, configurar usuarios contratados mensuales por Grupo Cliente y Cliente/implantación, y disponer del motor común de cargas probado de extremo a extremo y recuperable tras reinicios.

Son tres partes de una misma entrega. No basta un conjunto de tablas y pantallas vacías: personal y matriz deben funcionar con persistencia, permisos e historial; el motor debe procesar archivos de verdad y demostrar sus garantías con un perfil sintético aislado de pruebas. Los importadores operativos empiezan en CSAPP-03; no los adelantes.

Mantén las cuatro vistas principales: Comparativa, Análisis Cliente, Pulse Rent y Calidad. Personal, Usuarios y Cargas son apartados de Administración. No avances a CSAPP-03 ni despliegues.

## 2. Base real, continuidad y rama

El informe de CSAPP-01 indica PR https://github.com/bateman37/cs-app/pull/2, rama claude/new-session-omvsmd y commit bfa4cbe. Son referencias del informe, no una inspección independiente. Comprueba el estado actual, instrucciones y código reales antes de modificar nada; registra el SHA completo de partida.

Si la PR 2 está fusionada, parte del main actualizado. Si sigue abierta, crea una rama nueva desde su HEAD actual y una PR dependiente con esa rama como base para que el diff contenga CSAPP-02. Explica la dependencia; no fusiones, cierres, reescribas o modifiques la PR 2 ni su rama. No hagas force-push. Conserva cambios locales ajenos, usando un checkout aislado si hace falta.

Archiva este prompt literal antes de editar código. No sobrescribas prompts ejecutados. Lee el estado y comprueba que la primera entrega está presente; no reconstruyas CSAPP-01 desde cero.

Versiones reportadas: Next 16.4.3, React 19.3.1, TypeScript 5.9.3, Prisma 7.10.1, Better Auth 1.7.14, Node 22.22.0 y PostgreSQL 16.15. Verifica package/lockfile y entorno y conserva la combinación que funciona. No migres a Prisma 8, TypeScript 7 u otra rama por novedad. Una incompatibilidad real exige evidencia, corrección acotada y documentación, no una actualización general.

Preserva la migración inicial 20261029200318_base_acceso_y_maestros y sus datos. Añade migraciones incrementales. No uses reset, drop o recreación de la base para desarrollar esta entrega. Mantén cs_app, cs_app_test y cs_app_shadow aisladas; las pruebas destructivas requieren un destino de test explícito. El prefijo cs_app por sí solo no distingue una base de pruebas de otra de trabajo.

## 3. Lectura necesaria

Entrada: AGENTS.md, CLAUDE.md, docs/00-index.md, docs/plan/estado.md y el apartado CSAPP-02 de docs/plan/roadmap.md.

Después, únicamente:

- docs/producto/maestros.md, especialmente MST 05–06 y USR 01–05, respetando MST 07–08.
- docs/producto/administracion.md, apartados aplicables a esta entrega.
- docs/importaciones/proceso-comun.md.
- docs/arquitectura/propuesta.md y modelo.md, para las entidades y garantías afectadas.
- docs/plan/precarga-y-pruebas.md.
- docs/calculos/catalogo.md, solo convenciones de usuarios, nulos y exposición.
- docs/decisiones/DEC-003-status-backlog-y-arranque-documental-v04.md.
- Guías y decisiones técnicas de CSAPP-01 localizadas desde el índice, incluida docs/plan/guia-powershell-csapp01.md si esa sigue siendo su ruta.

Inspecciona código y pruebas existentes de autenticación, permisos, auditoría, vigencias, concurrencia, protección de bases y navegación. Reutilízalos. No cargues toda la evidencia histórica ni los exports operativos para implementar este núcleo.

## 4. Cerrar la reproducibilidad de CSAPP-01

El informe declara 31 pruebas con PostgreSQL y 41 comprobaciones Chromium, pero el guion de estas últimas no está versionado. Comprueba lo disponible y conserva en el repositorio una versión mantenible del recorrido y sus comandos. Recupera el guion si existe en el entorno; si no, implementa los casos esenciales sin atribuirte retrospectivamente los 41 originales.

Debe poder repetirse con cuentas y datos sintéticos en test: alta/provisión de cuenta compatible con Better Auth y login real, cookie falsa, acceso sin sesión, mutación forjada como Consulta, cierre de sesión, límite de intentos y persistencia tras reinicio. El defecto de identificador de cuenta corregido en CSAPP-01 debe quedar cubierto. Ninguna comprobación se limita a que el botón esté oculto.

Esto forma parte de consolidar la base de esta entrega; no crea otra entrega del roadmap. No declares Windows/PowerShell probado: el informe anterior solo probó Linux. Conserva ese pendiente hasta disponer de evidencia real.

## 5. PERSONAL único

En Administración crea un único maestro de personas. PERSONAL y PERSONAL PMO no deben convertirse en catálogos independientes.

| Campo | Regla |
| --- | --- |
| Identificador interno y nombre canónico | Estables, sin depender de un nombre externo |
| Persona PAP | Nombre/alias y correo o ID si existen en la fuente |
| Persona Zendesk | ID y nombre/alias cuando se conozcan; sin columna duplicada |
| Persona Wrike | Nombre/ID opcional; no todos tienen cuenta |
| Nivel y equipo | Valores del maestro/catálogo, con vigencia; sin inferirlos por nombre |
| Pertenece a PMO | Atributo operativo con vigencia, separado del rol de acceso |
| Rol PMO | ANA o DEV como valores iniciales conocidos; desconocido queda sin informar |
| Estado | Activo/inactivo, conservando historia y alias |

Permite alta, consulta, búsqueda, filtros, edición, desactivación/reactivación, alias por sistema e historial desde la web. Usa catálogos mínimos de nivel/equipo y rol conforme a las fuentes disponibles; no inventes empleados ni asignaciones. Una persona puede no tener alias en todos los sistemas. No elijas ANA/DEV por defecto para completar un dato desconocido.

Identidad y alias se asignan explícitamente. Una coincidencia parcial de nombres no fusiona personas. Un mismo alias/ID de un sistema no puede pertenecer a dos personas en vigencias solapadas, también ante concurrencia. Preserva alias antiguos y valores originales. Las 75 filas de PERSONAL y 17 de PMO del libro no equivalen automáticamente a 92 personas distintas.

Nivel, equipo, pertenencia PMO y rol deben poder resolverse a la fecha de un registro. Reutiliza la convención [desde, hasta) y las garantías de no solapamiento de CSAPP-01. No basta guardar el último valor con updated_at. Una situación inicial de fecha desconocida debe señalarse; no inventes trayectoria laboral.

Si PMO es falso, no debe mostrarse un rol PMO vigente como si aplicara. Cambiar de equipo o salir de PMO conserva la asignación anterior en historia. No implementes todavía selección de horas Zendesk/Wrike: deja el servicio de resolución temporal preparado y probado para CSAPP-03.

PERSONAL no son cuentas Better Auth. Sus alias no conceden permisos ni crean cuentas. Guardar cambios y auditoría es atómico; rechaza una edición obsoleta sin perder silenciosamente cambios de otro administrador.

## 6. Matriz de usuarios contratados

En Administración › Usuarios, ofrece selección de año y ámbito, búsqueda y una matriz enero–diciembre. Son usuarios que pagan; no usuarios activos de la app, cuentas de acceso o personas del maestro PERSONAL.

Admite valores por Grupo Cliente, Cliente y, cuando exista identificación real, implantación. Reutiliza sus IDs existentes. No crees un segundo catálogo de clientes para esta matriz. Clave única por ámbito, entidad, año y mes; integridad referencial real.

Valores enteros no negativos. Cero confirmado y sin informar son diferentes, tanto en interfaz como en almacenamiento y servicios. No rellenes huecos con cero ni presentes meses sin dato como confirmados. Cada valor conserva origen, revisión, autor y fecha; registra si es base copiada, propagado o ajuste explícito.

### Inicialización 2025 y 2026

2025 es histórico fijo: el dato conocido del ámbito se repite en sus doce meses y queda bloqueado tras la carga inicial. La fuente privada puede aportar solo datos de grupo: no copiarlos a cada Cliente/implantación.

Implementa una inicialización explícita, auditada e idempotente por ámbito para 2025 todavía vacío, usando fuente privada o el valor inicial introducido por Dennis. Esa operación crea los doce meses iguales y muestra la previsualización. No es una reapertura ni permite modificar un histórico ya inicializado. Si existe cualquier dato incompatible, no lo sobrescribas para completar el año. Repetir la misma inicialización no duplica; con otro valor exige resolver la discrepancia fuera de la edición ordinaria.

2026 se puede inicializar desde el histórico 2025 del mismo ámbito, conservando procedencia. La inicialización nunca pisa valores o ajustes existentes. Si falta dato de origen, mantener sin informar y permitir configurar el año corriente manualmente. No inventar 2025 para desbloquear 2026. Si no hay fuentes privadas en el entorno, las funcionalidades se construyen y la precarga se declara pendiente.

Solo el año natural en curso, calculado en servidor para Europe/Madrid, es editable ordinariamente. Comprueba esto también al recibir una petición directa. Años anteriores se consultan; años futuros no son un atajo para editar el actual. La excepción de inicialización histórica 2025 queda separada y acotada. No implementes la reapertura histórica excepcional ni una copia automática a años futuros, que todavía eran propuestas.

### Operaciones de edición

- Editar un mes cambia exclusivamente ese mes y lo marca como ajuste explícito.
- Aplicar desde este mes cambia el mes elegido y los posteriores del mismo año, preservando los meses posteriores que ya tengan un ajuste explícito. Mostrar antes el detalle de antes/después y de los meses protegidos.
- No interpretar la edición de un solo mes como propagación automática.
- Confirmar un cambio de matriz es una operación atómica, con control de versión y auditoría de los meses afectados.

Ejemplo básico: 65 enero–mayo y 68 desde junio. Otro ejemplo: septiembre ya tiene un ajuste explícito de 70; aplicar 68 desde junio preserva septiembre. La previsualización debe dejar claros todos los meses que cambian y los que no.

Los usuarios del grupo son un dato propio si hay personas compartidas entre Clientes/implantaciones. No sumar automáticamente los hijos ni exigir que coincidan con el grupo. Tampoco copiar el denominador de grupo a cada hijo. Una implantación sin usuarios muestra falta de dato, no un reparto estimado.

Implementa servicios de consulta para usuarios al mes/corte y exposición de usuarios mes del periodo, sin construir el motor económico. Enero–octubre con 65 hasta mayo y 68 desde junio da 665 usuarios mes y 68 usuarios a octubre, magnitudes distintas. Para un mes parcial, la exposición se pondera por días incluidos/días reales; el stock al corte no se prorratea. Si falta un mes requerido, informa cobertura incompleta en lugar de ignorarlo silenciosamente. Usa decimales y redondea solo para presentar.

## 7. Motor común: alcance y panel

Construye el núcleo compartido para XLSX y CSV. Las fuentes operativas y sus reglas específicas llegarán en sus entregas: tickets/tiempos en 03, Wrike/PAP/bugs en 04 y finanzas en 05. No adelantes esos importadores ni sus tablas de negocio.

Cargas en Administración tendrá historial paginado, ficha de lote, estado, progreso, previsualización, resumen y acciones permitidas por estado. Una entrada por fuente cuando su perfil esté implementado; las futuras se muestran pendientes o deshabilitadas. No presentes como disponible un importador que todavía no existe. No hay bandeja independiente de pendientes.

El motor debe funcionar ahora, validado con un perfil sintético de test y archivos XLSX/CSV pequeños y grandes generados en pruebas. Ese perfil solo se registra en entorno de test aislado: no queda como importador comodín en producción ni contamina la base de Dennis. Su habilitación exige configuración en servidor y destino de test comprobado, nunca un parámetro del navegador ni solo el prefijo del nombre de base. La interfaz y endpoints comunes se prueban con él. No basta declarar interfaces o simular un porcentaje.

El contrato de perfil, definido y documentado en servidor, debe permitir: identificar esquema/cabeceras y versión; leer y tipar filas; conservar originales; validar y clasificar errores/avisos; calcular huella; identificar entidades revisables si aplica; preparar staging; activar con la política de su ámbito y revertir/reprocesar cuando esté soportado. No admitir código, SQL o expresiones ejecutables subidas por el usuario.

## 8. Flujo real de carga y trabajador persistente

Implementa un ciclo de estados persistido que cubra recepción completa, cola, validación/preparación, listo para revisar, confirmación, cola de activación, activación y completado; también rechazado/error/cancelado. Documenta transiciones y acciones válidas; el cliente no puede forzar un estado enviándolo en una petición.

1. Administrador elige un perfil disponible, archivo y metadatos que requiera ese perfil.
2. El servidor autoriza y recibe el archivo en almacenamiento privado; una subida incompleta no se procesa como completa.
3. Se calcula checksum y se registra un lote recuperable. Un trabajador separado lee por bloques, valida, prepara staging y actualiza progreso persistente.
4. Se muestra previsualización limitada y resumen, sin alterar los datos activos. Confirmar queda deshabilitado si hay errores estructurales o no ha terminado la preparación.
5. La confirmación autorizada solicita activación; el trabajador ejecuta la operación del ámbito de forma atómica y registra resultado y auditoría.
6. La ficha muestra filas recibidas, válidas, revisadas, duplicadas, excluidas y avisos con definiciones claras; importadas solo después de activar. Cuando no se conoce un total fiable, mostrar contadores/fase, sin porcentaje inventado.

Servidor web y trabajador son procesos del mismo proyecto. Usa PostgreSQL para cola, reclamación atómica de trabajos, estado y progreso; no añadas Redis como requisito. Una petición HTTP no sostiene el trabajo mediante una promesa sin esperar, temporizador o cola en memoria.

Incluye reclamación exclusiva, lease/heartbeat o mecanismo equivalente, intentos acotados y protección frente a un trabajador antiguo que intente confirmar después de perder el trabajo. Dos trabajadores no activan dos veces un lote. Reiniciar web o trabajador permite retomar/reintentar sin duplicar efectos; checkpoints y staging deben ser coherentes. Los fallos no dejan trabajos eternamente ejecutándose ni bucles infinitos de reintento.

Cancelar es posible antes de comenzar la activación. Si la transacción ya está aplicando cambios, la interfaz explica que esa fase no se cancela por una petición arbitraria; fallo implica rollback. Una carga fallida conserva íntegro el estado activo anterior.

El trabajador se construye y arranca con scripts del proyecto compatibles con el entorno existente y Windows. Documenta qué dos procesos deben estar en marcha. No requieras un servidor de desarrollo para que el trabajador funcione con un build de producción local.

## 9. Archivos grandes, almacenamiento y permisos

Archivos privados en un directorio persistente configurable, fuera de public y de Git, compartido por web y trabajador. Identificadores internos de archivo, sin confiar en rutas aportadas por el navegador o usar el nombre original como ruta ejecutable. La ficha conserva nombre informativo, tamaño, checksum, perfil, autor, carga, extracción declarada y cobertura conocida.

No confundas fecha de carga con extracción ni la deduzcas de MAX(fecha_creación). Separa estos metadatos para observaciones históricas futuras. El nombre del archivo no valida su contenido.

Lectura y subida acotadas en memoria; no cargar todo el XLSX/CSV o todo su staging en un array. Configura límites de archivo, contenido descomprimido y concurrencia, con errores claros. El lector XLSX debe probarse con cabeceras y hojas válidas aunque falten metadatos de dimensión, como ocurre en exports Power BI. CSV respeta BOM, comillas, comas y saltos interiores. No uses split por coma ni evalúes fórmulas, macros, IQY o HTML.

La selección del lector debe ser compatible con Node y dependencias ya fijadas, con una prueba y referencias oficiales registradas. No declares soporte de archivos grandes sin medir filas, duración y pico de memoria con un archivo sintético representativo; el benchmark exhaustivo del roadmap sigue en 09.

Conserva los brutos necesarios para trazabilidad y reproceso. No borres automáticamente archivos activos para ahorrar espacio sin una política aprobada. Staging temporal, archivos incompletos y lotes cancelados tienen tratamiento documentado y nunca se exponen públicamente.

Reutiliza Administrador y Consulta. Consulta puede leer el personal y la matriz según los permisos existentes; no puede modificarlos ni crear/confirmar/cancelar/revertir cargas o acceder a archivos y brutos de Administración. Comprueba autorización en cada operación/descarga y antes de escribir archivos; no solo en el menú. El trabajador recibe contexto de actor generado en servidor y no confía en un rol enviado por el cliente.

## 10. Deduplicación, revisiones y activación

Separa tres identidades: checksum del archivo, huella de la fila fuente y clave de entidad revisable. No equivalen entre sí.

Huella por fuente/ámbito y todos los campos fuente tipados de forma determinista, antes de enriquecer con maestros/cálculos. No incluye lote, posición de fila o nombre del archivo. Conserva originales y documenta normalización. Dos filas idénticas dentro del archivo o entre archivos se materializan una vez; sus procedencias siguen relacionadas con sus lotes.

Una clave repetida con contenido distinto no es automáticamente un duplicado idéntico. El perfil decidirá revisión o conflicto conforme a su contrato; no implementes ahora la regla específica de los tickets o los logs sin ID. Fuente/ámbito separa productos, años o categorías cuando corresponda. No deduplicar por ticket/persona/día ni solo por ID para todos los sistemas.

Repetir una confirmación, un reintento o una petición concurrente no vuelve a aplicar cambios. Preparación y datos activos están separados; activación, estado final y auditoría deben quedar consistentes en la misma operación transaccional. Bloquea activaciones incompatibles del mismo ámbito y no conviertas esa protección en un bloqueo global innecesario.

Deja soportadas políticas de incorporación/revisión y sustitución atómica por ámbito, con un contrato de activación/reversión probado por el perfil de test. No programes los cálculos o tablas financieras de CSAPP-05. Los futuros reemplazos año/categoría deberán conservar otros ámbitos; no impongas append a todas las fuentes.

La reversión debe respetar contribuciones compartidas: deshacer lote A no elimina una fila también aportada por lote B vigente. No borres por checksum sin revisar procedencia y revisiones activas. Reprocesar después de actualizar un maestro reutiliza el bruto, sin duplicar la fila ni impedirlo solo porque el checksum ya existía.

Si cambian reglas, versión de perfil o maestros relevantes entre previsualización y activación, detecta la diferencia y revalida antes de aplicar resultados obsoletos. Guarda las versiones necesarias para explicar el lote. El perfil sintético demuestra este contrato; no crea hechos operativos reales.

Errores de estructura/unidad/fecha obligatoria impiden activar lo inválido. Una relación no resuelta puede conservar el bruto y quedar fuera del cálculo afectado con motivo, sin asignación por similitud ni obligación de otra bandeja. La política exacta de cada fuente se implementa en su entrega.

## 11. Pruebas y criterios de aceptación

Conserva la batería existente y ejecuta instalación reproducible, typecheck, lint, build, migraciones sobre test vacío y sobre una base con esquema/datos sintéticos de CSAPP-01. No uses la base de trabajo para pruebas destructivas. No sustituyas PostgreSQL por mocks para afirmar integridad o recuperación.

| Área | Caso y resultado exigido |
| --- | --- |
| Personal | Persona con varios alias conserva una identidad; PMO y rol quedan en el mismo maestro |
| Vigencias | Resolver antes/después de un cambio de equipo/PMO devuelve la asignación correcta; solapamientos rechazados |
| Identidades | Alias/ID en conflicto concurrente se rechaza sin cambios parciales ni personas duplicadas |
| Matriz | 65 enero–mayo, 68 junio–diciembre; hasta octubre 665 usuarios mes y stock 68 |
| Ajustes | Cambio de un mes no propaga; aplicar desde junio preserva septiembre explícito y muestra el resto antes de confirmar |
| Histórico | Inicializar 2025 vacío crea doce valores iguales; repetir no duplica; cambiar histórico ya informado se rechaza, también por petición directa |
| Año corriente | Regla calculada en servidor; con reloj controlado en otro año, 2026 no sigue editable por estar hardcodeado |
| Nulos y cero | Sin dato no se convierte en cero; cero confirmado se conserva; exposición incompleta se identifica |
| Grupo y Cliente | Usuarios compartidos no se suman ni se copian automáticamente entre ámbitos |
| Copia inicial | Copiar 2025 a 2026 no pisa ajustes; sin fuente conserva huecos y permite edición corriente |
| Concurrencia | Edición obsoleta de matriz/personal no sobrescribe; cambios y auditoría atómicos |
| Validación | Archivo incorrecto o incompleto no activa; UTF8/BOM y CSV citado se conservan; XLSX sin dimensión válido se lee |
| Duplicados | Tres filas, una repetida, producen dos registros; otro lote solapado conserva dos y añade procedencias |
| Activación | Doble confirmación/dos trabajadores producen un solo efecto; fallo mantiene estado activo anterior |
| Reinicio | Detener y reiniciar trabajador durante preparación recupera el mismo lote sin duplicados; reiniciar web conserva progreso |
| Recuperación | Cancelación previa no activa; reversión respeta fila compartida con otro lote; reproceso reutiliza brutos |
| Alcance | Sustituir el ámbito sintético A no altera B; revisión no se confunde con duplicado idéntico |
| Permisos | Consulta/sin sesión/cookie falsa no mutan ni suben/leen archivos restringidos; no hay efectos antes del rechazo |
| Volumen | Archivo sintético grande se procesa con navegación disponible; informar mediciones reales |

Guarda en Git las pruebas y generadores sintéticos pequeños necesarios, incluidos el recorrido de navegador y sus comandos. El perfil de test y sus tablas auxiliares, si hacen falta, viven solo en la base/entorno de test, sin migraciones de tablas ficticias de negocio a producción. No dejes grandes fixtures, archivos reales o credenciales en Git.

No persigas números de casos iguales a los del informe anterior: reporta qué se ejecutó realmente. Una guía no demuestra Windows probado y un progreso simulado no demuestra recuperación. Corrige los fallos encontrados dentro de la entrega; si un requisito esencial no pudo probarse, informa la limitación y no declares aceptación completa.

## 12. Datos, documentación y entrega

Precarga únicamente personal y usuarios autorizados si están las fuentes privadas. No inventes datos por su ausencia ni bloquees el desarrollo independiente. Las tablas operativas Zendesk/Wrike/PAP/bugs/facturación siguen sin cargas reales; Dennis probará sus importadores en las entregas previstas. Tampoco cambies los maestros ya introducidos por Dennis al arrancar, migrar o repetir una inicialización.

Actualiza solo contratos y guías afectados, índice si hay rutas nuevas, prompts/README.md y docs/plan/estado.md. Documenta por separado: PERSONAL; matriz/reglas de edición; contrato del motor; operación y recuperación del trabajador; validación ejecutada. No copies la especificación completa en otro documento gigante. Diferencia confirmado, propuesto, implementado, probado y aceptado.

Deja comandos exactos para PowerShell: aplicar migraciones sin borrar, configurar rutas privadas, construir, arrancar web y trabajador en dos terminales, detenerlos, reanudar y ejecutar pruebas aisladas. Mantén guía de desarrollo y build/start local. No publiques credenciales ni comandos que las impriman.

Recorrido breve para Dennis: gestionar una persona con alias/PMO e historial; abrir Grupo Cliente y Cliente en la matriz; registrar usuarios del año corriente; editar un mes y aplicar desde otro viendo la previsualización; comprobar bloqueo histórico y consulta. Explica qué se puede probar de Cargas en esta fase y que el primer importador operativo será el de 03. No le pidas subir ya los grandes archivos para suplir las pruebas del motor.

Prepara una PR propia sin fusionar. Título y descripción centrados en las tres funcionalidades, pruebas reproducibles, dependencia de PR 2 si sigue abierta y limitaciones reales. Mantén intactos el prompt y la historia de CSAPP-01. No despliegues ni marques 03 como iniciada.

Termina con: rama, SHA base y final, PR/base reales; funcionalidades operativas; migraciones aplicadas sin credenciales; comandos para probar; comprobaciones y medidas ejecutadas; estado de fuentes/precarga; pendientes de Windows y cualquier límite. No declares que el ayudante ha auditado PR 2 ni que Dennis ha aceptado manualmente 01. Después detente y espera el prompt de CSAPP-03.

## Referencias técnicas primarias

Consulta la documentación de las versiones instaladas cuando haga falta y registra la usada, sin actualizar dependencias por defecto:

- PostgreSQL 16, bloqueo/reclamación de filas: https://www.postgresql.org/docs/16/sql-select.html#SQL-FOR-UPDATE-SHARE
- Next.js, alojamiento propio y límites del entorno: https://nextjs.org/docs/app/guides/self-hosting
- Next.js, autenticación/autorización: https://nextjs.org/docs/app/guides/authentication
- Documentación oficial del lector XLSX y parser CSV elegidos, incorporada tras la prueba de compatibilidad.
