# Análisis Cliente e histórico detallado

## Ficha única panorámica (HOTFIX-02 §8, vigente)

La ficha es **una sola pantalla sin pestañas** (ruta `/analisis-cliente?ambito=group|client|implementation&id=…`). Sustituye a la ficha por secciones de CSAPP-06 y al bloque Calidad de la ficha; el acceso a los seis KPI es Calidad › Resumen de clientes.

- **Cabecera breve:** nombre completo (con título accesible), tipo (Grupo Cliente / Cliente / Implantación), Grupo al que pertenece, Soporte, Servidor (los de su Grupo, rotulados «(Grupo)», si el objeto no tiene los suyos), usuarios al corte, mes y corte, «Provisional» en el mes en curso, barra de periodo (mes/año, «A fecha de hoy / Mes completo», «Último mes cerrado»), selector de objeto (Grupo, Clientes e implantaciones, desplegable sin JavaScript), exportar y «← Comparativa». Volver conserva el periodo y los filtros **actuales** (Soporte/Servidor) más orden y página; los parámetros antiguos (alojamiento, complejidad, producto, estado, `pestana`, `q`…) ni se leen ni se arrastran. El formulario de filtros de CSAPP-06 no existe.
- **Resumen compacto** (tabla de dos filas, mes y CUM): rentabilidad (€/jornada), desviación contra objetivo, rentabilidad del mismo periodo del año anterior (mismo mes hasta el mismo día / CUM anterior comparable), horas reales, horas objetivo y desviación de horas, con «Ver cálculo» bajo demanda. Un Cliente o implantación muestra sus horas y «—» con motivo en lo económico, más dos filas «Grupo · … (contexto)».
- **Cuadrícula de dos zonas** (primera pantalla a 1920×1080): a la izquierda cinco gráficos SVG propios (sin dependencias) con alternancia Gráfico/Tabla en el mismo cuadro; a la derecha los tres cuadros de dedicación simultáneos. El detalle ilimitado de registros es una ruta con «← Volver a la ficha» (`det=horas|ratio|ingreso|pap|tickets|bugs|exportar`).
- **Sin** sellos de datos, método, revisión de configuración ni cobertura en la ficha: viven en «Ver cálculo» y en Administración › Diagnóstico de datos. Una cifra no disponible es «—» con el motivo al clic/foco; no hay avisos repetidos.

### Gráficos (zona izquierda)

| Gráfico | Contenido |
| --- | --- |
| Rentabilidad mensual (€/jornada) | Barras año elegido y año anterior comparable alineadas enero–diciembre, línea de objetivo, línea CUM del año (Σ ingresos / Σ horas) y mes parcial hueco. Tooltip y tabla: actual, mismo mes anterior, diferencia, variación %, CUM y desviación vs objetivo (Δ en puntos porcentuales) |
| Horas mensuales (h) | Mismo formato |
| PAP mensual | Serie con unidad propia (PAP únicos con puesta en producción), nunca sumada a horas |
| Ingreso imputado anual y Rentabilidad anual | Un punto por año disponible (histórico completo): año completo frente a CUM comparable del mismo corte; el año del corte solo tiene CUM |

Los hitos de arranque/migración ya informados se marcan en las curvas del año; no se inventan fechas.

### Comparación interanual (reglas)

Fuente única: `EntityResult.monthly / prevMonthly / history` del motor económico (`src/server/economics/engine.ts`) y funciones puras de `src/domain/ficha-series.ts`; el gráfico, el tooltip, la tabla equivalente y el CSV `tabla=interanual` leen las **mismas filas** (`FichaView.series`).

- Variación = (actual − anterior) / abs(anterior) si el anterior ≠ 0. Anterior cero → estado `BASE_CERO` (sin variación relativa; sí diferencia). Dato ausente → `SIN_ANTERIOR` / `SIN_ACTUAL`. Nunca infinito ni 0 % inventado.
- Porcentajes (desviación vs objetivo): diferencia en **puntos porcentuales**, sin variación relativa. Positivo = peor en las dos desviaciones.
- Mes parcial: el año anterior llega al mismo día (limitado al fin de ese mes: 15/02/2026 → 15/02/2025; 29/02/2024 → 28/02/2023); en «mes completo», ambos meses enteros. Enero–mes anterior completos; **meses posteriores al corte vacíos (null), no ceros**.
- CUM por mes = Σ ingresos / Σ horas × jornada (operador `eurosPerDay` del motor), nunca suma ni media de ratios mensuales; se interrumpe en el primer mes sin ingreso conocido o con perímetro incompleto. El CUM actual no se compara con el año anterior completo: se compara con el CUM anterior comparable.
- Anuales: el motor entrega, para el foco, `history` (año completo y CUM comparable de cada año de `historyYears`) con las mismas fórmulas.
- Limitación vigente: 28/02 de un año no bisiesto en modo «a fecha de corte» se compara con 28/02 del bisiesto anterior (contrato CSAPP-06 conservado; el mes anterior queda prorrateado 28/29).

### Tres cuadros de dedicación (zona derecha)

Horas del perímetro del servicio económico (Soporte), con persona/equipo/rol a la fecha del trabajo (`src/domain/ficha-dedicacion.ts`; los tres concilian entre sí y con la cifra de horas):

1. **Por equipo y perfil:** CS N1, CS N2, PMO ANA, PMO DEV, IT, Plataforma (siempre las seis filas) y «Sin identificar» al final; mes, % mes, mes anterior, CUM, % CUM, CUM anterior comparable y año anterior completo (rotulado).
2. **Por tipo de ticket y perfil:** Incidente/Problema Vincle, Otro soporte y Causa pendiente; cada tipo con su subtotal y sus perfiles con horas (% dentro del tipo). El total suma los tres tipos una vez; las filas de perfil son detalle. Un perfil sin horas en ningún periodo no se lista.
3. **Por tipo de problema Vincle:** Integración/Procesos, Configuración, Personalización, Estándar e Infraestructura CLOUD (solo con horas en el CUM o el CUM anterior; infraestructura cuenta como Vincle únicamente con alojamiento CLOUD a la fecha del trabajo): horas CUM, % sobre horas dedicadas, % sobre horas objetivo (— sin ingreso propio) y CUM anterior comparable. Sistemas del Cliente y Uso Indebido siguen en «Otro soporte» y en el detalle de horas.

Un porcentaje sin denominador es «—», no 0 %.

### Cliente con ingreso solo a nivel Grupo

Horas, dedicación y PAP propios; la serie económica y los anuales son del Grupo, identificados en el título («Grupo (contexto)») y en las filas del resumen; nunca se repite el ingreso como propio. Los PAP/Wrike solo atribuibles a Grupo aparecen en la ficha del Grupo, no en los Clientes (atribución `drvClientId`).

## Históricos y producto

La fuente de PMO cambia el 1 de enero de 2025, según el contrato de dedicación. Un año anterior no se obtiene siempre de Zendesk: para analizar 2026, la parte PMO de 2025 ya debe venir de Wrike. Aplicar la misma regla en todos los gráficos y desgloses.

El corte por VSW, VFS o ARQ precisa un campo de producto o una equivalencia de proyecto validada. No deducirlo del destino de un escalado ni del campo TIPO, que es complejidad. Un registro sin producto conserva la categoría «sin identificar».

## Detalle integrado en las vistas

Se abre como detalle o pestaña dentro de las cuatro vistas, sin crear otro módulo de negocio. Será una consulta sobre los datos normalizados y agregados, no una copia manual de la hoja ANÁLISIS DETALLADO. Admitir agrupación por cliente, año, mes, fuente, servicio, equipo, rol, causa, producto y proyecto. Los detalles se paginan y las descargas grandes se generan como tarea en segundo plano. Un gráfico no carga cientos de miles de registros en el navegador.

## Implementación (CSAPP-06, histórica)

Los servicios de detalle (`src/server/analytics/detail.ts`, `operational.ts`), el selector con búsqueda en servidor y el CSV (`ficha.csv`: `series`, `interanual`, `dedicacion`, `pap`, `tickets`) se conservan; las pestañas, la cohorte de desviación contra cartera, el bloque Calidad, «Tickets y bugs» y «Datos y cobertura» de la ficha **se retiraron** en HOTFIX-02. Cada cifra de horas abre su detalle conciliado; un detalle con un sello distinto declara «nueva lectura».
