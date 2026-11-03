# Registro de aceptación (Dennis / IT)

Registro **separado** de las pruebas sintéticas de Claude (ver [validación de CSAPP-10](csapp-10.md)). Estado posible: **pendiente**, **aprobado** o **fallido**. Todos los casos nacen **pendientes**. Claude **no rellena** ejecutor, fecha ni firma, y una PR fusionada no convierte nada en aprobado. La aceptación funcional usa los **archivos reales de Dennis**, cargados por él.

Columnas: ID estable · acción y resultado esperado · evidencia a adjuntar · ejecutor · fecha · estado. «Ejecutor» y «fecha» los rellena quien lo ejecuta.

## A. Instalación y acceso (IT / Dennis)

| ID | Acción y resultado esperado | Evidencia | Ejecutor | Fecha | Estado |
| --- | --- | --- | --- | --- | --- |
| INS-01 | Recorrido de [instalación y operación](../operacion/instalacion-operacion.md) completo en **Windows con PowerShell** desde un checkout limpio del SHA candidato: `verificar` sin errores, migrar, preparar, primer Administrador, `start:todo`, salud correcta, entrar, estado vacío honesto | Salida de cada orden (sin secretos) | | | pendiente |
| INS-02 | Reinicio del equipo/servicio: la aplicación vuelve con sus cuentas y datos; `stop:todo` deja web y trabajador detenidos y sin procesos huérfanos | Salida de `salud` antes/después | | | pendiente |
| INS-03 | Acceso Admin y Consulta; Consulta no muta Administración, no accede a originales ni a exportaciones ajenas (rechazo en servidor); cierre de sesión | Capturas sin datos reales | | | pendiente |
| INS-04 | Administración › Operación: versión, esquema, trabajador «presente en reposo», almacenes enlazados; parar el trabajador lo muestra «detenido»/«ausente» | Captura | | | pendiente |

## B. Maestros y usuarios

| ID | Acción y resultado esperado | Evidencia | Ejecutor | Fecha | Estado |
| --- | --- | --- | --- | --- | --- |
| MAE-01 | Grupo Cliente/Cliente con equivalencias; personal histórico con vigencias; organizaciones internas fuera de clientes | Capturas | | | pendiente |
| USR-01 | Matriz: año actual y anterior editables (2025 base, 2026 mensual), **65 hasta mayo y 68 desde junio → 665 usuarios mes enero–octubre y stock 68**; un nulo distinto de cero; el total del grupo no suma usuarios compartidos | Captura de la matriz y de la ficha | | | pendiente |

## C. Cargas y recuperación

| ID | Acción y resultado esperado | Evidencia | Ejecutor | Fecha | Estado |
| --- | --- | --- | --- | --- | --- |
| CAR-01 | Nueve perfiles operativos disponibles; estado del trabajador visible durante la carga | Captura de Cargas | | | pendiente |
| CAR-02 | Carga, **repetición** (sin duplicar), corrección, reproceso y reversión de un lote real de cada fuente; originales intactos | Fichas de lote | | | pendiente |
| CAR-03 | Tickets sin horas conservados; PMO desde 2025 solo de Wrike; sin deduplicación por parecido | Resúmenes de carga | | | pendiente |
| FIN-01 | Finanzas 2025 y 2026 de las tres categorías, cada una con sustitución anual completa e independiente; **12.000 €/año con corte 15/30 → 500 €** del mes; sin repartir el ingreso agrupado entre Clientes | Ficha y conciliación | | | pendiente |
| BUG-01 | Bugs VFS y VSW cargados por separado; solo `Bug_` cuenta; sin cierre por ausencia | Resúmenes | | | pendiente |

## D. Vistas

| ID | Acción y resultado esperado | Evidencia | Ejecutor | Fecha | Estado |
| --- | --- | --- | --- | --- | --- |
| VIS-01 | **Comparativa/ficha**: mes/corte, mes anterior, CUM actual, año anterior completo y comparable; curva y detalle conciliados; parámetros económicos configurables | Captura y CSV | | | pendiente |
| VIS-02 | **Pulse Rent**: perfiles, usuarios mes, referencias independientes del filtro de filas, ceros sustentados, percentiles, CSV; M11 no se inventa sin fuente | Captura y CSV | | | pendiente |
| VIS-03 | **Calidad**: Health mensual propio, seis indicadores y global con pesos exactos y cobertura; borrador/simulación/activación solo cuando lo elija el Administrador; Health en blanco redistribuye, técnico ausente no; sin calibración/datos no hay verde | Capturas | | | pendiente |
| VIS-04 | Backlog antiguo por fotografía compatible con fechas y edades propias; flujo por creación y stock separados; N3 único con varios tags; PAP multicausa único y causa cliente conservada; unión de problemas estándar/vinculados a `Bug_` sin duplicar por relaciones múltiples | Detalle y CSV | | | pendiente |
| VIS-05 | Diagnóstico por origen (estándar; configuración/personalización/procesos; Sistemas del Cliente; Uso Indebido; infraestructura CLOUD/OP) sin excluir carga ni afirmar causas no demostradas | Captura | | | pendiente |
| CON-01 | Conciliación (niveles 1–4) del periodo real sin diferencias no explicadas; informe descargable | Informe CSV/JSON | | | pendiente |

## E. Exportación y recuperación

| ID | Acción y resultado esperado | Evidencia | Ejecutor | Fecha | Estado |
| --- | --- | --- | --- | --- | --- |
| EXP-01 | Exportación completa por vista; descarga como propietario; checksum coincide con el manifiesto; persiste tras reinicio | Archivo + manifiesto | | | pendiente |
| REC-01 | Copia verificada con parada controlada y **restauración en base y carpetas nuevas**; comparar las cuatro vistas con el origen | Informe de la restauración | | | pendiente |
| ACT-01 | Actualización 09 → 10 con datos reales y **vuelta atrás** según la [guía de IT](../operacion/actualizacion-despliegue-it.md) | Salida de comandos | | | pendiente |

## F. Producción (IT) — **despliegue pendiente**

| ID | Condición | Dato que debe aportar IT | Estado |
| --- | --- | --- | --- |
| PRO-01 | Destino de producción y autorización de despliegue | Servidor, sistema operativo, dominio, responsable | pendiente |
| PRO-02 | Procesos persistentes, supervisor, usuario de servicio y volúmenes privados compartidos | Mecanismo elegido y rutas | pendiente |
| PRO-03 | TLS, `BETTER_AUTH_URL`, cookies y proxy con los límites de carga/descarga documentados | Configuración del proxy | pendiente |
| PRO-04 | Política de copias (frecuencia, custodia, acceso, retención) | Decisión de IT | pendiente |
