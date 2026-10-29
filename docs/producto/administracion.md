# Administración y configuración

## Secciones del panel

ADM 01. Clientes y proyectos: grupo BC, alias por sistema, organizaciones Zendesk, proyectos Wrike/PAP, soporte, CLOUD/OP, complejidad, producto y vigencias. Personal: identidad única y alias PAP/Zendesk/Wrike, equipo, nivel, PMO y rol ANA/DEV. Usuarios: matriz mensual por año y ámbito cliente/proyecto. Cargas: una entrada por fuente, historial de lotes y resumen de resultados.

ADM 02. Configuración: objetivo económico, horas de jornada, reglas de causas y servicios, tags de escalado, catálogo de orígenes, perfiles CSV y reglas de vínculos a bugs, pesos, límites, dirección de KPI, referencias y límites de resultado global. Mostrar valor vigente, descripción, autor y fecha del último cambio. Las reglas confirmadas se precargan; una propuesta pendiente se identifica como tal. No permitir fórmulas de código arbitrarias introducidas en texto.

## Pesos de Calidad

ADM 03. Modo inicial «pesos iguales»: seis pesos exactos de 1/6 del total. Puede mostrarse 16,666… por ciento, con un total exacto del 100 por ciento. No guardar seis valores de 16,67 como si sumaran 100. El cálculo utiliza la proporción exacta y redondea solo para presentar.

ADM 04. Modo personalizado: el administrador introduce seis porcentajes decimales no negativos y la pantalla calcula su suma en tiempo real. Guardar se habilita solo si suman exactamente 100 por ciento; por ejemplo 20+20+15+15+15+15. Si se usan dos decimales, comparar unidades de centésima de porcentaje enteras, evitando errores de coma flotante. Un peso cero desactiva su influencia, pero no borra el dato ni el KPI.

ADM 05. Si Client Health no tiene información en el mes, redistribuir proporcionalmente su peso entre los otros cinco indicadores. Con pesos iguales quedan cinco pesos exactos del 20 por ciento. Mostrar pesos configurados y efectivos. Si la suma de los pesos elegibles es cero, no calcular un global. Si falta una fuente técnica, informar de la cobertura; no convertir ausencia en cero.

## Umbrales y reglas

ADM 06. Por KPI, configurar ámbito grupo/proyecto, dirección, método absoluto o percentiles, límites verde/amarillo/rojo y conjunto de comparación. Mostrar media, mediana, P10/P25/P75/P90 y número de observaciones como ayuda. Comprobar orden de límites y qué ocurre en las igualdades. Para mes parcial, comparar magnitudes con la misma exposición o corte; no comparar ciegamente un medio mes contra totales de mes completo.

ADM 07. La propuesta inicial de umbrales de Calidad y las salvaguardas globales no están aprobadas por el hecho de figurar en el diseño. Permitir simular cambios y guardar la configuración elegida con una revisión. Las bandas históricas de Pulse Rent conservan sus límites propios; no obligar a que el semáforo de Calidad herede esas cinco bandas.

## Cargas sencillas

ADM 08. Subir, validar estructura, previsualizar y confirmar. Informar filas importadas, actualizadas, duplicadas, fuera de ámbito y no asignables. Una organización nueva se añade en Clientes y se reprocesan los registros aplicables o se repite la carga; no es una anomalía de calidad del cliente. Un archivo con estructura incompatible o fechas/unidades inválidas se rechaza con un mensaje concreto.

No existe bandeja independiente de tickets pendientes. Los registros sin relación necesaria se excluyen del cálculo afectado y se contabilizan en el resumen. Los datos brutos se conservan para evitar pérdidas al cargar las fuentes en distinto orden.

## Diagnóstico y relaciones de producto

ADM 09. Configurar organizaciones internas, equivalencias Grupo Cliente/Cliente, selección de equipos de Dedicación, familias de causa y señales de entorno. No excluir causas del cliente por defecto. Las relaciones a bugs se guardan con procedencia y pueden completarse de forma explícita, sin adivinar por título. Estados de producto conservan su valor fuente. PR significa pendiente de crear pull request con desarrollo terminado en rama; Ready for Release no acredita despliegue.

ADM 10. Cargas de bugs VFS y VSW separadas, elegidas por Dennis, con alcance y extracción declarados. Sin precarga real. En tickets se valida el perfil canónico de ocho campos con status; los perfiles anteriores se rechazan como incompletos. Configurar estados no resueltos y tratamiento explícito de desconocidos.

ADM 11. Backlog: bandas de edad, umbral preocupante por type incident/problem, tasas por usuarios al corte y regla de composición del indicador Incidentes y problemas. Distinguir parámetros aprobados, propuestas y valores sin configurar. Mostrar un resultado sin calibrar hasta que exista una configuración elegida, evitando un verde automático. No introducir un séptimo peso ni convertir parámetros internos en SLA de cliente.
