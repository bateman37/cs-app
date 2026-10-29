# Maestros de clientes personal y usuarios

## Clientes y proyectos

MST 01. Crear un cliente canónico con identificador interno estable, nombre de grupo BC, estado activo y fechas de vigencia. Guardar las identidades externas en una tabla de equivalencias por sistema. Admitir varias identidades por cliente; cada identidad solo puede apuntar a un cliente en el mismo intervalo. Un parecido de texto propone una correspondencia, nunca la confirma.

MST 02. Campos funcionales: grupo BC; organizaciones Zendesk con ID y nombre; nombres o IDs de proyecto Wrike; nombres o IDs PAP; plan Gold, Platinum, Silver On Demand o Silver Recurrente; alojamiento CLOUD u OP; complejidad Basic, Medium o Enterprise. Añadir producto y proyectos operativos como campos separados. Conservar alias y etiquetas originales sin duplicar columnas para BUSCARV.

MST 03. Precargar las 76 filas del maestro existente mediante revisión y consolidación; se han encontrado 46 nombres BC distintos no vacíos. Una fila incompleta no se convierte en cliente ficticio. Revisar discrepancias y alias antes de activar las equivalencias. Las bajas desactivan un cliente para nuevos periodos, sin borrar sus históricos.

MST 04. Plan, alojamiento, pertenencia al proyecto y complejidad deben admitir vigencia. Una migración OP a CLOUD cambia desde su fecha efectiva; no convierte en SaaS todos los incidentes de infraestructura de años anteriores. Guardar hitos de arranque, migración cloud y cambio mayor de versión para anotar las curvas. Esta capacidad explica picos; una exclusión automática del semáforo por arranque queda pendiente de aprobación.

## Personal unificado

MST 05. Unir PERSONAL y PERSONAL PMO. Campos: identificador interno, nombre, ID y nombre Zendesk, nombre o ID Wrike, alias o correo PAP, nivel, equipo, pertenece a PMO y rol PMO. Los roles iniciales encontrados son ANA y DEV. Unificar por identidad validada; no por coincidencia parcial de nombre. Hay 75 filas de personal y 17 filas del maestro PMO, no necesariamente 92 personas distintas.

MST 06. Equipo, nivel, pertenencia PMO y rol tendrán vigencia para atribuir el trabajo según la fecha del registro. Los alias antiguos permanecen disponibles. Para el histórico inicial sin fecha de cambio se propondrá una vigencia inicial, señalada para revisión; no se reconstruirá una trayectoria laboral que no existe en la fuente.

## Usuarios contratados

USR 01. Matriz por cliente y año, con doce columnas mensuales. Son usuarios que pagan, no usuarios activos en la aplicación. Guardar un valor de stock por mes; nunca sumar enero a diciembre para mostrar usuarios a cierre.

USR 02. Precarga 2025: obtener el dato del libro, mantenerlo igual los doce meses y dejarlo cerrado después de la validación inicial. Precarga 2026: copiar 2025 y permitir cambios mensuales. Ejemplo: 65 hasta mayo; cambio efectivo junio a 68. La operación «aplicar desde este mes» cambia los meses posteriores salvo los que ya tengan un ajuste explícito, mostrando antes el resultado. También permitir editar un único mes.

USR 03. Solo el año natural en curso es editable en operación ordinaria. Los años anteriores se consultan. Una corrección histórica excepcional debe ser una reapertura por administrador, con motivo y auditoría, si Dennis aprueba esta posibilidad. En el cambio de año se propone copiar el diciembre anterior; no volver a copiar 2025 de forma fija.

USR 04. Un cero confirmado indica ausencia de usuarios facturables. Un dato sin informar es nulo. Ambos impiden dividir, con motivos diferentes. Las métricas acumuladas utilizarán usuarios mes para reflejar altas y bajas; el valor a cierre se conserva como otro campo visible. La edición de usuarios recalcula solo los periodos afectados y registra antes, después, autor y fecha.

## Usuarios por grupo y proyecto

USR 05. Calidad se calcula en ambos ámbitos. La matriz admite usuarios mensuales de proyecto; no copiar el total de grupo a cada uno. La suma al grupo solo es automática si se confirma que los usuarios de proyectos no se solapan. Conservar el total de grupo como dato independiente si puede haber usuarios compartidos y mostrar el denominador faltante en clientes/implantaciones sin dato. Usar Cliente como la identidad de organización Zendesk y su relación con Grupo Cliente; distinguir implantaciones adicionales solo cuando la fuente las identifique.

## Acciones disponibles

Dentro de Administración: crear, editar, buscar, desactivar, revisar cambios y asignar equivalencias. No hay una bandeja independiente de identidades pendientes. Mostrar cuántos registros y qué periodos resultan afectados antes de cambiar una equivalencia histórica. No permitir que dos ediciones concurrentes sobrescriban silenciosamente la matriz.

## Vistas Grupo Cliente y Cliente

MST 07. Reutilizar las vistas existentes indicadas por Dennis; no inventar un catálogo paralelo. Los adjuntos permiten definir la relación lógica: organization_id_zendesk y Organization_name_zendesk identifican Cliente, y la columna F del maestro indica Grupo Cliente. Wrike usa A/B y PAP I/J. Los nombres físicos y acceso a vistas SQL no se han proporcionado ni consultado.

MST 08. Configurar is_internal para VINCLE, VINCLE BUGS, VINCLE INFRAESTRUCTURAS y pruebas. Un nombre distinto de VINCLE no convierte automáticamente a VINCLE BUGS en cliente externo. Una organización repetida por varias filas PAP es el mismo Cliente. Existen organizaciones con varias implantaciones PAP; no prometer desglose de sus tiempos si el ticket no identifica la implantación.
