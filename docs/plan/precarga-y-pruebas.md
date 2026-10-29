# Precarga y pruebas de carga de Dennis

## Datos iniciales

| Fuente | Estado de la base de trabajo de Dennis |
| --- | --- |
| Clientes y personal | Se pueden precargar desde los maestros del libro, consolidados y editables |
| Usuarios 2025 | Precarga constante los doce meses, a validar |
| Usuarios 2026 | Copia de 2025 editable por mes según las reglas del maestro |
| DATA ZENDESK TIME | Vacía hasta que Dennis pruebe la carga |
| Tickets: perfil vigente de ocho campos con status | Vacías hasta que Dennis pruebe la carga |
| DATA WRIKE | Vacía hasta que Dennis pruebe el CSV |
| PAP | Carga manual por Dennis; no inyectar automáticamente datos reales |
| Bugs VFS y VSW | Carga manual de ambos CSV por Dennis; no precargar sus filas reales |
| Facturación anterior a 2025 | Se pueden precargar años existentes del libro, sin inventar categorías ausentes |
| Facturación 2025 y 2026 | Dennis carga cada año completo y las categorías correspondientes |

No hay una entrega de migración masiva de tiempos o tickets. Los hechos se incorporan al probar sus importadores, manteniendo los años incluidos en el fichero que Dennis seleccione. Dejar un resumen de datos presentes y de fuentes todavía no cargadas.

## Comprobaciones progresivas

Tras entrega 03: Dennis carga tickets y tiempos, repite ficheros y comprueba que no se duplican. Tras 04: prueba Wrike, PAP y ambos CSV de bugs. Tras 05: carga soporte, administración delegada y OTROS de 2025/2026. Repetir una categoría y año con un fichero revisado prueba la sustitución: cambian los importes, desaparecen filas ausentes del nuevo archivo y permanecen los demás años y categorías.

Los datos de prueba automatizada viven en fixtures y una base de test separada. No sembrar registros sintéticos en las tablas de trabajo de Dennis. Si necesita un juego demostrativo, ofrecerlo mediante una acción explícita y un ámbito aislado, sin contaminar los informes reales.

No borrar automáticamente datos cargados por Dennis al ejecutar seed, instalar una actualización o arrancar la aplicación. El seed de maestros debe ser idempotente y respetar modificaciones del administrador.

En DOC-00 no se ejecuta ninguna precarga, ni siquiera maestros: solo se documenta la política para entregas futuras. Los CSV de producto aportados, incluido el VSW de varios años, son ejemplos de formato; Dennis realizará las cargas VFS y VSW desde Administración cuando corresponda. No ejecutar semillas o importadores al incorporar este paquete.
