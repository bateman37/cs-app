# Catálogo de cálculos

## Convenciones

H(c,p,s) son horas elegibles de cliente c en periodo p y servicio s, tras deduplicación, resolución y corte histórico de PMO. R(c,p,s) es ingreso imputado con el método aprobado. U(c,m) son usuarios facturables del mes. UM(c,p) es la suma de U de los meses completos incluidos, denominada usuarios mes; no es el número de personas distintas. N(p) es el número de meses completos. Trabajar con decimales y redondear solo para presentar.

CAL 01. La fuente de verdad de un ratio guarda numerador, denominador, unidad, periodo, ámbito, versión y estado de cobertura. Un cero válido, un resultado no aplicable y un dato ausente son valores funcionalmente diferentes.

| ID | Cálculo | Unidad y condición |
| --- | --- | --- |
| ECO R | R / H × jornada_horas | Euros por jornada dedicada; jornada inicial 8 |
| ECO HO | R / objetivo × jornada_horas | Horas objetivo; objetivo inicial 550 euros por jornada |
| ECO DO | (objetivo - ECO R) / objetivo | Proporción; positiva por debajo del objetivo |
| ECO RC | suma R visibles / suma H visibles × jornada_horas | Ratio de cartera filtrada, ponderado por horas |
| ECO DC | (ECO RC - ECO R) / ECO RC | Desviación respecto a cartera |
| USR C | U del último mes del periodo | Usuarios a cierre, no suma mensual |
| USR M | UM / N | Usuarios medios en meses completos |
| DED M | H del mes / U del mes | Horas por usuario en el mes |
| DED PM | H del periodo / UM | Horas por usuario mes, para periodos completos |
| DED A | 12 × H del periodo / UM | Horas equivalentes anuales por usuario |
| EVT M | 100 × eventos únicos del mes / U del mes | Eventos por 100 usuarios en el mes |
| EVT PM | 100 × eventos únicos del periodo / UM | Eventos por 100 usuarios mes |
| EVT A | 1200 × eventos únicos del periodo / UM | Equivalente anual por 100 usuarios |
| TAR A | ingreso anual / usuarios medios anuales | Euros por usuario año; requiere los 12 meses de usuarios |
| TAR RUN | 12 × ingreso del periodo / UM | Equivalente anual por usuario, con periodo indicado |
| ESC TOT | tickets únicos con N3 / tickets únicos del mismo conjunto | Porcentaje de tickets con N3 |
| ESC N2 | tickets únicos con N2 y N3 / tickets únicos con N2 | Porcentaje de N2 que presenta N3 |

CAL 02. Si U o UM es cero, el indicador por usuario no es calculable. Si un mes no está informado, no usar los otros meses como si el periodo estuviera completo. Para el corte parcial, ponderar la exposición de usuarios de ese mes por la fracción de días y rotular provisional; el ingreso mensual se prorratea con día/días reales. El mes en curso es el modo inicial; el mes completo permite validar cierres.

## Las familias de PulseRent

CAL 03. Descomponer H por CS N1, CS N2, PMO ANA+DEV, IT N3 y Plataforma N4. Para cada perfil: total; incidente Vincle confirmado o modo histórico identificado; y otro soporte = total - incidente confirmado - no clasificado. En equivalencia Excel, otro soporte = total - incidente, por lo que incluirá lo no clasificado; no confundir ambos métodos.

Las nueve métricas por usuario solicitadas son las tres variantes de CS N1, CS N2 y PMO N3. El libro incluye otras seis variantes de IT y Plataforma. Cada una usa DED M, DED PM o DED A según la vista seleccionada, y nunca un divisor implícito distinto.

CAL 04. Métricas adicionales: tarifa anual aproximada; PAP evolutivos no facturables; PAP correctivos de proyecto; PAP correctivos estándar; PAP origen cliente; ESC N2; horas CUM; USR C; ECO R actual; ECO DO; ECO DC; ECO R anterior; DED A; PAP únicos por usuario. Los conteos PAP usan pap_id único y se acompañan de sus versiones por usuario. Los porcentajes y euros por jornada no vuelven a dividirse entre usuarios.

## Comparación temporal

CAL 05. CUM actual = desde el 1 de enero hasta el corte. CUM comparable anterior = desde el 1 de enero anterior hasta el mismo corte desplazado un año. Año anterior completo = doce meses anteriores. Guardar estos tres ámbitos como distintos. Calcular R y H en cada ámbito antes de dividir. La selección de 2026 aplica Wrike para PMO tanto en 2026 como en la comparación 2025.

## Estadística

CAL 06. Percentil continuo con interpolación inclusiva compatible con PERCENTILE.INC: posición = (n - 1) × q sobre valores ordenados, interpolando los adyacentes. Incluir ceros confirmados y excluir nulos o denominadores no válidos. Para [0,10,20,30], P25 = 7,5; P50 = 15; P75 = 22,5. La mediana es P50 y no sustituye al ratio agregado económico.

CAL 07. Las métricas de tickets se agregan con conjuntos de IDs. Un ticket con dos tags de N3 cuenta una vez en el total N3 y puede aparecer en ambos desgloses. Un PAP con varias causas cuenta una vez en total y varias veces solo en una tabla de pertenencias expresamente no aditiva.

## Revisiones

CAL 08. Configuración y fuentes determinan una versión reproducible del cálculo. Cambiar un peso, causa, alojamiento histórico o usuario produce una nueva versión o una reapertura identificada. No reescribir el resultado de un cierre sin indicarlo. Las tolerancias de conciliación propuestas son 0,01 euro en importes y 0,01 hora en agregados; IDs y conteos deben coincidir exactamente. Las diferencias de metodología se explican, no se absorben en una tolerancia.

## Reglas de la revisión funcional

CAL 09. Vta Potencial es ingreso anual y Diferencia compara con Budget sin sumarse a ingreso. Las tres categorías financieras sustituyen por año/categoría. Ingreso del mes parcial = anual / 12 × día de corte / días reales del mes.

CAL 10. Seis pesos iguales exactos de 1/6; sin Client Health, cinco pesos efectivos de 1/5. El modo personalizado admite solo suma exacta de 100 por ciento. Los umbrales se eligen en Administración.

CAL 11. Cualquier causa correctiva clasifica al PAP como correctivo y su total es por ID único. Origen cliente participa y se desglosa. La afectación de bugs se apoya en Work Items Bug_ y vínculos explícitos; causa estándar en un problema de cliente es evidencia distinta. No usar la palabra BUG como clasificador.

## Diagnóstico y medidas no aditivas

CAL 12. Incidentes y problemas de Calidad usa tickets únicos de type incident/problem con todos los orígenes. El filtro histórico Incidente Vincle permanece disponible para equivalencia con Excel, sin eliminar Sistemas del Cliente, Uso indebido o causas no informadas del diagnóstico completo.

CAL 13. Sexto numerador aprobado: unión de los problem ticket_id externos vinculados explícitamente a Bug_ y los problem ticket_id externos con causa incidente_estándar_plataforma. Un ticket en ambos conjuntos se cuenta una vez. El periodo es creación y el denominador son usuarios/exposición del mismo ámbito. No es número de bugs únicos.

CAL 14. Bugs únicos son IDs de Work Item por ámbito de producto; abiertos observados es stock de la última fotografía. Problemas e incidentes son tickets y sus conteos por creación son flujos de otro significado. No sumar stocks con flujos ni multiplicar un bug por el número de enlaces antes de contar DISTINCT. Sin fecha de resolución/cierre de Zendesk no calcular cierres mensuales; sin problem_id no reconstruir los incidentes hijos.

## Stock y antigüedad

CAL 15. Backlog activo de clientes = tickets distintos de tipo incident/problem con status new/open/pending/hold al corte observado. Solved y closed permanecen distintos y fuera. Edad = días naturales entre creación y observación declarada. No filtrar el stock por fecha de creación dentro del mes ni inferir tiempo en el estado actual. Stock por 100 usuarios = 100 por conteo dividido por usuarios del ámbito al corte; envejecidos aplica el umbral configurable del tipo antes de contar. No usar usuarios mes para este stock.

CAL 16. Flujo de altas y stock son métricas diferentes; no sumarlos. Percentiles de edad se calculan sobre edades válidas del stock seleccionado. Sin activos, conteo cero pero edades no aplicables. Sin usuarios, tasa no calculable y conteo visible. El color del indicador combina sus componentes solo con una regla configurada y versionada; ver backlog. Los seis pesos no cambian por añadir ese detalle.

## Motor económico (CSAPP-05, CAL 17-30)

Estado: **implementado y probado en Linux** (`src/domain/finance.ts`, `src/server/economics/engine.ts`); consumido por la comprobación de Administración y, en CSAPP-06, por Comparativa y Análisis Cliente. Decisiones técnicas en [finanzas y motor económico](../arquitectura/finanzas-motor-csapp05.md). Versión del método: `eco-v1`. Todas las cifras usan decimales exactos; se redondea solo para mostrar.

CAL 17. **Periodos.** Entrada explícita: ámbito (Grupo Cliente, conjunto de grupos, Cliente o implantación), servicio (Soporte, Administración delegada, Otros, Total), fecha de análisis (por defecto hoy en Europe/Madrid; inyectable en pruebas) y modo **a fecha de corte / mes completo** (mes completo fija el fin del mes: no certifica un cierre contable ni inventa horas futuras). Devuelve: mes seleccionado, mes anterior completo (el de enero es diciembre del año anterior), CUM actual, año anterior completo, CUM anterior comparable y la serie mensual del año seleccionado. El CUM comparable desplaza el corte un año limitando el día al último del mes (**29/02/2024 → 28/02/2023**) y es distinto del año anterior completo. El mes en curso se rotula **provisional**. Las horas se filtran por fecha de trabajo hasta el corte inclusivo (no se incluyen registros posteriores) y no se prorratean: se suman minutos elegibles y después se convierten a horas.

CAL 18. **Ingreso imputado.** Para cada mes, ingreso base = ingreso anual de su año y categoría / 12; para una fracción, ingreso = base × días incluidos / días naturales reales del mes (no 31 fijo, ni días laborables, ni fracción del año). Anual 12000, corte 15 de un mes de 30 días → **500**; corte 15 de un mes de 31 → 1000 × 15/31. CUM = meses completos previos + fracción del seleccionado; un periodo que cruza años usa el conjunto financiero de cada año. Es una **imputación analítica**, no la facturación real de ese mes. Un único redondeo por término.

CAL 19. **Usuarios.** Se reutiliza la matriz de CSAPP-02 sin una consulta por grupo/mes. Se distinguen el stock al corte (valor del mes del corte, no se prorratea), la exposición del periodo en usuarios mes (flujo; el mes parcial pondera solo su exposición) y los usuarios medios. Enero–octubre completos con 65 hasta mayo y 68 desde junio: **665 usuarios mes y stock 68**. Un mes sin informar deja la exposición incompleta; el cero confirmado no permite dividir. No se suman usuarios de implantaciones al grupo ni se copia su total a cada hijo. La falta de usuarios **no** impide €/jornada.

CAL 20. **Fórmulas centralizadas.** Euros por jornada dedicada = R / H × jornada; horas objetivo = R / objetivo × jornada; desviación contra objetivo = (objetivo − €/jornada) / objetivo (**positivo = rendimiento por debajo del objetivo**); ratio de cartera filtrada = ΣR / ΣH × jornada; desviación contra cartera = (ratio cartera − ratio grupo) / ratio cartera. Cada resultado devuelve numerador, denominador, unidad, estado y motivo. No se promedian ratios mensuales, de clientes ni de páginas; la cartera usa **todo el conjunto filtrado antes de paginar**: 1000/10 y 1000/30 → 400 €/jornada (no la media de 800 y 266,67); 1000/0 y 1000/10 → 1600 €/jornada con el primer ratio individual no calculable y su ingreso a la vista. Tarifa anual por usuario: usuarios medios de los doce meses; en un periodo parcial, el equivalente anual identificado (no es una tarifa contractual).

CAL 21. **Estados y ceros.** Cada resultado es dato disponible, parcial/provisional, sin fuente o no calculable con su motivo, y devuelve los componentes conocidos aunque el ratio no pueda publicarse. Sin conjunto financiero activo, el ingreso es **desconocido, no cero**. Un grupo ausente de un conjunto anual completo, validado y **atribuido** (sin líneas sin asignar y no histórico) tiene **cero confirmado** de esa categoría; un conjunto parcial o de cobertura no confirmada no lo acredita. Ingreso cero con horas positivas → ratio 0; ingreso positivo con cero horas → sin ratio (nunca infinito); cartera de ratio cero → la desviación relativa no se calcula. Se preservan los signos de ajustes. La cobertura temporal declarada y la frescura son distintas: no se infiere completitud de tiempos por el último día registrado.

CAL 22. **Servicio y perímetro.** Servicio económico = SOPORTE, ADMIN_DELEGADA, OTROS o SIN_CLASIFICAR/CONFLICTO, distinto del plan Gold/Platinum/Silver y de la causa. Evidencias: administración delegada identificada del ticket, asignación por valor exacto de Entorno y Tipología y asignación por proyecto Wrike, con vigencia; `adminDelegada=false` no prueba Soporte; dos evidencias incompatibles son conflicto. El ratio de un servicio usa sus ingresos y sus horas; **si quedan horas del ámbito y periodo sin servicio, en conflicto o con elegibilidad pendiente que podrían cambiar el perímetro, el ratio no se presenta como completo** (estado parcial con numerador y denominador conocidos y el motivo, sin fabricar el denominador). La vista Total incluye el mismo perímetro económico (los tres ingresos y todas las horas elegibles) en ambos componentes. Las horas sin servicio, ámbito o elegibilidad conocidos se conservan en desgloses separados y no se reparten proporcionalmente.

CAL 23. **Fuente de horas.** Se conserva la política PMO de `TimeActivity` (antes de 2025 Zendesk; desde 01/01/2025 PMO solo Wrike y el resto de Zendesk, por pertenencia histórica) y la fecha del trabajo. Una actividad es `(source, entryId)`, contada una vez; no se vuelve a deduplicar entre fuentes por persona/ticket/día. 2 h de Zendesk PMO en 2024 + 3 h de Zendesk PMO en 2025 (excluidas) + 4 h de Wrike PMO en 2025 (elegibles) → 6 h en el agregado que comprende ambos años. El trabajo atribuido solo al grupo cuenta una vez en el grupo, no en cada Cliente; internos, conflictos y no atribuidos quedan identificados y conciliables sin inflar clientes externos.

CAL 24. **Ámbito.** El ingreso BC se calcula al nivel Grupo Cliente. En un Cliente o implantación sin ingreso propio se devuelven sus horas y usuarios y «ingreso agrupado en Grupo Cliente» con la referencia al grupo, sin ratio propio atribuido. Un filtro de equipo, nivel o proyecto que recorta solo las horas **no** puede conservar todo el ingreso del grupo y llamarlo rentabilidad de ese subconjunto: se informa la limitación. Plan y alojamiento se resuelven con vigencia a la fecha de corte; un grupo con hijos distintos devuelve «heterogéneo» y no el valor de un primer hijo.

CAL 25. **Silver On Demand (ECO 08, propuesto).** Se guardan sus ingresos reales y se permite el análisis anual/CUM; no se activa una rentabilidad mensual recurrente (mes seleccionado, mes anterior y serie mensual) ni se anualizan cobros parciales por defecto. Silver Recurrente no hereda la limitación.

CAL 26. **Lectura consistente y referencia.** Una ejecución lee un estado coherente (transacción de lectura `REPEATABLE READ`) y devuelve el lote financiero vigente y su versión por año y categoría, la cobertura, la revisión de configuración, la versión de las derivaciones de tiempos, el método, la versión del motor y el estado de recálculo pendiente (maestros BC cambiados; atribuciones apoyadas en el antiguo atajo BC). No es todavía un sistema de cierres certificados.

CAL 27. **Configuración económica.** Objetivo inicial **550 €/jornada** de **8 h** y tolerancia de conciliación de 0,01 € (técnica y propuesta). Revisiones inmutables con autor y fecha; una consulta usa una única revisión en todos sus bloques (la última por defecto; una anterior es un **recálculo identificado**, nunca una sustitución silenciosa). No se usan variables de entorno para estos parámetros. El método anual/12 con días reales es fijo y confirmado; no se ofrecen métodos no implementados. Pesos, umbrales y referencias de Calidad se añadirán a la misma página en CSAPP-07.

CAL 28. **Vta Potencial y Diferencia en los cálculos.** El ingreso del motor es la «Vta Potencial» anual («Ingreso anual: facturado + potencial»). «Diferencia» se conserva y muestra aparte: no se suma al ingreso, no mide la desviación contra 550 y no permite calcular un Budget absoluto mientras no se confirme la convención de signo.

CAL 29. **Reproducibilidad de la tolerancia.** La tolerancia usada al validar un lote queda capturada en su revisión de preparación; si cambia antes de activar y altera el resultado de la validación se exige revisar de nuevo.

CAL 30. **Límites de CSAPP-05.** Sin dashboards (CSAPP-06), Pulse Rent ni semáforos de Calidad; sin cierres certificados; Windows y los archivos reales de Dennis sin probar. Los valores sintéticos solo existen en bases `_test`.
