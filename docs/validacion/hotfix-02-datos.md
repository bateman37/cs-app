# Validación técnica de CSAPP-HOTFIX-02 · capa de datos

Registro de lo **ejecutado** el 3 de noviembre de 2026 en Linux (Node 22, PostgreSQL 16, bases `_test` aisladas; nunca `cs_app`). Cubre §2–§5, §10 y los casos 1–11 de §12 en lo que afecta a datos. **No** cubre las vistas (Comparativa, Análisis Cliente, Calidad: otros agentes), Windows, la instalación de Dennis ni sus operativos reales. Contrato: [enlace automático](../arquitectura/hotfix02-enlace-automatico.md).

## Causas demostradas con contraejemplo (fallan en la base anterior)

Pruebas escritas antes del arreglo (`tests/hotfix02-contraejemplos.test.ts`) y ejecutadas contra una exportación de la base anterior (`62131ff`): **6 de 7 fallan** (el séptimo, alias ambiguos, es una guarda de no regresión).

| # | Causa | Contraejemplo (base anterior) |
| --- | --- | --- |
| 1 | **Nadie propagaba el maestro a lo ya cargado.** Las derivaciones solo se recalculaban al activar un lote o con «Reprocesar» lote a lote (lista limitada a 100). | Operativos cargados antes de CLIENTES: tras confirmar el libro, tickets→Zendesk, Wrike, PAP y finanzas siguen sin Grupo/Cliente (caso 1, 3, 5). |
| 2 | **Orden de carga con distinto resultado**: el maestro posterior no actualizaba; solo el orden inverso funcionaba. | Resultado final distinto según el orden (caso 2). |
| 3 | **Edición de equivalencias existentes no reenlazaba** aunque la precarga no creara entidades. | Grupo, Cliente y equivalencia dados de alta a mano: los tiempos cargados seguían sin atribuir (caso 3). |
| 4 | **Comparación de nombres sin Unicode NFC**: la clave de búsqueda no normaliza NFC y las derivaciones SQL usan `lower()` sin colapsar espacios. | Maestro cargado ANTES; proyecto Wrike con tilde descompuesta y espacio no separable no encuentra su equivalencia (aislado de la causa 1). |
| 5 | **La clasificación del servicio vaciaba el soporte ordinario** sin `ServiceAssignment`. | Test existente de HOTFIX-01: «Entorno sin asignar» → `SIN_CLASIFICAR`; sustituido (ver abajo). |
| 6 | **ID Zendesk contradictorio convertía en error toda la fila**, perdiendo los alias Wrike y PAP independientes. | Real: una organización con dos Grupos hacía perder su alias Wrike y un nombre PAP. |
| 7 | **Alias de varios Grupos sin evidencia del propio registro** (ni se guardaban candidatos ni se usaba el ticket). | Wrike con ticket de otro Grupo se atribuía al del ticket sin comprobar compatibilidad. |
| 8 | **Cobertura de Calidad exigía declaración manual por lote** pese al contrato de carga amplia. | Con los tickets cargados y sin declaración, `coverageOf` daba «desconocida» (HOTFIX-01 solo cambió el formulario). |

Lo que **no** era causa: la dirección de las relaciones (Wrike y PAP a Grupo, Zendesk a Cliente) y las fechas de vigencia desconocidas ya eran correctas; los IDs Zendesk ya se tratan como texto exacto; el snapshot activo ya se lee por las vistas `Active*`. El ancho de página es de la capa de vistas.

## Cifras antes/después (escenario sintético, conteos)

Operativos sintéticos cargados antes del libro: 5 tiempos Zendesk (4 con ticket), 6 filas Wrike, 5 PAP, 3 filas financieras. **Antes** de confirmar CLIENTES: 0 atribuidos a Grupo (Zendesk, Wrike, PAP, finanzas). **Después**, sin pulsar nada: Zendesk 4/4 con Grupo y Cliente; Wrike 3 atribuidas (solo Grupo 1, enriquecida por ticket 2), 1 ambigua sin asignar, 1 conflicto, 1 sin correspondencia; PAP 3 con Grupo (1 por ticket vinculado), 1 ambiguo, 1 sin equivalencia; finanzas 3/3 (importes 1200/2400/600). Minutos fuente (Zendesk 330, Wrike 720) idénticos antes y después.

## Servicio (`servicio-v2`)

Sin ninguna `ServiceAssignment` (`tests/hotfix02-servicio.test.ts`): ticket con Entorno ordinario → SOPORTE; Administración Delegada → ADMIN_DELEGADA; Entorno ausente o en blanco → SIN_CLASIFICAR; asignación explícita OTROS y conflictos reales se conservan; Wrike de mantenimiento reconocido con persona PMO elegible → SOPORTE (procedencia `WRIKE_MANTENIMIENTO_N3`), incluso sin ticket; proyecto no reconocido, persona no PMO o anterior al corte → sin clasificar. El motor suma 2 h de soporte ordinario, 1 h delegada y 0,5 h sin clasificar sin catalogar entornos.

**Pruebas cambiadas por reglas modificadas:** `economia-motor` (dos casos) y `analitica-servicios` (un caso) esperaban `SIN_CLASIFICAR` para un Entorno informado sin asignar, que ahora es SOPORTE; se conserva el caso «sin Entorno» como no clasificado. `precarga-maestros`: el ID contradictorio ya no es error de fila y la lista «Reproceso necesario» se sustituye por la actualización automática (incl. 105 lotes COMPLETED sin límite). `quality`/cobertura: `supportsStock` ya no exige extracción conocida.

## Actualización automática (casos 9 y 10)

`tests/hotfix02-refresh.test.ts`: estado `PENDING`→`UP_TO_DATE` verificable; recuperación idempotente (0 filas actualizadas, versiones derivadas iguales); solo Admin y doble petición; **cambio durante el recálculo** (publica hasta su generación, queda `PENDING`, resultado final con el maestro último); dos trabajadores (uno reclama), lease vencido y fencing (el antiguo no publica); aborto a mitad de transacción (**SIGKILL representativo**: la transacción se deshace, sin versiones a medias, el reintento concilia); 120 lotes históricos activos todos atendidos; instantáneas sustituidas no se reactivan. **No se ejecutó un SIGKILL real del proceso trabajador** (la prueba lo representa abortando la transacción).

## Migración

`tests/migracion-hotfix02.test.ts`: base con todas las migraciones anteriores y datos (lotes completados, maestros con clave NFD, decisión, ticket y tiempo con derivado antiguo) → `migrate deploy` sin reset: conteos iguales, **sin recalcular** (versión derivada 7 intacta), reparación **programada** (`PENDING`, `MIGRACION_HOTFIX02`, completada 0), clave de nombre normalizada a NFC, disparador activo, `migrate diff` vacío y repetible.

## Cobertura (§10)

`tests/hotfix02-cobertura.test.ts`: lote completado no heredado sin declaración hereda el contrato (todos los clientes; inicio abierto, **no** `MIN(fecha)`), con procedencia `SOURCE_CONTRACT`; una declaración explícita (PARTIAL) prevalece; lo heredado sin declaración sigue desconocido; en tiempos solo la instantánea activa; el export recibido hoy sustenta el stock de hoy y **no** reconstruye junio de 2024. Límite: un export filtrado en origen no es detectable; lo corrige la declaración explícita.

## Ensayo con el maestro real (+ operativos sintéticos)

Archivo recibido: 17 667 bytes, SHA-256 `9b4fc599…f3fabda3f877`, rango A1:K83, **82 filas útiles** (el prompt citaba 17 019 bytes, SHA `bb795090…` y 74 filas: el archivo real incluye 8 filas nuevas, 76–83). Cifras de una lectura independiente del XML: 1 hoja, 52 denominaciones BC, 70 IDs Zendesk (4 internos sin Grupo; **1 ID con dos Grupos distintos**), 44 alias Wrike (1 con 3 Grupos), 68 nombres PAP (2 con varios Grupos: uno con 4 y otro con 2), 9 clientes con Soporte pendiente (E/H distintos o no válidos; las 4 discrepancias E/H de las filas 12, 44, 57 y 58 incluidas).

Resultado (`tests/ensayo-hotfix02.test.ts`, manual, base `cs_app_ensayo_hf02_test`): 82 filas leídas, 0 errores; 52 Grupos BC, 69 Clientes (el ID contradictorio no se crea), 4 internos, 43 alias Wrike a Grupo y 3 candidatos, 66 identidades PAP y 6 candidatos; 0 discrepancias en 69 tiempos Zendesk, 46 filas Wrike, 69 PAP y 52 filas financieras frente a lo esperado de la lectura independiente (rutas exactas, enriquecida por ticket, solo Grupo, ambigua con candidatos y conflicto de ticket de otro Grupo); repetir el libro no crea nada ni cambia derivados. **Excepciones reales que quedan** (no se resuelven por decisión mía): el ID Zendesk con dos Grupos (sus tickets quedan sin asignar hasta crearlo en Clientes), el alias Wrike de 3 Grupos y los dos nombres PAP de varios Grupos sin evidencia de ticket, y los 9 Soportes pendientes. Esto es «maestro real + operativos sintéticos»; **no** se tiene acceso a los operativos reales de Dennis ni a su base.

## Volumen (copia de la base representativa, 250 000 tiempos Zendesk, 116 000 tickets, 6 000 PAP, 1 500 Clientes + 50 000 filas Wrike sintéticas)

`scripts/medicion-relaciones.ts` (esta máquina, sin prometer SLA): reparación completa 27,1 s, 38 sentencias SQL (constantes: sin N+1), RSS pico del proceso 196 MB; segunda pasada idempotente 15,1 s, 38 sentencias, 0 filas escritas; motor económico (1 500 Grupos, TOTAL) 7,0 s y 20 sentencias. Una transacción única; conciliación antes/después sin diferencias.

## Suites

Suite rápida completa (`npm test` equivalente) en `cs_app_hf02a_test`: resultado final en el informe de la entrega. Fallos no relacionados con esta entrega: `csapp10-backup-*` y `csapp10-restauracion-*` (el `build-info.json` versionado no conoce las migraciones de HOTFIX-01 y se regenera al construir; no los ejecuté sobre la base anterior). No ejecutados: `test:largo`, `e2e` de navegador, build web/trabajador, Windows.
