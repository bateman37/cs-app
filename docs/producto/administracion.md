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

## Configuración entregada en CSAPP-07

Administración › Configuración tiene tres secciones: **Economía** (CSAPP-05, sin cambios), **Pulse Rent** y **Calidad**. Cada una tiene revisiones inmutables con autor, motivo y fecha, borrador, simulación (solo Calidad) y activación como acciones distintas. Ver [arquitectura](../arquitectura/pulse-configuracion-csapp07.md).

ADM 12. **Borrador, simulación y activación.** Guardar un borrador (solo Administrador) no cambia lo activo; simular nunca escribe; activar crea atómicamente la revisión siguiente, valida todo lo necesario y registra auditoría. Una edición basada en una revisión que ya no es la vigente se rechaza. Volver a una anterior crea una **nueva** activación identificada (la historia no se modifica). No hay aprobación externa: el Administrador elige. Consulta ve qué reglas se aplican, sin borradores ni formularios. Una consulta GET nunca cambia parámetros; sin revisión persistida se usa la inicial en memoria y la primera activación la persiste.

ADM 13. **Pulse Rent.** Se configuran referencias estadísticas (las seis confirmadas y las personalizadas), dirección por métrica (una dirección distinta del catálogo se identifica como personalizada) y la selección canónica de los cinco perfiles (equipo, nivel o PMO del catálogo de personal). Una nueva revisión activa invalida las bandas anteriores.

ADM 14. **Calidad: pesos.** Seis indicadores con nombre completo: Client Health, Dedicación, PAP correctivos, Escalados N3, Incidentes y problemas, Bugs y afectación del estándar. **Iguales (confirmado)** = 1/6 exacto cada uno. Personalizado = seis porcentajes ≥ 0 con hasta dos decimales que suman exactamente 100 (se rechazan 99, 101 y 100,02, en cliente y en servidor). Peso cero desactiva la influencia sin borrar datos. Sin feedback de Client Health su peso se redistribuye entre los otros cinco; una fuente técnica ausente con peso positivo deja el global sin publicar completo.

ADM 15. **Calidad: umbrales, composición y global — SIN CALIBRAR.** Los umbrales numéricos, los mínimos de muestra y la composición del global **no están confirmados**: se inicializan sin calibrar y sin color. Cada indicador declara unidad, normalización, ámbito, método (absoluto o percentiles sobre una referencia explícita de la misma métrica), dirección, límites e igualdades, muestra mínima propia de Calidad y estado de calibración. Incidentes y problemas: bandas de edad (ordenadas, sin solapamiento ni huecos), umbral preocupante por incident/problem (envejecido = edad **>** umbral) y componentes de flujo y backlog; la composición «peor señal entre flujo y backlog envejecido» (BACK 07) es una **propuesta desactivada** que exige sus componentes calibrados. El global es una **plantilla propuesta** (verde 0, amarillo 0,5, rojo 1, suma ponderada con pesos efectivos y dos límites elegidos en [0,1]): sin método y límites no hay color final; no se activan salvaguardas no seleccionadas. Client Health: mapeo positivo/mixto/negativo→verde/amarillo/rojo propuesto, ausencia en blanco. El dashboard y Client Health llegan en CSAPP-08; aquí solo se configura y simula con escenarios manuales.

## CSAPP-08: ampliaciones de Administración

ADM 08. **Configuración › Calidad** edita reglas por ámbito (Grupo y Cliente) y unidad, backlog por tipo, política de fotografía y correspondencias de diagnóstico, además de pesos, mapeo de Client Health, perfiles de Dedicación, composición y global. Distingue **confirmado** (pesos iguales 1/6, redistribución solo sin Health), **propuesto** (todo lo demás, desactivado) y **activado** (lo que el Administrador activa por el circuito de revisiones existente; no hay otra aprobación externa). Las revisiones v1 se leen mediante un adaptador sin modificarse; el simulador de escenarios manuales (CSAPP-07) usa el mismo evaluador que el dashboard.

ADM 09. **Simulación sobre datos.** El Administrador previsualiza el borrador de Calidad sobre los datos de la base (`/calidad?sim=borrador`): banner «SIMULACIÓN, NO PUBLICADO» y comparación activa/propuesta. No cambia feedback, observaciones, reglas activas ni resultados publicados; solo ADMIN.

ADM 10. **Cargas › cobertura declarada.** La ficha de un lote completado de tickets, tiempos, Wrike o PAP permite declarar (versión, motivo y auditoría) población, estados contenidos, alcance temporal y, en tickets, la extracción revisada. No cambia filas, extracción original ni observaciones; sin declaración la cobertura es desconocida. Ver [arquitectura](../arquitectura/calidad-csapp08.md).

ADM 11 (HOTFIX-02). **Actualizar relaciones de los datos cargados.** Una única acción en Cargas (solo Administrador) recalcula las atribuciones de todo lo ya cargado con los maestros actuales; es recuperación: los cambios de maestros (carga de Clientes/Personal, ediciones, decisiones) la disparan solos. Administración muestra un estado breve y real «Actualizando relaciones» con progreso, fallo y reintento, y distingue maestros guardados de análisis actualizado; no se muestra «al día» mientras haya una generación sin publicar. Ver [enlace automático](../arquitectura/hotfix02-enlace-automatico.md).
