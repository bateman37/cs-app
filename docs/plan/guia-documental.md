# Organización documental y lectura selectiva

## Principios

Un tema tiene un propietario documental: cálculos en su catálogo, cada importación en su contrato y cada vista en su funcional. Índices y resúmenes enlazan y no copian toda la regla. Los registros DEC explican cuándo se decidió; los contratos muestran la regla vigente. Las evidencias describen muestras y no crean reglas de negocio. Conservar enlaces relativos y rutas estables.

Piezas orientativas de 200 a 1000 palabras, salvo catálogos, roadmap o prompt completo que lo justifiquen. Si crecen, dividir por responsabilidad y enlazar, sin perder reglas ni crear un documento gigante. No dividir en decenas de archivos casi vacíos. Cada regla relevante mantiene ID, estado confirmado/propuesto y criterios de aceptación donde corresponda.

## Lectura por tarea

Siempre AGENTS, CLAUDE, índice, estado y prompt activo; después únicamente las rutas requeridas. Cambiar una importación exige proceso común, contrato de la fuente y decisiones que lo modifiquen. Cambiar un cálculo exige catálogo y vista afectada. No abrir todas las evidencias históricas por defecto ni pedir las hojas completas para una edición documental.

El roadmap debe indicar lecturas de entrada para cada entrega. No reinyectar esta especificación completa en los diez prompts: apuntar a contratos por ruta e ID y añadir solo decisiones nuevas. El arranque documental requiere una revisión global única; el trabajo ordinario es selectivo.

## Prompts y estado

Guardar el texto literal antes de trabajar en prompts/CSAPP-DOC-00-v1.md o prompts/CSAPP-XX-vN.md. No resumirlo ni reemplazar una versión ejecutada. El índice de prompts registra ID, versión, alcance, estado y PR real si existe. DOC-00 está fuera de las diez entregas y no autoriza implementación.

El estado diferencia diseñado, documentado, implementado, probado y aceptado. Un caso de aceptación escrito no es una prueba ejecutada. Un archivo entregado no prueba una PR. No copiar nombres de clientes/personas, fuentes brutas o secretos al repo para demostrar trazabilidad: usar referencias y conteos agregados.

## Precedencia

La instrucción más reciente confirmada por Dennis manda; DEC-003 v0.4 sustituye lo modificado de DEC-002/001 y los contratos reflejan esa revisión. Una propuesta técnica o de umbral sigue siendo propuesta hasta elegirla. Si el repositorio trae una decisión posterior al paquete, respetarla y documentar la conciliación; no aplicar versiones antiguas por tener más detalle.

## Rutas de entrada por entrega

Además de las entradas comunes y del apartado propio del roadmap:

| Entrega | Lecturas temáticas (rutas bajo docs/) |
| --- | --- |
| CSAPP-01 | producto/alcance.md; producto/maestros.md; arquitectura/propuesta.md; arquitectura/modelo.md |
| CSAPP-02 | producto/maestros.md; producto/administracion.md; importaciones/proceso-comun.md; plan/precarga-y-pruebas.md |
| CSAPP-03 | importaciones/zendesk-tickets.md; importaciones/zendesk-tiempo.md; importaciones/proceso-comun.md; arquitectura/modelo.md; producto/backlog-antiguedad.md |
| CSAPP-04 | importaciones/wrike.md; importaciones/pap.md; importaciones/bugs-producto.md; importaciones/proceso-comun.md; producto/diagnostico-origen.md |
| CSAPP-05 | importaciones/facturacion.md; calculos/catalogo.md; plan/precarga-y-pruebas.md; producto/comparativa.md; producto/administracion.md; arquitectura/finanzas-motor-csapp05.md |
| CSAPP-06 | producto/comparativa.md; producto/analisis-cliente.md; calculos/catalogo.md |
| CSAPP-07 | producto/pulse-rent.md; producto/administracion.md; calculos/catalogo.md |
| CSAPP-08 | producto/calidad.md; producto/backlog-antiguedad.md; producto/diagnostico-origen.md; calculos/catalogo.md; producto/administracion.md |
| CSAPP-09 | validacion/aceptacion.md; arquitectura/propuesta.md y modelo.md; contratos que revelen discrepancias |
| CSAPP-10 | plan/roadmap.md; plan/estado.md; validacion/aceptacion.md; guías operativas creadas durante la implementación |

Las rutas se resuelven desde el índice. Leer decisiones históricas únicamente para entender una divergencia. Las fuentes reales y la evidencia agregada se consultan cuando la entrega lo requiera, no como preámbulo fijo de cada tarea.
