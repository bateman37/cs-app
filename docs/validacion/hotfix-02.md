# Validación técnica de CSAPP-HOTFIX-02 (resumen)

Registro de lo **ejecutado** entre el 3 y el 4 de noviembre de 2026 en Linux (Node 22, PostgreSQL 16, bases `_test` aisladas; nunca `cs_app`). Detalle por módulo: [datos](hotfix-02-datos.md), [Comparativa](hotfix-02-comparativa.md), [ficha de Análisis Cliente](hotfix-02-ficha.md), [Calidad](hotfix-02-calidad.md). Windows, la base local de Dennis y sus operativos reales **no** se probaron.

## Base Git

Rama `feature/CSAPP-HOTFIX-02-enlace-automatico-y-vistas` desde `main` `1abda3f` (contiene CSAPP-01 a 10 y HOTFIX-01; verificado con Git). Una PR, sin fusionar ni desplegar; push normal, sin force.

## Archivo CLIENTES.xlsx recibido (discrepancia con el prompt)

El prompt describe 17 019 bytes, SHA-256 `bb795090…` y 74 filas útiles. El archivo recibido pesa **17 667 bytes**, SHA-256 `9b4fc599…f3fabda3f877`, rango A1:K83 y **82 filas útiles** (las 74 anteriores más 8 nuevas en las filas 76–83). Se trabajó con el archivo real; no hay cifras fijas de 74 en el código ni en pruebas versionadas. Cifras de una lectura independiente del XML: 52 denominaciones BC, 70 IDs Zendesk (4 internos sin Grupo; 1 ID con dos Grupos), 44 alias Wrike (1 con 3 Grupos), 68 nombres PAP (2 con varios Grupos), 9 clientes con soporte pendiente por E/H.

## Suites ejecutadas sobre el árbol integrado

| Suite | Resultado |
| --- | --- |
| `tsc --noEmit`, `eslint .` | Sin errores |
| `npm test` (suite rápida completa, 72 archivos) | 813 pasan, 3 omitidas, 2 fallos por expectativas de reglas cambiadas (cobertura por contrato de carga amplia y nuevo texto de Calidad); corregidas y repetidas en verde (25 pruebas) |
| Prueba de extremo a extremo de datos → pantallas (`tests/hotfix02-pantallas.test.ts`) | Operativos (tickets, tiempos Zendesk, Wrike, PAP, finanzas) cargados **antes** de CLIENTES; tras confirmar el libro de una hoja, sin «Reprocesar»: Comparativa, CSV de cartera, ficha de Grupo y de Cliente y Calidad muestran lo esperado (Wrike ALFA 2 h solo Grupo, BETA 1 h, GAMMA 0,5 h; Zendesk 2024 en el año anterior; ingreso 100/200/50; ambiguos y sin correspondencia sin asignar) |
| Migración con datos (`tests/migracion-hotfix02.test.ts`) | Sin reset, sin recalcular en la migración, reparación programada, sin deriva |
| Recorrido de navegador compilado (`npm run e2e`) | Ver «Navegador» |
| Ensayo con `CLIENTES.xlsx` real + operativos sintéticos | Ver [datos](hotfix-02-datos.md): 82 filas, 0 errores, 0 discrepancias frente a la lectura independiente, repetir no crea nada |
| Volumen (250 000 tiempos, 116 000 tickets, 6 000 PAP) | Reparación completa 27,1 s, 38 sentencias SQL (sin N+1), RSS pico 196 MB; segunda pasada idempotente 15,1 s sin escribir. Medida de esta máquina, no un SLA |

## Revisión visual (Chromium, datos sintéticos, 100 %)

| Vista | 1920×1080 | 1536×864 | 390 px |
| --- | --- | --- | --- |
| Comparativa | La tabla con los seis bloques cabe (1878/1878 px), sin scroll horizontal; filas de 27 px | Scroll horizontal limitado dentro del contenedor (≈344 px) | Scroll en el contenedor, sin scroll de página |
| Ficha | Gráficos y los tres cuadros visibles a la vez (hasta y=1016) | Los cuadros se apilan; hay que bajar | Sin scroll horizontal de página |
| Calidad (Resumen de clientes) | Seis accesos en una fila y las 18 filas en la primera pantalla | Cabe; el apartado PAP desborda 64 px dentro de su región | Accesos en rejilla de 2; sin scroll de página |

Capturas sintéticas de Comparativa y Calidad en las carpetas de validación (sin datos reales). Se miraron las imágenes, no solo el DOM.

## Límites y riesgos pendientes

- El agente no ejecutó un SIGKILL real del proceso trabajador: la prueba lo representa abortando la transacción.
- La ficha a 1536 px apila los tres cuadros (solo a 1920 caben en la primera pantalla).
- El año anterior de los gráficos mensuales llega solo hasta el mes del corte.
- Un export filtrado en origen no es detectable por el contrato de carga amplia; lo corrige una declaración explícita.
- Quedan sin resolver, por no inventarlas, las excepciones reales del maestro: el ID Zendesk con dos Grupos, el alias Wrike con tres, los PAP con varios Grupos y las discrepancias de soporte E/H.
- Windows y los datos operativos reales de Dennis: sin ejecutar. La reparación de su instalación se verifica con el estado de Administración tras actualizar.
