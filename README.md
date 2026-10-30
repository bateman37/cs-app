# CS App

Especificación v0.4, 29 de octubre de 2026, incorporada mediante [CSAPP-DOC-00-v1](prompts/CSAPP-DOC-00-v1.md). Repositorio: https://github.com/bateman37/cs-app. Cuatro vistas: Comparativa, Análisis Cliente, Pulse Rent y Calidad. Maestros, cargas y configuración en Administración. Arquitectura acordada: aplicación web Next.js/React/TypeScript, PostgreSQL propia y Prisma.

El repositorio contiene la documentación v0.4 y la aplicación: base y maestros (CSAPP-01), personal, usuarios y motor común de cargas (CSAPP-02) e importadores de tickets y tiempos Zendesk (CSAPP-03, en PR sin fusionar). Las vistas de análisis y las demás entregas (CSAPP-04 a CSAPP-10) no han empezado. Arranque: guías PowerShell de [CSAPP-01](docs/plan/guia-powershell-csapp01.md), [CSAPP-02](docs/plan/guia-powershell-csapp02.md) y [CSAPP-03](docs/plan/guia-powershell-csapp03.md). Consultar el [estado](docs/plan/estado.md) para el progreso real.

Entrada habitual: [índice](docs/00-index.md), [estado](docs/plan/estado.md) y contrato del tema. Para revisar negocio: [funcional sencillo](docs/producto/funcional-resumen.md). Para planificación: [roadmap](docs/plan/roadmap.md). El registro [DEC-003](docs/decisiones/DEC-003-status-backlog-y-arranque-documental-v04.md) prevalece sobre decisiones anteriores en lo que cambia; los contratos temáticos contienen las reglas vigentes. Instrucciones para agentes: [AGENTS.md](AGENTS.md) y [CLAUDE.md](CLAUDE.md).

El XLSX canónico de tickets tiene ocho campos, incluido status. Las versiones anteriores están sustituidas y no son perfiles alternativos. El sexto indicador está aprobado. PR significa desarrollo finalizado en su rama y pendiente de crear pull request. Calidad incorpora backlog y antigüedad dentro de Incidentes y problemas, sin crear un séptimo indicador.

Dennis hará las cargas operativas, incluidos bugs VFS y VSW separados. Las tres categorías financieras reemplazan año/categoría. Los datos de ejemplo y sus conteos no son una precarga ni prueban cobertura completa. No incluir fuentes reales, contraseñas o secretos en Git.
