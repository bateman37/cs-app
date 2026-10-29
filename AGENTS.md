# Normas de CS App

Trabajar solo en bateman37/cs-app. Cuatro vistas: Comparativa, Análisis Cliente, Pulse Rent y Calidad. Administración reúne maestros, personal, usuarios, cargas y parámetros. Backlog, Client Health, diagnóstico y bugs son apartados de Calidad.

## Lectura y documentación

Leer este archivo, CLAUDE.md, docs/00-index.md, docs/plan/estado.md y el prompt activo. Después, solo los contratos indicados por el índice. Los contratos temáticos son la fuente vigente; DEC-003 de v0.4 modifica DEC-002 y DEC-001. Las evidencias y decisiones históricas no sustituyen al contrato. No cargar todo el árbol en cada tarea.

Archivar cada prompt literal y versionado antes de trabajar. CSAPP-DOC-00-v1 es exclusivamente documental y no consume ninguna de las diez entregas CSAPP-01 a CSAPP-10. En DOC-00 solo modificar Markdown documental; nada de aplicación, configuración ejecutable, dependencias, migraciones, SQL, semillas o cargas. No iniciar CSAPP-01 por iniciativa propia.

## Reglas de negocio

Conservar tickets sin horas para Calidad. Conservar Sistemas del Cliente, Uso Indebido y PAP origen cliente en las magnitudes, explicando su origen. Un PAP es correctivo si cualquiera de sus causas lo es; contar su ID una vez. Una etiqueta orienta a revisar pruebas, pero no demuestra que faltaran.

Usar los dos niveles Grupo Cliente y Cliente. Usuarios mensuales por ámbito; el grupo conserva su total propio cuando hay usuarios compartidos. No duplicar ingresos agrupados ni inventar un reparto por implantación. Organizaciones internas, incluidas VINCLE BUGS y pruebas, no son clientes externos.

El único perfil vigente de tickets tiene ticket_id, organization_id, Entorno y Tipología, CausaRaiz(Agr), tags, fecha_creación, type y status. Versionar por ticket_id. Activos: new/open/pending/hold; solved y closed separados fuera del backlog activo. El estado es una observación, no una fecha de cierre ni la duración en ese estado. Ver contrato de backlog para cortes e historia.

Bugs VFS y VSW se cargan por separado por Dennis. Contar Work Item Type=Bug_. PR es desarrollo terminado en rama, pendiente de crear la pull request. Ready for Release no prueba despliegue. No cerrar ni borrar por ausencia en otro export. Usar vínculos explícitos a tickets; no buscar BUG en descripciones ni adivinar clientes por títulos. El sexto numerador aprobado es la unión de problemas externos vinculados a Bug_ o con causa estándar, sin duplicar IDs.

Mantener seis indicadores. Incidentes y problemas incorpora volumen y backlog envejecido, con incidentes y problemas diferenciados. El stock usa usuarios al corte; el flujo usa exposición del periodo. No sumar stocks y flujos ni inventar historia de estados anterior a las observaciones. Umbrales y composición pendientes de calibrar se marcan como propuestas; no generar un verde por falta de configuración o de datos.

Vta Potencial es ingreso anual realizado más cartera casi confirmada. Diferencia compara contra Budget y se guarda separada. SOPORTE, ADMIN_DELEGADA y OTROS sustituyen año/categoría atómicamente. Mes parcial: anual/12 por día/días reales. Objetivo inicial 550 euros por jornada de 8 horas. PMO desde 2025 solo Wrike; antes Zendesk.

Seis pesos iniciales iguales exactos, total 100. Sin Client Health, los otros cinco pesan 20 por ciento. Modo personalizado exige suma exacta de 100. Pesos, umbrales y referencias se configuran en Administración; nombres completos, sin códigos Q ambiguos.

## Entregas

Una rama y PR por entrega, sin merge automático. Guardar el prompt completo; una corrección crea otra versión. No cambiar otros repositorios o bases. Respetar cambios locales ajenos. No precargar datos operativos reales ni ejecutar cargas: Dennis las probará cuando existan los importadores. Maestros y financieros anteriores a 2025 solo según la política documentada; tampoco se cargan en DOC-00.

No versionar secretos, archivos fuente o libros descifrados. No ejecutar HTML ni seguir enlaces durante importaciones. Resúmenes y avisos dentro de Cargas, sin bandeja independiente. No declarar pruebas, PR o despliegue que no se hayan realizado. Mantener estado y documentación del módulo cambiado.
