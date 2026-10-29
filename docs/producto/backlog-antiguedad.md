# Tickets sin resolver y antigüedad

## Ubicación y finalidad

BACK 01. Es parte de Calidad, dentro del indicador Incidentes y problemas y su detalle. No es un séptimo KPI ni otra vista principal. Separar incidentes pendientes, que representan afectación directa por resolver, de problemas pendientes, que requieren solución definitiva y pueden generar ruido o necesidad de workarounds. El fichero no mide frecuencia o número de esos workarounds.

## Población

BACK 02. Stock no resuelto inicial = tickets distintos con status new/open/pending/hold en una organización externa del ámbito. Solved y closed quedan fuera, en estados separados. Conservar desconocidos como cobertura no clasificada. Mostrar incident y problem por separado. Question y task permanecen consultables, pero no se agregan al componente de antigüedad de incidentes/problemas.

BACK 03. El backlog no se filtra por creación dentro del mes seleccionado. Un incidente de hace un año todavía open pertenece al stock actual aunque el mes actual no tenga nuevas altas. Aplicar cliente/grupo, producto, origen y demás filtros pertinentes, pero usar fecha de observación para el corte del stock. Un mismo ticket se cuenta una vez al agregar un grupo, aunque tenga varias horas, tags o bugs.

## Antigüedad y denominadores

BACK 04. Edad en días naturales = fecha de observación de la fuente menos fecha_creación. Usar fechas del negocio y declarar el corte; las fuentes XLSX actuales no aportan hora de creación. No llamar a esa edad tiempo en open, tiempo desde escalado o tiempo hasta resolución. No usar hoy contra un estado antiguo sin advertir que falta una observación actual. Una creación posterior al corte es un error de ámbito/fecha, no una edad cero inventada.

BACK 05. Mostrar por tipo: cantidad no resuelta, cantidad por banda de edad, mediana, P90 y edad máxima; usuarios al corte; no resueltos y envejecidos por 100 usuarios; porcentaje envejecido dentro del stock, si es calculable. Si no hay usuarios, mostrar el conteo absoluto y denominador faltante. Un stock vacío confirmado tiene conteo cero; su mediana/edad máxima es no aplicable, no cero días de actividad.

BACK 06. La tasa de stock es 100 por número de tickets activos dividido entre usuarios del mismo ámbito al corte. La tasa de envejecidos filtra edad mayor que el umbral del tipo y usa el mismo denominador. Es un stock; no dividir por usuarios mes acumulados ni prorratearlo por llevar medio mes. El flujo de nuevas altas usa fecha de creación y exposición temporal. Ambos se presentan por separado y nunca se suman como tickets adicionales.

## Regla de color y configuración

BACK 07. Confirmado: muchos asuntos sin resolver y antiguos deben influir en Calidad, diferenciando incidentes y problemas. Configurar en Administración bandas y días preocupantes por tipo, referencias y límites. No inventar un SLA externo ni números aprobados. Propuesta para revisar antes de activar: el color de Incidentes y problemas toma la peor señal entre su flujo y los componentes de backlog envejecido por tipo; un backlog rojo no queda verde solo por tener pocas altas. Mantiene un único peso de los seis.

BACK 08. Los umbrales numéricos y esa composición son parámetros pendientes de calibrar, distintos de los pesos iguales ya confirmados. Sin calibración se muestran magnitudes y la etiqueta sin calibrar, sin asignar verde por defecto; el global informa cobertura parcial. Si se presenta una configuración de ejemplo, debe rotularse propuesta y no activarse silenciosamente. La regla de comparación en la igualdad queda documentada al elegir límites.

## Cortes y límites históricos

BACK 09. Guardar status por observación, fuente y lote. fecha de extracción declarada y fecha de importación son campos diferentes; si no se conoce extracción, registrar observación recibida al importar y advertir su frescura desconocida. MAX(fecha_creación), el nombre del archivo o su fecha de modificación no prueban la extracción.

BACK 10. Un export actual permite el stock observado y cohortes por creación con estado actual. No reconstruye backlog al cierre de enero o a una fecha pasada. La UI distingue cohorte creada en enero/estado conocido ahora de stock observado en enero. Para un corte histórico sin fotografía compatible, mostrar no disponible; las fotos futuras permiten series observadas, sin afirmar el instante exacto de cada transición entre cargas. Cada serie muestra corte, cobertura y estado de configuración.

BACK 11. Al actualizar un ticket de open a solved desaparece del stock activo de la nueva observación; no es un ticket nuevo ni prueba la fecha exacta de resolución. Revertir una carga restaura la versión anterior aplicable. No sobrescribir silenciosamente observaciones más nuevas con exports antiguos. No sumar tiempo Zendesk/Wrike otra vez al enriquecer el ticket.

## Diagnóstico y acción

BACK 12. El detalle permite ver ID, Cliente/Grupo Cliente, type, status, creación, días, origen, escalados y vínculos conocidos a producto. Mantener Sistemas del Cliente y Uso Indebido: un rojo orienta a actuar y la causa explica si corresponde producto, implantación, infraestructura, formación o sistemas del cliente. No confundir workaround con solución definitiva ni crear un gestor de acciones de QA fuera de alcance.
