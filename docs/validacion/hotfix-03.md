# Validación de CSAPP-HOTFIX-03

Registro de lo realmente ejecutado. **No** afirma pruebas en Windows ni conciliación de la base operativa de Dennis. Entorno: Linux, Node 22.22, PostgreSQL 16, bases `_test` aisladas (nunca `cs_app`).

## Pruebas automáticas

| Qué | Resultado |
| --- | --- |
| `tsc --noEmit`, `eslint .`, `next build`, `build-worker` | Sin errores |
| `npm test` (las suites largas quedan excluidas por el propio `package.json`) | 855 pruebas: 800 correctas, 39 omitidas y 16 fallidas. Las 16 fallidas y 31 de las omitidas pertenecían a los cinco archivos de copia y restauración (`csapp10-backup-*`, `csapp10-restauracion-*`) y fallaban por un único motivo: `build-info.json` no conocía la migración nueva. Regenerado (`node scripts/build-info.mjs`), esos cinco archivos pasan **64/64**. No se repitió la suite completa después de ese único cambio de artefacto |
| Pruebas nuevas | `tests/hotfix03-dominio.test.ts` (bandas con T=550 y fronteras 329,99/330/440/549,99/550/660; estado efectivo; claves de orden de todas las columnas; media filtrada; percentiles, empates, intensidad y muestra mínima; global 0,60 → rojo y límites 0,25/0,50; detección de formatos 8/6/11/7) y `tests/hotfix03-calidad.test.ts` (2 PAP / 10 usuarios → Total 2 y Por usuario 0,2; Total sin matriz de usuarios; cortes P25/P75 = 2,25/4,75; filtros visuales que no mueven los cortes; muestra insuficiente; CSV con medida; PAP solo-Grupo, multicausa y Petición cliente; instalación idempotente del perfil inicial, borrador y calibración manual conservados) |
| Pruebas heredadas adaptadas | Las que fijaban comportamientos que esta entrega cambia por diseño: cartera incompleta (ahora media del subconjunto comparable), Silver On Demand sin veto, ratio provisional, `estado` como parámetro válido, valores «por usuario» en lugar de «por 100», todos-iguales-positivos → amarillo relativo, y el perfil «sin calibrar» (ahora `uncalibratedQualityConfig()`, solo para probar ese comportamiento del evaluador) |
| Ejemplo económico independiente | Anual 12.000, mes completo R=1.000, H=16 → 500 €/jornada; corte 15/30, H=8 → 500; R=0 con H>0 → 0; H=0 sin ratio |

**Conflicto con un cambio local ajeno.** El árbol de trabajo recibido traía sin confirmar un cambio en `src/server/quality/coverage.ts` y `tests/hotfix02-cobertura.test.ts` (cobertura de lotes heredados por contrato). No es de esta entrega y **no está en sus commits**; se conserva en el árbol. Con él aplicado fallan varias pruebas de Calidad que sin él pasan (cobertura y ceros, backlog, N3); las ejecuciones de arriba se hicieron con ese cambio apartado temporalmente. Conviene decidirlo aparte.

## Importación real de los dos archivos de gestión (base aislada, solo cifras)

`Tabla de Clientes.xlsx` (SHA-256 verificado): 87 filas válidas y 0 errores; 54 Grupos; **74 Clientes** (75 IDs de organización menos el ID con Grupo y servidor distintos en las filas 63 y 82, que no se crea ni se resuelve por orden). `Tabla de Personal.xlsx` (SHA-256 verificado): 75 filas, 1 duplicado exacto consolidado (47/75), 2 entradas no empleadas excluidas, 72 personas; sin cuentas de acceso nuevas. Repetir ambas cargas no cambia ningún recuento. Ningún nombre ni ID real se versiona (`tests/ensayo-hotfix03-tablas.test.ts` se omite sin las rutas privadas).

## Actualización sobre datos existentes

Copia de una base de ensayo en estado HOTFIX-02 (52 Grupos, 69 Clientes, 230 equivalencias, 627 eventos de auditoría): `prisma migrate deploy` aplica `20261111090000_hotfix03_bandas_economicas` sin tocar esos recuentos; `npm run hotfix03:preparar` instala la revisión 1 de Calidad (`SYSTEM_INITIAL`, sin autor) y la segunda ejecución responde «ya instalada». Migración sobre base vacía: aplicada por la propia suite.

## Recorrido de navegador compilado (datos sintéticos, 12 Grupos)

57/57 comprobaciones sobre la aplicación compilada y servida (`next start`), a 1920×1080, 1536×864 y móvil 390×844: menú de cinco entradas; `main` panorámico (ancho = viewport) y cabeceras fijas; filas de las dos tablas; estados Activos/Inactivos; en Comparativa **300 rojo, 330 naranja, 500 amarillo, 550 verde, 660/700/800 verde intenso**, **600\* provisional**, Silver On Demand con ratio calculado, grupo sin ingreso con «—» y causa; orden numérico real ascendente y descendente por €/jornada, tarifa, usuarios, ingresos y servidor, con ausentes al final; Calidad con el interruptor (valores distintos por modo, sin «Sin calibrar»); Comprobación de datos como tabla; ocho rutas antiguas que responden 200; sin errores de JavaScript; sin desborde horizontal en móvil. Capturas sintéticas (nombres inventados) en [`hotfix-03-capturas`](hotfix-03-capturas/).

## No probado

Windows/PowerShell; la base `cs_app` de Dennis; carga con el volumen representativo para medir consultas, tiempos y memoria de las tablas, referencias y reenlace (la tabla de Clientes lee por conjuntos, 7 consultas, sin consulta por fila, pero no se midió); el recorrido heredado `scripts/e2e` (sus casos referencian pantallas retiradas del menú y no se reescribieron); edición dentro de la celda de las tablas.
