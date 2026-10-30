# Pases a producción con todas sus causas

El XLSX de PAP tiene 29 columnas A a AC y la consulta IQY no se ejecuta desde la aplicación. Conservar los campos fuente, fechas, proyecto, Resultado, responsables, plataformas, tipologías, causas, tickets y contexto de despliegue. Dennis probará la carga manualmente.

PAP 01. Identidad única de PAP mediante ID estable de lista o patrón inequívoco con ámbito. Una revisión no añade otra intervención. Proyecto se vincula al Cliente/implantación y desde ahí al Grupo Cliente. Una fuente que solo identifica grupo no se reparte entre los clientes por conjetura.

PAP 02. Causa raíz admite una o varias selecciones, con separador observado ;#. El PAP es correctivo si cualquiera contiene correctivo, aunque otras sean evolutivas. Mantener todas las pertenencias y una sola identidad. Contar DISTINCT pap_id en totales; no sumar desgloses que se solapan.

PAP 03. Origen cliente se conserva y participa en el volumen y el semáforo de PAP correctivos. Esta regla sustituye la exclusión del borrador v0.2. Mostrar el desglose por estándar, personalización, configuración/datos, procesos, infraestructura y origen cliente para explicar qué actuación puede corresponder. Un PAP de varias familias sigue contando una vez en el total.

PAP 04. El periodo usa Fecha puesta en producción. Resultado se conserva como información y filtro, sin imponer ahora Resultado=OK. La duración textual no se añade a las horas Zendesk/Wrike para evitar sumar el mismo trabajo dos veces.

PAP 05. Nº de BUG se conserva. Si identifica un Work Item de producto de forma inequívoca, se puede relacionar con él como dato explícito, preservando producto/ámbito; no deducir vínculos por parecido de título ni asumir que todo número es un Bug ID válido. El indicador de bugs no se obtiene buscando BUG en una descripción de cliente.

## Implementación en CSAPP-04

Perfil `pap` (XLSX CARGA PAP, 29 columnas por contenido). Contrato exacto de identidad (`^(?:ID\s+)?([0-9]+)\s*:` + lista de origen declarada), causas, formatos de referencias admitidos, ámbito por proyecto y política temporal: [Wrike, PAP y bugs](../arquitectura/wrike-pap-bugs-csapp04.md#6-pap-contrato-exacto). Resumen operativo:

- PAP 01: clave = lista de origen (metadato obligatorio) + ID del título; otro `42` en otra lista es otra identidad; el resto del título puede cambiar (revisión). Sin identidad reconocida es error claro.
- PAP 02-03: causas por `;#` con tokens originales y normalizados; correctivo si cualquiera lo es (también un `Correctivo (…)` nuevo); sin causa o etiqueta nueva = sin clasificar; origen cliente conservado y desglosado; los totales cuentan PAP distintos y los desgloses no se suman.
- PAP 04: periodo = fecha de puesta en producción (sin ella, «sin fecha de producción»); `Fecha de Solicitud` vacía es válida; `Resultado` se conserva íntegro sin imponer OK; `Duración` no se suma a horas.
- PAP 05: `Nº de BUG` se conserva; solo una referencia con producto explícito se resuelve contra un Work Item (cuando llega); un número suelto queda con producto sin determinar. Los tickets asociados y el ticket PAP asociado tienen roles distintos y sus pares se deduplican; `CAL's asociados` no son tickets.
