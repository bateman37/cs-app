# DEC-003: estado, backlog y arranque documental

Fecha: 29 de octubre de 2026. Estado: decisiones confirmadas por Dennis salvo las propuestas indicadas. Prevalece sobre DEC-002 y DEC-001 donde exista cambio. La versión v0.4 se incorpora mediante una tarea exclusivamente documental, fuera de CSAPP-01 a CSAPP-10.

## Confirmado

1. DATA ZENDESK TICKET_TAG_CREATED_TYPE_STATUS.xlsx sustituye los exports anteriores de tickets. Ocho columnas obligatorias de estructura, con valores opcionales solo cuando lo permita el contrato. No implementar perfiles antiguos como compatibilidad inicial. Los tiempos Zendesk siguen siendo otra fuente.
2. Los tickets sin horas sirven para Calidad. El estado permite analizar tickets todavía no resueltos y su antigüedad, separando incidentes de problemas. Los primeros indican afectación directa pendiente; los segundos necesidad de solución definitiva y posible ruido/workarounds. No inventar cuántos workarounds ha habido.
3. Este análisis forma parte del indicador Incidentes y problemas y de su detalle dentro de Calidad. Se mantienen seis indicadores y pesos iguales, no siete.
4. Queda aprobado el sexto numerador: problemas únicos de cliente externo con vínculo explícito a Bug_ o causa raíz estándar. La unión cuenta cada problema una vez; bugs únicos del producto son contexto separado.
5. PR en VSW significa desarrollo finalizado en la rama de desarrollo, pendiente de crear la pull request. No significa PR ya abierta, revisión completada, merge o despliegue.
6. Dennis hará las cargas de bugs, separadas para VFS y VSW. Los CSV aportados son muestras para contratar el formato, no cargas automáticas ni garantía de que cualquier vista esté completa.
7. La vista VSW más amplia sustituye al ejemplo VSW anterior en la evidencia activa. Contiene registros de 2025 y 2026; filtrar por las fechas reales, no descartar 2025 por el nombre o la descripción del archivo.
8. DOC-00 incorpora documentación, contratos, roadmap, instrucciones e índices en cs-app. Ninguna línea de código de aplicación, dependencias, bases, migraciones o importaciones en esta tarea. No iniciar la primera entrega.

## Límites de los datos

Status informa el estado observado. No hay fecha de resolución, fecha de cierre, updated_at, historial de estados ni problem_id. Por tanto se puede medir antigüedad desde creación y stock observado, pero no duración en cada estado, tiempo real de resolución, cierres mensuales ni familias completas problema-incidentes. Las observaciones futuras permitirán historia observada desde entonces, sin inferir transiciones exactas entre extracciones.

## Propuestas que deben calibrarse

Activos iniciales new/open/pending/hold, separados de solved y closed, conforme al contrato de status. Umbrales de antigüedad distintos para incidente y problema, bandas, referencias y composición de su color se configuran en Administración. La propuesta funcional es que el envejecimiento pueda empeorar el color aunque haya pocas altas recientes. No hay valores numéricos de umbral aprobados ni un SLA externo implícito.

## Documentos propietarios

- [Tickets](../importaciones/zendesk-tickets.md): perfil y revisiones.
- [Backlog](../producto/backlog-antiguedad.md): stock, antigüedad y cortes.
- [Producto](../importaciones/bugs-producto.md): CSV, estados y relaciones.
- [Calidad](../producto/calidad.md): seis indicadores.
- [Roadmap](../plan/roadmap.md): DOC-00 y diez entregas.
