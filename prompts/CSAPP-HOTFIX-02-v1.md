# CSAPP-HOTFIX-02-v1 — Enlace automático de datos y rediseño de las vistas

## 1. Encargo y resultado exigido: una entrega completa

Trabaja exclusivamente en `bateman37/cs-app`. Implementa **una única entrega y PR** que repare la atribución de datos ya cargados y rehaga **Comparativa, Análisis Cliente y Calidad** siguiendo el comportamiento y las capturas de Dennis. No basta ensanchar contenedores, esconder avisos o pedirle que repita todas las cargas. **Pulse Rent no se rediseña en esta entrega**; solo recibe los datos corregidos de los servicios compartidos.

Problema real: Dennis cargó los datos operativos y después los maestros de Clientes; las uniones materializadas no se actualizaron. Las vistas presentan vacíos, demasiados filtros, explicaciones técnicas y una distribución vertical que no reproduce su Excel. El orden de carga debe ser libre y el resultado, el mismo.

Antes de programar, archiva literalmente `prompts/CSAPP-HOTFIX-02-v1.md` y actualiza el índice. Lee AGENTS.md, CLAUDE.md, índice/estado y únicamente los contratos dueños de los módulos afectados. Parte de una base que contenga CSAPP-01 a 10 y HOTFIX-01; comprueba Git, no el estado antiguo escrito en documentación. En la revisión de preparación, `main` era `1abda3f`, con HOTFIX-01 integrado. Verifica de nuevo el estado real. Crea una rama propia; no reescribas historia ni añadas commits a una entrega anterior ya fusionada.

Entrega código, migraciones incrementales si hacen falta, pruebas de comportamiento, revisión visual y guía de actualización Windows. PR sin fusionar ni desplegar. Conserva PostgreSQL `cs_app`, `.env`, usuarios, matrices, archivos, cargas y auditoría. No hagas reset, limpieza de cuentas, SQL manual de Dennis, reinstalación desde cero o precarga sintética en su base.

Las reglas de esta entrega sustituyen las restricciones anteriores que obligaban a reprocesar manualmente cada lote, mostraban filtros técnicos o fragmentaban la ficha en pestañas. Los demás contratos vigentes de HOTFIX-01 se conservan.

## 2. Evidencias de partida y diagnóstico que debes demostrar

Esta preparación revisó código y el Excel adjunto; no ejecutó la instalación local de Dennis. Reproduce las causas con pruebas antes de cambiarlas. No inventes que toda la incidencia está explicada por una sola causa.

| Evidencia en la revisión | Trabajo exigido |
| --- | --- |
| `src/server/precarga/review.ts`, `reprocessNeeded`, devuelve una lista limitada a 100 y remite a «Reprocesar» lote por lote | Sustituir ese recorrido obligatorio por una actualización automática de todas las dependencias activas, sin límite silencioso |
| `src/server/precarga/apply.ts` crea equivalencias; Wrike/PAP/tiempos conservan atribuciones materializadas | Propagar la nueva revisión del maestro hasta hechos, agregados, detalles y exportaciones |
| `src/server/economics/engine.ts`, `SERVICE_OF_SQL`, devuelve `SIN_CLASIFICAR` sin evidencias en `ServiceAssignment` | Evitar que la ausencia de configuración manual vacíe el soporte ordinario descrito por el Excel; aplicar §5 |
| `globals.css`: `main { max-width: 1180px }`; el layout contiene las páginas dentro de ese main | Cambiar el ancho efectivo del padre de las vistas, no solo un hijo `.analytics-wide` |
| Comparativa repite metadatos, badges y explicaciones dentro de cada fila | Construir una tabla densa con una línea por grupo, centrada en cifras |
| Análisis Cliente tiene metadatos extensos, tarjetas por periodo y pestañas | Sustituirlo por una ficha panorámica unificada con gráficos y tablas simultáneos |
| Calidad muestra `ContextCard`, cada `view.notes` como aviso y navegación «Cartera / Health / Diagnóstico / Backlog» | Resumen de clientes limpio y acceso directo mediante los seis KPI, sin muro de avisos |

Revisa normalización, dirección de las relaciones, fechas de vigencia, selección del snapshot activo, atribución económica y filtros heredados en URLs. Clasifica cada vacío: sin registro real, fuente cargada sin activar, identidad no resuelta, persona/PMO pendiente, servicio desconocido, filtro incorrecto, denominador ausente o fallo del cálculo. **Nunca convertir todos esos casos a cero para que parezca arreglado.**

## 3. CLIENTES.xlsx es el puente entre sistemas

Fuente privada adjunta: `CLIENTES.xlsx`, 17.019 bytes, SHA-256 `bb795090b62630e3793c3df29337aef4cc057c63d957b47e0e0d2226eba203c5`. Tiene una hoja CLIENTES, rango A1:K77, con **74 filas útiles**, 46 denominaciones de Grupo BC, 63 organizaciones Zendesk, 38 nombres Wrike y 64 nombres PAP. No son 77 clientes. Las filas finales vacías no crean entidades.

Debe admitirse **este archivo con solo CLIENTES**, además del libro anterior que incluía PERSONAL y PERSONAL PMO. No exigir las tres hojas ni sustituir o vaciar Personal por no aparecer en esta actualización. Detecta cabeceras y posiciones duplicadas correctamente, independientemente del nombre del archivo.

### Mapeo obligatorio

| Columnas | Significado y relación |
| --- | --- |
| A `organization_wrike` + B `GRUPO CLIENTE VINCLE` | Nombre de proyecto/cliente Wrike → Grupo BC |
| C `organization_id_zendesk` + D `Organization_name_zendesk` + F `GRUPO CLIENTE VINCLE` | ID de organización Zendesk → Cliente canónico → Grupo BC |
| E y H `Nivel_Servicio_acutal` | Plan: Gold, Platinum, Silver On Demand, Silver Recurrente; son dos columnas fuente del mismo atributo |
| G `SERVIDOR` | OP o CLOUD del Cliente |
| I `Organization_name_PAP` + J `GRUPO CLIENTE VINCLE` | Nombre de organización/proyecto PAP → Grupo BC |
| K `TIPO` | Complejidad del proyecto; no usuarios ni identificador de cliente |

**Las tres columnas Grupo repetidas tienen una función:** acompañan a cada clave externa. Lee A/B, C/D/F e I/J como sus correspondencias respectivas, sin perder columnas al convertir cabeceras a un objeto. No exigir que coincidan los nombres de Zendesk, PAP, Wrike y BC. No unirlos por parecido ni por igualdad de sus nombres visibles.

El Grupo BC es el punto común para consolidar horas, PAP y facturación. El Cliente es la organización Zendesk. Un Grupo puede tener varios Clientes y proyectos. Una atribución válida solo a Grupo **ya tiene que sumar en el Grupo**, aunque no permita elegir un Cliente o implantación. No descartarla por faltar el nivel inferior, ni repartirla entre todos los hijos.

Una fila alineada en Excel no autoriza a sustituir B/J por F ni a considerar siempre que A o I es el nombre Zendesk de D. Para PAP/Wrike, una relación adicional a Cliente/implantación debe estar sustentada y ser compatible con su Grupo. Respeta relaciones explícitas existentes; no crees implantaciones nuevas para forzar una unión que solo es a Grupo.

### Recorrido de cada fuente

- **Finanzas:** denominación BC del archivo → Grupo canónico mediante su equivalencia BC. Reutiliza Grupos creados por históricos, no crees otro por diferencias de espacios/caja. No repartir sus ingresos entre Clientes.
- **Tickets Zendesk:** `organization_id` → C → Cliente D → Grupo F. Los tickets sin horas siguen disponibles para Calidad.
- **Tiempos Zendesk:** `ticket_id` → ticket vigente → su `organization_id` → Cliente/Grupo; persona por alias Zendesk de Personal. No confundir el ID del registro de tiempo o de usuario con una organización.
- **Wrike:** proyecto → A/B; si hay ticket explícito válido o el único extraído del título, este puede aportar Cliente/Grupo y completar una atribución compatible. Si no hay ticket, el Grupo de A/B basta para sumar sus horas elegibles. No supeditar el Grupo al éxito de la extracción del ticket.
- **PAP:** organización/proyecto de la fila → I/J; fecha de producción y causas de su revisión activa. Los vínculos explícitos a tickets pueden enriquecer el ámbito si son compatibles, nunca duplicar un PAP por cada vínculo.
- **Bugs:** conservar producto y vínculos explícitos; no unir un bug VINCLE a un Cliente por coincidencias de título o de ID de otro sistema.

### Normalización y excepciones acotadas

Usa una única normalización compatible en escritura, búsqueda, SQL y reproceso: Unicode NFC, espacios incluidos no separables, trim, colapso de espacios y comparación de nombres sin distinguir caja. Conserva el original. No elimines palabras, acentos o puntuación para confirmar identidades. IDs Zendesk como texto decimal exacto, sin pasar por float ni notación científica. La equivalencia tiene ámbito de sistema/tipo y vigencia.

En el archivo real hay cuatro diferencias E/H —filas 12, 44, 57 y 58—; no deben impedir crear la identidad ni atribuir los hechos. Deja pendiente únicamente el atributo en conflicto, resoluble en Administración.

Hay un alias Wrike repetido entre tres Grupos en A21/A24:A29/A32/A43 y un alias PAP entre cuatro Grupos en I26/I32/I43/I74. Para esos casos utiliza evidencia adicional inequívoca del propio registro —ticket vinculado y organización— si identifica uno de los candidatos compatibles. Si no existe, conserva el conflicto concreto y el hecho sin asignar; no elijas el primero, no dupliques el hecho ni bloquees los demás alias. I22/I23 corresponde a varios Clientes de un mismo Grupo: puede sumar al Grupo sin inventar un hijo.

Las organizaciones internas/pruebas sin Grupo se conservan fuera de los clientes externos. **Estas excepciones no justifican que todo quede vacío.** El informe de reparación distingue coincidencias exactas, enriquecidas, solo Grupo, ambiguas y sin correspondencia.

Las vigencias desconocidas de la precarga no se convierten en «empieza hoy»: deben permitir la atribución a fechas de trabajo históricas mientras no contradigan un tramo conocido. No sobrescribas migraciones OP/CLOUD ni pertenencias PMO fechadas, ni uses un alojamiento actual para asegurar sin evidencia cómo era hace años.

## 4. Reenlace automático, también para lo ya cargado

### Comportamiento visible

Después de confirmar una carga de Clientes/Personal, editar una equivalencia o resolver un conflicto, el sistema **actualiza automáticamente** las relaciones y cálculos afectados. Dennis no tiene que localizar y reprocesar diez archivos ni volverlos a subir.

Si tarda, muestra en Administración un estado breve y real «Actualizando relaciones» con progreso/fallo/reintento. Distingue maestros guardados de actualización de análisis terminada. Al finalizar, las vistas se refrescan con los datos nuevos. No mostrar «Todo actualizado» cuando todavía hay hechos activos derivados con el maestro anterior. No poner textos de cola, versiones o revisiones en las páginas de negocio.

Ofrece en Administración una única acción **Actualizar relaciones de los datos cargados** para reparar la instalación existente y recuperar errores. Es recuperación; los cambios siguientes la disparan automáticamente. Al aplicar el hotfix debe detectarse y programarse la reparación pendiente de cargas existentes, sin depender de otra subida del mismo Excel ni de que la precarga vuelva a crear alguna entidad.

### Garantías de implementación

Usa la cola/trabajador existentes y derivaciones compartidas, operaciones por conjuntos e índices. Evita resolver cada fila con consultas N+1. Debe cubrir todo el conjunto activo y no los primeros 100 lotes. La reparación no necesita releer originales si ya están almacenados los datos necesarios.

Dependencias: equivalencias/Cliente/Grupo y Personal → tickets y personas → tiempos Zendesk, Wrike, PAP y vínculos dependientes → servicio económico/elegibilidad PMO → agregados/sellos/detalles/exportaciones. No reactivar snapshots o revisiones sustituidos. Los tickets cuya organización se conoce después y los tiempos cargados antes que sus tickets deben resolverse al llegar la dependencia.

Coalesce cambios próximos del maestro y usa una generación/revisión o mecanismo equivalente para no perder un cambio que llega durante el recálculo. Una tarea antigua no publica como definitiva una atribución calculada con un maestro anterior. Reintentos y reinicio del trabajador son idempotentes; no hay recálculos recursivos ni doble suma. Las lecturas se publican coherentemente y no mezclan mitad de atribuciones antiguas/nuevas como un total definitivo.

Reprocesar relaciones **no es volver a cargar**: conserva orden de recepción, ganador por última carga, observaciones, revisiones fuente, fechas, snapshots activos y aportaciones de los lotes. Solo recalcula derivados y su procedencia. Respeta sustitución completa de tiempos por fuente y finanzas por año/categoría de HOTFIX-01. Una reversión también propaga sus dependencias.

Concilia, antes/después, filas, minutos, PAP únicos, tickets e ingresos. Si un registro pasa de sin asignar a Grupo, la cantidad fuente no cambia y no queda sumada en los dos sitios. Errores parciales se registran con alcance y reintento; no se reporta éxito silencioso.

## 5. La clasificación del servicio no puede vaciar Soporte

La regla funcional del Excel separa Administración Delegada mediante Entorno y Tipología, y mantiene el soporte ordinario. No exigir que Dennis catalogue manualmente cada entorno/proyecto para que todas las horas empiecen a existir.

Corrige la clasificación compartida por motor, ficha y detalles:

1. Conservar asignaciones explícitas vigentes a ADMIN_DELEGADA/OTROS/SOPORTE y sus conflictos reales; no sobrescribirlas por una regla de relleno.
2. Ticket con Entorno y Tipología informado e identificado como Administración Delegada → ADMIN_DELEGADA.
3. Ticket con Entorno y Tipología informado que no es Administración Delegada y no tiene otra asignación explícita → SOPORTE ordinario, por la regla original. Documenta y versiona este fallback; no requiere cientos de asignaciones manuales.
4. Wrike del perfil de mantenimiento/soporte N3, con proyecto reconocido en Clientes y persona PMO elegible, sin evidencia de otro servicio → SOPORTE de mantenimiento, también cuando no tiene ticket. Registra la procedencia de esta regla del perfil; no la extiendas a otro futuro export de proyectos generales.
5. Sin la evidencia necesaria, o con contradicciones, conserva pendiente/conflicto; no clasifiques como soporte todo lo desconocido indiscriminadamente.

La atribución a cliente y la clasificación del servicio son dimensiones distintas. Una etiqueta de causa desconocida no debe borrar horas de soporte válidas del cliente: conserva «Causa sin informar» en el desglose. Sistemas del Cliente y Uso Indebido siguen contando en las horas y muestran su origen. Un fallo al resolver equipo/rol no borra una atribución de organización válida; si la pertenencia PMO es realmente desconocida, conserva la elegibilidad pendiente sin fingirla.

Mantén el corte por **fecha del trabajo**: antes del 01/01/2025 Zendesk; desde esa fecha, PMO en Wrike y no PMO en Zendesk. CS N1/N2, PMO ANA/DEV, IT y Plataforma se distinguen en los desgloses. Cargar Clientes no sustituye la carga de Personal necesaria para reconocer técnicos; usa los alias ya presentes y señala únicamente los que realmente faltan.

## 6. Diseño común: panorámico, compacto y con dos filtros

### Ancho real

Usa todo el ancho disponible en las tres vistas, con márgenes laterales de aproximadamente 16–24 px, sin el límite de 1180 px ni otro max-width estrecho de un ancestro. Formularios de acceso/edición pueden conservar su anchura apropiada. No expandas un hijo por fuera del padre ni generes scroll horizontal del documento.

Objetivo principal: **1920×1080, zoom 100 %**. Comprueba además 1536×864 y móvil sin romper navegación o lectura. No uses zoom CSS, transform scale, texto de 8 px, desbordamiento oculto o eliminación de datos para simular que todo cabe. En escritorio, tipografía compacta legible, números tabulares y alineados; en tablas densas, aproximadamente 11–12 px y filas de 26–30 px. Comprime textos/espacios, no significados.

Usa la identidad visual de Vincle ya presente: cabecera baja, fondo claro, paneles alineados, separadores discretos y una jerarquía tipográfica común. El color se reserva principalmente para desviaciones, series y estados de Calidad. No copiar el Excel como una imagen ni convertirlo en una colección de tarjetas enormes: conservar su densidad útil con una presentación web cuidada.

### Controles comunes

En **Comparativa y Calidad** solo hay dos filtros de negocio, en forma de chips o segmentadores multiselección fáciles:

- **Soporte:** Gold, Platinum, Silver Recurrente, Silver On Demand.
- **Servidor:** CLOUD, OP.

Sin seleccionar equivale a todos; clic selecciona y deselecciona, sin Ctrl/Cmd. OR dentro del mismo filtro, AND entre ambos. El periodo no es un filtro de negocio adicional: una barra pequeña para mes/año y «A fecha de hoy / Mes completo», con acceso a último mes cerrado. Mantener prorrateo del mes en curso y etiqueta breve «Provisional».

Elimina de la vista normal búsqueda BC, servicio económico, complejidad, producto, estado/cobertura del maestro, revisión de configuración, tamaño de página y selectores de bloques. Parametrización técnica vive en Administración. No sustituirlos por un panel «Avanzado» que vuelva a ocupar media página.

Limpia parámetros obsoletos de URLs/estado local al navegar: un filtro oculto viejo no puede seguir recortando los datos. Ordenar por cabeceras y paginar no agrega filtros. Exportar conserva exactamente periodo y selección.

Comparativa consolida Grupos BC. En un Grupo con varios Clientes, soporte y servidor deben coincidir **en el mismo Cliente** para justificar su inclusión cuando se seleccionan ambos; no mezclar el soporte de un hijo con el servidor de otro. Incluir un Grupo no autoriza recortar solo sus horas y conservar todo su ingreso: sus cifras económicas siguen siendo las del Grupo completo. Muestra un valor mixto corto cuando exista, explicable al pasar el puntero/abrir detalle.

### Información técnica fuera del recorrido principal

Retira introducciones largas, sellos de datos, método matemático, revisión de configuración, cobertura declarada, explicaciones por fila y avisos repetidos que aparecen en las capturas. Conserva esa información en Administración › Diagnóstico de datos o dentro del detalle «Ver cálculo» bajo demanda. Reutiliza/ordena la conciliación existente en lugar de crear otro sistema de control.

Una cifra no disponible se representa con **—** y una explicación breve accesible al clic/foco, no con un párrafo dentro de la celda. Cuando haya una limitación común, máximo un indicador discreto «Datos pendientes» que abra el diagnóstico con acción concreta; no una pila de carteles amarillos/azules. Un error de ejecución real sí tiene un mensaje comprensible y Reintentar. No ocultes el error para aparentar un cero o un semáforo verde.

## 7. Comparativa: tabla semejante al Excel, de una línea por Grupo

Encabezado pequeño: Comparativa, periodo, objetivo vigente —inicial 550 €/jornada— y rentabilidad agregada del mes/CUM. Debajo, los dos segmentadores. La tabla debe empezar pronto, sin paneles de contexto.

### Columnas predeterminadas

| Bloque | Columnas |
| --- | --- |
| Identificación | Cliente —nombre del Grupo BC—, Soporte, Servidor |
| Mes seleccionado | Horas, Facturación imputada, €/jornada, Desv. objetivo %, Desv. media filtrada % |
| Mes anterior | Horas, Facturación imputada, €/jornada |
| Año actual CUM | Horas, Facturación imputada, Usuarios al corte, Tarifa anual/usuario, €/jornada, Desv. objetivo %, Desv. media filtrada % |
| Año anterior completo | Horas, Facturación imputada, €/jornada |
| CUM anterior comparable | Horas, Facturación imputada, €/jornada |

Todos los bloques visibles por defecto; cabeceras agrupadas de dos/tres líneas con unidades claras. No quitar el CUM anterior comparable para copiar la limitación del Excel antiguo. El periodo anterior completo y el CUM comparable tienen nombres distintos.

Quita de la tabla principal Producto, Complejidad, Estado/cobertura, recuentos de Clientes/implantaciones, «de sus Clientes (1/1)», y badges técnicos. El nombre del Grupo ocupa una línea con el nombre completo accesible y enlace a Análisis Cliente. No convertir cada fila en una ficha de varias líneas.

Ajusta anchos y precisión de presentación para que **la tabla compacta con todos los bloques quepa horizontalmente a 1920 px**, sin obligar a atravesar un contenedor enorme para llegar a la rentabilidad. Prevé nombres y cifras grandes. A 1536 px puede existir un desplazamiento horizontal limitado y accesible si es imprescindible; no apiles cada fila en tarjetas verticales en escritorio. Scroll vertical natural, cabeceras fijas y primera columna identificable. Si paginas, usa un tamaño fijo razonable sin selector expuesto; totales de todo el filtrado, nunca solo la página.

Totales compactos al pie. Horas/ingresos se suman; rentabilidad y desviaciones se calculan con sus componentes agregados, no sumando o promediando porcentajes. Usa el motor compartido: €/jornada = ingreso / horas × jornada; desviación objetivo = (objetivo − ratio)/objetivo; desviación de la media filtrada usa la misma población económica y criterio ponderado documentado. Mantén signo positivo como peor rendimiento en estas dos desviaciones y su formato condicional, sin confundirlo con la variación interanual de §8.

No inventar ingresos 2026 copiando 2025: solo se autorizó copiar usuarios. Si el lote de Soporte 2026 no existe o no está activo, el dato queda — con motivo puntual. Si sí fue cargado, sigue su conjunto año/categoría hasta la consulta y corrige el fallo. El enlace de Clientes no crea una factura ausente.

## 8. Análisis Cliente: una ficha completa en una pantalla panorámica

Al pulsar un Grupo desde Comparativa se abre su ficha económica y operativa conservando periodo/filtros. Se puede elegir Grupo/Cliente y, donde esté sustentado, implantación. Ese selector identifica el objeto analizado; no reincorpora el formulario gigante de filtros.

**Sin pestañas para repartir Resumen/Dedicación/PAP/etc.** La ficha principal se ve de una vez a 1920×1080 con datos representativos. Cabecera y resumen breves; debajo una cuadrícula de dos zonas, gráficos a la izquierda y tablas compactas a la derecha, como la captura. El detalle ilimitado de registros se abre en panel lateral, diálogo amplio o ruta de detalle con volver, sin empujar la ficha miles de píxeles hacia abajo.

### Cabecera y contenido mínimo visible

- Nombre, Grupo/Cliente, soporte, servidor y periodo. Selector de objeto y volver a Comparativa.
- Resumen del mes y CUM: rentabilidad, desviación vs objetivo, rentabilidad del mismo periodo anterior, horas reales/objetivo y desviación de horas; no cinco tarjetas verticales llenas de texto.
- Gráfico mensual **año elegido frente al anterior**, alineado enero–diciembre, para rentabilidad con línea de objetivo.
- Gráfico mensual **horas año elegido frente al anterior**; PAP mensual como serie separada con unidad propia si se superpone, nunca sumarlo a horas.
- Gráficos pequeños anuales de facturación y rentabilidad para los años disponibles; conservar histórico, diferenciar completo y CUM.
- Tabla **Dedicación por equipo y perfil**: CS N1, CS N2, PMO ANA, PMO DEV, IT, Plataforma. Horas mes, % mes, mes anterior, CUM, % CUM y CUM anterior comparable; año anterior completo en detalle cuando no quepa, siempre rotulado.
- Tabla **Dedicación por tipo de ticket y perfil**: Incidente/Problema Vincle, Otro soporte y Causa pendiente separados, con perfiles y periodos equivalentes. Las filas de detalle no duplican el total del periodo.
- Tabla **Tipo de problema Vincle**: Integración/Procesos, Configuración, Personalización y Estándar, además de Infraestructura CLOUD cuando corresponda. Horas CUM, % sobre horas dedicadas, % sobre horas objetivo y CUM anterior comparable. Origen cliente se distingue en el diagnóstico, no se borra.

Los tres cuadros de dedicación deben verse simultáneamente, con encabezados cortos y sin párrafos explicativos bajo cada uno. Conserva totales y denominadores trazables; explicaciones a demanda. Si hay muchos técnicos, el resumen es por perfil, no una fila por persona en la ficha principal.

### Comparación interanual que Dennis necesita

Para cada mes, mostrar en el gráfico/tooltip y tabla equivalente: actual, mismo mes anterior, diferencia absoluta y variación %. Para porcentajes, diferencia en puntos porcentuales. Variación de magnitudes = (actual − anterior)/abs(anterior) cuando anterior es distinto de cero; base cero o ausente se indica sin inventar infinito/0 %. No interpretes subir facturación igual que subir horas o incidentes: nombre y dirección de la medida claros.

En mes parcial compara hasta el mismo día equivalente del año previo —ajustado al calendario, incluido febrero—; en mes completo, ambos meses completos. Enero–mes anterior van completos; meses futuros del año actual vacíos, no ceros. Las rentabilidades CUM se recalculan sobre Σingresos/Σhoras, nunca sumando ratios mensuales. No comparar el CUM actual contra el año anterior completo como si fueran curvas iguales.

Reutiliza y corrige las series existentes; no programes otra fórmula independiente solo para el gráfico. Tooltips y detalle proceden del mismo conjunto de datos. Elige componentes gráficos legibles y consistentes, no enormes tarjetas con títulos genéricos. Mantén hitos de arranque/migración si ya están informados, sin inventar fechas.

En un Cliente cuyo ingreso solo existe al nivel Grupo, la ficha muestra **sus datos operativos** y el contexto económico del Grupo identificado como tal; no repite todo el ingreso como si fuera propio. Un PAP/Wrike solo atribuible a Grupo aparece en la ficha del Grupo, no en todos los Clientes. No llenar la ficha con avisos por esa limitación conocida.

## 9. Calidad: resumen claro y navegación por los seis KPI

La entrada se llama **Resumen de clientes**, no «Cartera». Una cabecera compacta de periodo y los mismos segmentadores Soporte/Servidor. Un control pequeño Grupo/Cliente es necesario para elegir nivel; no lo conviertas en otro panel de filtros. La vista global del Grupo no inventa reparto a proyectos.

Seis accesos con nombre completo, valor/resumen breve y estado visual comprensible:

1. Client Health.
2. Dedicación.
3. PAP correctivos.
4. Escalados a N3.
5. Incidentes y problemas.
6. Bugs y afectaciones.

Debajo, tabla compacta con una fila por Grupo/Cliente, los seis KPI y resultado global. Semáforos con color más texto/icono accesible; no seis carteles técnicos por fila. Muestra magnitud o ratio y estado; la causa detallada se consulta al entrar.

**Los KPI son la navegación:** pulsar un acceso o cabecera abre el apartado de ese indicador para la selección actual; pulsar su celda abre el detalle del indicador para ese cliente. Conserva periodo, nivel, filtros y volver al resumen. No saltar a Administración ni a un apartado genérico sin la selección. Todos los KPI tienen destino funcional con encabezado reconocible y datos conciliados; no enlaces decorativos.

| KPI | Apartado al entrar |
| --- | --- |
| Client Health | Matriz enero–diciembre, feedback positivo/negativo/sin informar, edición Admin e historial |
| Dedicación | Horas por perfiles, evolución y normalización por usuarios; desgloses CS/mantenimiento PMO y contexto IT/Plataforma |
| PAP correctivos | PAP únicos, causas, Petición cliente visible aparte, producción y comparación mensual |
| Escalados a N3 | Tickets únicos con tags N3 PMO/IT, cantidades, tasas y evolución por fecha de creación —proxy, no fecha del escalado— |
| Incidentes y problemas | Volumen y backlog abierto envejecido, incidentes y problemas separados; causas y antigüedad |
| Bugs y afectaciones | Problemas de clientes vinculados a Bug_ o con causa estándar, unión sin duplicar, y contexto de bugs abiertos VFS/VSW |

Diagnóstico por origen y backlog se integran en el detalle de los KPI correspondientes; no son botones principales que sustituyan los seis indicadores. El diagnóstico debe diferenciar Estándar, Configuración, Personalización, Integración/Procesos, Infraestructura CLOUD, Sistemas del Cliente y Uso Indebido. «Falta de pruebas» es una hipótesis a investigar, no una conclusión automática por tipología.

No inventes un bug-cliente por el texto BUG en la descripción ni asignes todos los bugs de producto a todos los clientes. Solo `Bug_` cuenta como defecto de producto; se conservan los otros Work Item Type en Administración. Mantén estados PR/Ready for Release sin declararlos desplegados.

Mantén las definiciones y pesos existentes: seis iguales exactos; sin Health informado se redistribuye a cinco al 20 %. Un KPI técnico sin datos **no** pierde su peso automáticamente como Health. Pesos, umbrales, perfiles y calibración siguen en Administración; no añadas ese trabajo al panel del usuario. Un umbral no configurado muestra «Sin calibrar» discretamente, con magnitudes visibles y acceso Admin a la configuración, nunca verde inventado ni un muro de mensajes. No actives propuestas de scoring no aceptadas para embellecer el resultado.

## 10. Cobertura y ausencia de datos: corregir la causa, simplificar la presentación

Conecta la cobertura de Calidad con el contrato de **carga amplia** de HOTFIX-01. No mantener dos políticas incompatibles donde la carga ya no pide declaraciones y Calidad sigue exigiendo rellenarlas manualmente por cada lote.

La procedencia «export amplio» la aporta el contrato de fuente autorizado, no la existencia de una fila o el nombre de archivo. Audita si el hotfix anterior quedó implementado solo en el formulario. Para lotes existentes compatibles con ese contrato, integra su procedencia de forma trazable; conserva declaraciones explícitas más precisas, limitaciones y observaciones. No rellenar todas las coberturas como completas indiscriminadamente ni inferir el inicio de una cobertura mediante MIN(fecha).

La falta de una declaración manual no debe ocultar las horas/PAP/tickets **realmente observados** ni la posibilidad de enlazarlos. Si la completitud no alcanza para afirmar un cero o comparar un stock histórico, esa celda tiene estado parcial/desconocido; el resto sigue mostrando sus magnitudes. No bloquear toda la página por una fuente no usada por ese KPI o por un atributo del maestro ajeno a la medida.

Backlog: con el export recibido hoy y su status puedes analizar el estado **observado en esa carga** y su edad desde creación; la fecha de recepción es una observación operativa identificada como tal, no la fecha real de extracción si falta. Si el corte de hoy no dispone de observación utilizable, mostrar el último stock observado con su fecha y límite claro bajo la política vigente, sin rebautizarlo como exacto de hoy. Nunca reconstruir el estado de 2024 con el status cargado hoy ni afirmar fecha real de cierre/escalado inexistente.

Mantén null, cero confirmado y parcial distintos en consultas y CSV. Los motivos técnicos siguen disponibles en el diagnóstico administrativo/Ver cálculo, fuera del recorrido principal. Esto no es ocultar errores: **se repara la unión y se sitúa la explicación donde permite actuar**.

## 11. Reparación de la instalación y seguridad de cambios

No cambiar las políticas de actualización de HOTFIX-01: última carga exitosa por identidad; PAP único por ID; bugs por producto/ámbito/ID; tiempos sin ID fiable como snapshot completo independiente por fuente; finanzas por año/categoría. El reproceso no cambia ganadores. Personal y usuarios contratados continúan separados por su significado, con Personal PMO unificado en Personal. Usuarios del año actual/anterior siguen editables por mes; no se reinicializan al reparar enlaces.

Si hacen falta migraciones, son incrementales y ensayadas sobre una base que ya tenga cargas, maestros, decisiones, snapshots y ajustes. No recalcular dentro de una migración bloqueante millones de filas si puede ejecutarse de forma recuperable por el trabajador; prepara el esquema y programa la reparación con estado verificable. Conserva trazabilidad de identidades previas sin duplicar activos.

Solo Admin modifica maestros, dispara reparación y consulta originales privados. Consulta puede usar vistas, filtros y detalles autorizados, sin forjar mutaciones. No introducir nuevas dependencias, sistema de diseño o arquitectura de cola por comodidad; usa lo existente salvo necesidad demostrada y documentada.

El Excel/capturas son privados: no Git, `public/`, fixtures nominativas, logs de PR ni dumps con nombres/IDs reales. Se permiten ensayos de lectura/aplicación del maestro real en base aislada privada; fixtures versionadas sintéticas. No afirmar acceso a `C:\Projects\cs-app` o a `cs_app` de Dennis desde el contenedor.

## 12. Pruebas que impiden repetir el mismo problema

Usa guard central y PostgreSQL real aislado `_test`; verifica base efectiva antes de mutar. Primero añade contraejemplos que fallen en la base anterior. No basta una prueba del importador de Clientes que compruebe que se crearon filas; hay que comprobar los valores al final de las tres pantallas.

### Datos y orden de llegada

1. **Operativos antes del maestro:** cargar tickets, tiempos Zendesk, Wrike, PAP y finanzas con nombres distintos entre sistemas; confirmar CLIENTES después. Sin pulsar Reprocesar por lote, comprobar Cliente/Grupo, minutos, PAP, ingresos, ficha, Calidad y CSV cuando termine el trabajo automático.
2. Mismo escenario en orden inverso y con tickets posteriores a sus tiempos: mismo resultado económico/operativo final. Repetir el maestro no duplica ni cambia snapshots.
3. El archivo adjunto de una sola hoja es admitido sin PERSONAL. Conserva personas/roles existentes y puede actualizar relaciones aunque las entidades ya existan y no se cree ninguna nueva.
4. A/B, C/D/F e I/J probados con nombres deliberadamente distintos y columnas Grupo repetidas; todas las rutas suman al mismo Grupo correcto. No unir por D como si fuera nombre de todas las fuentes.
5. Wrike sin ticket pero con alias de Grupo y PMO válido suma al Grupo. Tickets sin horas cuentan en Calidad. PAP con múltiples causas/vínculos cuenta una vez. Hechos solo Grupo no se reparten en hijos.
6. Alias ambiguos con/sin evidencia de ticket: resolver solo cuando sea inequívoca; conflictos acotados y no bloqueo global. Cambios de soporte E/H no vacían toda la identidad ni los ingresos.
7. Clasificación del soporte sin `ServiceAssignment` manual: ticket ordinario → soporte; Admin Delegada → separado; Wrike mantenimiento reconocido → soporte; servicio explícito OTROS se conserva; sin evidencia real no se inventa servicio.
8. Corte PMO 31/12/2024 y 01/01/2025, personas con vigencias y alias: horas bien particionadas y sin doble fuente. Desconocido no se interpreta como No PMO.
9. Edición de equivalencia/decisión/pertenencia PMO actualiza dependientes. Cambio durante recálculo, dos trabajadores y SIGKILL representativo: recuperación idempotente y generación final correcta; sin reactivar hechos sustituidos.
10. Más de 100 lotes históricos activos: todos los afectados quedan atendidos. Minutos/tickets/PAP/ingresos concilian fuente y atribución antes/después; las cantidades no cambian al moverse de pendiente a identificado.
11. Lote financiero 2026 presente vs realmente ausente: no queda oculto por un fallo de enlace, ni se inventa 2026 copiando 2025. Cliente sin ingreso propio no recibe todo el ingreso del Grupo.

### Interfaz y comparaciones

12. Comparativa/Calidad muestran exactamente dos filtros de negocio, multiselección sin Ctrl, AND correcto en un mismo Cliente y periodo compacto. Parámetros retirados de URLs no continúan filtrando en secreto. CSV coincide con la pantalla y totales de todo el filtrado.
13. Comparativa: filas de una línea, todos los bloques presentes, totales ponderados, nombres largos/cifras grandes sin solaparse; a 1920×1080 no hay que desplazar horizontalmente la tabla compacta para llegar al último bloque.
14. Ficha: Grupo y Cliente abren sin expansión vertical descontrolada; gráficos y tres tablas simultáneos, sin pestañas ni grandes tarjetas. Enero/diciembre, febrero bisiesto, mes parcial, base anterior cero y ausentes: curvas comparables y deltas correctos; detalle concilia.
15. Calidad: seis accesos/cabeceras y cada celda enlazan al KPI y objeto correctos, conservando contexto al volver. Health editable solo Admin; técnico ausente no redistribuye su peso; Health sin dato sí; ausencia/calibración no dan verde.
16. Datos sin cobertura o stock histórico insuficiente: se ven magnitudes reales sin banners en cascada; faltas localizadas en —/detalle. Un fallo real sigue visible y puede reintentarse. Stock recibido hoy no aparece como fotografía exacta de un año anterior.
17. Regresión de HOTFIX-01: cursor terminal, formularios archivo/año, PAP Petición cliente, última carga, snapshots, históricos 2022–2025 y matrices de usuarios con ajustes preservados. Pulse no cambia de diseño ni pierde sus agregados por el nuevo reproceso.

### Ensayo con el maestro real y volumen

Ensaya `CLIENTES.xlsx` real en base aislada privada. Añade hechos sintéticos de prueba que usen sus claves fuente para demostrar las rutas de enlace y el orden datos→maestros; esas claves se mantienen privadas. Separa en el informe «maestro real + operativos sintéticos» de «operativos reales de Dennis», a los que no debes atribuirte acceso. Usa comprobaciones esperadas independientes de los resolvers; no llames al mismo helper para fabricar esperado y resultado.

Ejecuta tipos, lint, build web/trabajador, pruebas de los módulos afectados y recorrido compilado en navegador. Reutiliza el conjunto representativo de volumen —aprox. 250.000 tiempos y 114.000 tickets— para medir reparación, memoria, consultas y apertura de las vistas sin N+1. No conviertas el trabajo en una nueva campaña de millones de casos ajenos. Mide y documenta, no prometas tiempos de esta máquina como SLA.

**Revisión visual obligatoria:** abre y mira las tres pantallas con datos representativos, incluyendo nombres largos, valores grandes, mezcla de soportes, ausentes y errores reales; 1920×1080 y 1536×864 a 100 %, más comprobación de adaptación móvil. Comprueba geometría de tablas/contenedores y realiza inspección visual; un test que solo confirma textos en el DOM no acredita el diseño. Corrige lo que no quepa antes de cerrar. Conserva evidencia sintética versionable donde corresponda, sin capturas nominativas públicas.

## 13. Documentación e instrucciones de actualización

Mantén documentación modular: un contrato dueño para las uniones y propagación automática, cambios en Comparativa/Análisis/Calidad, clasificación de servicio, validación y una guía corta del hotfix. Actualiza índice y estado sin llamar «aceptado por Dennis» a lo que solo probaste en Linux. No repetir en cinco documentos la misma fórmula ni entregar un documento gigantesco de operación.

La guía para `C:\Projects\cs-app`, PostgreSQL `cs_app`, explica: parar web/trabajador, copia verificada, actualizar rama/SHA correcto sin borrar cambios locales o `.env`, `npm.cmd ci`, migración si corresponde, `npm.cmd run build:todo`, arrancar y comprobar trabajador. Usa los comandos vigentes realmente existentes. No pedir recrear la base ni volver a cargar todos los datos.

Recorrido manual de Dennis, corto y con resultado observable: comprobar reparación automática o ejecutar una única recuperación → revisar un Grupo en Comparativa → abrir su ficha → verificar tres importes/conteos → entrar a cada KPI de Calidad → cambiar Soporte/Servidor → volver y exportar. Si actualiza CLIENTES, ese único archivo debe bastar sin reenviar los Excels operativos ni Personal. Indica cómo consultar solo las excepciones reales.

## 14. Informe final y criterio de cierre

Una sola PR con título/descripción centrados en el resultado final, base, migraciones, reproducción, soluciones, pruebas y guía Windows. Incluye:

- Causas demostradas con contraejemplo, no «se han mejorado las uniones» sin evidencia.
- Qué hizo automático el reenlace y cómo se repara una instalación con hechos ya cargados.
- Política de servicio aplicada y cantidades fuente/atribuidas antes-después, con conteos seguros.
- Resultados del maestro real, excepciones restantes y límites de los operativos sintéticos.
- Comprobación visual de ancho y altura, resolución/zoom y métricas reales de apertura/reparación.
- Riesgos/limitaciones pendientes separados de los fallos corregidos; Windows solo si lo ejecutaste.

No declares completo si aún hay que pulsar Reprocesar en cada lote, clasificar a mano todos los entornos ordinarios, rellenar declaraciones para que aparezcan magnitudes o atravesar pestañas para ver la ficha principal. Tampoco si solo has escondido avisos pero los datos identificables siguen sin enlazar.

Detente tras esta entrega. No rediseñes Pulse Rent, no empieces otro roadmap, no fusiones ni despliegues por iniciativa propia. La frase final incompleta de Dennis («Por otro lado quería, tener…») no contiene un requisito adicional implementable: no inventes su continuación.
