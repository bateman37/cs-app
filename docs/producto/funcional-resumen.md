# Funcional de CS App

Versión 0.4 del 29 de octubre de 2026. Destino: https://github.com/bateman37/cs-app. Cuatro vistas de negocio, Administración y diez entregas. Arquitectura web Next.js/React/TypeScript, PostgreSQL y Prisma. Esta revisión prepara el diseño; no ha implementado la aplicación ni modificado el remoto.

## Las cuatro vistas

| Vista | Contenido |
| --- | --- |
| Comparativa | Horas, ingresos, euros por jornada y desviaciones; mes actual, anterior, CUM y año anterior completo/comparable |
| Análisis Cliente | Ficha, curvas, equipos, causas, PAP, tickets y detalle que explica las cifras |
| Pulse Rent | Indicadores por usuario, media, mediana y percentiles P10 P25 P75 P90 |
| Calidad | Seis indicadores, Client Health, diagnóstico, backlog/antigüedad y contexto de bugs VFS/VSW |

Maestros, cargas, usuarios y configuración pertenecen a Administración. Client Health y diagnóstico son apartados de Calidad. El análisis detallado se abre desde las vistas existentes.

## Grupo Cliente y Cliente

Usar los dos niveles existentes, con las equivalencias BC/Zendesk/Wrike/PAP del maestro. La organización Zendesk identifica Cliente y su grupo BC permite la agregación económica. Por ejemplo, el maestro ya agrupa organizaciones de distintos países o implantaciones bajo un mismo grupo. No crear un catálogo paralelo.

Los usuarios se mantienen mensualmente por ámbito. Si una persona pertenece a varias implantaciones, el total del grupo no se obtiene sumando sin más los clientes: se conserva su total propio. El ingreso agrupado de BC no se copia en cada cliente. El detalle de implantación adicional solo se ofrece cuando la fuente lo identifica.

## Seis indicadores con nombres completos

| Indicador | Regla |
| --- | --- |
| Client Health | Feedback mensual positivo, negativo, mixto o sin dato; nota y autor |
| Dedicación | Horas por usuario, con N1, N2, PMO, IT y Plataforma desglosados; equipos configurables |
| PAP correctivos | PAP único si cualquiera de sus causas es correctiva, conservando también el origen cliente |
| Escalados N3 | Tickets únicos con tags PMO/IT, asignados al mes de creación |
| Incidentes y problemas | Tipo nativo incident/problem: volumen y backlog no resuelto por antigüedad, todos los orígenes, sin exigir horas |
| Bugs y afectación del estándar | Aprobado: problemas de cliente con vínculo explícito a Bug_ o causa estándar; bugs únicos del producto aparte |

La etiqueta anterior Q1 significaba indicador de dedicación, no trimestre. La interfaz utilizará los nombres completos. La base de Dedicación mantiene las horas que ya contempla el Excel y permite ver cada equipo.

Los tickets sin tiempo se conservan para Calidad. No se excluyen los datos por ser Sistemas del Cliente, Uso indebido o PAP origen cliente. Un semáforo rojo significa que hace falta actuar; el diagnóstico dirá qué tipo de actuación corresponde.

## Diagnóstico del origen

| Familia | Qué orienta a revisar |
| --- | --- |
| Estándar del producto | Defectos, recurrencia, versión y entrega de correcciones |
| Configuración | Validación de configuración e implantación |
| Personalización | Diseño, pruebas y regresión de desarrollos personalizados |
| Integración y procesos | Integraciones, entradas y pruebas de extremo a extremo |
| Sistemas del Cliente | Datos o procesos incorrectos que llegan de sus sistemas |
| Uso indebido | Formación, adopción y claridad de uso |
| Infraestructura | Operación SaaS de Vincle en CLOUD; infraestructura propia en OP |
| Otros o sin determinar | Diagnósticos todavía no concluyentes, hardware u otras causas |

Tipo, entorno/tipología y causa raíz son dimensiones distintas. Si el entorno es configuración y la causa final estándar, se conservan ambos. Mucha configuración/personalización/integración señala dónde revisar pruebas y validación; no demuestra por sí sola que faltaran pruebas. Mostrar matriz de causas, horas y volumen por usuario para valorar la señal.

## Bugs de producto y clientes afectados

Se retira la regla anterior de buscar BUG en una descripción de cliente. Los CSV aportan Work Item ID, tipo, estado y Zendesk Ticket ID. En VSW, Clients contiene también enlaces a tickets. El bug central puede apuntar a VINCLE BUGS; los enlaces externos permiten conocer parte de su afectación.

VFS contiene 79 Bug_ entre 82 filas; el VSW ampliado, 128 Bug_ entre 145, con registros de 2025 y 2026. Request y Enhancement se conservan aparte. Los vínculos a clientes siguen siendo parciales. Dennis hará cargas separadas VFS y VSW desde Administración, sin precarga real.

Separar tres cifras: bugs únicos de producto abiertos en la lista aportada, bugs vinculados a cada cliente y problemas de cliente con causa estándar. Un bug puede afectar a varios clientes y producir varios problemas; no se suman como si fueran la misma unidad. Los nombres libres se revisan mediante equivalencias y los títulos no crean vínculos automáticos.

Para el sexto semáforo queda aprobado contar problemas únicos de cliente con vínculo explícito a Bug_ o causa estándar, sin duplicar los que cumplan ambas condiciones. Mostrar bugs únicos y backlog del producto como contexto separado.

PR significa desarrollo finalizado en rama, pendiente de crear la pull request. Ready for Release no acredita despliegue. El único XLSX vigente de tickets tiene ocho campos, incluido status, y sustituye los anteriores. Permite medir backlog observado y antigüedad desde creación, separando incidentes y problemas dentro de su indicador. Faltan fecha de resolución y problem_id: no reconstruir cierres mensuales ni familias completas. El stock no se limita a tickets creados en el mes; usar usuarios al corte y distinguirlo del flujo. Las reglas numéricas de antigüedad se configuran antes de activar su color, sin crear un séptimo peso.

## Configuración y pesos

Los seis indicadores mantienen el mismo peso exacto de un sexto y total del 100 por ciento. Sin Client Health, cinco pesos efectivos del 20 por ciento. El modo personalizado exige suma exacta de 100. Administración configura equipos, causas, referencias, umbrales y reglas del global. Los datos ausentes o las relaciones parciales se identifican; no se convierten en ceros silenciosos.

## Finanzas y cargas

Vta Potencial sigue siendo ingreso anual de facturado más cartera casi confirmada. Diferencia compara con Budget y se guarda aparte. Soporte, administración delegada y OTROS sustituyen íntegramente el año/categoría elegido, conservando otros ámbitos.

Mes en curso inicial, con ingreso mensual base por día de corte/días reales del mes. Euros por jornada = ingreso imputado/horas por ocho. Conservar media de cartera ponderada y el CUM anterior al mismo corte, separado del anterior completo.

Dennis prueba las cargas operativas, incluidos ambos CSV de bugs. No se precargan tiempos, tickets, Wrike o PAP en su base. Maestros y usuarios pueden prepararse; históricos financieros anteriores a 2025 pueden conservarse. Las cargas de 2025/2026 las hará Dennis. Resumen de cada lote con importados, revisados, duplicados y descartes; sin bandeja independiente.

## Diez entregas

| Entrega | Alcance |
| --- | --- |
| 01 | Base web, acceso, documentación y Grupo Cliente/Cliente |
| 02 | Personal, usuarios mensuales y motor común de cargas |
| 03 | Tickets con fecha/tipo/status y tiempos Zendesk |
| 04 | Wrike, PAP y bugs de producto VFS/VSW |
| 05 | Tres cargas financieras y cálculo económico |
| 06 | Comparativa y Análisis Cliente |
| 07 | Pulse Rent y configuración del administrador |
| 08 | Calidad, origen, Client Health, backlog y afectación de producto |
| 09 | Conciliación, volumen, exportaciones y recuperación |
| 10 | Aceptación, guías y despliegue autorizado |

Una rama y una PR por entrega, sin fusionar hasta revisión de Dennis. Cada prompt se guarda literalmente e indica qué documentos del índice leer. Los contratos nuevos de bugs y diagnóstico completan el diseño modular sin crear más entregas.

CSAPP-DOC-00, fuera de las diez entregas, incorpora exclusivamente documentación y el prompt literal. Nada de código, configuración ejecutable, bases o cargas. Este paquete aún no demuestra modificación del remoto. Las diez entregas mantienen su numeración y empiezan cuando Dennis envíe su prompt específico.
