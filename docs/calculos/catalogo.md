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
