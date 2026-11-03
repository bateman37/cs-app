# Validación técnica de CSAPP-HOTFIX-01

Registro de lo **ejecutado** el 3 de noviembre de 2026 en Linux (Node 22.22, PostgreSQL 16, bases `cs_app_test` y bases `_test` aisladas; nunca `cs_app`). Windows, la base local de Dennis, el proxy y el lector de pantalla **no** se probaron.

## Base Git

Rama `feature/CSAPP-HOTFIX-01-cargas-sencillas-precarga`, creada desde la cabeza de CSAPP-10 (`dc6f4c4`, que contiene CSAPP-01 a 10; `main` `f71b5b7` no contiene 06–10). PR única apilada contra `feature/CSAPP-10-instalacion-recuperacion-cierre`, sin fusionar ni desplegar; push normal, sin force. HOTFIX-01-v1 no estaba en el repositorio ni en la sesión: queda marcada como sustituida en el índice de prompts.

## Migraciones (incrementales, sin reset)

`20261106090000_hotfix01_ultima_carga` (secuencia de recepción, `legacyBase`, consolidación de PAP por ID, «Petición cliente», vistas de actividad activa), `20261107090000_hotfix01_precarga_maestros` (`MasterLoadDecision`), `20261108090000_hotfix01_historico_usuarios` (`ESTIMATED`, tablas de origen histórico y base de usuarios, limpieza de `isLocked`). Probadas con `migrate deploy` sobre una base de CSAPP-10 con datos sintéticos (PAP en dos listas, tiempos, causas) y sobre base limpia; `migrate diff` sin deriva; repetibles.

## Suites

| Suite | Resultado |
| --- | --- |
| `npm test` (suite rápida, árbol fusionado) | 60 archivos pasan, 2 omitidos; 743 pruebas pasan, 2 omitidas |
| `tsc --noEmit`, `eslint .` | Sin errores |
| Recorrido de navegador compilado (`npm run e2e`, web y trabajador compilados) | 359 PASS, 0 FAIL |
| Ensayo con el libro real de maestros (base aislada, no versionado) | Ver abajo |
| Ensayo con el libro real de histórico (base aislada, no versionado) | Ver abajo |

**No ejecutados:** suites de volumen y `test:largo` (trabajador con 300 000 filas, etc.), `ensayo-actualizacion`/`ensayo-instalacion`/`ensayo-restauracion` de CSAPP-10 (el primero fija la migración 20261105 como única nueva y habrá que actualizarlo), Windows.

## Ensayos con los archivos reales (base aislada; informes nominativos fuera de Git)

- **HOJAS DE CARGA.xlsx** (SHA-256 `daf8d61d…cce8`, 27 038 bytes): 74/75/17 filas (CLIENTES/PERSONAL/PMO), 0 errores; 46 Grupos, 63 Clientes con ID Zendesk, 4 internos sin Grupo, 38 alias Wrike (37 asignados, 1 pendiente), 64 nombres PAP (62 a implantación, 1 a Grupo, 1 pendiente), 4 soportes discrepantes, 74 personas distintas (72 cargadas, 2 excluidas prueba/marcador), 3 pares de variantes en revisión, 17 roles PMO (16 enlazados, 1 en revisión), 0 cuentas de acceso. Repetir y repetir reordenado: 0 entidades nuevas.
- **DATA FACTURACIÓN.xlsx** (SHA-256 `d79f05cd…6628`, 25 373 bytes): 164 filas, 0 errores, 8 ámbitos (2022: 35+1, 2023: 39+2, 2024: 40+4, 2025: 39+4), 11 administrativas; sumas de B por año+categoría iguales a una lectura independiente del XML; E164 (B/6), G28/G100 `#N/A` y H160 señalados; 46 Grupos (2 creados como procedencia histórica); 8 lotes hijos con el SHA-256 del original; 0 Clientes/implantaciones creados; repetición: 8 conjuntos «sin cambios»; usuarios: 43 valores para 39 Grupos, 4 discrepancias (H124/H165, H132/H161, H143/H162, H152/H163), 35 Grupos con 2025×12 y 2026, 1 092 meses estimados 2022–2024.

Son **ensayos en bases aisladas**, no una carga de la base de Dennis. Él confirma las precargas reales en su instalación.

## Cambios de pruebas por reglas modificadas

Reescritas con su razón: PAP por lista (ahora ID único y última carga), «export antiguo no pisa» (ahora manda la última carga), correcciones de tiempos por parecido (ahora instantánea completa), año financiero (select y casilla → entrada libre), bugs con vista declarada, usuarios de 2025 bloqueado (ahora ventana año actual y anterior), recuentos de perfiles y listas de migraciones.

## Límites conocidos

- La sustitución de tiempos es total por fuente: un archivo parcial oculta el resto hasta revertirlo (la ficha avisa del impacto).
- Las decisiones de corrección explícita de tiempos heredadas siguen existiendo en el código pero ya no son el recorrido ordinario.
- La precarga de maestros no se revierte (INCORPORATE sin `revert`).
- `changedFields` de revisiones PAP consolidadas conserva la comparación con su predecesora original.
