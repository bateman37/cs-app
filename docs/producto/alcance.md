# Alcance funcional de CS App

## Cuatro vistas de negocio

| Vista | Función |
| --- | --- |
| Comparativa | Cartera, horas, ingreso imputado, euros por jornada, objetivos y comparables |
| Análisis Cliente | Ficha individual, evolución, dedicación, PAP, tickets y desgloses |
| Pulse Rent | Métricas por usuario, medias, medianas y percentiles |
| Calidad | Seis indicadores, semáforo, evolución, origen y matriz rellenable de Client Health |

El resto pertenece a un panel de Administración: maestros, equivalencias, proyectos, personal, usuarios mensuales, cargas, configuración y permisos. El detalle se abre como tabla o pestaña dentro de las vistas; no se convierte en un quinto módulo. Client Health es Client Health dentro de Calidad, no otro panel principal.

## Ámbito de análisis

La rentabilidad se presenta por grupo BC cuando la facturación solo existe agrupada. Calidad utiliza los dos niveles existentes Grupo Cliente y Cliente, y desglosa implantación cuando la fuente lo permite. Un proyecto dispone de sus identidades de origen y usuarios; si no se puede atribuir un registro o denominador al proyecto, no se inventa un reparto. Un dato financiero de grupo no se replica en cada proyecto.

Los filtros incluyen año, mes, día de corte, mes en curso o mes completo, cliente, proyecto, soporte, alojamiento, producto y complejidad. La aplicación abre el mes en curso. El objetivo económico inicial es 550 euros por jornada de ocho horas, configurable en Administración.

## Fuentes y operativa

Importar ficheros descargados de Zendesk, Wrike, Power BI y PAP. No es necesaria integración API en la primera versión. Todos los registros idénticos de una fuente se incorporan una vez. Las tres categorías financieras sustituyen por año y categoría. Los descartes y avisos se resumen en cada carga, sin una bandeja de trabajo independiente.

Las pruebas de los grandes ficheros operativos las hará Dennis desde la pantalla de carga. Solo se permite precargar maestros y datos financieros históricos autorizados, según la política de precarga.

## Presentación

Interfaz web en castellano, formatos españoles y Europe/Madrid. Aplicar marca Vincle con #1f18c0, negro y acentos #dbba12. Los colores de estado llevan texto. Las tablas permiten filtrar, ordenar, configurar columnas, exportar y abrir detalle. Conservar filtros al navegar entre cartera y ficha. La documentación y los prompts se mantienen en bateman37/cs-app con índice por módulos.

## Diagnóstico y bugs

Los datos de causas del cliente permanecen en el análisis. Calidad incorpora el diagnóstico por origen y los listados VFS/VSW dentro de la misma vista, sin crear más módulos principales. Contar tickets sin horas. Los bugs centrales internos no se asignan a todos los clientes; se usan vínculos explícitos cuando existen y causa estándar como otra evidencia separada.

## Revisión v0.4

El backlog y antigüedad de incidentes/problemas se analizan dentro de Calidad, sin aumentar sus seis indicadores. Status viene en el único perfil vigente de tickets; formatos previos sustituidos. El sexto numerador ya está aprobado. El arranque CSAPP-DOC-00 es exclusivamente documental y queda fuera de las diez entregas, sin código o cargas.
