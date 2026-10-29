# Diagnóstico de calidad y nueva evidencia de bugs

> Registro histórico. En reglas modificadas prevalecen DEC-003 y los contratos temáticos v0.4. Los formatos antiguos de tickets y la propuesta pendiente del sexto indicador están sustituidos. No usar esta evidencia como perfil vigente.

Fecha 29 de octubre de 2026. Fuente: última aclaración de Dennis y los tres nuevos archivos adjuntos. Prevalece sobre DEC 001 en sus reglas de exclusión de causas de cliente y búsqueda de BUG en descripción.

## Decisiones confirmadas

- Los tickets sin dedicación se conservan para Calidad. No aportan horas, pero sí pueden aportar incidentes, problemas, escalados y afectación por estándar.
- Reutilizar los dos niveles Grupo Cliente y Cliente. Los usuarios se pueden registrar mensualmente a esos niveles; no se suman automáticamente si hay personas compartidas. Las implantaciones adicionales requieren clave real en la fuente.
- No excluir del diagnóstico las causas Sistemas del Cliente o Uso indebido. Mantener su carga y distinguir el origen. Esta instrucción reemplaza también la exclusión anterior de PAP origen cliente del semáforo.
- La creación del bug central puede pertenecer a una organización interna VINCLE. La afectación del cliente se gestiona en problemas del cliente y sus incidentes. Se retira la regla anterior de palabra BUG más problema más organización externa.
- Los exports de VFS y VSW representan la lista de trabajo de bugs que Dennis quiere analizar como abiertos. Conservar los estados de desarrollo y mostrar las etapas; no interpretar Ready for Release como ya desplegado al cliente.
- Una causa raíz estándar en un problema de cliente aporta evidencia de afectación de producto. No equivale al número de bugs únicos ni revela por sí misma el día de cierre del bug.
- El diagnóstico debe distinguir estándar, implantación/validación, infraestructura SaaS, sistemas del cliente y uso/formación. Una alta señal de configuración/personalización/integración orienta una revisión de pruebas; no demuestra por sí sola que no se ejecutaran pruebas.

## Propuestas operativas de esta revisión

Usar nombres completos: Client Health, Dedicación, PAP correctivos, Escalados N3, Incidentes y problemas, Bugs y afectación del estándar. Dedicación toma como base todas las horas elegibles ya presentes en el análisis original: CS N1, CS N2, PMO, IT y Plataforma, con desglose y selector de equipos en Administración. Se deja explícita esta interpretación para que Dennis pueda ajustarla, sin volver a usar el código Q1.

El sexto semáforo se propone sobre problemas de cliente con afectación confirmada del estándar por causa raíz o vínculo explícito a un Bug_ de producto. El número de bugs únicos y la lista abierta del producto se muestran por separado. Esa propuesta de numerador está pendiente, no es una regla ya aprobada.

No cambia lo acordado sobre cuatro vistas, Administración, diez entregas, pesos iguales, prorrateo del mes, sustitución anual financiera ni pruebas manuales de carga.
