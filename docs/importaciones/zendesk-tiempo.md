# Contrato de tiempos Zendesk

## Estructura

Columnas A a K comprobadas: ticket_id, user_id, user_name, date, hour, logged_hours, logged_minutes, Día de la semana, Segmentador app time, id y type. Conservar las once para la huella y auditoría; las columnas posteriores del libro son cálculos, no campos de entrada.

ZTM 01. Dedicación en horas = logged_hours + logged_minutes / 60. El campo hour es la hora del registro, no su duración. date es la fecha de trabajo. Un log de cero horas y cinco minutos equivale a 0,083333 horas, nunca a cinco horas. No usar el tipo del canal como nivel de soporte.

ZTM 02. Resolver persona por user_id cuando exista equivalencia; usar el nombre como alias secundario revisado. Resolver cliente por el ticket y su organization_id. Un ticket aún no cargado impide atribuir ese tiempo; se excluye temporalmente del cálculo, se resume en la carga y se reevalúa cuando llegue. Una persona o cliente desconocidos no se asignan a un valor de conveniencia.

## Cambio histórico de fuente

| Fecha del trabajo | Persona | Fuente elegible |
| --- | --- | --- |
| Antes de 2025-01-01 | Cualquier equipo | Zendesk |
| Desde 2025-01-01 | PMO | Wrike |
| Desde 2025-01-01 | Resto de equipos | Zendesk |

ZTM 03. Guardar las filas PMO de Zendesk posteriores al corte como excluidas por regla, para poder demostrar que no se han sumado dos veces. El criterio es la fecha del trabajo y pertenencia PMO vigente, no el año de importación. No aplicar este descarte a IT o Plataforma solo porque sean N3/N4. Un Wrike anterior al corte no sustituye a Zendesk.

ZTM 04. Clasificar por servicio, equipo, nivel, causa de ticket y producto mediante reglas versionadas. Si no se puede determinar la pertenencia PMO, la fila queda pendiente de elegibilidad; no considerarla automáticamente CS.

## Duplicados y modificaciones

Se han encontrado 247140 filas, con 183 repeticiones exactas sobre las once columnas y 58372 filas sin id. Por tanto id no puede exigirse para todas las filas. La huella de fila es obligatoria y el uso de id como identidad de log requiere comprobar unicidad y semántica. El mismo ticket puede tener numerosos tiempos legítimos.

ZTM 05. Corregir una fila sin ID estable no se resuelve anexando automáticamente la nueva versión: se presenta el posible cambio para sustitución explícita o confirmación de que es otro trabajo. La aplicación debe informarlo y permitir resolverlo dentro del propio lote, sin una bandeja separada y sin alterar el archivo original. Mantener trazabilidad hasta la fila y lote.

## Resultado de la carga

Mostrar horas recibidas, deduplicadas, elegibles, excluidas por PMO, sin ticket, sin persona y sin cliente. La suma de esas categorías debe explicar el total original. Las horas excluidas de una vista permanecen consultables. No conciliar el total bruto de todos los años con solo el subtotal de soporte de un cierre.

## Implementación en CSAPP-03

Implementado y probado en Linux; detalle técnico en [importadores Zendesk](../arquitectura/zendesk-csapp03.md). Interpretaciones implementadas **pendientes de aceptación por Dennis**:

ZTM 06. Cada fila válida del lote cae en un único motivo principal (duplicada, pendiente de decisión, excluida por PMO, elegibilidad pendiente, sin ticket, ticket sin organización, organización sin Cliente, sin persona o atribuible); las demás circunstancias son indicadores que no suman horas. La suma de la partición reconcilia con las filas y horas válidas. Lo no atribuible se conserva y se distingue de un cero. Antes de 2025 la falta de persona impide atribuir pero no prohíbe la fuente Zendesk.

ZTM 07. Una posible corrección es una fila con el mismo `id` y el mismo contexto de trabajo (ticket, persona y día) que un registro activo y contenido distinto. Se advierte; hasta que el Administrador decida (corrige ese registro, o es otro trabajo) la fila conserva su bruto y no añade horas, y el resto del lote se activa. La decisión se toma dentro de la ficha, antes de confirmar, y queda auditada con antes/después. Nunca se corrige por parecido ni sin `id`, y no se crea una bandeja masiva; los `id` vacíos no se revisan.

ZTM 08. Un tiempo recibido antes que su ticket, persona o equivalencia se conserva sin atribuir y se resuelve después: automáticamente al activar o revertir tickets, y con «Reprocesar» sobre el lote completado cuando se completan alias, equivalencias o vigencias. El recálculo no relee el archivo ni cambia fechas de trabajo; sus cambios quedan versionados en cada registro.
