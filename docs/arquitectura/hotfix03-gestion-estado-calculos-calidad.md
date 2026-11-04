# HOTFIX-03: maestros en tabla, estado comercial, cálculos utilizables y Calidad por usuario / total

Propietario de las reglas que [CSAPP-HOTFIX-03-v1](../../prompts/CSAPP-HOTFIX-03-v1.md) cambia sobre HOTFIX-02. Cada sección es independiente. Estado: **implementado y probado en Linux con datos sintéticos**; la actualización de la base de Dennis y Windows **no** se han probado.

## 1. Formato maestro de gestión y compatibilidad

| Archivo | Cabeceras (por posición, no por nombre de hoja ni de archivo) | Notas |
| --- | --- | --- |
| **Clientes, 8 columnas** (nuevo) | GRUPO CLIENTE VINCLE · organization_wrike · organization_id_zendesk · Organization_name_zendesk · Nivel_Servicio_acutal · SERVIDOR · Organization_name_PAP · TIPO | El Grupo de la fila es común a las relaciones Wrike, Zendesk y PAP de esa fila. Se traduce a las mismas filas tipadas que el formato anterior: un único plan, una única activación. |
| Clientes, 11 columnas (anterior) | Sin cambios | No se trasladan posiciones del formato nuevo al antiguo. |
| **Personal, 6 columnas** (nuevo) | Persona PAP · Persona Zendesk · Nivel · Equipo · PMO · Persona Wrike | Opcional una séptima columna inequívoca **Rol PMO** / **Perfil PMO** (nunca confundida con la antigua «Persona Zendesk» duplicada). |
| Personal, 7 columnas (anterior) | Con «Persona Zendesk» repetida | Sin cambios; el enriquecimiento «PERSONAL PMO» sigue admitido. |

La carga **no sustituye decisiones manuales**: crea lo ausente, completa vacíos no ambiguos y previsualiza diferencias; un vacío del Excel no borra lo informado ni reactiva un Cliente inactivo. El formato no trae Activo/Inactivo (se conservan los estados). Un ID Zendesk con Grupo o servidor distintos entre filas **no se resuelve por orden**: no se crea ese Cliente, se localiza la diferencia y el resto de filas se aplica. Los duplicados exactos se consolidan. El adjunto de Personal **no trae rol PMO**: ANA/DEV ya informados se conservan; los resultados de fórmula PMO se validan contra Equipo y una fórmula con equipo vacío no se convierte en «No PMO».

Ensayo con los dos archivos privados (solo cifras; ver [validación](../validacion/hotfix-03.md)).

## 2. Estado comercial (Activos / Inactivos / Todos)

Parámetro `estado`, predeterminado **Activos**, en Comparativa, Calidad, Pulse, selector de Análisis Cliente y maestro de Clientes. Reutiliza `isActive` de Grupo y Cliente; es el estado **actual**, no un borrado ni un histórico por fechas. Semántica única (`src/domain/estado.ts`):

- **Cliente activo efectivo**: propio activo y Grupo no desactivado (sin Grupo, solo el propio).
- **Grupo activo efectivo**: Grupo no desactivado y, si tiene Clientes externos, al menos uno activo; sin Clientes, su estado propio.
- Un Grupo con hijos activos e inactivos figura en **Activos**; sus cifras económicas siguen siendo las del **Grupo completo** (no se recortan horas de hijos inactivos).
- Con Soporte/Servidor seleccionados, la coincidencia se justifica en un Cliente compatible **del mismo estado pedido**: un hijo Platinum inactivo no mete al Grupo en «Activos + Platinum».
- Los hechos de Clientes inactivos siguen disponibles en Todos/Inactivos; la referencia de Calidad es la de entidades activas y se identifica en el detalle.

## 3. Cálculo económico: provisional y Silver On Demand

- **ECO 08 deja de ser un veto.** Silver On Demand (y los Grupos mixtos) usan la **misma imputación anual prorrateada** que el resto: anual/12 × días del mes parcial / días del mes. El ratio se rotula «imputación económica anual prorrateada», no facturación mensual real. Sin fuente anual no se fabrica importe. *Este cambio de criterio sustituye a la propuesta anterior (ECO 08 pendiente) y queda documentado aquí; no lo decide una interpretación.*
- **Cifra provisional**: con ingreso y horas observadas coherentes pero actividad pendiente en el perímetro (horas sin servicio, en conflicto o con elegibilidad PMO pendiente), se publica el ratio de las **horas observadas** (`provisional`, asterisco y texto accesible), sin añadir horas inciertas al denominador. La columna Horas muestra el denominador de esa cifra; el resto va en el desglose. Si no hay ninguna hora observable, o H=0, o el ingreso es desconocido, permanece «—» con la causa concreta. R=0 confirmado con H>0 da 0; H=0 nunca da infinito.
- **Media filtrada**: ΣR/ΣH × jornada sobre el **subconjunto comparable**; si falta un Grupo la desviación de los demás no queda vacía y el alcance se declara una vez («media de 35/40 grupos»). Ingreso y horas salen del mismo subconjunto y estado.
- Una incidencia en otro Grupo no vacía los ratios bien identificados; la falta de usuarios no bloquea €/jornada.

## 4. Bandas económicas

Factores del objetivo **T** (no cortes absolutos): 0,60 · 0,80 · 1,00 · 1,20. Con T=550: rojo <330, naranja 330–<440, amarillo 440–<550, **verde 550–<660**, verde intenso ≥660 (el corte exacto pertenece a la banda superior). Ausente = neutro; provisional = borde discontinuo y asterisco; color + etiqueta accesible. Editables y versionadas en Configuración › Economía (columna `EconomicSettingsRevision.bandFactors`; `NULL` = valores iniciales). Comparativa, Análisis Cliente y los CSV usan la misma función (`src/domain/economic-bands.ts`).

## 5. Calidad: Por usuario / Total

Parámetro `medida` (`usuario` predeterminado, `total`) en URL, seis KPI, ficha, evolución y CSV. **Por usuario**: numerador ÷ exposición de usuarios (por *un* usuario, no «por 100»; 2 PAP con 10 usuarios·mes = 0,2). **Total**: numerador observado, sin matriz de usuarios (Dedicación = horas; PAP, N3, incidentes/problemas y bugs = conteos únicos; backlog = envejecidos de la fotografía). Client Health no se divide. Sin usuarios, Por usuario conserva el numerador y muestra el motivo local, sin dividir entre uno ni inventar un cero. Las referencias se recalculan con los valores de cada modo, ámbito y mes. Unidades: `PER_USER_MONTH`, `PER_USER_STOCK`, `TOTAL_COUNT`, `TOTAL_HOURS`, `RELATIVE` (percentiles); una regla absoluta heredada «por 100» se convierte de forma explícita (÷100) a «por usuario» y no se aplica a totales.

## 6. Configuración inicial HOTFIX-03 de Calidad (editable y versionada)

Criterio operativo inicial, **no** un benchmark científico ni garantía de ausencia de fallos: Dedicación = CS N1, CS N2 y mantenimiento PMO N3 (IT/Plataforma como contexto); menor carga es mejor en los cinco KPI técnicos; percentiles inclusivos **P25/P75**, muestra mínima **5**, cohorte propia de Calidad (entidades externas activas, sin depender de Pulse; Soporte/Servidor, búsqueda, orden y paginación no mueven los cortes); intensidad hasta P10 / más allá de P90; empates (todo cero → verde; todos iguales y positivos → amarillo relativo); Health Positivo→verde, Mixto→amarillo, Negativo→rojo; seis pesos iguales (sin Health, cinco al 20 %); severidad 0 / 0,5 / 1 y global verde ≤0,25, amarillo ≤0,50, rojo >0,50; «peor señal» entre flujo y backlog; edad preocupante >7 días (incidente) y >30 (problema); fotografía anterior al corte con ≤7 días. «Sin calibrar» ya no aparece por ausencia del método inicial; «Muestra insuficiente», usuarios ausentes y datos parciales son limitaciones distintas.

**Instalación** (`npm run hotfix03:preparar`, idempotente): sin revisión de Calidad crea la 1; si la activa es la inicial «de fábrica» sin calibrar crea una **nueva** con procedencia `SYSTEM_INITIAL` (sin autor humano, sin evento de auditoría con actor inventado); si hay calibración manual o ya está instalada, no hace nada. Un borrador existente se conserva y su revisión base anterior queda visible. En una base nueva el perfil es además la configuración virtual por defecto.

## 7. Administración y tablas

Layout panorámico (`/administracion` en el `main` ancho), menú **Clientes · Personal · Usuarios · Cargas · Configuración**. Clientes y Grupos en una tabla de trabajo (proyección de relaciones canónicas, sin producto cartesiano; identidad por ID, no por fila) con estados Configurado / Sin informar / No aplica / En conflicto; «No aplica» es una decisión explícita (`MasterLinkDecision`, auditada). Personal con las columnas del encargo. Las herramientas retiradas del menú viven en Configuración › Herramientas técnicas (Comprobación de datos con tabla problema · afectados · motivo · acción, Excepciones de servicio, Estado de la aplicación) y Cargas › Descargas; las URL antiguas siguen funcionando con un aviso breve. Cambiar un maestro dispara el reenlace automático de HOTFIX-02 sobre lo ya cargado.
