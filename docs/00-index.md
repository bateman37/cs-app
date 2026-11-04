# Índice de documentación

Versión 0.4, incorporada al repositorio mediante [CSAPP-DOC-00-v1](../prompts/CSAPP-DOC-00-v1.md). Para trabajar: AGENTS.md, CLAUDE.md, [estado](plan/estado.md) y prompt activo; después solo las rutas de la tarea. Cada contrato es propietario de su tema. No leer todo el árbol en cada entrega. [Guía documental](plan/guia-documental.md), con la tabla de lecturas mínimas por entrega.

Estado de la regla: **Confirmado** = decidido por Dennis; **Propuesto** = parámetro o método a calibrar/elegir (ver [pendientes](decisiones/pendientes.md)); **Mixto** = el contrato separa ambos y rotula cada regla. Ninguno implica software implementado.

## Contratos vigentes

| Tema | Propietario | IDs de regla | Estado |
| --- | --- | --- | --- |
| Funcional sencillo para negocio | [Resumen](producto/funcional-resumen.md) | enlaza, no define | Confirmado |
| Cuatro vistas, Administración, ámbitos | [Alcance](producto/alcance.md) | — | Confirmado |
| Grupo Cliente, Cliente, personal, usuarios | [Maestros](producto/maestros.md) | MST 01-08, USR 01-05 | Mixto (aprobar reapertura de años en USR 03; exclusión por arranque en MST 04 pendiente) |
| Administración, pesos y configuración | [Administración](producto/administracion.md) | ADM 01-15 | Mixto (umbrales de Calidad y backlog propuestos; pesos iguales confirmados; configuración implementada en CSAPP-07) |
| Comparativa | [Contrato de vista](producto/comparativa.md) | ECO 01-08 | Mixto (Silver en ECO 08 propuesto); implementada en CSAPP-06 |
| Análisis Cliente | [Contrato de vista](producto/analisis-cliente.md) | — | Confirmado; implementado en CSAPP-06 |
| Pulse Rent | [Contrato de vista](producto/pulse-rent.md) | PUL 01-05 | Confirmado (bandas del Excel); implementado en CSAPP-07 |
| Seis indicadores de Calidad | [Calidad](producto/calidad.md) | QLT 01-19, QHL 01-03 | Mixto (color de Incidentes y problemas, mapeo de Health y global: propuestas hasta elección del Administrador) |
| Stock y antigüedad | [Backlog](producto/backlog-antiguedad.md) | BACK 01-12 | Mixto (BACK 07-08 propuesta a calibrar) |
| Origen y actuación | [Diagnóstico](producto/diagnostico-origen.md) | DIA 01-07 | Confirmado; catálogo de causas configurable |
| Fórmulas y denominadores | [Catálogo](calculos/catalogo.md) | CAL 01-44 | Confirmado; implementado en CSAPP-05 el motor económico (CAL 17-30) y corregido en CSAPP-06 (CAL 31-36, eco-v2); tolerancias de conciliación propuestas (CAL 08) |
| Importación común y avisos | [Proceso común](importaciones/proceso-comun.md) | IMP 01-12 (08-12 de HOTFIX-01: última carga, instantánea de tiempos, vista amplia, controles) | Confirmado |
| Tickets: único perfil de ocho campos | [Tickets](importaciones/zendesk-tickets.md) | ZDT 01-10 (11-13 implementación) | Confirmado; ZDT 11-13 interpretaciones implementadas pendientes de aceptación |
| Bugs VFS y VSW separados | [Bugs de producto](importaciones/bugs-producto.md) | BUG 01-08 | Confirmado; implementado en CSAPP-04 |
| Dedicación Zendesk | [Tiempos](importaciones/zendesk-tiempo.md) | ZTM 01-05 (06-08 implementación) | Confirmado; ZTM 06-08 interpretaciones implementadas pendientes de aceptación |
| Dedicación PMO | [Wrike](importaciones/wrike.md) | WRK 01-07 | Confirmado; implementado en CSAPP-04 |
| Tres categorías anuales | [Facturación](importaciones/facturacion.md) | FAC 01-14 | Confirmado; implementado en CSAPP-05; vacío monetario como cero (FAC 07) propuesto |
| Pases a producción | [PAP](importaciones/pap.md) | PAP 01-06 (01 modificado y 06 nuevo en HOTFIX-01) | Confirmado; implementado en CSAPP-04 y HOTFIX-01 |
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
| Implementado en CSAPP-05: finanzas, motor económico, esquema y bloqueos | [Decisiones técnicas](arquitectura/finanzas-motor-csapp05.md) | FAC 09-14, CAL 17-30 | Implementado; probado en Linux |
| Guía PowerShell de CSAPP-05 | [Guía](plan/guia-powershell-csapp05.md) | — | Sin probar en Windows |
| Resultados de validación de CSAPP-05 | [Validación](validacion/csapp-05.md) | — | Registro |
| Implementado en CSAPP-06: servicios analíticos, sello de datos, CSV y permisos | [Analítica](arquitectura/analitica-csapp06.md) | CAL 31-36 | Implementado; probado en Linux |
| Guía PowerShell de CSAPP-06 | [Guía](plan/guia-powershell-csapp06.md) | — | Sin probar en Windows |
| Resultados de validación de CSAPP-06 | [Validación](validacion/csapp-06.md) | — | Registro |
| Implementado en CSAPP-07: Pulse Rent, configuración versionada, guard de pruebas | [Decisiones técnicas](arquitectura/pulse-configuracion-csapp07.md) | CAL 37-44, ADM 12-15 | Implementado; probado en Linux |
| Guías de CSAPP-07: PowerShell y configuración | [PowerShell](plan/guia-powershell-csapp07.md) · [Configuración](plan/guia-configuracion-csapp07.md) | — | Sin probar en Windows |
| Resultados de validación de CSAPP-07 | [Validación](validacion/csapp-07.md) | — | Registro |
| Arquitectura de Calidad (CSAPP-08): esquema, compatibilidad v1→v2, fotografías, cobertura | [Calidad CSAPP-08](arquitectura/calidad-csapp08.md) | CAL 45-52 | Implementado, sin aceptación |
| HOTFIX-01: última carga, instantáneas de tiempos, PAP único, formularios sencillos | [Arquitectura](arquitectura/hotfix01-ultima-carga.md) | IMP 08-12, PAP 01/06 | Implementado; probado en Linux |
| HOTFIX-01: histórico económico 2022-2025 y usuarios 2025 | [Histórico económico](importaciones/historico-economico.md) | FAC, USR 02-03 | Implementado; ensayado con el libro real en base aislada |
| HOTFIX-01: precarga de maestros (Clientes, Personal, PMO) | [Precarga de maestros](importaciones/precarga-maestros.md) | MST 03/05 | Implementado; ensayado con el libro real en base aislada |
| Guía de actualización de HOTFIX-01 para Windows | [Guía](plan/guia-powershell-hotfix01.md) | — | Escrita, sin probar en Windows |
| HOTFIX-02: enlace automático, servicio y cobertura | [Arquitectura](arquitectura/hotfix02-enlace-automatico.md) | IMP, PRE | Implementado; probado en Linux |
| HOTFIX-02: validación y guía de actualización | [Validación](validacion/hotfix-02.md) · [Guía Windows](plan/guia-powershell-hotfix02.md) | — | Registro; guía sin probar en Windows |
| Guía PowerShell y recorrido de CSAPP-08 | [Guía PowerShell](plan/guia-powershell-csapp08.md) | — | Escrita, sin probar en Windows |
| Guía breve de Calidad | [Guía de Calidad](plan/guia-calidad-csapp08.md) | — | Referencia |
| Resultados de validación de CSAPP-08 | [Validación](validacion/csapp-08.md) | — | Registro |
| Exportaciones completas en segundo plano, instantáneas, recuperación y límites (CSAPP-09) | [Exportaciones](arquitectura/exportaciones-csapp09.md) | — | Implementado; probado en Linux con datos sintéticos; sin aceptación |
| Conciliación en cuatro niveles con IDs estables (tres de CSAPP-09 y el puente de CSAPP-10) | [Contrato de conciliación](validacion/conciliacion-contrato.md) | REC-N1…N4 | Implementado; la conciliación real la ejecuta Dennis |
| Guía PowerShell y recorrido de CSAPP-09 | [Guía PowerShell](plan/guia-powershell-csapp09.md) | — | Escrita, sin probar en Windows |
| Resultados de validación de CSAPP-09 | [Validación](validacion/csapp-09.md) | — | Registro |
| Operación, salud, instalación y supervisor (CSAPP-10) | [Operación CSAPP-10](arquitectura/operacion-csapp10.md) | — | Implementado; probado en Linux; Windows sin probar |
| Instalación y operación vigentes | [Instalación y operación](operacion/instalacion-operacion.md) · [Variables](operacion/variables-entorno.md) | — | Vigente; ensayada en Linux |
| Copia y restauración | [Copia y restauración](operacion/copia-restauracion.md) | — | Ensayada en Linux |
| Actualización, vuelta atrás y requisitos para IT | [Actualización y despliegue](operacion/actualizacion-despliegue-it.md) | — | Ensayada en Linux; despliegue pendiente |
| Puesta en marcha de datos para Dennis | [Guía de Dennis](plan/guia-dennis.md) | — | Vigente |
| Registro de aceptación (Dennis/IT), separado de las pruebas sintéticas | [Registro](validacion/registro-aceptacion.md) | — | Todo pendiente |
| Resultados de validación de CSAPP-10 | [Validación](validacion/csapp-10.md) | — | Registro |
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

[Índice de prompts](../prompts/README.md), [plantilla](../prompts/_plantilla.md), [CSAPP-DOC-00-v1](../prompts/CSAPP-DOC-00-v1.md), [CSAPP-01-v1](../prompts/CSAPP-01-v1.md), [CSAPP-02-v1](../prompts/CSAPP-02-v1.md), [CSAPP-03-v1](../prompts/CSAPP-03-v1.md) y [CSAPP-04-v1](../prompts/CSAPP-04-v1.md), [CSAPP-05-v1](../prompts/CSAPP-05-v1.md) y [CSAPP-06-v1](../prompts/CSAPP-06-v1.md).
