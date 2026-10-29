# Importación y resumen de cargas

## Pantalla de Administración

IMP 01. Elegir fuente, fichero y año/categoría cuando corresponda. Leer cabeceras y unidades, validar, mostrar previsualización y confirmar. Procesar en segundo plano con progreso sin bloquear la navegación. Mostrar importados, revisados, duplicados, descartados y avisos. No crear una bandeja de pendientes separada ni obligar a resolver cada fila para continuar con el resto válido.

IMP 02. Distinguir incidencias de estructura de archivos y registros fuera del análisis. Un fichero equivocado, una duración ilegible o una fecha obligatoria inválida requiere corrección. Tickets/organizaciones ajenos al maestro o filas sin imputación pueden quedar fuera del cálculo con un contador y motivo. Los clientes nuevos son una actualización normal del maestro, no un problema de Calidad.

## Relaciones sin inventar datos

IMP 03. Conservar el bruto y sus identificadores para admitir fuentes cargadas en distinto orden. Un tiempo sin ticket conocido no puede atribuirse por conjetura; queda fuera de la dedicación atribuida y se informa en el lote. Al incorporar tickets o maestros, resolver y recalcular las relaciones posibles automáticamente o mediante repetir/procesar el lote desde su propia pantalla.

Un ticket sin tiempo no aporta dedicación y sí se conserva para Calidad, decisión confirmada. Los escalados, problemas y afectación por estándar no requieren una imputación de horas. No eliminar esos tickets mediante un join interno con tiempos.

## Duplicados y revisiones

IMP 04. Huella sobre todos los campos fuente tipados, antes de cálculos y equivalencias; no incluir el identificador de lote. Una fila idéntica de una fuente y ámbito se materializa una vez, aunque venga en varios archivos. Conservar checksum y fila original para auditoría. No deduplicar solo por ticket/persona/día porque puede haber dedicaciones legítimas distintas.

IMP 05. Los tickets son entidades revisables por ticket_id, no nuevos tickets cuando cambia causa, tags, type, status u organización. PAP se versiona por ID estable cuando exista. Un ID de tiempo solo se usa como clave si se ha validado su semántica; el export tiene IDs vacíos y un ID repetido con contenido distinto. Los posibles cambios de logs sin clave estable se informan en el resumen; no sumar una corrección parecida como si siempre fuera otro trabajo.

## Confirmación y recuperación

IMP 06. Preparar sin alterar datos activos. La activación de un lote financiero anual es atómica por año y categoría; bloquear activaciones simultáneas del mismo ámbito. Revertir restaura el conjunto anterior sin eliminar aportaciones válidas compartidas con otro lote. Mantener el detalle operativo dentro del historial de Cargas.

IMP 07. Guardar fecha de extracción/carga, intervalo declarado, filas y cobertura conocida. La falta de una fuente no equivale a cero actividad. Enriquecer tickets, usuarios o maestros invalida los agregados afectados. Las vistas muestran fecha de corte y datos disponibles, sin obligar a un proceso formal de publicación para consultar el mes actual.

## Volumen y formatos

XLSX y CSV original Wrike. El IQY no contiene datos PAP y no se ejecuta. El XLSM solo se consulta para maestros e históricos autorizados, sin VBA. Lectura por bloques en servidor, paginación y exportaciones grandes en segundo plano. Validar límites de tamaño comprimido/descomprimido y rendimiento con los archivos reales.

Los IDs se almacenan con exactitud y las duraciones/importes con decimales. No evaluar fórmulas o instrucciones del contenido. Los campos y cálculos derivados pertenecen al servidor. No cargar datos operativos reales automáticamente: ver la política de precarga y pruebas de Dennis.

## CSV de producto

Los dos perfiles de bugs comparten el motor de importación. Actualizan la lista observada por producto, conservan versiones y relaciones históricas y filtran Bug_ para métricas de defectos. El texto HTML/Markdown se procesa como dato; extraer enlaces permitidos no supone abrirlos ni ejecutarlos. Los elementos internos y otros tipos de Work Item permanecen consultables sin multiplicar las métricas de clientes.

## Fuente vigente y observación

Tickets: solo el perfil de ocho campos con status. Los anteriores están sustituidos; no mantenerlos como alternativas iniciales. Bugs: dos cargas VFS/VSW independientes, que actualizan identidades y observaciones sin borrado/cierre por ausencia. Capturar extracción declarada, alcance y fecha de carga por separado. Un export histórico no sobrescribe silenciosamente una observación más reciente. Mantener historial suficiente para reproducir cortes observados; no inventar cortes anteriores al primer dato.
