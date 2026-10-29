# Pases a producción con todas sus causas

El XLSX de PAP tiene 29 columnas A a AC y la consulta IQY no se ejecuta desde la aplicación. Conservar los campos fuente, fechas, proyecto, Resultado, responsables, plataformas, tipologías, causas, tickets y contexto de despliegue. Dennis probará la carga manualmente.

PAP 01. Identidad única de PAP mediante ID estable de lista o patrón inequívoco con ámbito. Una revisión no añade otra intervención. Proyecto se vincula al Cliente/implantación y desde ahí al Grupo Cliente. Una fuente que solo identifica grupo no se reparte entre los clientes por conjetura.

PAP 02. Causa raíz admite una o varias selecciones, con separador observado ;#. El PAP es correctivo si cualquiera contiene correctivo, aunque otras sean evolutivas. Mantener todas las pertenencias y una sola identidad. Contar DISTINCT pap_id en totales; no sumar desgloses que se solapan.

PAP 03. Origen cliente se conserva y participa en el volumen y el semáforo de PAP correctivos. Esta regla sustituye la exclusión del borrador v0.2. Mostrar el desglose por estándar, personalización, configuración/datos, procesos, infraestructura y origen cliente para explicar qué actuación puede corresponder. Un PAP de varias familias sigue contando una vez en el total.

PAP 04. El periodo usa Fecha puesta en producción. Resultado se conserva como información y filtro, sin imponer ahora Resultado=OK. La duración textual no se añade a las horas Zendesk/Wrike para evitar sumar el mismo trabajo dos veces.

PAP 05. Nº de BUG se conserva. Si identifica un Work Item de producto de forma inequívoca, se puede relacionar con él como dato explícito, preservando producto/ámbito; no deducir vínculos por parecido de título ni asumir que todo número es un Bug ID válido. El indicador de bugs no se obtiene buscando BUG en una descripción de cliente.
