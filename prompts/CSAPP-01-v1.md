# CSAPP-01-v1 — Base web, acceso y maestros de clientes

Repositorio único: https://github.com/bateman37/cs-app.
Entrega: CSAPP-01 de las diez entregas de implementación.
Rama propuesta: feature/CSAPP-01-base-y-clientes.
Archivo obligatorio: prompts/CSAPP-01-v1.md, con este texto íntegro.

## 1. Objetivo y resultado visible

Empieza a construir CS App sobre la documentación incorporada en CSAPP-DOC-00. Este prompt autoriza código de esta primera entrega; la restricción exclusivamente documental correspondía a DOC-00. No avances a CSAPP-02.

Al terminar debo poder arrancar la aplicación, iniciar sesión, entrar en Administración y gestionar Grupo Cliente, Cliente, implantaciones identificadas, equivalencias, soporte, alojamiento e hitos. Los datos deben persistir en PostgreSQL y sus cambios deben tener historial y autor. No es una maqueta: el acceso y los maestros deben funcionar de extremo a extremo.

Las cuatro vistas de análisis estarán en la navegación, con estados pendientes honestos. No implementes sus cálculos ni rellenes gráficos con datos simulados.

## 2. Estado de partida y lectura selectiva

Antes de editar código confirma repositorio, rama, estado del árbol y documentación existente. Guarda este prompt literal; no lo sustituyas por un resumen. Si ya existe otra versión ejecutada, consérvala y documenta la nueva sin sobrescribir historia. Respeta cambios locales ajenos y usa un checkout aislado si hace falta.

Lee solamente:

- AGENTS.md y CLAUDE.md.
- docs/00-index.md y docs/plan/estado.md.
- docs/plan/roadmap.md: CSAPP-01 y sus dependencias.
- docs/producto/alcance.md.
- docs/producto/maestros.md: MST 01–04 y MST 07–08; usuarios/personal solo para respetar límites de alcance.
- docs/arquitectura/propuesta.md y docs/arquitectura/modelo.md: las entidades que se implementan ahora.
- docs/plan/precarga-y-pruebas.md.
- docs/decisiones/DEC-003-status-backlog-y-arranque-documental-v04.md.

Abre otras rutas solo si una regla depende de ellas. No cargues todos los históricos, exports o prompts anteriores en contexto.

Comprueba que DOC-00 esté disponible. Si su documentación está en una rama aún sin integrar, puedes basarte en ese estado y explicar la dependencia de la PR, sin fusionarla. Si falta, busca el paquete documental ya entregado en el entorno; no inventes contratos ni des por completada DOC-00. Una ausencia real de documentación se informa con las rutas concretas que faltan.

Contratos temáticos vigentes y decisiones posteriores confirmadas prevalecen sobre evidencias históricas. No cambies una regla de negocio para facilitar la implementación. Resuelve autónomamente los detalles técnicos rutinarios y registra las decisiones necesarias.

## 3. Base técnica y aislamiento

Implementa Next.js con App Router, React y TypeScript, PostgreSQL propia y Prisma. Si ya existe estructura funcional en este repo, intégrate con ella sin rehacerla. Para un repo documental, crea la base conservando README, AGENTS, CLAUDE, docs y prompts; comprueba especialmente que el generador no los sobrescriba.

Usa una combinación estable y compatible de Node LTS, Next, React, TypeScript, Prisma y autenticación. Verifica las versiones en sus documentos oficiales al ejecutar; registra versiones elegidas, requisitos y motivo. Un solo gestor de paquetes, lockfile versionado e instalación reproducible. No copies dependencias o variables de otros proyectos.

Nombre propuesto de base de desarrollo: cs_app. Base de pruebas separada, por ejemplo cs_app_test. Si ya hay una base exclusiva de cs-app configurada y documentada, respétala. Antes de migrar verifica el destino sin mostrar credenciales. No conectes a gamification-vcs, V-apps, beM u otras bases. No uses producción para desarrollo o tests.

Incluye configuración de ejemplo sin secretos, validación comprensible de variables obligatorias, migraciones incrementales y procedimiento de arranque. No hagas reset, drop, limpieza masiva ni db push destructivo sobre una base existente. Una shadow database, si se necesita, también será exclusiva. El setup repetido no borra ni sobrescribe datos del administrador.

Debe funcionar con PostgreSQL local y PowerShell en Windows, sin Docker obligatorio. Si ejecutas las comprobaciones en otro sistema, dilo: no declares Windows probado por haber escrito sus comandos. Proporciona arranque en desarrollo y build/start de producción local; esto último no autoriza un despliegue externo.

Separa UI, validación/reglas y persistencia. Prisma y secretos solo en servidor. Centraliza conexión y comprobación de permisos. Crea únicamente las entidades necesarias para acceso, maestros, vigencias, hitos y auditoría: no generes ahora esquemas completos de tickets, PAP, facturación, calidad o importaciones.

## 4. Acceso y permisos reales

Implementa inicio y cierre de sesión con una solución mantenida compatible con el stack, siguiendo su documentación oficial. Si no existe identidad corporativa ya configurada, usa acceso local por correo y contraseña. No presupongas SSO ni añadas registro público, proveedores sociales o envío de correos.

Contraseñas con hash apropiado y secretos fuera de Git; sesiones con expiración, cookies protegidas y cierre efectivo. Usa las protecciones de la solución elegida frente a solicitudes no autorizadas y limita intentos de acceso. No inventes un protocolo de autenticación propio. Los mensajes de error no exponen contraseñas, cadenas de conexión o detalles internos.

Permisos mínimos de esta entrega:

| Perfil | Facultades |
| --- | --- |
| Administrador | Crear, editar, desactivar/reactivar maestros, equivalencias, vigencias e hitos; consultar historial |
| Consulta | Leer los maestros disponibles; ninguna mutación ni acceso al historial administrativo completo |

El rol Consulta es interno de la aplicación, no un portal de clientes. Los perfiles futuros se incorporarán cuando haya sus funcionalidades. Proporciona un procedimiento explícito para crear el primer administrador y una cuenta de lectura, sin contraseñas predeterminadas ni alta automática en cada arranque. No necesitas un módulo completo de gestión de cuentas en esta entrega.

Protege en servidor páginas, consultas y cada mutación, incluyendo acceso directo a endpoints o Server Actions. Ocultar un botón o proteger solo el menú no es autorización. Tras cerrar sesión, las rutas protegidas dejan de ser accesibles. Evita cachés compartidas que expongan datos entre sesiones. Las cuentas de acceso son distintas del maestro de PERSONAL y de los usuarios contratados por cliente.

## 5. Navegación e interfaz

Interfaz en castellano, fechas/formato español y zona de presentación Europe/Madrid. Aplicar la marca documentada: azul Vincle #1f18c0, negro y acento #dbba12. Usa el logotipo oficial si está disponible, conservando proporciones; no inventes otro. Diseño claro de escritorio, usable con teclado y adaptable a pantallas menores.

Navegación con exactamente:

- Comparativa.
- Análisis Cliente.
- Pulse Rent.
- Calidad.
- Administración como acceso separado de gestión.

Las cuatro vistas de negocio abrirán una página coherente que indique que todavía no están disponibles. Sin KPIs falsos, ceros presentados como resultados o filtros que aparenten funcionar. Client Health, backlog y bugs no son nuevas vistas principales. No añadas una portada con métricas ficticias.

Administración tendrá funcional el apartado Clientes: listas de Grupo Cliente y Cliente, ficha y acciones. Personal, usuarios mensuales, cargas y configuración analítica siguen pendientes; si aparecen, deben estar claramente deshabilitados. Los textos de la interfaz serán operativos, sin SQL, nombres de tablas o explicaciones de arquitectura.

## 6. Maestros completos: identidad y equivalencias

### Grupo Cliente y Cliente

Modela los dos niveles existentes, no un catálogo paralelo:

- Grupo Cliente: agrupación económica BC con ID interno estable, nombre canónico, denominación/identidad BC y estado.
- Cliente: identidad operativa vinculada a Grupo Cliente, nombre, estado, indicador interno y sus equivalencias.
- Implantación: detalle opcional perteneciente al Cliente, solo si existe una identificación real de proyecto/implantación; nombre, clave, estado y metadatos correspondientes.

Un grupo puede contener varios Clientes/organizaciones y estos pueden tener implantaciones identificadas. No fusiones organizaciones distintas automáticamente por compartir grupo. Una fila duplicada por BUSCARV o por varios nombres PAP no crea otro Cliente. No crees implantaciones artificiales para rellenar la pantalla.

La organización Zendesk identifica Cliente. Si no se conoce aún su ID, permite registrar el maestro sin inventarlo y muestra la equivalencia pendiente. Usa la agrupación conocida; si todavía no puede asignarse, represéntala como no asignada, sin fabricar un grupo BC. Los IDs internos son independientes de nombres y IDs de origen.

No se han facilitado nombres ni acceso a vistas SQL externas. Reutiliza estructuras locales equivalentes si ya existen; en otro caso implementa la relación lógica documentada. No inventes conexiones o integraciones con BC/Zendesk.

### Equivalencias de origen

Permite crear, editar, consultar y desactivar con vigencia las equivalencias necesarias:

| Sistema | Identidad y destino |
| --- | --- |
| BC | Denominación/clave del grupo hacia Grupo Cliente |
| Zendesk | Organization ID y nombre hacia Cliente |
| Wrike | Identidad/nombre de proyecto hacia Cliente o implantación identificada |
| PAP | Identidad/nombre de organización/proyecto hacia Cliente o implantación identificada |

Admite alias históricos sin duplicar columnas de búsqueda. Conserva valor original y valor de búsqueda normalizado. No elimines acentos, puntuación o partes del nombre para asignar por parecido. IDs externos exactos como texto o enteros seguros, nunca flotantes.

Una misma identidad externa del mismo sistema/tipo no puede apuntar a dos destinos durante una vigencia solapada, ni bajo peticiones concurrentes. Distingue sistemas y tipos: el mismo texto en Wrike y PAP no implica identidad compartida. Si hay conflicto, explica cuál y conserva los cambios del formulario; no reasignes silenciosamente.

Incluye el indicador de organización interna para VINCLE, VINCLE BUGS, VINCLE INFRAESTRUCTURAS y pruebas cuando se registren, sin inferir que cualquier nombre distinto de VINCLE es cliente externo. No crees esas entidades como registros reales si no se dispone de su fuente autorizada.

## 7. Servicio, vigencias e hitos

Campos editables en el ámbito aplicable, sin duplicaciones heredadas del Excel:

- Soporte: Gold, Platinum, Silver On Demand o Silver Recurrente; sin informar es distinto de un plan asignado.
- Servidor: CLOUD u OP; sin informar es distinto de OP.
- Complejidad: Basic, Medium o Enterprise, según el catálogo documentado.
- Producto: dato/catálogo explícito separado de complejidad; admite sin informar. No deducirlo de TIPO o del futuro destino de escalado.

Un dato del grupo no se copia automáticamente a todos sus Clientes. Un dato del Cliente tampoco se propaga a todas las implantaciones por suposición. Muestra el ámbito de edición y evita mantener copias divergentes del mismo dato.

Implementa vigencias reales para soporte, alojamiento, complejidad y relaciones que cambien en el tiempo. Guardar una modificación con fecha efectiva conserva el valor anterior y permite conocer la situación a una fecha. No basta un updated_at con el último valor. Una migración OP a CLOUD el 1 de junio mantiene OP el 31 de mayo y CLOUD desde el 1 de junio. No permitas intervalos solapados o fechas incoherentes; documenta las convenciones y resuelve sus límites en un único lugar.

Para una situación inicial histórica cuya fecha no se conoce, registra esa incertidumbre sin inventar una fecha de arranque o aplicar hoy a todos los años anteriores. Un cambio retroactivo se identifica y audita; no exige calcular métricas que todavía no existen.

Hitos editables: arranque, migración cloud y cambio mayor de versión, con fecha, ámbito y nota. Sirven para anotar curvas futuras; no excluyen automáticamente al cliente de Calidad ni modifican contratos por sí solos.

Desactivar/reactivar conserva relaciones e historial. No hay borrado físico ni cascadas ocultas. Los registros inactivos siguen consultables y no se ofrecen como destino de nuevas asignaciones mientras estén inactivos. No ocultes una relación histórica porque el maestro se haya desactivado.

## 8. Experiencia de gestión y auditoría

Entrega listas con búsqueda, filtros pertinentes, orden y paginación; ficha de grupo con sus Clientes y ficha de Cliente con equivalencias, servicio, implantaciones e hitos. Formularios con etiquetas, validación en servidor y mensajes concretos; estados de carga, vacío, éxito y error. Tras guardar y recargar, los datos persisten. Conserva los filtros al volver a la lista.

Las acciones no pueden ser botones sin implementación ni formularios JSON genéricos. La edición de datos y su historial deben poder usarse desde la web, sin recurrir a Prisma Studio.

Audita altas, cambios, desactivaciones/reactivaciones, equivalencias, vigencias e hitos con actor, fecha y antes/después pertinentes. Guarda cambio y auditoría de forma atómica. No registres credenciales o secretos. Permite al administrador consultar ese historial desde la ficha.

Evita que dos administradores sobrescriban cambios sin aviso: control de versión o mecanismo equivalente y mensaje para recargar/revisar. Aplica integridad referencial, unicidad y validación también en persistencia; no dependas solo de comprobaciones en el navegador.

## 9. Datos iniciales y límites de la entrega

La precarga de maestros está autorizada si la fuente privada está disponible. Consolida únicamente lo que permitan identidades explícitas y registra las discrepancias; no fuerces que cada fila del Excel sea una entidad. Conservar la fuente y sus datos fuera de Git. Una lectura puntual de maestros no autoriza construir todos los importadores.

Si las fuentes privadas no están en el entorno, entrega los maestros funcionales con estado vacío y documenta la precarga pendiente por falta de fuente; no inventes clientes ni declares una precarga realizada. No bloquees el desarrollo independiente ni solicites exports operativos para construir estos formularios.

No cargues Zendesk Time/Tickets, Wrike, PAP, bugs o facturación. Dennis probará los importadores cuando corresponda. Sin fixtures sintéticas en la base de trabajo de Dennis ni seeds que se ejecuten solos al iniciar. Las pruebas usan una base aislada y una protección explícita frente a URLs de desarrollo/producción.

Fuera de CSAPP-01: PERSONAL, roles PMO, matriz mensual de usuarios contratados, motor de cargas, cálculos económicos, percentiles, semáforos, pesos y umbrales, Client Health, backlog, listados de bugs y despliegue. No crees funcionalidades de esos módulos por anticipación. Respeta el modelo futuro, sin implementarlo entero.

## 10. Validación exigida

Ejecuta typecheck, lint, migración de instalación limpia y build de producción. Comprueba arranque y persistencia reales. Añade pruebas pequeñas de los riesgos de acceso e integridad; no una batería de tests de presentación que copie el código.

| Caso | Resultado que debes verificar |
| --- | --- |
| Sin sesión | Página/consulta privada y mutación directa no permiten acceso |
| Perfil Consulta | Puede leer lo permitido; una mutación forjada se rechaza y no cambia datos ni auditoría |
| Alta y persistencia | Un grupo con dos Clientes distintos se guarda y permanece tras recarga/reinicio |
| Equivalencia repetida | Mismo sistema/tipo/identidad con destinos y vigencias incompatibles se rechaza, también ante concurrencia |
| Duplicados de búsqueda | Añadir otro alias PAP no crea otro Cliente ni otra implantación |
| Vigencia OP a CLOUD | Antes de la fecha efectiva conserva OP; desde esa fecha muestra CLOUD; sin solapamiento |
| Desactivación | Registro e historia siguen consultables; no se borra ni se usa para nuevas asignaciones |
| Dos ediciones | La segunda edición obsoleta no sobrescribe silenciosamente la primera |
| Auditoría | Cambio, actor y antes/después correctos; una operación fallida no deja cambios parciales |
| Cierre de sesión | Se pierde acceso y no se reutiliza una sesión invalidada |
| Instalación repetida | No duplica ni modifica maestros/credenciales existentes |
| Navegación y vacío | Cuatro vistas pendientes, Administración funcional y ninguna cifra inventada |

Usa datos sintéticos pequeños solo en test. Reporta comando y resultado de cada comprobación; una validación no ejecutada se identifica con su motivo. No sustituyas PostgreSQL por mocks para afirmar que migraciones o integridad funcionan. No declares esta entrega completa si no has podido comprobar acceso, maestros y persistencia de extremo a extremo; entrega lo realizado y concreta el impedimento.

## 11. Documentación, guía para probar y PR

Actualiza únicamente las piezas afectadas, índice si hay rutas nuevas y docs/plan/estado.md con el resultado real de CSAPP-01. No marques CSAPP-02 ni otras entregas como iniciadas. Mantén el prompt completo y su entrada en prompts/README.md.

Documenta setup y modelo físico implementado en archivos temáticos breves, enlazados desde el índice: versiones, variables sin secretos, base exclusiva, migraciones, provisión de cuentas, permisos, vigencias, auditoría y comprobaciones. No copies toda la especificación en un nuevo documento.

Incluye una guía PowerShell con comandos exactos del proyecto para instalar, configurar, migrar sin borrar, crear la primera cuenta, arrancar en desarrollo y ejecutar build/start local. Indica URL/puerto y cómo parar/rearrancar. No proporciones contraseñas reales ni comandos que las impriman o queden como argumentos públicos.

La prueba manual para Dennis debe durar unos minutos: iniciar sesión; crear grupo de prueba propio y dos Clientes; añadir equivalencias; cambiar soporte/alojamiento con fecha efectiva; consultar historial; desactivar/reactivar; comprobar lectura y cerrar sesión. No insertar ese grupo automáticamente en su base. Explica cómo retirar/desactivar los datos creados manualmente sin borrar historia.

Prepara commit y PR con título y descripción centrados en el resultado y la validación. Déjala sin fusionar y no despliegues. Si no puedes publicar la PR, conserva la rama y explica el impedimento, sin afirmar que existe. No alteres otras PR ni repositorios.

Termina informando de: funcionalidades operativas; versiones y decisiones técnicas; migraciones y base usada sin credenciales; comandos exactos para probar; validaciones ejecutadas y pendientes; situación real de la precarga; rama/commit/PR reales y límites. Después detente: la siguiente entrega necesita su propio prompt.

## Referencias técnicas primarias

Verificar la documentación correspondiente a las versiones elegidas; no copiar ejemplos de otra versión sin comprobarlos:

- Next.js, instalación: https://nextjs.org/docs/app/getting-started/installation
- Next.js, autenticación y autorización: https://nextjs.org/docs/app/guides/authentication
- Prisma, requisitos: https://www.prisma.io/docs/orm/reference/system-requirements
- Prisma, migraciones: https://www.prisma.io/docs/orm/prisma-migrate
- Node.js, ramas soportadas: https://nodejs.org/en/about/previous-releases
