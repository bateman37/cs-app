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
