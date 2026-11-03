# Importación y resumen de cargas

## Pantalla de Administración

IMP 01. Elegir fuente y fichero; solo las tres fuentes financieras piden además el **año**, escrito a mano (cuatro dígitos, 1900–9999; el año actual Europe/Madrid es solo el valor inicial). Desde HOTFIX-01 el formulario ordinario **no** pide lista PAP, vista, ámbito DevOps, extracción, intervalos, cobertura ni casilla de conjunto completo (ver IMP 08–IMP 12); la hoja solo se informa cuando hay varias hojas compatibles realmente ambiguas. Leer cabeceras y unidades, validar, mostrar previsualización y confirmar. Procesar en segundo plano con progreso sin bloquear la navegación. Mostrar importados, revisados, duplicados, descartados y avisos. No crear una bandeja de pendientes separada ni obligar a resolver cada fila para continuar con el resto válido.

IMP 02. Distinguir incidencias de estructura de archivos y registros fuera del análisis. Un fichero equivocado, una duración ilegible o una fecha obligatoria inválida requiere corrección. Tickets/organizaciones ajenos al maestro o filas sin imputación pueden quedar fuera del cálculo con un contador y motivo. Los clientes nuevos son una actualización normal del maestro, no un problema de Calidad.

## Relaciones sin inventar datos

IMP 03. Conservar el bruto y sus identificadores para admitir fuentes cargadas en distinto orden. Un tiempo sin ticket conocido no puede atribuirse por conjetura; queda fuera de la dedicación atribuida y se informa en el lote. Al incorporar tickets o maestros, resolver y recalcular las relaciones posibles automáticamente o mediante repetir/procesar el lote desde su propia pantalla.

Un ticket sin tiempo no aporta dedicación y sí se conserva para Calidad, decisión confirmada. Los escalados, problemas y afectación por estándar no requieren una imputación de horas. No eliminar esos tickets mediante un join interno con tiempos.

## Duplicados y revisiones

IMP 04. Huella sobre todos los campos fuente tipados, antes de cálculos y equivalencias; no incluir el identificador de lote. Una fila idéntica de una fuente y ámbito se materializa una vez, aunque venga en varios archivos. Conservar checksum y fila original para auditoría. No deduplicar solo por ticket/persona/día porque puede haber dedicaciones legítimas distintas.

IMP 05. Los tickets son entidades revisables por ticket_id, no nuevos tickets cuando cambia causa, tags, type, status u organización. PAP se versiona por su ID (identidad única en la aplicación, IMP 10). Un ID de tiempo no es clave: el export tiene IDs vacíos y un ID repetido con contenido distinto; los tiempos se sustituyen por instantánea completa de la fuente (IMP 09) y **no** se marcan «posibles correcciones».

## Confirmación y recuperación

IMP 06. Preparar sin alterar datos activos. La activación de un lote financiero anual es atómica por año y categoría; bloquear activaciones simultáneas del mismo ámbito. Revertir restaura el conjunto anterior sin eliminar aportaciones válidas compartidas con otro lote. Mantener el detalle operativo dentro del historial de Cargas.

IMP 07. Guardar fecha de extracción/carga, intervalo declarado, filas y cobertura conocida. La falta de una fuente no equivale a cero actividad. Enriquecer tickets, usuarios o maestros invalida los agregados afectados. Las vistas muestran fecha de corte y datos disponibles, sin obligar a un proceso formal de publicación para consultar el mes actual.

## Volumen y formatos

XLSX y CSV original Wrike. El IQY no contiene datos PAP y no se ejecuta. El XLSM solo se consulta para maestros e históricos autorizados, sin VBA. Lectura por bloques en servidor, paginación y exportaciones grandes en segundo plano. Validar límites de tamaño comprimido/descomprimido y rendimiento con los archivos reales.

Los IDs se almacenan con exactitud y las duraciones/importes con decimales. No evaluar fórmulas o instrucciones del contenido. Los campos y cálculos derivados pertenecen al servidor. No cargar datos operativos reales automáticamente: ver la política de precarga y pruebas de Dennis.

## CSV de producto

Los dos perfiles de bugs comparten el motor de importación. Actualizan la lista observada por producto, conservan versiones y relaciones históricas y filtran Bug_ para métricas de defectos. El texto HTML/Markdown se procesa como dato; extraer enlaces permitidos no supone abrirlos ni ejecutarlos. Los elementos internos y otros tipos de Work Item permanecen consultables sin multiplicar las métricas de clientes.

## Fuente vigente y observación

Tickets: solo el perfil de ocho campos con status. Los anteriores están sustituidos; no mantenerlos como alternativas iniciales. Bugs: dos cargas VFS/VSW independientes, que actualizan identidades y observaciones sin borrado/cierre por ausencia. Capturar extracción declarada, alcance y fecha de carga por separado. Desde HOTFIX-01 (IMP 08) lo último cargado manda sobre el estado actual aunque el export traiga fechas antiguas; las fechas originales se conservan como datos y procedencia. Mantener historial suficiente para reproducir cortes observados; no inventar cortes anteriores al primer dato.

## Cargas sencillas y última carga (HOTFIX-01-v2)

IMP 08. **Lo último cargado sustituye el contenido activo.** El servidor asigna a cada lote una **secuencia de recepción** (`UploadBatch.receptionSeq`) cuando el archivo llega completo y se encola; no depende de la posición de filas ni del reloj del navegador. Para una misma identidad o ámbito gana, entre lotes completados, la mayor secuencia (el puntero vigente de tickets, PAP y Work Items se recalcula por ella). Un lote fallido, cancelado o pendiente no desplaza al activo; un lote antiguo que se activa tarde no pisa al posterior (en sustituciones de ámbito se cancela con motivo); reprocesar no cambia la secuencia. Sustituye la regla anterior de que una observación o Changed Date antiguos impedían actualizar; las fechas del dato no se reescriben. Estado: confirmado (instrucción de Dennis).

IMP 09. **Tiempos: instantánea activa por fuente.** Wrike no tiene ID de imputación y el `id` de tiempos Zendesk no es único, por lo que ninguna clave de ticket/persona/día/duración/fila identifica una imputación. Cada export completo de una fuente reemplaza el conjunto visible anterior de **esa** fuente (punteros Zendesk y Wrike independientes); las instantáneas y brutos anteriores se conservan. Filas idénticas se deduplican; filas distintas legítimas se mantienen; una duración corregida no se suma a la antigua. Implementación: vistas `ActiveTimeBatch`, `ActiveZdTimeEntry` y `ActiveWrikeTimeEntry`; `TimeActivity` solo lee la actividad activa. La actividad anterior a HOTFIX-01 forma la **base heredada** (`legacyBase`) y sigue activa hasta la primera instantánea nueva, que la sustituye de forma explícita (ficha: «Impacto de la activación»); no se fabrica un lote con archivo inexistente. Mensaje junto a la fuente: «Carga el export completo: sustituirá los tiempos activos de esta fuente; las cargas anteriores se conservan». Revertir restaura la instantánea anterior válida. Un futuro formato con ID estable podría actualizar por ID.

IMP 10. **PAP, tickets y bugs se actualizan por ID.** Tickets: `ticket_id`; PAP: ID PAP único (namespace técnico `pap`; la lista antigua queda como procedencia); bugs: producto + ámbito + Work Item ID. Dentro de un archivo, el mismo ID con contenido contradictorio es error de fuente (no «gana la última fila»). Actualizar IDs presentes no cierra ni borra los ausentes. Finanzas: sustitución completa de año+categoría. Ver [PAP](pap.md).

IMP 11. **Vista amplia.** Bugs VFS/VSW leen todos los registros suministrados (abiertos y cerrados, todos los Work Item Type) sin selector ni casilla; solo `Bug_` cuenta como defecto. Se registra como **contrato de la fuente**, no como inferencia por existencia de filas. Sin fecha de extracción fiable en el archivo, la fecha de recepción es una observación operativa identificada como tal; no se inventa periodo histórico: la cobertura (en su apartado, no obligatoria) muestra el límite concreto sin bloquear la carga.

IMP 12. **Estado de los controles.** Un botón deshabilitado porque el lote terminó no usa cursor de espera ni `aria-busy`; solo una operación realmente enviada muestra progreso. El sondeo de la ficha se detiene sin trabajo activo (lote terminal sin recálculo/reversión en cola), refresca una vez y cancela temporizador y petición al desmontar. Un recálculo o reversión sobre un lote COMPLETED se explica como operación aparte.
