# Calidad: seis indicadores y diagnóstico

Calidad es una de las cuatro vistas. Usa Grupo Cliente y Cliente, usuarios mensuales por ámbito, evolución, detalle explicable y diagnóstico por origen. Client Health, backlog y contexto de bugs VFS/VSW están dentro de esta vista; cargas y parámetros en Administración.

| Indicador | Magnitud y reglas |
| --- | --- |
| Client Health | Feedback mensual positivo, negativo, mixto o sin dato; nota y autor |
| Dedicación | Horas por usuario con CS N1, N2, PMO, IT y Plataforma desglosados; equipos configurables |
| PAP correctivos | PAP únicos si cualquiera de sus causas es correctiva; conservar origen cliente |
| Escalados N3 | Tickets únicos con tags PMO/IT, por creación y usuario; destinos separados |
| Incidentes y problemas | Flujo de type incident/problem y stock no resuelto por antigüedad, distinguiendo ambos tipos y orígenes |
| Bugs y afectación del estándar | Aprobado: problemas únicos externos vinculados explícitamente a Bug_ o con causa estándar; contexto de bugs de producto separado |

QLT 01. Los tickets sin horas sirven para Calidad. Sistemas del Cliente, Uso Indebido y origen cliente no se excluyen por atribución. Un rojo indica necesidad de actuar; el diagnóstico identifica qué acción puede corresponder, sin implicar culpabilidad automática de Vincle.

QLT 02. Conservar como dimensiones distintas type, entorno/tipología y causa raíz. Mostrar matrices, horas, tickets, PAP y escalados por origen. Configuración/personalización/integración orientan a revisar validación y pruebas; no demuestran por sí solos ausencia de pruebas. Las notas de QA pueden confirmar una hipótesis, sin crear una herramienta completa de planes de prueba.

## Dos ámbitos

QLT 03. La organización Zendesk identifica Cliente y el maestro lo relaciona con Grupo Cliente BC. Los usuarios del grupo se mantienen propios si hay personas compartidas entre implantaciones. No duplicar ingresos de grupo ni copiar su denominador en cada proyecto. Un desglose adicional de implantación solo existe cuando la fuente lo identifica.

## Sexto indicador aprobado

QLT 04. Numerador = unión de ticket_id distintos de type problem y organización externa registrada con vínculo explícito a Work Item Bug_ o causa incidente_estándar_plataforma. Si cumple ambas condiciones cuenta una vez; varios bugs del mismo problema tampoco lo multiplican. Periodo por creación y denominador de usuarios/exposición del mismo ámbito. Mostrar evidencia por vínculo, por causa y ambas. No excluirlo por no tener horas.

QLT 05. Separar bugs únicos del producto, bugs con afectación vinculada y problemas de cliente. Un bug puede afectar a varios clientes y generar varios problemas/incidentes. Los vínculos son parciales; cero vínculos no acredita ausencia de afectación. Un ticket central VINCLE BUGS no asigna el bug a todos los clientes. No sobrescribir una causa distinta porque exista un vínculo.

QLT 06. Stock abierto de producto según fotografía y estado; PR es desarrollo terminado en rama y pendiente de crear pull request; Ready for Release no prueba despliegue. Cargas VFS/VSW separadas y manuales por Dennis. Las vistas de producto son muestras para diseñar, no una precarga automática ni garantía de cobertura.

## Incidentes y problemas: volumen y antigüedad

QLT 07. Type incident/problem por creación mide flujo. Status new/open/pending/hold identifica no resueltos en una observación, sin limitar su fecha de creación al mes. Desglosar incidentes y problemas por edad y causa. Medir stock por usuarios al corte y flujo por exposición del periodo. Aplicar el [contrato de backlog](backlog-antiguedad.md); no sumar ambas magnitudes ni añadir un séptimo peso.

QLT 08. Antigüedad desde creación, no tiempo en cada estado. No hay fecha de cierre, resolución ni problem_id en el export. El histórico de backlog solo se muestra si existe una observación compatible; no proyectar el estado actual hacia meses pasados. La composición propuesta del color entre volumen y envejecimiento y sus límites se calibran en Administración, mostrando sin calibrar mientras no exista una configuración elegida.

## Client Health y pesos

QHL 01. Matriz enero-diciembre por grupo o cliente, con estado, comentario, fecha y autor. Sin feedback queda en blanco; no arrastrar el anterior ni propagar automáticamente la valoración de grupo a cada cliente.

QLT 09. Seis pesos iguales exactos de 1/6; total 100 por ciento. Sin Client Health, los otros cinco pesan 1/5, 20 por ciento cada uno. Modo personalizado: valores no negativos con suma exacta de 100 antes de guardar. No sumar seis redondeos 16,67 como si fueran cien. Mostrar pesos configurados y efectivos.

QLT 10. Administración configura dirección, límites, referencias, muestras y reglas globales. Dato ausente, relación parcial y resultado sin calibrar no son ceros. Un global parcial indica su cobertura. Cada color permite consultar numerador, denominador, corte, fuente, referencia, reglas y versión. Rentabilidad conserva las horas con independencia del origen del problema.

## CSAPP-08: pantalla, global mensual y Client Health (implementado)

Estado: **implementado y probado con datos sintéticos; sin aceptación de Dennis**. Arquitectura en [calidad-csapp08](../arquitectura/calidad-csapp08.md); fórmulas en [catálogo](../calculos/catalogo.md) CAL 45–52.

QLT 11. Pantalla `/calidad` (una de las cuatro vistas; sin quinta vista ni séptimo indicador): contexto de mes/corte, ámbito, revisión y avisos de cobertura; tarjetas de cartera (sobre todo el conjunto filtrado antes de paginar); tabla con los seis indicadores (valor, unidad, color con texto, estado), global, usuarios y cobertura; detalle por entidad; matriz de Client Health; diagnóstico; backlog. Funciona con datos sin calibrar: muestra magnitudes y siguientes acciones para ADMIN y solo el motivo para Consulta.

QLT 12. El resultado global principal es **mensual**: mes elegido hasta el corte efectivo (hoy en Europe/Madrid, nunca futuro), Health de ese mes, flujos del mismo periodo y stock observado compatible. CUM, año anterior comparable y año completo son contextos técnicos de evolución: no existe un global anual ni se promedian semáforos ni se combina Health del último mes con flujos CUM.

QLT 13. Ámbitos: Grupo y Cliente son propios (cada ticket/PAP/actividad una vez, usuarios independientes, sin sumar compartidos de hijos, sin promediar semáforos, sin heredar feedback). Un Cliente sin grupo conserva sus hechos. Una implantación **no hereda** los KPI de su Cliente. Las organizaciones internas no son clientes externos. Los filtros financieros no entran en Calidad; el servicio solo afecta a Dedicación.

QLT 14. Cada resultado devuelve valor, numerador, denominador, unidad, periodo, ámbito, fuente, revisión, estado de datos, de calibración, color si procede y explicación. Se distinguen: cero confirmado, sin dato, parcial, sin configuración y no calculable. Un valor parcial nunca da verde ni amarillo; en «menor es mejor» una cota inferior ya roja se muestra como **alerta roja parcial** sin convertir un global incompleto en completo.

QLT 15. Pesos (CAL 46): asignación efectiva (solo Health en blanco redistribuye), contribución disponible y cobertura son tres magnitudes. Ejemplo: Health en blanco y un técnico ausente → cinco asignados al 20 %, cobertura calculable 80 %, sin global completo. Health presente sin mapeo confirmado **conserva su peso** y bloquea el global.

QLT 16. Incidentes y problemas conserva **un solo peso**. Con la composición «peor señal» elegida evalúa flujo y backlog envejecido de incidentes y de problemas; sin elegirla no hay color del KPI (un flujo verde no es un color completo).

QHL 02. Client Health real: matriz enero–diciembre por año y ámbito dentro de Calidad, con búsqueda y paginación de entidades. Por celda: estado positivo/negativo/mixto o sin feedback, comentario (texto), fecha concreta opcional, autor, fecha de registro y versión. Edición atómica con `expectedVersion`, historial y auditoría antes/después; limpiar conserva el historial. Sin arrastre, sin prellenado, sin propagación entre Grupo/Cliente; «mixto» es elección explícita. Un mes futuro y una fecha futura se rechazan; una fecha posterior al corte diario no se usa antes de ella; sin fecha dentro del mes se declara el uso mensual provisional; el registro posterior al mes se identifica.

QHL 03. La categoría se ve aunque el mapeo no esté activado; el color solo con `health.confirmed` y configuración activa. Sin feedback (blanco, redistribuible) y feedback sin calibrar (conserva peso) son casos distintos.

QLT 17. Evolución mensual con datos propios de cada periodo y hueco cuando no hay fotografía compatible; hitos anotados sin excluir eventos; CUM técnico (mismo corte del año anterior) separado del global. Una curva de cohortes por creación con clasificación actual sería un recálculo, no un estado histórico demostrado.

**QLT 17 (ampliada en CSAPP-09).** La evolución muestra, para cada mes, los **seis indicadores** con sus componentes, el global cuando es calculable y las magnitudes originales (numerador, denominador, estado, tamaño de la muestra de referencia y cobertura), en una tabla accesible que conserva los huecos. Cada mes se evalúa con **la misma evaluación que la ficha mensual** sobre su propia cohorte, usuarios, cobertura, fotografía y reglas, y sus referencias por percentiles se **recalculan con la cohorte de ese mes** (nunca umbrales prestados del último mes). Política de configuración: **serie recalculada con la revisión activa al solicitarla**, la misma para todos los puntos, identificada en pantalla junto con una referencia de serie; **no** afirma que cada color sea el publicado históricamente (no existe archivo de ese cálculo) y un cambio retroactivo de datos, Health o maestros puede modificarla y cambia su referencia. Un mes sin cobertura declarada no es un cero confirmado; el stock sigue la política de fotografía (exacta o anterior dentro del máximo y provisional) y no usa información futura. No hay global anual ni promedio de colores. Coste y límites medidos: [validación de CSAPP-09](../validacion/csapp-09.md).

QLT 18. CSV autenticado (`/api/analitica/calidad.csv?tabla=cartera|ficha|health`): cartera completa filtrada, resumen de ficha y matriz de Health, con estados, unidades, colores textuales, pesos, revisiones, corte solicitado/observado y cobertura. Detalle y CSV avisan de una lectura nueva si el sello cambió.

QLT 19. Simulación sobre datos: un Administrador previsualiza el **borrador** de Calidad sobre los datos de la base (`/calidad?sim=borrador`) con el banner «SIMULACIÓN, NO PUBLICADO» y la comparación activa/propuesta; no cambia feedback, observaciones, reglas activas ni resultados publicados. Coexiste con los escenarios manuales de CSAPP-07.

Confirmado, propuesto y activado: **confirmados** los pesos iguales 1/6 y la regla de redistribución sin Health; **propuestas** (no aceptadas) mapeo de Client Health, selección de perfiles de Dedicación, «peor señal», plantilla del global, umbrales y política de fotografía anterior; **activado** solo lo que el Administrador elija en Administración › Configuración. No se activan datos de ejemplo para que haya colores.
