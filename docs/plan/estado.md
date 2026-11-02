# Estado de CS App

Actualizado el 2 de noviembre de 2026 tras ejecutar [CSAPP-DOC-00-v1](../../prompts/CSAPP-DOC-00-v1.md), [CSAPP-01-v1](../../prompts/CSAPP-01-v1.md), [CSAPP-02-v1](../../prompts/CSAPP-02-v1.md), [CSAPP-03-v1](../../prompts/CSAPP-03-v1.md) [CSAPP-04-v1](../../prompts/CSAPP-04-v1.md) [CSAPP-05-v1](../../prompts/CSAPP-05-v1.md) [CSAPP-06-v1](../../prompts/CSAPP-06-v1.md) y [CSAPP-07-v1](../../prompts/CSAPP-07-v1.md) [CSAPP-08-v1](../../prompts/CSAPP-08-v1.md) y [CSAPP-09-v1](../../prompts/CSAPP-09-v1.md).

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
| PR | https://github.com/bateman37/cs-app/pull/6 (**fusionada** en main, merge f71b5b7283ab1081802cc6256899a02f70460a74, según Git; corregido al preparar CSAPP-06: integración, no aceptación) |
| Migración | `20261031090000_finanzas_motor_economico` |
| Implementado | Tres perfiles financieros (nueve operativos en total) con sustitución atómica por año/categoría, revisión del impacto y de la versión del conjunto vigente, decisiones, conciliación, reversión y reproceso; motor económico común (periodos, prorrateo, CUM, usuarios, ratios, servicio, cobertura, lectura consistente); comprobación económica, configuración económica y asignaciones de servicio en Administración; equivalencias Wrike/PAP a Grupo (el atajo BC ya no atribuye); vía histórica < 2025 (simulación por defecto) |
| Probado | Linux (Node 22.22, PostgreSQL 16): `npm test` 23 archivos/338 pruebas, trabajador real, volumen y recorrido de navegador 193/193. Ver [validación](../validacion/csapp-05.md) |
| No probado | Windows/PowerShell; aceptación de Dennis; archivos reales; `cargas-trabajador` con 300 000 filas excede su límite en este entorno (también en main) |
| Precarga | **No realizada: falta fuente.** Las cargas reales de 2025 y 2026 las realiza Dennis |
| Pendiente de Dennis | Revisar la PR, ejecutar la [guía de CSAPP-05](guia-powershell-csapp05.md), cargar 2025/2026 por categoría, repetir, sustituir, revertir y comprobar 12000 → 500 a 15/30; validar las propuestas pendientes (ver [tabla](../arquitectura/finanzas-motor-csapp05.md#10-reglas-propuestas-pendientes-o-heredadas-estado-explícito)) |

Documentación: [finanzas y motor económico](../arquitectura/finanzas-motor-csapp05.md), [facturación](../importaciones/facturacion.md), [catálogo CAL 17-30](../calculos/catalogo.md).

## Resultado de CSAPP-06 (Comparativa y Análisis Cliente)

| Dato | Valor |
| --- | --- |
| Rama / base | claude/new-session-omvsmd (designada; el prompt proponía feature/CSAPP-06-comparativa-analisis-cliente), reiniciada con `checkout -B` desde main f71b5b7 (PR 6 fusionada); push normal, sin force |
| PR | https://github.com/bateman37/cs-app/pull/7 (base main, **sin fusionar**) |
| Migración | **Ninguna** |
| Implementado | `/comparativa` y `/analisis-cliente` sobre el motor `eco-v2` corregido; contrato de consulta compartido; ficha con cinco secciones, gráficos y detalle que concilia; CSV de cartera y de la ficha; lectura coherente con sello de datos |
| Probado | Linux: `npm test` 392 pruebas, trabajador real 300 000 filas (260 s), recorrido de navegador 238 comprobaciones, volumen 1 500 grupos/250 000 tiempos. Ver [validación](../validacion/csapp-06.md) |
| No probado | Windows/PowerShell; aceptación de Dennis; archivos reales |
| Precarga | No realizada |
| Pendiente de Dennis | Revisar la PR, ejecutar la [guía](guia-powershell-csapp06.md), cargar sus fuentes y recorrer las pantallas; aceptar o ajustar ECO 08, ZDT 11-13, ZTM 06-08, lista de origen PAP y estados de bugs; decidir la limpieza de dos cuentas sintéticas en la base `cs_app` del contenedor |

Documentación: [analítica](../arquitectura/analitica-csapp06.md), [Comparativa](../producto/comparativa.md), [Análisis Cliente](../producto/analisis-cliente.md), [catálogo CAL 31-36](../calculos/catalogo.md).

## Resultado de CSAPP-07 (Pulse Rent y configuración)

| Dato | Valor |
| --- | --- |
| Rama / base | `feature/CSAPP-07-pulse-rent-configuracion`, **apilada sobre la cabeza de la PR 7** (`8c92ab8`, CSAPP-06, sin fusionar; `main` f71b5b7 incluye CSAPP-05, merge de la PR 6, pero no 06). La rama designada por la sesión (`claude/new-session-omvsmd`) estaba ocupada por la PR 7 y no se contaminó; push normal, sin force |
| PR | [PR 8](https://github.com/bateman37/cs-app/pull/8), apilada contra `claude/new-session-omvsmd`; **integrada en la rama de la PR 7** (cabeza `e0f17e4`, que contiene 06 y 07), **no en `main`** (`f71b5b7`). Integración en Git no es aceptación de Dennis |
| Migración | `20261102090000_pulse_calidad_configuracion` (`ConfigRevision`, `ConfigDraft`) |
| Implementado | Guard central de pruebas (prevención, no limpieza); `/pulse-rent` con 38 métricas (M01-M38), referencias explícitas, normalización, percentiles, cinco bandas, explicación, detalle y CSV; Administración › Configuración con secciones Economía / Pulse Rent / Calidad (borrador, simulación, activación, vuelta atrás, revisiones inmutables); pesos exactos de Calidad y simulador |
| Probado | Linux: `npm test` 475 pruebas / 33 archivos, trabajador 300 000 filas, recorrido 291 comprobaciones, volumen 1 500 grupos. Ver [validación](../validacion/csapp-07.md) |
| No probado | Windows/PowerShell; aceptación de Dennis; archivos reales; lector de pantalla |
| Confirmado / propuesto / activado | **Confirmado:** pesos iguales 1/6 y la regla de redistribución sin Health; **propuestas desactivadas** (no aceptadas): umbrales, mínimos de muestra, composición «peor señal», mapeo de Client Health, plantilla del global; **activado por el Administrador:** nada (todo parte inicial/sin calibrar) |
| Incidente de CSAPP-06 | Prevención implementada y probada. **Residuo pendiente de decisión de Dennis:** 2 cuentas sintéticas en la base `cs_app` del contenedor (no tocadas) |
| Pendiente de Dennis | Revisar la PR, ejecutar la [guía](guia-powershell-csapp07.md), cargar fuentes, decidir sobre el residuo, aceptar o ajustar ECO 08, ZDT 11-13, ZTM 06-08, lista PAP, estados de bugs y los parámetros de Calidad |

Documentación: [arquitectura](../arquitectura/pulse-configuracion-csapp07.md), [Pulse Rent](../producto/pulse-rent.md), [guía de configuración](guia-configuracion-csapp07.md), [catálogo CAL 37-44](../calculos/catalogo.md).

## Resultado de CSAPP-08 (Calidad, Client Health, diagnóstico y backlog observado)

| Dato | Valor |
| --- | --- |
| Rama / base | `feature/CSAPP-08-calidad-client-health`, creada desde la cabeza de la PR 7 (`e0f17e4c8e1a47ad08d10b8eeaf2e5f407c66bb5`, que ya contiene 06 y 07 tras integrar la PR 8); `main` (`f71b5b7`) no los contiene. La rama de la sesión (`claude/new-session-omvsmd`) es la de la PR 7 y no se contaminó; push normal, sin force |
| PR | [PR 9](https://github.com/bateman37/cs-app/pull/9), apilada contra `claude/new-session-omvsmd`, sin fusionar ni desplegar. Cuando 06/07 entren en `main`, ajustar la base conservando historia |
| Migración | `20261103090000_calidad_health_cobertura` (`HealthFeedback`, `HealthFeedbackEvent`, `QualityNote`, `UploadCoverageDeclaration`, índices y restricciones); las seis anteriores y la `ConfigRevision` v1 intactas |
| Implementado | `/calidad` (cartera, Client Health editable, diagnóstico por origen, backlog por antigüedad, detalle explicado, evolución, CSV) con el motor común por conjuntos y evaluador puro; `quality-config-v2` con adaptador de v1; contrato de cobertura declarada en Cargas, compartido con Pulse; simulación del borrador sobre datos; integración en Análisis Cliente; correcciones de §2 con contraejemplos |
| Probado | Linux con datos sintéticos: ver [validación](../validacion/csapp-08.md). Windows sin probar; sin lector de pantalla |
| Confirmado / propuesto / activado | **Confirmados:** pesos iguales 1/6 y redistribución solo sin Health. **Propuestas desactivadas:** mapeo de Health, perfiles de Dedicación, umbrales/referencias/mínimos, «peor señal», plantilla del global, política de fotografía anterior. Nada se ha activado para que haya colores |
| Pendiente de Dennis | Revisar la PR; ejecutar la [guía](guia-powershell-csapp08.md); declarar la cobertura de sus lotes reales; calibrar y activar sus reglas; decidir sobre las dos cuentas sintéticas de `cs_app`; aceptar o ajustar ECO 08, ZDT 11–13, ZTM 06–08, lista PAP, estados de bugs y signo de «Diferencia» (siguen pendientes) |

Documentación: [arquitectura](../arquitectura/calidad-csapp08.md), [Calidad](../producto/calidad.md), [backlog](../producto/backlog-antiguedad.md), [diagnóstico](../producto/diagnostico-origen.md), [catálogo CAL 45–52](../calculos/catalogo.md), [guía breve](guia-calidad-csapp08.md).

## Resultado de CSAPP-09 (conciliación, rendimiento, exportaciones y recuperación)

| Dato | Valor |
| --- | --- |
| Rama / base | `feature/CSAPP-09-conciliacion-exportaciones-rendimiento`, creada desde la cabeza de la PR 7 (`claude/new-session-omvsmd` = `31009c99398af314a87fe3eedef5b457ede31559`, que contiene 06, 07 y 08 con el mismo contenido que la cabeza de la PR 9 `d7bc52b`). `main` (`f71b5b7283ab1081802cc6256899a02f70460a74`) **no** contiene 06–08. PR apilada **contra la rama de la PR 7**, con un diff exclusivo de 09; push normal, sin force, sin tocar la historia publicada |
| PR | Ver el prompt registrado en [prompts/README.md](../../prompts/README.md) y la validación; sin fusionar ni desplegar |
| Migración | `20261104090000_exportaciones_conciliacion` (`ExportJob`, `ExportFile`, `ExportRow`, `ReconRun`); incremental, sin reset; las siete anteriores y las `ConfigRevision` intactas |
| Implementado | **Evolución de Calidad recalculada por mes** con cohorte, usuarios, cobertura, reglas y percentiles de cada mes (seis indicadores, serie identificada por revisión y referencia); **conciliación** en Administración (tres niveles, IDs `REC-*`, ejecución registrada con manifiesto, informe CSV y JSON); **exportaciones completas en segundo plano** (materialización coherente, bloques con contrapresión, lease/fencing, cancelar, reintentar, caducar, partición determinista, manifiesto) integradas en las cuatro vistas y supervisadas en Administración; **sello de datos** con las omisiones demostradas corregidas; CSV de Health desde una lectura coherente; documentación de Pulse/cobertura corregida; fallo de paginación de la exportación hallado y corregido por la prueba de volumen |
| Probado | Linux con datos sintéticos: ver [validación de CSAPP-09](../validacion/csapp-09.md) (suite rápida, trabajador real con SIGKILL, volúmenes, recorrido de navegador, benchmark comparado con 08). Windows y lector de pantalla **sin probar** |
| Confirmado / propuesto / activado | **Confirmados** (sin cambio): pesos iguales 1/6 y redistribución solo sin Health. **Propuestas desactivadas y sin aceptar**: mapeo de Health, perfiles de Dedicación, umbrales/referencias/mínimos, «peor señal», plantilla del global, política de fotografía, límites iniciales de exportación. **Activado**: nada en la base de trabajo |
| Conciliación real | **Pendiente de ejecución por Dennis** (finanzas 2025 y 2026 completas, bugs VFS/VSW separados): no se cargó ningún archivo real y no hay resultados de ese tipo |
| Pendiente de Dennis | Revisar la PR; ejecutar la [guía](guia-powershell-csapp09.md) (Windows sin probar); cargar sus fuentes y recorrer el [recorrido breve](guia-powershell-csapp09.md#recorrido-breve-para-dennis-con-tus-archivos-reales-por-tu-cuenta); decidir sobre las dos cuentas sintéticas de `cs_app` (no se tocaron); aceptar o ajustar ECO 08, ZDT 11–13, ZTM 06–08, lista PAP, estados de bugs y signo de «Diferencia» (siguen pendientes) |

Documentación: [exportaciones](../arquitectura/exportaciones-csapp09.md), [conciliación](../validacion/conciliacion-contrato.md), [validación](../validacion/csapp-09.md), [guía PowerShell](guia-powershell-csapp09.md).

## Estado por trabajo

Niveles: diseñado, documentado, implementado, probado, aceptado. Un criterio de aceptación escrito no es una prueba ejecutada.

| Trabajo | Diseñado | Documentado | Implementado | Probado | Aceptado |
| --- | --- | --- | --- | --- | --- |
| CSAPP-DOC-00 | Sí | Sí (PR pendiente de revisión) | No aplica | Solo verificaciones documentales | No |
| CSAPP-01 | Sí | Sí | Sí (PR 2 fusionada) | Sí en Linux; Windows sin probar | No |
| CSAPP-02 | Sí | Sí | Sí (PR 3 fusionada) | Sí en Linux con perfil sintético; Windows sin probar | No |
| CSAPP-03 | Sí | Sí | Sí (PR 4 fusionada) | Sí en Linux con XLSX sintéticos; Windows sin probar | No |
| CSAPP-04 | Sí | Sí | Sí (PR 5 fusionada según Git) | Sí en Linux con datos sintéticos; Windows sin probar | No |
| CSAPP-05 | Sí | Sí | Sí (PR 6 fusionada según Git) | Sí en Linux con datos sintéticos; Windows sin probar | No |
| CSAPP-06 | Sí | Sí | Sí (PR sin fusionar) | Sí en Linux con datos sintéticos; Windows sin probar | No |
| CSAPP-07 | Sí | Sí | Sí (PR 8, integrada en la rama de la PR 7, no en `main`) | Sí en Linux con datos sintéticos; Windows sin probar | No |
| CSAPP-08 | Sí | Sí | Sí (PR apilada sin fusionar) | Sí en Linux con datos sintéticos; Windows sin probar | No |
| CSAPP-09 | Sí | Sí | Sí (PR apilada sin fusionar) | Sí en Linux con datos sintéticos; Windows y conciliación real sin ejecutar | No |
| CSAPP-10 | Sí, en [roadmap](roadmap.md) y contratos | Sí | No | No | No |
| Cargas reales | — | Política en [precarga y pruebas](precarga-y-pruebas.md) | No | No | No; las probará Dennis |

CSAPP-10 sigue sin iniciar y sin prompt redactado. La próxima acción es revisar la PR 7 (CSAPP-06, con 07 y 08 integradas en su rama) y la PR apilada de CSAPP-09, que Dennis cargue sus fuentes reales, declare su cobertura, ejecute la conciliación, decida sobre las dos cuentas sintéticas de `cs_app` y envíe el prompt de CSAPP-10.

## Vigente

Tickets con ocho campos/status, sexto indicador aprobado, PR aclarado, bugs VFS/VSW separados, backlog dentro de Incidentes y problemas. Parámetros por calibrar: ver [pendientes](../decisiones/pendientes.md). problem_id y fechas de resolución son enriquecimientos futuros, no campos existentes. No volver a pedir las decisiones resueltas.

No se han ejecutado cargas reales ni precargas. Las conciliaciones y medidas de CSAPP-03 y CSAPP-04 son de archivos sintéticos; no equivalen a conciliar con los datos reales de Dennis.
