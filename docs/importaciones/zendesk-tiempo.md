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
