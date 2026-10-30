# Índice de prompts

| ID y versión | Alcance | Estado |
| --- | --- | --- |
| [CSAPP-DOC-00-v1](CSAPP-DOC-00-v1.md) | Incorporación exclusivamente documental, fuera de las diez entregas | Ejecutado; rama claude/new-session-omvsmd; [PR 1](https://github.com/bateman37/cs-app/pull/1) sin fusionar |
| [CSAPP-01-v1](CSAPP-01-v1.md) | Base web, acceso y maestros de clientes | Ejecutado; rama claude/new-session-omvsmd; [PR 2](https://github.com/bateman37/cs-app/pull/2) fusionada |
| [CSAPP-02-v1](CSAPP-02-v1.md) | Personal, usuarios mensuales y motor común de cargas | Ejecutado; rama claude/new-session-omvsmd (parte del main tras fusionar la PR 2); [PR 3](https://github.com/bateman37/cs-app/pull/3) fusionada |
| [CSAPP-03-v1](CSAPP-03-v1.md) | Importadores operativos de tickets y tiempos Zendesk | Ejecutado; rama claude/new-session-omvsmd (reiniciada desde main tras fusionar la PR 3); [PR 4](https://github.com/bateman37/cs-app/pull/4) fusionada (merge 3c08fc0; ver [estado](../docs/plan/estado.md)) |
| [CSAPP-04-v1](CSAPP-04-v1.md) | Wrike, PAP y bugs de producto VFS/VSW, con corrección de registros sin ID | Ejecutado; rama claude/new-session-omvsmd (reiniciada desde main 3c08fc0 tras fusionar la PR 4); [PR 5](https://github.com/bateman37/cs-app/pull/5) fusionada en main (merge 24d3658; esto confirma integración en Git, no aceptación manual de Dennis) (ver [estado](../docs/plan/estado.md)) |
| [CSAPP-05-v1](CSAPP-05-v1.md) | Facturación anual (tres perfiles financieros) y motor económico, con equivalencias Wrike/PAP a Grupo | Ejecutado; rama feature/CSAPP-05-finanzas-motor-economico (desde main 24d3658, merge de la PR 5 de CSAPP-04, fusionada según Git); PR sin fusionar (ver [estado](../docs/plan/estado.md)) |
| CSAPP-06 a CSAPP-10 | Implementación según roadmap | Sin redactar ni ejecutar |

Guardar cada prompt íntegro antes de trabajar, sin sustituirlo por resumen. Revisiones crean v2, v3 y enlazan su origen; no sobrescribir una versión ejecutada. Tras ejecutar, registrar rama, commit y PR reales en estado, sin fusionar automáticamente.

No redactar diez prompts definitivos prematuros. El [roadmap](../docs/plan/roadmap.md) contiene funcionalidad y aceptación; cada futuro prompt será medio/largo y leerá solo contratos relevantes. [_plantilla.md](_plantilla.md) es para implementación posterior, no autoriza escribir código en DOC-00.
