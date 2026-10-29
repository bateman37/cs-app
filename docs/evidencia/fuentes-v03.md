# Inspección de las tres fuentes nuevas

> Registro histórico. En reglas modificadas prevalecen DEC-003 y los contratos temáticos v0.4. Los formatos antiguos de tickets y la propuesta pendiente del sexto indicador están sustituidos. No usar esta evidencia como perfil vigente.

## Tickets Zendesk

DATA ZENDESK TICKET_TAG_CREATED_TYPE.xlsx tiene siete campos y 113856 ticket_id únicos. El tipo nativo está completo: 71006 task, 33637 incident, 6271 question y 2942 problem. fecha_creación está informada, con registros observados entre 15 de septiembre de 2021 y 27 de octubre de 2026. No hay columna de descripción, estado, fecha de cierre o problem_id.

El valor incidente_estándar_plataforma aparece en 94 tickets del export: 27 problemas internos, 23 problemas de clientes registrados, 42 incidentes de clientes registrados y 2 incidentes de organizaciones sin equivalencia en el maestro histórico. Es evidencia del fichero y maestro aportados, no un total filtrado de producción actual ni un número de bugs únicos o cerrados.

## Exportaciones de producto

| Archivo | Filas | Bug_ | Otros tipos |
| --- | --- | --- | --- |
| VFS Creado CS | 82 | 79 | 2 Request y 1 Enhancement |
| VSW Vista CS | 53 | 45 | 8 Request |

Entre los 124 Bug_, hay 82 Done (Ready for Release), 30 New, 4 In Progress, 3 Selected, 3 Blocked y 2 PR. Los cinco Done del CSV VSW son Request, no Bug_. Estos estados describen la lista aportada y no una fecha de despliegue por cliente.

Ambos CSV tienen Zendesk Ticket ID informado en todas sus filas. Para Bug_: VFS enlaza directamente 30 tickets de cliente y 49 internos; VSW, 9 de cliente y 36 internos. Se han identificado además 7 Bug_ VSW con URLs explícitas de 10 tickets de clientes en Clients. El campo también contiene nombres, versiones, texto HTML y menciones. No todo su contenido es una relación estructurada completa.

Las organizaciones internas detectadas en el maestro incluyen VINCLE, VINCLE BUGS, VINCLE INFRAESTRUCTURAS y una organización de pruebas. Comparar solo el nombre VINCLE habría confundido VINCLE BUGS con un cliente externo; la aplicación requiere un indicador de organización interna explícito.

## Jerarquía existente

El maestro incluye varios clientes/organizaciones por grupo: grupos de ejemplo con dos, seis y cinco organizaciones, respectivamente. La relación Zendesk se toma de organization_id_zendesk, Organization_name_zendesk y su GRUPO CLIENTE VINCLE de la columna F; Wrike usa A/B y PAP I/J. Los duplicados de búsqueda no crean clientes nuevos. Una organización puede tener varios nombres PAP, por lo que no se equipara automáticamente una fila PAP a un cliente nuevo.

## Límites de la evidencia

No se ha probado que todos los clientes afectados por todos los bugs estén vinculados. No existe enlace incidente-problema en el XLSX. No se pueden fechar cierres usando Changed Date. Los conteos no justifican por sí solos ausencia de pruebas o culpabilidad. Son resultados de inspección estructural y cruce de IDs de los adjuntos, sin modificar originales ni cargar la base de la aplicación.
