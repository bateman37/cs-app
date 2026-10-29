# Decisiones abiertas y límites

## Resuelto

Tickets sin horas se conservan; se reutilizan Grupo Cliente y Cliente; las causas del cliente participan y se desglosan; el sexto numerador ha sido aprobado. PR significa desarrollo terminado en rama y pendiente de crear pull request. Existe status en el único export de tickets vigente. No volver a preguntar estos puntos.

## Parámetros por calibrar en Administración

Umbrales por KPI, referencias, mínimos de muestra y reglas del global. En Incidentes y problemas: antigüedad preocupante por tipo, bandas y composición entre volumen reciente y backlog. La propuesta está en el contrato de backlog. Deben distinguirse propuesta, configuración elegida y regla confirmada; no presentar cifras de ejemplo como aprobación de Dennis. Esto no bloquea DOC-00 ni la preparación de las cargas y vistas.

## Datos opcionales futuros

Fecha de resolución/cierre para medir cierres y tiempos de resolución; problem_id para relacionar incidentes hijos con problemas. Updated_at o una fecha de extracción fiable ayudarían a ordenar observaciones. Ninguno existe en el XLSX vigente. Guardar fecha de extracción declarada y fecha de importación por separado, sin deducir la primera de MAX(fecha_creación).

La relación bug-problemas-incidentes es parcial. La organización no registrada se resuelve mediante el maestro y el resumen de carga; no es un defecto de Calidad ni obliga a otra bandeja. En una implantación sin usuarios o sin clave de atribución, mostrar la cobertura real.

## Decisiones técnicas de la implementación

Versiones compatibles, lector XLSX y benchmark se verifican en CSAPP-01/02. La autenticación corporativa y el entorno de producción se concretan cuando corresponda, sin inventar SSO. DOC-00 documenta estas dependencias, sin instalar ni ejecutar nada.
