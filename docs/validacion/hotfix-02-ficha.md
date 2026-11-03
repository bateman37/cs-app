# HOTFIX-02 · Validación de la ficha de Análisis Cliente (agente C)

Contrato dueño: `docs/producto/analisis-cliente.md`. Todo lo siguiente se ejecutó en Linux, con PostgreSQL real aislado `cs_app_hf02c_test` y datos **sintéticos**; no hay validación con datos reales de Dennis ni en Windows.

## Qué se cambió

| Pieza | Archivos |
| --- | --- |
| Ficha única sin pestañas (cabecera, resumen mes/CUM, cinco gráficos, tres cuadros) | `src/app/(app)/analisis-cliente/{page,ficha-head,ficha-charts,ficha-tables,ficha-client,ficha-format}.tsx`, `ficha.css` (prefijo `.fc-*`; la cuadrícula se llama `.fc-zones` para no chocar con `.fc-grid` de `globals.css`), `links.ts` |
| Series interanuales y anuales (funciones puras) | `src/domain/ficha-series.ts` |
| Tres cuadros de dedicación (funciones puras) | `src/domain/ficha-dedicacion.ts` |
| Servicio de la ficha | `src/server/analytics/ficha.ts` (sin cohorte, tickets, bugs ni fuentes), `operational.ts` (`ProfileRow` con minutos exactos por clase), `export.ts` (CSV `interanual`, `dedicacion` de los tres cuadros) |
| Motor económico (cambio compartido, aditivo) | `src/server/economics/engine.ts`: `EconomicInput.historyYears` y `EntityResult.history` |
| Retirado | `resumen.tsx`, `sections.tsx`, `calidad.tsx` de la ficha |
| Pruebas | `tests/analitica-ficha.test.ts` (18), `tests/analitica-servicios.test.ts` (ajustado), `scripts/e2e/casos/12-analitica.ts` (bloque de la ficha), `scripts/e2e/casos/12b-ficha-visual.ts` + `scripts/e2e/ficha-visual.ts`, `tests/generators/ficha.ts` |

## Pruebas ejecutadas

- `npx tsc --noEmit` y `npx eslint .`: sin errores ni avisos.
- Vitest contra `cs_app_hf02c_test`: `analitica-ficha` (18), `analitica-servicios`, `analitica-motor`, `analitica-dominio`, `economia-motor`, `hotfix02-comparativa`, `csapp09-exportaciones` (en la primera pasada falló por un `timeout` de la transacción de `TRUNCATE` con la máquina cargada; repetido solo: 18/18), `csapp09-conciliacion`, `-consistencia`, `-aceptacion`, `-sello`, `-evolucion`: todo en verde.
- `tests/analitica-ficha.test.ts` (esperados escritos a mano, independientes de los resolvers): variación con base cero/ausente/negativa y puntos porcentuales; meses futuros null; CUM = Σ/Σ (800 y 200 → 320, no 500 ni 1000) y coincidencia con `periods.cum.perDay` del motor; febrero bisiesto (29/02/2024 frente a 28/02/2023, marzo 2023 fuera); mes parcial (15/06, 20/06 del año anterior fuera, mes completo 24 h); ausentes (sin ingreso del año anterior: «—» con motivo y `SIN_ANTERIOR`; sin 2026 no se copia 2025); anuales de cada año igual a una consulta directa del motor (año completo y CUM del mismo corte); Cliente con serie del Grupo como contexto y sin ingreso propio; Cliente sin Grupo sin serie económica; tres cuadros concilian con la cifra, con la suma mensual y con el detalle de horas incluidas; CSV `interanual` = filas del gráfico.
- E2E compilado (`next build` + `E2E_SOLO=analitica`, puerto 3202): 53 PASS, 0 FAIL (incluye el bloque de Comparativa del agente B tras fusionar su rama).

## Revisión visual (imágenes miradas con la herramienta de lectura)

Datos sintéticos: Grupo de 96 caracteres con tres Clientes (uno de 76 caracteres) y dos implantaciones, cinco años de historia (2022–2026), mes en curso parcial (3 días), valores de hasta 2,3 M€ (Grupo «Mega Cuenta»), Grupo sin ingreso del año en curso, Grupo sin horas el año anterior (base cero), Grupo heterogéneo, PAP de Cliente y solo de Grupo, hito de arranque y de migración. Un error real de lectura (`could not serialize access due to concurrent update`, al primer acceso tras arrancar el servidor) se vio en una captura: el mensaje es comprensible y el enlace «Reintentar» lo resuelve; la revisión lo usa como lo haría una persona. No se provocó ningún otro error.

| Vista | Resultado medido |
| --- | --- |
| 1920×1080, 100 % | Sin scroll horizontal; contenedor 1880 px; los cinco gráficos terminan en y=803 y los tres cuadros en y=1016 (primera pantalla); documento 1084 px (4 px por encima del viewport por el pie de hitos); tablas 10,5–11 px, filas 26 px; ninguna tabla necesita scroll interno |
| 1536×864, 100 % | Sin scroll horizontal; los tres cuadros se apilan (≈1342 px de documento: hay que bajar para ver los tres; el requisito de pantalla única es a 1920) |
| 390 px | Sin scroll horizontal del documento; gráficos y cuadros en una columna; el resumen y las tablas anchas se desplazan dentro de su contenedor. En la primera revisión fallaba (869 px): un `span` de solo lectura de pantalla con `position: absolute` sin ancestro posicionado salía del contenedor; corregido |

Se miraron además: Cliente con nombre largo (resumen con contexto del Grupo, serie económica rotulada, PAP «Sin PAP atribuidos a este ámbito»), tooltip del gráfico (actual, mismo mes anterior, diferencia, variación, CUM y Δ de desviación en pp), tabla equivalente, selector de objeto, cifra no disponible, mes completo de febrero, febrero bisiesto 2024, enero, objeto inexistente, detalle de horas y exportación. Las capturas (`E2E_CAPTURAS`) y `geometria.json` son sintéticas y **no** se versionan.

Reproducir: `E2E_PORT=3202 E2E_CAPTURAS=<dir> TEST_DATABASE_URL=…/cs_app_hf02c_test npx tsx scripts/e2e/ficha-visual.ts` sobre el `next start` compilado (`FICHA_MOVIL=1` solo comprueba 390 px).

## Qué quedó fuera o limitado

- El año anterior de los gráficos mensuales solo llega al mes del corte (comparable); no se dibujan los meses posteriores del año previo.
- Perfil con cero horas en todos los periodos no se lista en el cuadro por tipo de ticket (sí las seis filas fijas del cuadro por equipo); con muchos perfiles activos en los tres tipos el cuadro crece (≈ 21 filas).
- El bloque Calidad de la ficha, «Tickets y bugs» y «Datos y cobertura» ya no están en la ficha (los resúmenes siguen en `operational.ts` y en el CSV `tickets`); la cohorte de desviación contra cartera se retiró (vive en Comparativa).
- 28/02 de un año no bisiesto en «a fecha de corte» sigue comparándose con el 28/02 del bisiesto anterior (contrato CSAPP-06 sin tocar, para no divergir de Comparativa).
- Sin volumen: no se midió la ficha con el conjunto de ≈250.000 tiempos; el motor lee los años históricos en la misma pasada de horas (sin consultas por año), pero la ficha del Grupo ejecuta dos pasadas del motor (Cliente: dos) y tres consultas auxiliares de años.
- Accesibilidad comprobada solo por inspección y por las pruebas de navegador; sin lector de pantalla.
