# Tickets Zendesk: perfil canónico con estado

## Esquema vigente

Fuente de referencia: DATA ZENDESK TICKET_TAG_CREATED_TYPE_STATUS.xlsx. Sustituye todas las versiones anteriores de tickets; no son perfiles alternativos admitidos en la primera implementación. Las cabeceras obligatorias son:

| Campo | Significado |
| --- | --- |
| ticket_id | Identidad estable del ticket; exacta, sin flotantes |
| organization_id | Organización Zendesk; puede estar vacía o aún no existir en el maestro |
| Entorno y Tipología | Dimensión del entorno/tema, distinta de type |
| CausaRaiz(Agr) | Causa raíz registrada, conservando su valor fuente |
| tags | Conjunto de tags; el export observado usa array JSON |
| fecha_creación | Fecha de creación; el Excel observado almacena serial de fecha sin hora |
| type | Tipo nativo: incident, problem, question, task |
| status | Estado observado del ticket |

La muestra tiene 113856 tickets únicos. No hay descripción, subject, updated_at, fecha de resolución/cierre, problem_id ni historial de estados. No calcular ni inventar esos campos.

ZDT 01. Validar por contenido y cabeceras, no por nombre de archivo. El orden de columnas se resuelve por cabecera. Admitir columnas extra informándolas, pero rechazar como perfil antiguo/incompleto un fichero sin cualquiera de las ocho cabeceras. IDs, fecha, type y status requieren valores válidos; una organización o tipología sin informar se mantiene como cobertura pendiente, sin asignación inventada. Preservar originales y normalizar espacios de cabecera sin confundir significados.

ZDT 02. ticket_id identifica una entidad revisable. Reimportar idéntico no crea nada nuevo; cambiar status, causa, organización o tags crea una revisión y actualiza su observación vigente. Conservar extracción declarada e importación por separado. Una carga declarada anterior a la observación vigente no la sobrescribe silenciosamente. Una fila ausente no se interpreta como ticket eliminado/resuelto. Dennis prueba la carga; no precargar los ejemplos.

## Estado y cobertura

ZDT 03. Estados no resueltos iniciales: new, open, pending, hold. Solved es resuelto y closed cerrado: ambos fuera del backlog activo, manteniéndolos distintos. La muestra contiene closed 111990, solved 1257, hold 156, pending 38 y open 415. No hay new en esta muestra; no significa que el perfil lo prohíba. Un valor desconocido se informa y no se convierte en open ni en cero; el catálogo se revisa en Administración.

ZDT 04. El estado es conocido a la observación del export, no durante todos los meses desde creación. Ver [backlog y antigüedad](../producto/backlog-antiguedad.md). Pending/hold siguen siendo asuntos no resueltos; diferenciarlos en el detalle porque no prueban la misma acción pendiente ni responsabilidad. La antigüedad es desde creación, no tiempo en el estado actual.

## Ámbito y jerarquía

ZDT 05. Resolver organization_id como Cliente y su relación con Grupo Cliente BC. Clasificar explícitamente organizaciones internas VINCLE, VINCLE BUGS, VINCLE INFRAESTRUCTURAS y pruebas en el maestro. Un ticket central de producto no se convierte en cliente externo por no llamarse exactamente VINCLE.

ZDT 06. Conservar los tickets sin horas para Calidad. Una organización nueva o vacía se informa en el lote y se conserva el bruto para resolución posterior. No asignarla a otra por similitud. Contar por ticket_id distinto antes de unir tiempos, bugs o causas. Excluir internos del semáforo de clientes, manteniéndolos consultables como contexto de producto.

## Causas y escalados

ZDT 07. Mantener todos los orígenes en Calidad, incluidos Sistemas del Cliente y Uso Indebido. El filtro histórico Incidente Vincle conserva sus cuatro causas de aplicación más infraestructura cuando el alojamiento vigente es CLOUD; es un filtro de conciliación, no una exclusión global del diagnóstico completo. Type, causa y entorno permanecen separados.

| Tag exacto | Destino |
| --- | --- |
| team_n2 | CS N2 |
| team_n3_pmo | PMO N3 |
| team_it | IT N3 |
| team_plataforma o team_plataformavfs | VFS N4 |
| team_plataformaarq | Arquitectura VFS N4 |
| team_plataformavsw | VSW N4 |

ZDT 08. Comparar tags completos del conjunto. Un ticket con PMO e IT cuenta una vez en el total N3 y aparece en ambos desgloses. El mes de análisis es creación con tags conocidos a la extracción; no afirmar que el escalado ocurrió ese mes ni pedir una fecha de evento inexistente.

## Producto

ZDT 09. Sexto numerador aprobado: unión de problemas externos con vínculo explícito a Bug_ o causa incidente_estándar_plataforma. Un problema presente en ambos se cuenta una vez. La causa estándar no prueba por sí sola cierre del ticket ni del bug; status es otra dimensión.

ZDT 10. No clasificar por palabra BUG o tag bug genérico. Las relaciones del CSV de producto son múltiples y conservan procedencia. Sin problem_id no reconstruir qué incidentes cuelgan de un problema. No sumar bugs, problemas e incidentes como si fueran la misma unidad.

## Implementación en CSAPP-03

Implementado y probado en Linux; detalle técnico en [importadores Zendesk](../arquitectura/zendesk-csapp03.md). Las siguientes reglas concretan los contratos anteriores donde el texto dejaba margen; son **interpretaciones implementadas pendientes de aceptación por Dennis**, no decisiones nuevas de negocio.

ZDT 11. Revisión y observación son dos cosas. Una revisión es un contenido funcional distinto de un `ticket_id` (los tags se comparan como conjunto). Una observación es que un lote vio ese ticket con esa revisión en una fecha: se registra aunque el contenido no cambie y no crea otro ticket ni otra actividad. La fecha de observación es la extracción declarada o, si no hay, la de recepción (se avisa de frescura desconocida). La revisión vigente es la de la observación más reciente; el empate se resuelve por recepción del lote y después por orden de activación, nunca por posición de fila, y se informa. Un export anterior se conserva como histórico y no sustituye al vigente; reprocesarlo no cambia su observación.

ZDT 12. Dos filas del mismo ticket con contenido contradictorio dentro de un archivo son errores (ninguna se activa) y el lote no se confirma hasta corregir el archivo. Con errores obligatorios sin resolver el lote tampoco se confirma. Revertir un lote retira solo lo que ningún otro lote sustenta y recalcula la vigencia con las observaciones restantes.

ZDT 13. Vínculos y clasificaciones dependientes de maestros (Cliente, interno/externo, Grupo BC, alojamiento, Incidente Vincle) se calculan al consultar con los maestros actuales y la fecha de creación del ticket, de modo que completar un maestro mejora los resúmenes sin recargar. Admin delegada y los destinos por tag exacto se guardan con la revisión. Los tickets sin horas, sin organización o sin equivalencia se conservan siempre.
