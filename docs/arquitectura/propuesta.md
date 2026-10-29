# Propuesta de arquitectura

## Aplicación y persistencia

Se propone el mismo patrón de gamification-vcs y V-apps: monolito modular Next.js, React y TypeScript, con PostgreSQL y Prisma. Interfaz, dominio, importadores y consultas analíticas se separan por módulos dentro de un repositorio. Repositorio bateman37/cs-app. Base de datos propia, nombre propuesto `cs_app`, sin reutilizar gamification_vcs o v_apps. Desarrollo Windows/PowerShell y despliegue corporativo con Node, sin Docker obligatorio.

Usar una versión LTS soportada de Node y fijar versiones compatibles con lockfile al iniciar CSAPP-01. La rama y versión se verificarán en CSAPP-01; este arranque documental no fija una versión numérica ni instala herramientas. La versión exacta de Next, Prisma y lector XLSX se decide con una prueba técnica documentada, no con una instalación flotante de latest en cada entrega.

Navegación limitada a las cuatro vistas de negocio y Administración. No agregar un panel principal de cargas, análisis detallado o Client Health. Los resúmenes de carga viven en Administración y el detalle en la vista correspondiente.

## Importaciones grandes

ARC 01. Servidor web y trabajador de importación son dos procesos del mismo proyecto. Una cola persistida inicialmente en PostgreSQL permite reanudar trabajos, progreso y cancelación antes de activar. Bloques orientativos de 1000 a 5000 filas, carga a staging y activación transaccional. No hace falta Redis para la primera versión si el benchmark demuestra capacidad con concurrencia controlada.

ARC 02. Valorar un lector XLSX con streaming y un parser CSV que respete comillas. La prueba debe cubrir archivos reales, incluidos los exports Power BI que carecen de metadatos de dimensión. Conservar archivos en almacenamiento persistente restringido. No basar los trabajos en un directorio temporal efímero de una petición o en un servicio que cierre el proceso al acabar la respuesta HTTP.

ARC 03. Crear agregados mensuales por cliente, servicio, equipo, rol y causa, con versión de datos. El cálculo de percentiles y ratios vive en el servidor. Las tablas grandes se paginan; las consultas se filtran por índices y los detalles se exportan en segundo plano. Prisma se usa para las operaciones de dominio y SQL parametrizado para agregaciones que lo necesiten.

## Objetivos de rendimiento para validar

Sobre un servidor y dataset de referencia registrados: soportar los 247140 tiempos, 113856 tickets y el resto de fuentes actuales, después probar un millón de tiempos. Objetivo propuesto: consultas de cartera y ficha habitual por debajo de 2 segundos en caché y 5 segundos sin ella, sin incluir descargas; importaciones sin bloqueo de navegación y con progreso observable. Medir memoria máxima, filas por segundo y tiempo de activación. No prometer un tiempo de carga antes del benchmark. Ajustar límites de archivo, contenido descomprimido y concurrencia al resultado.

## Permisos

| Rol propuesto | Facultades |
| --- | --- |
| Administrador | Maestros, usuarios, cargas, configuración, cierres, reversión y permisos |
| Operador de datos | Cargas y su resumen de avisos; sin modificar pesos ni permisos |
| Responsable QA o CS | Consulta operativa, feedback mensual y notas; acceso económico según permiso específico |
| Consulta | Lectura y exportación del ámbito autorizado |

ARC 04. Autenticación desde la primera entrega, con control de acceso también en servidor, exportaciones y archivos. Adaptar al sistema corporativo disponible en la decisión de despliegue; no presuponer que ya hay SSO. Para local puede existir una cuenta de desarrollo creada desde variables de entorno, sin contraseña real en Git.

ARC 05. Auditoría de cambios de maestros, matriz de usuarios, cargas, reversión, feedback y configuración. Secretos fuera del repositorio, ficheros restringidos y repositorio privado. Entornos de prueba y producción separados. Publicación con HTTPS, red/VPN según IT, copias de base y archivos, y restauración comprobada. Retención y acceso de los archivos originales se acuerdan antes de producción.

## Fuentes técnicas primarias consultadas

- [Next.js y alojamiento propio](https://nextjs.org/docs/app/guides/self-hosting): ejecución propia y proxy inverso.
- [Node y ramas soportadas](https://nodejs.org/es/about/previous-releases): elección de una rama LTS.
- [PostgreSQL y percentiles continuos](https://www.postgresql.org/docs/18/functions-aggregate.html): agregaciones y percentile_cont.
- [CSV Parse](https://csv.js.org/parse/options/): BOM, comillas, delimitador y procesamiento de registros.
- [ExcelJS](https://github.com/exceljs/exceljs): candidato para la prueba de lectura XLSX; validar antes de adoptarlo.

Estas fuentes fundamentan capacidades técnicas. El modelo funcional y sus umbrales son propuestas propias para este proyecto, no recomendaciones de esas fuentes.
