# Estado de CS App

Actualizado el 29 de octubre de 2026 tras ejecutar [CSAPP-DOC-00-v1](../../prompts/CSAPP-DOC-00-v1.md) y [CSAPP-01-v1](../../prompts/CSAPP-01-v1.md).

## Resultado de CSAPP-DOC-00

| Dato | Valor |
| --- | --- |
| Alcance | Exclusivamente documental; fuera de las diez entregas |
| Repositorio | https://github.com/bateman37/cs-app |
| Rama | claude/new-session-omvsmd (designada por la sesión; el prompt proponía docs/CSAPP-DOC-00-base-documental) |
| PR | https://github.com/bateman37/cs-app/pull/1 (sin fusionar); contenido en el commit b8d90df |
| Repositorio previo | Solo un README de una línea; no había decisiones posteriores que conciliar |
| Contenido | Especificación v0.4 incorporada con sus rutas estables; prompt archivado byte a byte; roadmap ampliado con objetivo, alcance, lecturas, dependencias, aceptación y prueba manual por entrega; índice con propietario, IDs de regla y estado confirmado/propuesto |

Verificaciones documentales ejecutadas (comprobaciones locales de texto y enlaces, sin añadir scripts al proyecto): enlaces relativos e índices resuelven; todo archivo añadido o modificado es Markdown; el prompt archivado es idéntico al recibido; sin secretos, fuentes reales ni nombres de clientes; barrido de las contradicciones activas listadas en la sección 7 del prompt (ocho campos de tickets, sexto numerador, significado de PR, VFS/VSW separados, causas del cliente, backlog dentro de seis indicadores, pesos de 1/6, tres categorías por sustitución, cargas manuales de Dennis). Las correcciones de coherencia aplicadas al paquete: Wrike WRK 04 pasa de propuesta a confirmada; se retiran referencias activas a created_at, a una contraseña y a un nombre de organización; DEC 09 y DEC 11 se señalan como sustituidas; CSAPP-01 ya no vuelve a incorporar AGENTS/CLAUDE/índice/plantilla/prompt.

## Resultado de CSAPP-01 (base web, acceso y maestros de clientes)

| Dato | Valor |
| --- | --- |
| Rama | claude/new-session-omvsmd (designada por la sesión; el prompt proponía feature/CSAPP-01-base-y-clientes). Parte de la rama de DOC-00; su PR 1 ya se fusionó en main y se incorporó a esta rama con un merge, de modo que la PR de CSAPP-01 contiene solo esta entrega |
| PR | Ver el último apartado de este documento (sin fusionar) |
| Implementado | Next.js/Prisma/PostgreSQL; acceso local con Better Auth; perfiles Administrador y Consulta con autorización en servidor; Grupo Cliente, Cliente, implantaciones, equivalencias BC/Zendesk/Wrike/PAP, soporte/servidor/complejidad/producto con vigencias, hitos, catálogo de productos, auditoría atómica y control de versión; navegación con las cuatro vistas pendientes |
| Probado | Tipos, lint, 31 pruebas con PostgreSQL real, build, instalación limpia y 41 comprobaciones de extremo a extremo en Linux. Ver [validación](../validacion/csapp-01.md) |
| No probado | Windows/PowerShell; despliegue |
| Precarga | No realizada: no hay fuente privada en el entorno; los maestros están vacíos |
| Pendiente de Dennis | Revisar la PR, ejecutar la [guía](guia-powershell-csapp01.md) en Windows y facilitar el libro de maestros para la precarga |

Documentación: [base y setup](../arquitectura/base-web-y-setup.md), [modelo físico](../arquitectura/modelo-fisico-csapp01.md).

## Estado por trabajo

Niveles: diseñado, documentado, implementado, probado, aceptado. Un criterio de aceptación escrito no es una prueba ejecutada.

| Trabajo | Diseñado | Documentado | Implementado | Probado | Aceptado |
| --- | --- | --- | --- | --- | --- |
| CSAPP-DOC-00 | Sí | Sí (PR pendiente de revisión) | No aplica | Solo verificaciones documentales | No |
| CSAPP-01 | Sí | Sí | Sí (PR sin fusionar) | Sí en Linux; Windows sin probar | No |
| CSAPP-02 a CSAPP-10 | Sí, en [roadmap](roadmap.md) y contratos | Sí | No | No | No |
| Cargas reales | — | Política en [precarga y pruebas](precarga-y-pruebas.md) | No | No | No; las probará Dennis |

CSAPP-02 a CSAPP-10 siguen sin iniciar y sin prompt redactado. La próxima acción es revisar la PR de CSAPP-01 y enviar el prompt de CSAPP-02.

## Vigente

Tickets con ocho campos/status, sexto indicador aprobado, PR aclarado, bugs VFS/VSW separados, backlog dentro de Incidentes y problemas. Parámetros por calibrar: ver [pendientes](../decisiones/pendientes.md). problem_id y fechas de resolución son enriquecimientos futuros, no campos existentes. No volver a pedir las decisiones resueltas.

No se han ejecutado cargas ni precargas. No se afirma conciliación ni benchmark de software.
