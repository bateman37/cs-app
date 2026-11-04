# Validación de CSAPP-HOTFIX-04

Registro de lo realmente ejecutado. **No** afirma pruebas en Windows ni sobre la base operativa de Dennis (`cs_app`): no se leyó su instalación. Entorno: Linux, Node 22.22, PostgreSQL 16, bases `_test` aisladas con el guard de pruebas activo (nunca `cs_app`). Base de partida: `main` `c4a298a` (merge de la PR 15, con HOTFIX-03).

## Pruebas automáticas (ejecutadas tras la última modificación de código)

| Qué | Resultado |
| --- | --- |
| `npm run lint`, `npm run typecheck` | Sin errores |
| `npm test` (las suites largas siguen excluidas por el propio `package.json`) | **75 archivos correctos, 890 pruebas correctas, 5 archivos omitidos** (ensayos reales manuales y volumen, que exigen archivos privados o `test:largo`) |
| `npm run e2e:build` (web + trabajador) | Sin errores; `build-info.json` anuncia el SHA compilado |
| `npm run e2e` (recorrido de navegador completo sobre la web compilada, datos sintéticos) | **441 correctas y 3 fallidas de 444**. Las 3 fallidas son comprobaciones de Client Health de Calidad (`Health: con el mapeo sin confirmar…`, `…feedback presente sin calibrar…`, `Simulación: el resumen activo sigue sin colorear Health`) que **ya fallan en `main` `c4a298a`** (se comprobó ejecutando el mismo recorrido sobre una compilación limpia de `main`: mismas tres) y no se tocaron (Calidad queda fuera de alcance) |
| Caso de navegador añadido `17-hotfix04` (también ejecutado aislado tras añadir la comprobación de esquema) | 38 correctas, 0 fallidas |

### Pruebas nuevas

- `tests/hotfix04-comparativa.test.ts`: esquema sin la migración de bandas → Prisma `P2022` sobre `EconomicSettingsRevision.bandFactors` (reproducido); clasificación SCHEMA / CONNECTION / UNKNOWN sin URL ni credenciales; diagnóstico del Administrador con compilación y migraciones pendientes; actualización con una revisión de bandas `NULL`; barrido de formas de datos (Grupos sin hijos y mixtos, mes sin horas con CUM, ingresos 0 o ausentes, matrices incompletas, Wrike solo Grupo; 3 modos × 3 estados × 5 órdenes); **lectura concurrente con la tabla de revisiones vacía** (falla antes con `40001`/`P2010`, correcta después); cifra independiente R=1.000 y H=16 con jornada 8 → 500 €/jornada.
- `tests/hotfix04-clientes-edicion.test.ts` (16): los ocho campos y Activo; la vista previa no escribe (otra lectura sigue viendo lo anterior, sin auditoría); confirmar guarda y es persistente con auditoría antes/después; reintento con la misma operación sin duplicar; cierre de vigencia en lugar de borrar claves y claves BC anteriores conservadas; ID Zendesk exacto (rechazo de decimales/científica); conflicto localizado y atómico; clave de otro Grupo = conflicto explícito; campo repetido; nombre duplicado; Consulta rechazada; digest de otro borrador; altas de Grupo y Cliente sin duplicados ni producto cartesiano; **operativos antes del maestro → altas en la tabla → reenlace automático** con tickets, Wrike y PAP atribuidos, cantidades conciliadas y sin dobles sumas; rutas antiguas y cabeceras.
- `tests/hotfix04-usuarios-edicion.test.ts` (15): varias celdas y filas en un guardado con una versión por matriz; clasificación solo de lo editado; vista previa sin escritura; doble envío; valor igual sin cambios; 0 ≠ sin informar con auditoría; negativo, decimal, texto y fuera de rango; ventana de años (nov-2026 y reloj de 2027); Consulta; **65 enero–mayo y 68 junio–octubre → 665 usuarios·mes y stock 68**; solo julio no mueve junio/agosto; «Aplicar desde» sin pisar ajustes; copia de la base anterior; conflicto concurrente atómico; digest.
- `tests/hotfix04-importacion.test.ts`: las cabeceras legibles y las técnicas producen exactamente las mismas entidades; la misma organización con Grupos y servidor distintos no crea dos Clientes y se resuelve una sola vez en la tabla.

### Recorrido de navegador (`scripts/e2e/casos/17-hotfix04.ts`)

Desde **Administración en Comparativa** (que lleva a `/administracion/clientes`); ocho columnas visibles a 1920×1080 sin scroll horizontal; redirección de `/grupos` y `/clientes` con filtros traducidos y «Volver» de la ficha a la tabla; edición de celdas con marcado de modificadas; **Tab y Enter no guardan**; **Cancelar la confirmación no escribe y conserva el borrador**; confirmar guarda en la misma pantalla; **doble clic = una operación**; el guardado dispara el reenlace y el trabajador lo completa; **persistencia tras reiniciar el servidor y entrar otra vez**; guardia de navegación (Guardar / Descartar / Seguir editando); Usuarios con marzo=12, abril=0, mayo sin informar y una sola versión nueva, decimal rechazado junto a la celda, «Aplicar desde junio»; Comparativa con los datos editados; **esquema sin la migración de bandas → detalle técnico con la causa, la migración y `db:migrar`, sin credenciales y sin tabla; con el esquema al día carga**; móvil con acciones visibles; Consulta sin celdas editables ni botones; **petición de guardado forjada** (Server Action real capturada) rechazada para Consulta y anónimo, con control positivo del Administrador. Los casos antiguos de maestros, consulta, persistencia, acceso y cargas se actualizaron a las rutas nuevas; las comprobaciones de analítica y Pulse que fijaban el comportamiento anterior a HOTFIX-03 (todos los Grupos por defecto, dos segmentadores, 3 pestañas de Configuración) se alinearon con él (ya fallaban en `main`).

## Importación real del archivo adjunto (base aislada `_test`, solo cifras)

`Tabla de Clientes(1).xlsx` (14.627 bytes, SHA-256 `43bbd68e…c50` verificado; cabeceras legibles): previsualización **READY** sin errores, activación **COMPLETED**; **54 Grupos, 70 Clientes externos y 4 internos (74 IDs Zendesk; el ID de las filas con Grupo y servidor distintos no genera Cliente ni elige una fila)**, 45 claves Wrike, 68 PAP, 203 datos de servicio y 9 candidatos de alias ambiguo. **Repetida la importación, todas las cifras son idénticas.** La tabla del editor carga 54 Grupos y 70 Clientes con todos los IDs como texto exacto; se cambió el Servidor de un Cliente real y se revirtió con vista previa, guardado y auditoría. Base y archivo no se versionan; no se escribió ningún nombre ni ID.

## Revisión visual (navegador compilado, datos sintéticos con nombre largo y celdas modificadas)

1920×1080, 1536×864 y móvil (390×844) de Clientes, Usuarios y Comparativa, incluida la confirmación y las celdas modificadas. **Defecto visual hallado y corregido**: el panel «Aplicar desde… / copiar» era absoluto y quedaba recortado por el contenedor con scroll; ahora se expande dentro de la propia celda y se cierra al aplicar. Las capturas se revisaron en la sesión y no se versionan (contienen datos sintéticos).

## Qué no está probado

Windows/PowerShell (la guía está escrita, no ejecutada); la base operativa de Dennis y el Excel contra ella; la causa real del error de Comparativa en su instalación (la demostrada es la del esquema sin migración y la concurrencia sin revisión 1); proxy; despliegue; volúmenes grandes (no se pidieron campañas nuevas: el guardado y el reenlace usan una operación por guardado y las consultas existentes por conjuntos, sin un job por celda ni N+1 por Cliente).
