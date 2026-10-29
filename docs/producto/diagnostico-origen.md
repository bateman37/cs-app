# Diagnóstico del origen de calidad

## Qué mide cada dimensión

Mantener separadas fecha_creación, type, Entorno y Tipología y CausaRaiz(Agr). type distingue incident, problem, question y task. Entorno y Tipología dice dónde o sobre qué se notificó. La causa raíz registra el diagnóstico conocido. Un volumen alto en una tipología no prueba por sí mismo la causa final.

| Familia de diagnóstico | Causa registrada o señal | Acción orientativa |
| --- | --- | --- |
| Estándar del producto | Causa incidente_estándar_plataforma; vínculos explícitos a bugs como evidencia adicional separada | Priorizar corrección, versión y despliegue; revisar recurrencia |
| Configuración | Causa configuración; entorno/tipología con configuración como señal inicial | Revisar validación de configuración y pruebas de implantación |
| Personalización | Causa customización; tipologías de personalización | Revisar diseño, pruebas y regresión de la personalización |
| Integración y procesos | Causa integración/procesos; entorno servidor de integración | Revisar integraciones, datos de entrada y pruebas de extremo a extremo |
| Sistemas del Cliente | Causa incidente_sistemas_del_cliente y sus variantes de pregunta | Revisar contratos de datos, entradas y controles del sistema cliente |
| Uso indebido | Causa incidente_uso_indebido y sus variantes de pregunta | Revisar formación, adopción, claridad y uso del aplicativo |
| Infraestructura Vincle | Causa infraestructura y alojamiento CLOUD vigente | Revisar operación y fiabilidad del SaaS |
| Infraestructura del cliente | Causa infraestructura con alojamiento OP | Revisar su operación; mantenerlo distinto de SaaS y de Sistemas del Cliente |
| Otros o sin determinar | Hardware, no reproducido, sin informar u otras causas | Mantener visibles; no forzar responsabilidad ni convertirlo en cero |

DIA 01. Conservar los valores originales y un catálogo configurable de correspondencias. En los datos reales aparecen incidente_configuración_plataforma, incidente_customización_plataforma, incidente_integración/procesos, incidente_estándar_plataforma, incidente_sistemas_del_cliente, incidente_uso_indebido e incidente_infraestructura, entre otros. Los códigos de entorno observados contienen, por ejemplo, configuración o personalización, y no son el tipo nativo incident/problem.

DIA 02. Los conteos, horas, PAP y escalados atribuibles al cliente permanecen en el diagnóstico y en las magnitudes del semáforo. Un rojo indica necesidad de actuar, no culpabilidad automática de Vincle. Separar Sistemas del Cliente y Uso indebido porque sus actuaciones son distintas. No ocultar PAP origen cliente.

DIA 03. Crear una matriz type por familia de causa raíz y otra entorno/tipología por causa raíz. Mostrar conteos, horas y valores por usuario en el mismo periodo. Si entorno=personalización pero causa=estándar, conservar ambos ejes: el diagnóstico primario registrado es estándar y el entorno sigue siendo personalización.

DIA 04. «Posible problema de validación/pruebas» es una hipótesis orientada por configuración, personalización e integración. No etiquetar «faltan pruebas» como hecho demostrado sin una revisión de QA o evidencia de pruebas. Esa revisión se puede registrar como nota, sin incorporar gestión completa de QA a la primera versión.

DIA 05. Un enlace de un ticket a Bug_ y una causa raíz de uso indebido son dos evidencias que pueden entrar en conflicto. Mostrar ambas y orientar a revisión, sin reemplazar silenciosamente la causa por estándar. Un PAP con varias causas conserva sus pertenencias; su total se cuenta por ID único.

DIA 06. Mes en curso: usar el corte común y normalización por usuarios/exposición, además de números absolutos. Agrupar tickets por creación; no presentar ese gráfico como tickets cerrados del mes. Status ya está disponible. Para contar cierres/resoluciones por mes falta su fecha, y no hay historial para reconstruir transiciones. Bugs abiertos del producto son una fotografía y llevan su propia fecha de observación, no se suman al volumen de tickets creado ese mes.

DIA 07. Añadir edad y estado no resuelto a las matrices de incidentes y problemas. El origen explica la acción, pero no elimina del stock Sistemas del Cliente o Uso Indebido. Un incidente antiguo abierto merece atención aunque no haya altas nuevas; un problema antiguo pendiente se analiza como necesidad de solución definitiva, sin asumir una frecuencia de afectación o de workarounds que no consta.
