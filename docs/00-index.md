# Índice de documentación

Versión 0.4, incorporada al repositorio mediante [CSAPP-DOC-00-v1](../prompts/CSAPP-DOC-00-v1.md). Para trabajar: AGENTS.md, CLAUDE.md, [estado](plan/estado.md) y prompt activo; después solo las rutas de la tarea. Cada contrato es propietario de su tema. No leer todo el árbol en cada entrega. [Guía documental](plan/guia-documental.md), con la tabla de lecturas mínimas por entrega.

Estado de la regla: **Confirmado** = decidido por Dennis; **Propuesto** = parámetro o método a calibrar/elegir (ver [pendientes](decisiones/pendientes.md)); **Mixto** = el contrato separa ambos y rotula cada regla. Ninguno implica software implementado.

## Contratos vigentes

| Tema | Propietario | IDs de regla | Estado |
| --- | --- | --- | --- |
| Funcional sencillo para negocio | [Resumen](producto/funcional-resumen.md) | enlaza, no define | Confirmado |
| Cuatro vistas, Administración, ámbitos | [Alcance](producto/alcance.md) | — | Confirmado |
| Grupo Cliente, Cliente, personal, usuarios | [Maestros](producto/maestros.md) | MST 01-08, USR 01-05 | Mixto (aprobar reapertura de años en USR 03; exclusión por arranque en MST 04 pendiente) |
| Administración, pesos y configuración | [Administración](producto/administracion.md) | ADM 01-11 | Mixto (umbrales de Calidad y backlog propuestos) |
| Comparativa | [Contrato de vista](producto/comparativa.md) | ECO 01-08 | Mixto (Silver en ECO 08 propuesto) |
| Análisis Cliente | [Contrato de vista](producto/analisis-cliente.md) | — | Confirmado |
| Pulse Rent | [Contrato de vista](producto/pulse-rent.md) | PUL 01-05 | Confirmado (bandas del Excel) |
| Seis indicadores de Calidad | [Calidad](producto/calidad.md) | QLT 01-10, QHL 01 | Mixto (color de Incidentes y problemas propuesto) |
| Stock y antigüedad | [Backlog](producto/backlog-antiguedad.md) | BACK 01-12 | Mixto (BACK 07-08 propuesta a calibrar) |
| Origen y actuación | [Diagnóstico](producto/diagnostico-origen.md) | DIA 01-07 | Confirmado; catálogo de causas configurable |
| Fórmulas y denominadores | [Catálogo](calculos/catalogo.md) | CAL 01-16 | Confirmado; tolerancias de conciliación propuestas (CAL 08) |
| Importación común y avisos | [Proceso común](importaciones/proceso-comun.md) | IMP 01-07 | Confirmado |
| Tickets: único perfil de ocho campos | [Tickets](importaciones/zendesk-tickets.md) | ZDT 01-10 (11-13 implementación) | Confirmado; ZDT 11-13 interpretaciones implementadas pendientes de aceptación |
| Bugs VFS y VSW separados | [Bugs de producto](importaciones/bugs-producto.md) | BUG 01-08 | Confirmado; implementado en CSAPP-04 |
| Dedicación Zendesk | [Tiempos](importaciones/zendesk-tiempo.md) | ZTM 01-05 (06-08 implementación) | Confirmado; ZTM 06-08 interpretaciones implementadas pendientes de aceptación |
| Dedicación PMO | [Wrike](importaciones/wrike.md) | WRK 01-07 | Confirmado; implementado en CSAPP-04 |
| Tres categorías anuales | [Facturación](importaciones/facturacion.md) | FAC 01-08 | Confirmado; vacío monetario como cero (FAC 07) propuesto |
| Pases a producción | [PAP](importaciones/pap.md) | PAP 01-05 | Confirmado; implementado en CSAPP-04 |
| Arquitectura | [Web y PostgreSQL](arquitectura/propuesta.md) | ARC 01-05 | Propuesto (stack acordado; versiones y rendimiento a verificar) |
| Entidades, sin esquema implementado | [Modelo lógico](arquitectura/modelo.md) | — | Propuesto |
| Implementado en CSAPP-01: versiones, setup, acceso | [Base web y setup](arquitectura/base-web-y-setup.md) | — | Implementado |
| Implementado en CSAPP-01: esquema, vigencias, auditoría | [Modelo físico](arquitectura/modelo-fisico-csapp01.md) | — | Implementado |
| Guía PowerShell y prueba manual de CSAPP-01 | [Guía](plan/guia-powershell-csapp01.md) | — | Sin probar en Windows |
| Resultados de validación de CSAPP-01 | [Validación](validacion/csapp-01.md) | — | Registro |
| Implementado en CSAPP-02: personal único, alias y vigencias | [Personal](arquitectura/personal-csapp02.md) | MST 05-06 | Implementado; probado en Linux |
| Implementado en CSAPP-02: matriz de usuarios contratados | [Matriz de usuarios](arquitectura/usuarios-matriz-csapp02.md) | USR 01-05 | Implementado; probado en Linux |
| Implementado en CSAPP-02: contrato del motor de cargas | [Motor de cargas](arquitectura/motor-cargas-contrato.md) | IMP 01-07 | Implementado; probado en Linux con perfil sintético |
| Implementado en CSAPP-02: lectores XLSX/CSV | [Lectores](arquitectura/lectores-xlsx-csv.md) | — | Implementado; medido en Linux |
| Operación y recuperación del trabajador de cargas | [Guía del trabajador](plan/guia-trabajador-cargas.md) | — | Sin probar en Windows |
| Guía PowerShell de CSAPP-02 | [Guía](plan/guia-powershell-csapp02.md) | — | Sin probar en Windows |
| Recorrido de navegador reproducible | [Guía del recorrido](plan/guia-recorrido-navegador.md) | — | Probado en Linux; Windows sin probar |
| Resultados de validación de CSAPP-02 | [Validación](validacion/csapp-02.md) | — | Registro |
| Implementado en CSAPP-03: importadores de tickets y tiempos Zendesk | [Decisiones técnicas](arquitectura/zendesk-csapp03.md) | ZDT, ZTM | Implementado; probado en Linux |
| Guía PowerShell de CSAPP-03 | [Guía](plan/guia-powershell-csapp03.md) | — | Sin probar en Windows |
| Resultados de validación de CSAPP-03 | [Validación](validacion/csapp-03.md) | — | Registro |
| Implementado en CSAPP-04: Wrike, PAP, bugs, correcciones sin ID y política histórica | [Decisiones técnicas](arquitectura/wrike-pap-bugs-csapp04.md) | WRK, PAP, BUG, ZTM 05-08 | Implementado; probado en Linux |
| Implementado en CSAPP-04: modelo físico | [Modelo físico](arquitectura/modelo-fisico-csapp04.md) | — | Implementado |
| Guía PowerShell de CSAPP-04 | [Guía](plan/guia-powershell-csapp04.md) | — | Sin probar en Windows |
| Resultados de validación de CSAPP-04 | [Validación](validacion/csapp-04.md) | — | Registro |
| DOC-00 y diez entregas | [Roadmap](plan/roadmap.md) | — | Confirmado |
| Precarga futura y pruebas de Dennis | [Política](plan/precarga-y-pruebas.md) | — | Confirmado |
| Progreso real | [Estado](plan/estado.md) | — | Registro vivo |
| Casos definidos, sin afirmar ejecución | [Aceptación](validacion/aceptacion.md) | VAL 01-60, V04-01 a V04-16 | Definidos, no ejecutados |
| Formatos comprobados actuales | [Evidencia v0.4](evidencia/fuentes-v04.md) | — | Evidencia (muestras, no reglas) |

## Decisiones

| Registro | Contenido |
| --- | --- |
| [DEC-003](decisiones/DEC-003-status-backlog-y-arranque-documental-v04.md) | Últimas decisiones confirmadas; prevalece donde cambia DEC-002 y DEC-001 |
| [Pendientes](decisiones/pendientes.md) | Parámetros por calibrar, datos opcionales futuros y decisiones técnicas diferidas |

## Historia: solo cuando la tarea lo requiera

[Acuerdos v0.2](decisiones/DEC-001-acuerdos-v02.md), [diagnóstico v0.3](decisiones/DEC-002-diagnostico-y-bugs-v03.md), [primera inspección](evidencia/inspeccion.md) e [inspección v0.3](evidencia/fuentes-v03.md) explican el proceso. Sus perfiles antiguos, preguntas resueltas y reglas sustituidas no están vigentes. No utilizarlos como contratos alternativos ni leerlos por defecto.

## Prompts

[Índice de prompts](../prompts/README.md), [plantilla](../prompts/_plantilla.md), [CSAPP-DOC-00-v1](../prompts/CSAPP-DOC-00-v1.md), [CSAPP-01-v1](../prompts/CSAPP-01-v1.md), [CSAPP-02-v1](../prompts/CSAPP-02-v1.md), [CSAPP-03-v1](../prompts/CSAPP-03-v1.md) y [CSAPP-04-v1](../prompts/CSAPP-04-v1.md).
