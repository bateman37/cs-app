# Estado de CS App

Actualizado el 30 de octubre de 2026 tras ejecutar [CSAPP-DOC-00-v1](../../prompts/CSAPP-DOC-00-v1.md), [CSAPP-01-v1](../../prompts/CSAPP-01-v1.md), [CSAPP-02-v1](../../prompts/CSAPP-02-v1.md), [CSAPP-03-v1](../../prompts/CSAPP-03-v1.md) [CSAPP-04-v1](../../prompts/CSAPP-04-v1.md) y [CSAPP-05-v1](../../prompts/CSAPP-05-v1.md).

## Resultado de CSAPP-DOC-00

| Dato | Valor |
| --- | --- |
| Alcance | Exclusivamente documental; fuera de las diez entregas |
| Repositorio | https://github.com/bateman37/cs-app |
| Rama | claude/new-session-omvsmd (designada por la sesión; el prompt proponía docs/CSAPP-DOC-00-base-documental) |
| PR | https://github.com/bateman37/cs-app/pull/1 (sin fusionar); contenido en el commit b8d90df |
| Repositorio previo | Solo un README de una línea; no había decisiones posteriores que conciliar |
| Contenido | Especificación v0.4 incorporada con sus rutas estables; prompt archivado byte a byte; roadmap ampliado con objetivo, alcance, lecturas, dependencias, aceptación y prueba manual por entrega; índice con propietario, IDs de regla y estado confirmado/propuesto |

Verificaciones documentales ejecutadas (comprobaciones locales de texto y enlaces, sin añadir scripts al proyecto): enlaces relativos e índices resuelven; todo archivo añadido o modificado es Markdown; el prompt archivado es idéntico al recibido; sin secretos, fuentes reales ni nombres de clientes; barrido de las contradicciones activas listadas en la sección 7 del prompt (ocho campos de tickets, sexto numerador, significado de PR, VFS/VSW separados, causas del cliente, backlog dentro de seis indicadores, pesos de 1/6, tres categorías por sustitución, cargas manuales de Dennis). Las correcciones de coherencia aplicadas al paquete: Wrike WRK 04 pasa de propuesta a confirmada; se retiran referencias activas a created_at, a una contraseña y a un nombre de organización; DEC 09 y DEC 11 se señalan como sustituidas; CSAPP-01 ya no vuelve a incorporar AGENTS/CLAUDE/índice/plantilla/prompt.

## Resultado de CSAPP-01 (base web, acceso y maestros de clientes)

| Dato | Valor |
| --- | --- |
| Rama | claude/new-session-omvsmd (designada por la sesión; el prompt proponía feature/CSAPP-01-base-y-clientes). Parte de la rama de DOC-00; su PR 1 ya se fusionó en main y se incorporó a esta rama con un merge, de modo que la PR de CSAPP-01 contiene solo esta entrega |
| PR | https://github.com/bateman37/cs-app/pull/2 (fusionada en main, merge d0a58f3) |
| Implementado | Next.js/Prisma/PostgreSQL; acceso local con Better Auth; perfiles Administrador y Consulta con autorización en servidor; Grupo Cliente, Cliente, implantaciones, equivalencias BC/Zendesk/Wrike/PAP, soporte/servidor/complejidad/producto con vigencias, hitos, catálogo de productos, auditoría atómica y control de versión; navegación con las cuatro vistas pendientes |
| Probado | Tipos, lint, 31 pruebas con PostgreSQL real, build, instalación limpia y 41 comprobaciones de extremo a extremo en Linux. Ver [validación](../validacion/csapp-01.md) |
| No probado | Windows/PowerShell; despliegue |
| Precarga | No realizada: no hay fuente privada en el entorno; los maestros están vacíos |
| Pendiente de Dennis | Revisar la PR, ejecutar la [guía](guia-powershell-csapp01.md) en Windows y facilitar el libro de maestros para la precarga |

Documentación: [base y setup](../arquitectura/base-web-y-setup.md), [modelo físico](../arquitectura/modelo-fisico-csapp01.md).

## Resultado de CSAPP-02 (personal, usuarios mensuales y motor común de cargas)

| Dato | Valor |
| --- | --- |
| Rama | claude/new-session-omvsmd (designada por la sesión; el prompt proponía feature/CSAPP-02-personal-usuarios-cargas). La PR 2 estaba fusionada: la rama se reinició desde main (d0a58f3) |
| PR | https://github.com/bateman37/cs-app/pull/3 (fusionada en main, merge 7dd1c90) |
| Implementado | PERSONAL único con alias por sistema, nivel/equipo/PMO/rol con vigencias y resolución temporal; matriz de usuarios contratados por Grupo Cliente, Cliente e implantación con reglas de edición, inicialización 2025 y copia a 2026, servicios de usuarios al mes/corte y exposición; motor común de cargas (lectores XLSX/CSV por bloques, cola en PostgreSQL, trabajador separado con lease y fencing, staging, huellas, procedencias, activación atómica, reversión, reproceso) con interfaz en Administración › Cargas; recorrido de navegador versionado |
| Probado | Linux: tipos, lint, build, migración sobre base vacía y sobre datos sintéticos de CSAPP-01, 144 pruebas con PostgreSQL real, 78 comprobaciones de navegador, volumen de 1 000 000 filas. Ver [validación](../validacion/csapp-02.md) |
| No probado | Windows/PowerShell; subida de archivos grandes por el navegador; despliegue |
| Precarga | No realizada: sin fuentes privadas. Las tablas de personal y de matriz están vacías; el motor no tiene ningún importador operativo (el primero es el de CSAPP-03) |
| Pendiente de Dennis | Revisar la PR, ejecutar las guías de PowerShell de [CSAPP-01](guia-powershell-csapp01.md) y [CSAPP-02](guia-powershell-csapp02.md) en Windows y facilitar las fuentes privadas de personal y usuarios para la precarga |

Documentación: [personal](../arquitectura/personal-csapp02.md), [matriz de usuarios](../arquitectura/usuarios-matriz-csapp02.md), [motor de cargas](../arquitectura/motor-cargas-contrato.md), [lectores](../arquitectura/lectores-xlsx-csv.md), [trabajador](guia-trabajador-cargas.md), [cargas para Dennis](guia-cargas-usuario.md), [recorrido de navegador](guia-recorrido-navegador.md).

## Resultado de CSAPP-03 (importadores de tickets y tiempos Zendesk)

| Dato | Valor |
| --- | --- |
| Rama | claude/new-session-omvsmd (designada por la sesión; el prompt proponía feature/CSAPP-03-zendesk-tickets-y-tiempos). La PR 3 estaba **fusionada** (merge 7dd1c90): la rama se reinició desde ese main, sin añadir nada a la PR 3 |
| PR | https://github.com/bateman37/cs-app/pull/4 (**fusionada** en main, merge 3c08fc0c647088d2b226d1385b95e1daa8142843; corregido según Git al preparar CSAPP-04) |
| Implementado | Perfiles `zendesk-tickets` (ocho campos con status) y `zendesk-tiempo` (once campos) sobre el motor de CSAPP-02: validación por contenido y cabeceras, IDs y fechas exactos, tickets como entidad con revisiones y observaciones (vigencia por observación), vínculos y clasificaciones, tiempos con duración exacta, deduplicación por huella, correcciones explícitas, corte histórico PMO, partición contable conciliable, relaciones tardías, reproceso de lotes completados (`REDERIVE`), reversión y detalle en Administración › Cargas |
| Probado | Linux (Node 22.22, PostgreSQL 16): tipos, lint, build, migración limpia y sobre CSAPP-02 con datos, pruebas con PostgreSQL real, recorrido de navegador, volumen de ≈114 000 tickets y ≈250 000 tiempos por el motor y por subida web, y recuperación tras SIGKILL. Cifras exactas en la [validación](../validacion/csapp-03.md) |
| No probado | Windows/PowerShell; aceptación manual por Dennis; despliegue |
| Precarga | No realizada: no se han cargado archivos reales (las pruebas usan XLSX sintéticos generados en streaming y no versionados). El primer import real lo hará Dennis |
| Pendiente de Dennis | Revisar la PR, ejecutar la [guía de CSAPP-03](guia-powershell-csapp03.md) en Windows con sus XLSX y validar las interpretaciones ZDT 11-13 y ZTM 06-08 |

Documentación: [decisiones técnicas](../arquitectura/zendesk-csapp03.md), [tickets](../importaciones/zendesk-tickets.md), [tiempos](../importaciones/zendesk-tiempo.md), [motor](../arquitectura/motor-cargas-contrato.md), [guía PowerShell](guia-powershell-csapp03.md).

## Resultado de CSAPP-04 (Wrike, PAP y bugs de producto VFS/VSW)

| Dato | Valor |
| --- | --- |
| Rama / base | claude/new-session-omvsmd (designada por la sesión; el prompt proponía feature/CSAPP-04-wrike-pap-bugs). Su PR 4 estaba fusionada: la rama se reinició con `checkout -B` desde main 3c08fc0c647088d2b226d1385b95e1daa8142843, sin force-push |
| PR | https://github.com/bateman37/cs-app/pull/5 (base main, sin fusionar); último commit de código y pruebas 7298a40bab7f384df1efa5d25478c3a061f7b9e3 |
| Implementado | Perfiles `wrike` (CSV), `pap` (XLSX de 29 columnas) y `bugs-vfs`/`bugs-vsw` (CSV) sobre el motor común; el registro tiene seis perfiles operativos y las tres fuentes financieras siguen pendientes. Corrección explícita de un registro activo **sin ID** (Zendesk sin id y Wrike) con comparación, confirmación de la sustitución concreta, versión del registro y del lote, auditoría y reversión. Vista común `TimeActivity` con origen inequívoco y política histórica PMO. Resúmenes conciliables, detalle por motivo y revisión de vínculos en Administración › Cargas |
| Probado | Linux (Node 22.22, PostgreSQL 16): tipos, lint, pruebas con PostgreSQL real, migración limpia y sobre CSAPP-03 con datos, recorrido de navegador con web y trabajador compilados y volumen del circuito. Cifras exactas en la [validación](../validacion/csapp-04.md) |
| No probado | Windows/PowerShell; aceptación manual por Dennis; despliegue |
| Interpretaciones | ZDT 11-13 y ZTM 06-08 **siguen pendientes de aceptación**; ZTM 07 se amplía (ver [decisiones](../arquitectura/wrike-pap-bugs-csapp04.md#2-revisión-acotada-de-las-interpretaciones-zdt-11-13-y-ztm-06-08)). Nuevas propuestas sin aceptar: clave BC de grupo como forma de declarar proyecto-solo-grupo, lista de origen PAP declarada en la carga y catálogo de etapas de estado de bugs |
| Precarga | No realizada: no hay fuentes privadas; las cargas reales de las cuatro fuentes las hará Dennis |
| Pendiente de Dennis | Revisar la PR, ejecutar la [guía de CSAPP-04](guia-powershell-csapp04.md) en Windows, comprobar equivalencias de PERSONAL y proyectos, cargar sus archivos reales y validar las interpretaciones |

Documentación: [decisiones técnicas](../arquitectura/wrike-pap-bugs-csapp04.md), [modelo físico](../arquitectura/modelo-fisico-csapp04.md), [Wrike](../importaciones/wrike.md), [PAP](../importaciones/pap.md), [bugs](../importaciones/bugs-producto.md), [guía PowerShell](guia-powershell-csapp04.md).

## Resultado de CSAPP-05 (facturación anual y motor económico)

| Dato | Valor |
| --- | --- |
| Rama / base | claude/new-session-omvsmd (designada; el prompt proponía feature/CSAPP-05-finanzas-motor-economico). Base: main 24d365813ab2ba2703fa911f4e0dacd31fb781fb (merge de la PR 5, **fusionada según Git**: integración, no aceptación manual de Dennis). Push normal, sin force |
| PR | https://github.com/bateman37/cs-app/pull/6 (base main, sin fusionar) |
| Migración | `20261031090000_finanzas_motor_economico` |
| Implementado | Tres perfiles financieros (nueve operativos en total) con sustitución atómica por año/categoría, revisión del impacto y de la versión del conjunto vigente, decisiones, conciliación, reversión y reproceso; motor económico común (periodos, prorrateo, CUM, usuarios, ratios, servicio, cobertura, lectura consistente); comprobación económica, configuración económica y asignaciones de servicio en Administración; equivalencias Wrike/PAP a Grupo (el atajo BC ya no atribuye); vía histórica < 2025 (simulación por defecto) |
| Probado | Linux (Node 22.22, PostgreSQL 16): `npm test` 23 archivos/338 pruebas, trabajador real, volumen y recorrido de navegador 193/193. Ver [validación](../validacion/csapp-05.md) |
| No probado | Windows/PowerShell; aceptación de Dennis; archivos reales; `cargas-trabajador` con 300 000 filas excede su límite en este entorno (también en main) |
| Precarga | **No realizada: falta fuente.** Las cargas reales de 2025 y 2026 las realiza Dennis |
| Pendiente de Dennis | Revisar la PR, ejecutar la [guía de CSAPP-05](guia-powershell-csapp05.md), cargar 2025/2026 por categoría, repetir, sustituir, revertir y comprobar 12000 → 500 a 15/30; validar las propuestas pendientes (ver [tabla](../arquitectura/finanzas-motor-csapp05.md#10-reglas-propuestas-pendientes-o-heredadas-estado-explícito)) |

Documentación: [finanzas y motor económico](../arquitectura/finanzas-motor-csapp05.md), [facturación](../importaciones/facturacion.md), [catálogo CAL 17-30](../calculos/catalogo.md).

## Estado por trabajo

Niveles: diseñado, documentado, implementado, probado, aceptado. Un criterio de aceptación escrito no es una prueba ejecutada.

| Trabajo | Diseñado | Documentado | Implementado | Probado | Aceptado |
| --- | --- | --- | --- | --- | --- |
| CSAPP-DOC-00 | Sí | Sí (PR pendiente de revisión) | No aplica | Solo verificaciones documentales | No |
| CSAPP-01 | Sí | Sí | Sí (PR 2 fusionada) | Sí en Linux; Windows sin probar | No |
| CSAPP-02 | Sí | Sí | Sí (PR 3 fusionada) | Sí en Linux con perfil sintético; Windows sin probar | No |
| CSAPP-03 | Sí | Sí | Sí (PR 4 fusionada) | Sí en Linux con XLSX sintéticos; Windows sin probar | No |
| CSAPP-04 | Sí | Sí | Sí (PR 5 fusionada según Git) | Sí en Linux con datos sintéticos; Windows sin probar | No |
| CSAPP-05 | Sí | Sí | Sí (PR 6 sin fusionar) | Sí en Linux con datos sintéticos; Windows sin probar | No |
| CSAPP-06 a CSAPP-10 | Sí, en [roadmap](roadmap.md) y contratos | Sí | No | No | No |
| Cargas reales | — | Política en [precarga y pruebas](precarga-y-pruebas.md) | No | No | No; las probará Dennis |

CSAPP-06 a CSAPP-10 siguen sin iniciar y sin prompt redactado. La próxima acción es revisar la PR 6 de CSAPP-05, que Dennis cargue 2025 y 2026 de cada categoría y repita para validar la sustitución, y enviar el prompt de CSAPP-06.

## Vigente

Tickets con ocho campos/status, sexto indicador aprobado, PR aclarado, bugs VFS/VSW separados, backlog dentro de Incidentes y problemas. Parámetros por calibrar: ver [pendientes](../decisiones/pendientes.md). problem_id y fechas de resolución son enriquecimientos futuros, no campos existentes. No volver a pedir las decisiones resueltas.

No se han ejecutado cargas reales ni precargas. Las conciliaciones y medidas de CSAPP-03 y CSAPP-04 son de archivos sintéticos; no equivalen a conciliar con los datos reales de Dennis.
