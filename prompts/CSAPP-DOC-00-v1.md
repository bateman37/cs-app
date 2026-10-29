# CSAPP-DOC-00-v1 — Arranque documental de CS App

Repositorio único: https://github.com/bateman37/cs-app.
Tipo de encargo: exclusivamente documental, fuera de las diez entregas de implementación.
Entrada adjunta: CS_App_Especificacion_v0_4.zip, versión funcional 0.4 del 29 de octubre de 2026.
Rama propuesta: docs/CSAPP-DOC-00-base-documental.

Actúa como ingeniero responsable de incorporar y revisar la base documental del proyecto. Mi ayudante de ingeniería ha preparado el paquete adjunto a partir de nuestro Excel de Budget/Rentabilidad y los exports reales. Tú serás el programador cuando enviemos las entregas de implementación. En esta tarea debes dejar el repositorio documentado para trabajar después con contratos claros y lectura selectiva.

## 1. Resultado requerido y límite absoluto

Incorpora el contenido documental del ZIP al repositorio, revisa su coherencia con este encargo y deja una rama y una PR revisables. Archiva íntegramente este prompt en prompts/CSAPP-DOC-00-v1.md antes de trabajar; no lo resumas ni sustituyas por una referencia a la conversación. Si el adjunto ya contiene ese archivo, conserva exactamente sus bytes. Las versiones ejecutadas de prompts son inmutables.

No escribas ninguna línea de código de aplicación. No crees scaffold Next, rutas, componentes, endpoints, schemas Prisma, SQL, migraciones, semillas, fixtures ejecutables, tests de software, scripts, package.json, lockfiles, configuración de infraestructura, CI o Docker. No instales dependencias, arranques servicios, crees/conectes bases, importes datos, ejecutes macros o consultas IQY ni despliegues. No comiences CSAPP-01 ni redactes los diez prompts definitivos. El contenido añadido o modificado en Git debe ser Markdown documental; describir arquitectura y entidades en prosa/tablas no equivale a implementarlas.

Este trabajo no es la primera entrega ni reduce las diez previstas. El roadmap conserva CSAPP-01 a CSAPP-10. El resultado de DOC-00 es documentación incorporada y revisada, nunca aplicación implementada o probada.

## 2. Forma de trabajar en el repositorio

1. Confirma la identidad del repositorio y lee las instrucciones que ya existan. Examina README, AGENTS, CLAUDE y documentación previa antes de cambiarlos. Respeta trabajo local ajeno; si hace falta aislar tu trabajo, usa una rama o checkout separado. No cambies otros repositorios ni bases. Parte de la base actualizada pertinente, sin resets, limpieza destructiva ni reescritura de historia.
2. Lee el índice, estado y contratos del paquete. Extráelo a una ubicación de trabajo y copia únicamente los Markdown necesarios a sus rutas de destino. El ZIP contiene la especificación; los XLSX/CSV originales no son necesarios para esta tarea documental. Si el ZIP no estuviera disponible, solicita ese adjunto concreto y no recrees de memoria sus contratos.
3. Incorpora la documentación completa preservando los detalles funcionales, fórmulas, contratos y casos de aceptación. Puedes mejorar redacción, organización y enlaces. No reduzcas el paquete a un resumen ni añadas reglas de negocio para rellenar huecos. Si el repo ya documenta una decisión posterior confirmada, respétala y explica la conciliación; una propuesta antigua no prevalece por estar más desarrollada.
4. Mantén un único propietario por regla. Los contratos muestran la versión vigente; DEC registra cambios; evidencia describe muestras. Actualiza todos los puntos activos que contradigan este prompt. Los registros históricos pueden permanecer, señalados como sustituidos en lo modificado y fuera de la lectura ordinaria.
5. Comprueba el resultado documental y crea un commit y una PR solo de documentación, sin fusionarla. Si no existe acceso para abrir la PR, conserva el trabajo local y reporta el impedimento concreto sin afirmar que se ha publicado. No solicites aprobación adicional para la edición documental ya encargada.

No copies fuentes reales, contraseñas, tokens, .env, nombres de personas/clientes ni un libro descifrado al repositorio. Los conteos agregados y los nombres de columnas de la evidencia sí sirven como referencia. Conserva los originales del usuario fuera de Git.

## 3. Estructura y ahorro de contexto

Usa las rutas estables del ZIP. Como mínimo deben quedar README.md, AGENTS.md, CLAUDE.md y docs/00-index.md; carpetas docs/producto, docs/importaciones, docs/calculos, docs/arquitectura, docs/decisiones, docs/evidencia, docs/plan y docs/validacion; y prompts con índice, plantilla y este prompt literal.

Mantén el funcional sencillo como entrada para negocio, los contratos detallados por tema, el modelo lógico sin código, el roadmap, el estado real y los casos de aceptación. Incluye el contrato específico producto/backlog-antiguedad.md. No crees un único documento gigante que obligue a releer todo. Divide por responsabilidad cuando aporte claridad, sin fragmentar en archivos casi vacíos.

El índice debe permitir localizar propietario, regla y estado confirmado/propuesto. En la guía documental deja una tabla de lecturas mínimas por entrega. Para tareas futuras: leer AGENTS, CLAUDE, índice, estado y prompt activo; después solo los contratos aplicables. No exigir toda la evidencia histórica en cada prompt. Este arranque permite una revisión global única para detectar contradicciones.

AGENTS y CLAUDE deben ser breves y consistentes, con las restricciones del proyecto, precedencia de decisiones, archivo de prompts, política de cargas y lectura selectiva. No conviertas CLAUDE en una segunda copia del funcional. La documentación debe distinguir diseñado, documentado, implementado, probado y aceptado. Tener un criterio de aceptación escrito no significa que la prueba se haya ejecutado.

## 4. Producto y reglas confirmadas que debes preservar

### Cuatro vistas, Administración y dos ámbitos

Solo hay cuatro vistas principales: Comparativa, Análisis Cliente, Pulse Rent y Calidad. Maestros, personal, matriz de usuarios, importaciones, historial de cargas, pesos y umbrales pertenecen a Administración. Client Health, diagnóstico, bugs y backlog son apartados de Calidad. El análisis detallado se abre dentro de las vistas existentes.

Reutilizar los dos niveles Grupo Cliente y Cliente. Zendesk identifica la organización del Cliente y el maestro la relaciona con el grupo BC. El maestro original repite campos por BUSCARV; la aplicación tendrá identidades y equivalencias normalizadas. No crear un Cliente distinto por cada fila duplicada de PAP. Una implantación adicional requiere una clave real para atribuir sus hechos.

Rentabilidad se muestra por grupo BC cuando solo hay facturación agrupada. Calidad debe poder analizar Grupo Cliente y Cliente/implantación atribuible. Los usuarios mensuales se mantienen por ámbito. Una persona puede pertenecer a varias implantaciones: el total del grupo tendrá un valor propio para evitar duplicaciones. No copiar ingreso o usuarios del grupo en cada proyecto ni inventar repartos.

Maestro de clientes editable con equivalencias Zendesk/Wrike/PAP/BC, plan de soporte, CLOUD/OP, complejidad, producto e hitos. Unificar PERSONAL y PERSONAL PMO, conservando alias por sistema, equipo, nivel, pertenencia PMO y rol ANA/DEV. Cambios relevantes admiten vigencia y trazabilidad. Clientes nuevos sin equivalencia son una actualización normal del maestro, no un defecto de Calidad.

Usuarios 2025: precarga constante los doce meses, fija tras validación. 2026: copia inicial de 2025 editable por mes; ejemplo 65 hasta mayo y 68 desde junio. Solo el año en curso es editable ordinariamente; mantener historia. Stock de usuarios a cierre y exposición usuarios mes son magnitudes distintas.

### Comparativa, ficha y Pulse Rent

Comparativa incluye mes actual, mes anterior, CUM actual, anterior completo y anterior comparable hasta el mismo corte: horas, ingresos, euros por jornada, desviaciones contra objetivo y cartera filtrada. Añadir expresamente horas, facturación y rentabilidad CUM del año anterior comparable. Análisis Cliente explica las cifras con curvas, equipos, causas, PAP, tickets y detalle integrado.

Mes en curso por defecto y posibilidad de mes completo. Ingreso del mes a corte = ingreso anual / 12 por día de corte / días reales del mes. Rentabilidad = ingreso imputado / horas por jornada de 8 horas, con objetivo inicial 550 euros por jornada. Es rendimiento económico de dedicación, no un margen contable. Cartera filtrada = suma ingresos / suma horas por 8; nunca media simple de ratios. Mantener denominadores, cortes y cobertura explícitos.

Pulse Rent contiene el catálogo del paquete: métricas por usuario de CS N1/N2, PMO, variantes de incidente/soporte, tarifa, PAP, escalados y métricas económicas; media, mediana y percentiles P10/P25/P75/P90. El método y las condiciones de borde están en el catálogo. Mantener las cinco bandas históricas de Pulse Rent separadas de los tres colores de Calidad.

### Cargas y dedicación

Todos los importadores validan estructura por contenido, previsualizan, procesan archivos grandes con progreso y confirman de forma recuperable. Las filas fuente idénticas solo existen una vez; tickets y PAP con cambios son revisiones de su identidad. Los contratos distinguen entidades y registros de tiempo sin ID fiable. No deduplicar dedicaciones solo por ticket/persona/día.

Resumen de importados, actualizados, duplicados, descartados y avisos dentro de Cargas. Sin bandeja independiente de pendientes. Conservar el bruto para resolver relaciones al llegar otros maestros o fuentes. Un ticket sin horas se conserva para Calidad y no suma dedicación; una organización aún no identificada se informa sin asignarla por similitud.

Zendesk Time tiene once columnas fuente según su contrato. Horas PMO anteriores al 1 de enero de 2025: Zendesk; a partir de esa fecha: únicamente Wrike. El resto sigue Zendesk. Aplicar también al comparable anterior.

Wrike se lee como CSV original de seis columnas con comillas correctas. El export observado ya dice Dedicación (horas): no dividir entre 60 ni reproducir la macro sobre posiciones equivocadas. Ticket explícito válido primero; después inferencia inequívoca del nombre; sin ticket puede atribuirse al proyecto. No convertir versiones o cualquier número en ticket. Filas de tarea sin imputación no son horas.

PAP: 29 columnas fuente. Puede tener varias causas; si cualquiera es correctiva, el PAP es correctivo. Contar su identidad una vez y conservar todas las pertenencias. Mostrar origen cliente, sin eliminarlo del diagnóstico/magnitud según el contrato vigente. Resultado se conserva como filtro sin imponer OK. No añadir duración PAP a horas Zendesk/Wrike duplicando trabajo. No ejecutar IQY.

Finanzas: Vta Potencial es facturado más cartera casi confirmada. Diferencia compara contra Budget, se guarda separada y no se suma al ingreso. SOPORTE, ADMIN_DELEGADA y OTROS son snapshots anuales completos: cada carga reemplaza solo su año/categoría, de forma atómica, retirando las líneas ausentes y preservando otras categorías/años. Nunca sumar dos descargas acumuladas.

Dennis probará todas las cargas operativas, incluidos bugs VFS/VSW separados. No precargar Zendesk, Wrike, PAP o bugs reales. En entregas futuras se permiten maestros consolidados, usuarios e históricos financieros anteriores a 2025 según la política. Dennis cargará 2025 y 2026 y probará sustitución. En DOC-00 no se carga nada, incluidos maestros.

### Único perfil vigente de tickets

El nuevo DATA ZENDESK TICKET_TAG_CREATED_TYPE_STATUS.xlsx sustituye todas las versiones anteriores de tickets. Cabeceras: ticket_id, organization_id, Entorno y Tipología, CausaRaiz(Agr), tags, fecha_creación, type, status. No diseñar compatibilidad con perfiles previos de cuatro, cinco o siete campos. El nombre del archivo no es la validación; contenido y ocho cabeceras sí.

Type, entorno/tipología y causa raíz son dimensiones distintas. Versionar cambios de status, causa, tags y organización por ticket_id. Clasificar explícitamente organizaciones internas, incluidas VINCLE, VINCLE BUGS, VINCLE INFRAESTRUCTURAS y pruebas. No confundir un ticket central de producto con un cliente externo.

Escalados: team_n3_pmo y team_it son N3; team_n2 es N2; team_plataforma/team_plataformavfs, team_plataformaarq y team_plataformavsw son destinos N4. Contar IDs únicos en totales y permitir desglose por destinos. Sin fecha de evento, se usa el mes de creación con tags conocidos a la extracción, rotulado sin afirmar que el escalado ocurrió ese mes.

### Bugs VFS y VSW

Dos cargas independientes, con perfiles de columnas definidos en importaciones/bugs-producto.md, usando identidad de producto/ámbito y Work Item ID. Reimportar actualiza sin duplicar; cargar VSW no toca VFS. Solo Work Item Type=Bug_ cuenta como defecto; Request/Enhancement se conservan aparte. Los ejemplos son evidencia, no un inventario precargado ni garantía de cobertura completa.

La vista VSW ampliada tiene registros de 2025 y 2026; respetar sus fechas y el alcance declarado, sin exigir que un archivo sea de un único año. La ausencia de un bug en otra vista no lo borra ni lo cierra. Preservar estado, fotografía, alcance y fecha de observación. Una vista más estrecha no demuestra que los elementos ausentes se hayan resuelto.

PR significa desarrollo finalizado en la rama de desarrollo y pendiente de crear la pull request. No significa que la PR ya esté abierta. Done (Ready for Release) no demuestra despliegue al cliente. Preservar estados, configurar su interpretación y no inventar cierre/despliegue con Changed Date.

Relacionar por Zendesk Ticket ID y URLs explícitas de tickets dentro de Clients; esos vínculos son parciales. No ejecutar HTML ni visitar enlaces. Nombres libres o títulos no asignan todos los afectados. Un bug central VINCLE puede afectar a varios problemas/clientes y contener incidentes cuya relación hoy no tenemos completa. No clasificar por palabra BUG en una descripción ni por un tag bug genérico.

### Seis indicadores y diagnóstico de Calidad

| Indicador | Base funcional |
| --- | --- |
| Client Health | Matriz mensual enero-diciembre con feedback, comentario y autor; sin dato queda en blanco |
| Dedicación | Horas por usuario, equipos desglosados y selección configurable; no usar Q1 como etiqueta de trimestre |
| PAP correctivos | Identidades únicas con cualquier causa correctiva, conservando orígenes |
| Escalados N3 | Tickets únicos por usuario y destinos, por cohorte de creación |
| Incidentes y problemas | Volumen por creación y backlog no resuelto por antigüedad, diferenciados por tipo/origen |
| Bugs y afectación del estándar | Numerador aprobado: problemas únicos externos vinculados explícitamente a Bug_ o con causa estándar |

En el sexto indicador se hace unión, no suma: un problema con ambas evidencias o varios bugs cuenta una vez. Los bugs únicos del producto y su stock abierto son contexto separado; no sumar bugs, problemas e incidentes como si fueran lo mismo. Mantener cobertura de vínculos.

Seis pesos iniciales iguales exactos de 1/6; total 100 por ciento. No almacenar seis redondeos de 16,67 como si sumaran cien. Sin Client Health, los otros cinco pesan 20 por ciento. Pesos personalizados no negativos y suma exacta de 100. Otras fuentes ausentes no se convierten en cero ni en verde: mostrar cobertura y resultado parcial cuando proceda.

Pesos, umbrales, dirección, referencias, límites y reglas del global se administran en una página de configuración. Los límites numéricos aún no aprobados se identifican como pendientes de calibración; Claude no debe elegirlos como si fueran reglas de negocio confirmadas.

Calidad orienta a actuar y explica el origen: estándar del producto; configuración; personalización; integración/procesos; Sistemas del Cliente; Uso Indebido/formación; infraestructura SaaS en CLOUD cuando la causa es Infra; infraestructura del cliente en OP; otros/sin determinar. Horas, tickets y escalados de causas del cliente no se excluyen. Un rojo no significa culpabilidad automática de Vincle. Entorno de configuración/personalización/integración señala dónde revisar validación/pruebas, pero no prueba que faltaran pruebas.

### Backlog y antigüedad dentro de Incidentes y problemas

Status permite identificar no resueltos: new/open/pending/hold. Solved y closed son estados distintos, ambos fuera del backlog activo. Mantener valores desconocidos como cobertura no clasificada, con aviso. Diferenciar incidentes pendientes, con afectación directa, de problemas pendientes de solución definitiva; no inventar el número de workarounds o la frecuencia de afectación.

El stock actual incluye tickets antiguos aunque no se crearan en el mes seleccionado. Edad en días naturales desde creación al corte observado, no tiempo en el estado actual. Mostrar cantidad, bandas, mediana, P90, máximo y tasas por usuarios al corte, separadas por tipo y origen. No prorratear un stock a mitad de mes ni dividirlo por usuarios mes acumulados; el flujo de nuevas altas usa otra exposición y no se suma al stock.

Mantener seis indicadores. La propuesta a calibrar es que el envejecimiento pueda empeorar el color de Incidentes y problemas aunque haya pocas altas recientes, usando señales distintas de incidentes/problemas. Umbrales y composición se configuran; sin calibración mostrar magnitudes y sin calibrar, sin verde automático ni cifras de SLA inventadas.

Guardar estado observado y extracción declarada por separado de la importación. El archivo no contiene fecha de resolución/cierre, updated_at, problem_id ni historia de estados. Por tanto no permite cierres mensuales, tiempo de resolución, tiempo en cada estado ni backlog pasado anterior a observaciones compatibles. MAX(fecha_creación) no es fecha de extracción. Diferenciar cohorte histórica con estado conocido ahora de stock realmente observado en ese mes. Una actualización a solved elimina del stock de la nueva observación sin crear otro ticket ni inventar la fecha exacta de resolución.

## 5. Arquitectura a documentar, sin construir

Aplicación web Next.js/React/TypeScript, PostgreSQL independiente y Prisma, con módulos separados de dominio, importación, cálculo y UI. Desarrollo compatible con el entorno Windows y operación de Dennis. Versiones concretas y lector XLSX se verifican cuando toque, sin instalar ni fijar versiones por intuición ahora.

Documentar trabajo de importación en segundo plano, staging, progreso, activación atómica y recuperación; archivos grandes no se procesan como una petición que bloquee la interfaz. Modelo lógico con identidades, vigencias, usuarios mensuales, lotes, brutos, revisiones, observaciones de estado/tags, horas, ingresos, PAP, producto, vínculos, reglas y resultados reproducibles. No generar SQL o schema físico.

Permisos y auditoría desde la primera implementación; no asumir SSO corporativo que no se haya confirmado. Objetivos de rendimiento son propuestas para medir con datasets y equipo documentados, nunca benchmarks ya superados por tener diseño.

## 6. Roadmap cerrado en diez entregas

Conserva esta tabla dentro del roadmap y desarrolla cada entrega con objetivo, alcance, lecturas mínimas, dependencias, criterios de aceptación y prueba manual de Dennis. Una rama/PR por entrega; las correcciones pertenecen a la revisión de su entrega. No inventes una entrega adicional de históricos operativos.

| Entrega | Funcionalidad completa | Cierre exigido cuando se implemente |
| --- | --- | --- |
| CSAPP-01 | Base web, acceso, PostgreSQL propia, marca, navegación y maestros Grupo Cliente/Cliente/equivalencias | Arranque limpio, permisos, maestros editables y cuatro vistas identificadas sin métricas ficticias |
| CSAPP-02 | Personal unificado, matriz mensual de usuarios y motor común de cargas | Alias/roles, 65 a 68 desde junio sin alterar meses anteriores, progreso y activación recuperable |
| CSAPP-03 | Tickets canónicos con tags/creación/type/status y tiempos Zendesk | Revisiones/deduplicación, tickets sin horas, estado observado y corte PMO; Dennis prueba ambos XLSX |
| CSAPP-04 | Wrike, PAP y cargas separadas bugs VFS/VSW | CSV sin pérdida, horas correctas, PAP multicausa único, vínculos explícitos, reimportación sin duplicar ni cerrar por ausencia; Dennis carga |
| CSAPP-05 | Tres importaciones financieras y motor económico | Sustitución atómica año/categoría, prorrateo y CUM; históricos permitidos; Dennis carga 2025/2026 y repite |
| CSAPP-06 | Comparativa y Análisis Cliente | Tabla/ficha/curvas coherentes, mes anterior y año anterior completo/comparable, detalle integrado |
| CSAPP-07 | Pulse Rent y configuración de Administración | Catálogo, media/mediana/percentiles y bandas, pesos exactos 100, umbrales/referencias versionados |
| CSAPP-08 | Calidad, Client Health, diagnóstico, afectación estándar y backlog/antigüedad | Seis indicadores explicables en ambos ámbitos; stocks/flujo separados, sin historia inventada; configuración visible |
| CSAPP-09 | Conciliación, fiabilidad, rendimiento, exportaciones y recuperación | Reimportación/reversión, volumen medido, permisos y cifras conciliadas con cargas reales de Dennis |
| CSAPP-10 | Aceptación, guías y preparación/ejecución del despliegue autorizado | Instalación y copia recuperable, guía Windows/IT, aceptación registrada y despliegue solo en entorno autorizado |

Los prompts de implementación se redactarán antes de cada entrega conforme al estado real, en prompts/CSAPP-XX-vN.md. No los rellenes ahora con instrucciones genéricas. Este encargo documental queda identificado como CSAPP-DOC-00 y las diez entregas siguen sin iniciar tras completarlo.

## 7. Validación documental y entrega de esta tarea

Comprueba enlaces internos, rutas e índices, trazabilidad de reglas y que no existan contradicciones activas. En particular: ocho campos de tickets, sexto numerador aprobado, significado PR resuelto, VFS/VSW separados, causas del cliente conservadas, backlog dentro de seis indicadores, pesos exactos, tres categorías financieras por sustitución y cargas manuales de Dennis. Los archivos históricos están claramente señalados y no se leen por defecto.

Revisa el diff completo. Todo archivo añadido/modificado debe ser Markdown documental; sin datos brutos o secretos, sin instalación, código, configuración ejecutable o modificaciones a otros repos. Puedes usar comprobaciones locales de texto/enlaces existentes, sin añadir scripts o dependencias al proyecto. No ejecutes tests de aplicación para aparentar validación: no estás cambiando software.

Actualiza docs/plan/estado.md con el resultado real de DOC-00 e índice de prompts con el prompt archivado. Mantén CSAPP-01 a CSAPP-10 sin iniciar. Crea commit y PR documental sin merge cuando el acceso lo permita. La descripción de PR debe explicar el resultado, las verificaciones documentales realizadas y qué decisiones siguen como parámetros, sin afirmar cargas, benchmarks o implementación.

Al terminar informa brevemente de: rama y PR reales si existen; documentos creados/actualizados y rutas de entrada; validaciones documentales ejecutadas; parámetros todavía por calibrar y datos opcionales futuros; y confirmación de que no se ha escrito código, instalado dependencias, tocado bases ni iniciado CSAPP-01. No preguntes otra vez por el sexto indicador o PR: están resueltos. Detente al completar este encargo documental y espera el prompt específico de la primera entrega.
