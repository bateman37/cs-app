# CS App

Aplicación web de análisis de Customer Success de Vincle. Repositorio: https://github.com/bateman37/cs-app. Cuatro vistas de negocio: **Comparativa, Análisis Cliente, Pulse Rent y Calidad**; maestros, personal, usuarios, cargas, configuración, conciliación, exportaciones y operación están en **Administración**. Stack: Next.js/React/TypeScript, PostgreSQL y Prisma; ejecución en **Windows con PowerShell, Node y PostgreSQL** (sin Electron, Docker ni WSL).

## Estado (CSAPP-10, cierre técnico)

Las **diez entregas** del roadmap tienen implementación y pruebas sintéticas en Linux. **Windows/PowerShell, la aceptación funcional con los archivos reales de Dennis y el despliegue en producción están pendientes** y se registran aparte: [estado](docs/plan/estado.md) · [validación técnica de CSAPP-10](docs/validacion/csapp-10.md) · [registro de aceptación](docs/validacion/registro-aceptacion.md). Ninguna fusión de PR equivale a aceptación. Las cargas reales las realiza Dennis; el repositorio no contiene datos, fuentes, respaldos ni secretos.

## Arranque breve (detalle en [instalación y operación](docs/operacion/instalacion-operacion.md))

```powershell
git checkout <SHA-DEL-CANDIDATO>; copy .env.example .env   # completar .env (catálogo: docs/operacion/variables-entorno.md)
npm ci
npm run build:todo                                          # web + trabajador compilados (una vez por versión)
npm run ops -- verificar --puerto                           # comprobación previa
npm run db:migrar                                           # migraciones incrementales
npm run ops -- preparar                                     # enlaza la instalación con sus almacenes privados
npm run cuenta:crear -- --correo <correo> --nombre "<Nombre>" --rol admin   # primer Administrador (contraseña por entrada segura)
npm run start:todo                                          # web + trabajador con cierre coordinado (Ctrl+C o npm run stop:todo)
npm run ops -- salud --web                                  # comprobación técnica
```

## Mapa de lectura

| Para… | Leer |
| --- | --- |
| Instalar, operar, vigilar y parar | [Instalación y operación](docs/operacion/instalacion-operacion.md) · [variables de entorno](docs/operacion/variables-entorno.md) |
| Copias y restauración | [Copia y restauración](docs/operacion/copia-restauracion.md) |
| Actualizar, volver atrás y preparar producción (IT) | [Actualización y despliegue](docs/operacion/actualizacion-despliegue-it.md) |
| Poner datos en marcha y leer las cuatro vistas (Dennis) | [Guía de Dennis](docs/plan/guia-dennis.md) · [registro de aceptación](docs/validacion/registro-aceptacion.md) |
| Reglas de negocio y contratos | [Índice](docs/00-index.md) · [funcional sencillo](docs/producto/funcional-resumen.md) · [decisiones pendientes](docs/decisiones/pendientes.md) |
| Planificación y estado real | [Roadmap](docs/plan/roadmap.md) · [estado](docs/plan/estado.md) · [prompts](prompts/README.md) |
| Instrucciones para agentes | [AGENTS.md](AGENTS.md) · [CLAUDE.md](CLAUDE.md) |

El XLSX canónico de tickets tiene ocho campos, incluido `status`. El sexto indicador está aprobado. PR significa desarrollo finalizado en su rama y pendiente de crear pull request. Calidad incorpora backlog y antigüedad dentro de Incidentes y problemas, sin crear un séptimo indicador. Bugs VFS y VSW se cargan por separado. Las tres categorías financieras reemplazan año/categoría. Los datos de ejemplo y sus conteos no son una precarga ni prueban cobertura completa. No incluir fuentes reales, contraseñas ni secretos en Git. Las guías PowerShell por entrega (`docs/plan/guia-powershell-csapp0X.md`) son **históricas**: la vigente es la de instalación y operación.
