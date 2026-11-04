# CSAPP-HOTFIX-03-v1 — Maestros en tablas, estado de clientes y cálculos utilizables

## 1. Una entrega completa sobre HOTFIX-02

Trabaja exclusivamente en `bateman37/cs-app`. Implementa **un único CSAPP-HOTFIX-03 y una única PR**: Administración panorámica con tablas de Clientes/Personal, filtro comercial Activo/Inactivo, simplificación del menú, reparación de cifras económicas/PAP/tickets, ordenación de Comparativa y Calidad en modo **Por usuario / Total**, con una configuración inicial de colores y global utilizable.

Archiva este prompt literalmente en `prompts/CSAPP-HOTFIX-03-v1.md` antes de cambiar código. Lee AGENTS.md, CLAUDE.md, índice/estado y solo los contratos dueños de lo afectado. La revisión de preparación encontró `main` en `2c7a8d4`, merge de la PR 14 de HOTFIX-02; verifica de nuevo Git. Parte de una base que incluya HOTFIX-01/02 y conserva cambios locales ajenos. No des por terminada una función porque una tarea anterior esté marcada completada.

Una rama propia y PR sin fusionar ni desplegar. No ampliar el roadmap ni rehacer el proyecto. Mantén las cuatro vistas: Comparativa, Análisis Cliente, Pulse Rent y Calidad. **Pulse no se rediseña**, pero sí recibe el filtro de estado solicitado y los datos corregidos de los servicios compartidos.

Conserva todos los maestros, alias, vigencias, decisiones, cuentas, ajustes de usuarios, cargas, snapshots, archivos y auditoría existentes. «Unificar Clientes y Grupos» se refiere a una gestión conjunta en pantalla: **no convertir dos entidades de negocio distintas en una única tabla física** ni duplicar sus ingresos. No borrar información por retirar una pestaña.

Los nuevos Excels son referencia del formato de gestión y formatos de importación que deben admitirse. No sustituyen automáticamente todas las decisiones manuales del maestro. El hotfix no carga ni sobrescribe la base local de Dennis sin que este ejecute su actualización/importación.

## 2. Evidencias concretas que debes reproducir

La preparación leyó código, adjuntos y capturas; no ejecutó la instalación de Dennis. Reproduce cada defecto con un contraejemplo antes de corregirlo.

| Evidencia | Consecuencia y corrección |
| --- | --- |
| Administración aún usa el contenedor estrecho; Clientes tiene submenús Grupos / Clientes / Catálogo | Gestión conjunta apaisada en tabla, sin wall text |
| El importador reconoce CLIENTES de 11 columnas y PERSONAL de 7 con Zendesk duplicado | Añadir los nuevos formatos de 8 y 6 columnas, conservando compatibilidad |
| Existen `isActive` en Grupo/Cliente/Persona, pero `parseComparativaQuery` y `parseQualityQuery` fuerzan `status: todos` | Implementar de extremo a extremo el estado comercial visible y persistente |
| Comparativa ya genera enlaces de orden, pero filtra claves contra otra lista compartida | Auditar todas las cabeceras hasta la ordenación real; un enlace o flecha no prueba que ordene |
| El motor anula `perDay` por servicio/elegibilidad pendientes y por ECO 08 / Silver On Demand | Reparar relaciones/clasificación y tratar un cálculo provisional explícitamente, sin vaciar cifras calculables |
| `defaultQualityConfig` arranca sin perfiles, umbrales, mapeo Health ni global activos | Instalar el perfil inicial definido aquí; no volver a entregar una Calidad permanentemente «sin calibrar» |
| Calidad usa tasas por 100 usuarios mes y depende de selectores/referencias de Pulse | Separar el modo Total del denominador y evitar exigir configurar Pulse para usar Calidad |

La captura de diagnóstico muestra, en esa lectura, **5 filas de Soporte sin Grupo**, **3.311,67 h sin Grupo**, horas con servicio/PMO pendientes, limitaciones de ingresos y el bloqueo de Silver On Demand. Son pistas para reproducir, **no conteos universales que deban codificarse ni resultados que puedas atribuirte en otra base**. Hay que seguir esos registros hasta su causa; quitar el diagnóstico no arregla los datos.

## 3. Administración panorámica y menú de cinco entradas

La navegación principal de Administración queda en **Clientes · Personal · Usuarios · Cargas · Configuración**. Extiende el ancho efectivo del layout padre a aproximadamente `viewport − 32/48 px`, también en las páginas internas. No basta ensanchar un hijo dentro del `main` limitado. Mantén formularios de credenciales y pequeños diálogos a un ancho legible.

Objetivo escritorio: 1920×1080 a zoom 100 %, verificación adicional 1536×864 y móvil. Tablas densas legibles, cabeceras fijas, primera columna identificable, números alineados y desplazamiento local cuando haga falta. No usar escalado CSS, texto microscópico ni cortar campos importantes para fingir que caben.

### Destino de las funciones que salen del menú principal

| Función actual | Destino |
| --- | --- |
| Catálogo de productos | Retirar la pestaña de Clientes. Conservar los registros/referencias y la separación técnica VFS/VSW; si existe mantenimiento necesario, Configuración avanzada |
| Servicio económico | Configuración → Avanzado → Excepciones de servicio. El recorrido normal usa la clasificación automática de HOTFIX-02 |
| Comprobación económica y Conciliación/Diagnóstico | Una sección «Comprobación de datos» en herramientas técnicas de Configuración, con problemas accionables y sin duplicar páginas |
| Supervisión administrativa de Exportaciones | Acceso secundario desde Cargas → Descargas. Conservar exportar/cancelar/descargar desde cada vista |
| Operación | Configuración → Estado de la aplicación: trabajador, cola, fallos y recuperación. Mantener salud, arranque/parada y copias |

Son funciones útiles: comprobar cifras, descargar archivos grandes y saber si el trabajador está funcionando. Simplifica su acceso y lenguaje, conserva permisos y motores. Las antiguas URLs se redirigen al destino correcto o mantienen compatibilidad con un aviso breve; no dejar 404 ni enlaces de diagnóstico rotos. Retirar una pestaña no autoriza borrar tablas, jobs, originales o copias.

El diagnóstico presenta una tabla breve: **problema · registros/importe/horas afectados · motivo · acción**. «5 grupos financieros sin equivalencia BC → completar enlace», «horas sin persona → Personal», «relaciones pendientes → estado/reintento». Abrir desde una celda incompleta debe llevar a su caso concreto, no a una explicación genérica de todo el motor. Las mutaciones requieren Admin; Consulta conserva solo las lecturas autorizadas.

## 4. Clientes y Grupos: una tabla de trabajo

### Recorrido ordinario

1. Botón **Nuevo grupo**: nombre/denominación BC y estado. Crear ese Grupo es suficiente para que aparezca como fila pendiente de completar; no exigir Zendesk/Wrike/PAP para darlo de alta.
2. En la misma pantalla se añaden sus Clientes/organizaciones y se rellenan los enlaces en la tabla.
3. Edición por fila/celda mediante controles compactos y Guardar/Cancelar. Un panel lateral puede resolver alias múltiples, conflictos y vigencias; no abrir cinco páginas y leer párrafos para completar una equivalencia.

Columnas visibles principales, siguiendo el Excel:

**Grupo BC · Wrike · ID organización Zendesk · Nombre Zendesk/Cliente · Soporte · Servidor · PAP · Tipo de proyecto · Activo · Enlaces**.

Utiliza una vista agrupada por Grupo y filas de Cliente/proyecto donde la relación lo justifique. Un Grupo sin Cliente tiene una fila de Grupo identificada como tal. Alias propios del Grupo se muestran en su ámbito o como heredados, sin duplicar equivalencias por cada hijo. Varios PAP/alias se editan en un pequeño subeditor, no concatenando una cadena que el sistema después interprete como un único nombre.

**Evita el producto cartesiano** entre alias Wrike, organizaciones Zendesk y PAP. La tabla es una proyección de relaciones canónicas, no una nueva fuente de duplicados. Conserva ID estable de entidad/relación al ordenar o filtrar; número de fila no es identidad.

### Qué falta realmente

Cada sistema distingue **Configurado, Sin informar, No aplica o En conflicto**. No aplica es una decisión explícita cuando corresponda, no un relleno automático de vacíos. Un enlace configurado puede tener cero actividad: no es igual que enlace ausente. Un registro solo atribuible a Grupo es válido a ese nivel y no exige inventar un Cliente.

La columna Enlaces resume lo pendiente y permite abrir la celda/caso afectado. Usa contadores de hechos sin atribuir cuando existan, para priorizar lo que está dejando datos fuera. No marcar como erróneo a todo cliente sin Wrike/PAP si no hay evidencia de que ese sistema le aplique, ni declarar «todo completo» solo porque los campos tengan texto.

Al guardar una equivalencia o resolver un caso, se activa el reenlace automático de HOTFIX-02 para los hechos **ya cargados**. Mostrar su estado real; no pedir subir otra vez los archivos ni recalcular cada lote. Corregir un alias no cambia la última carga ganadora, duraciones o fechas fuente.

Conservar historia y versión optimista. Editar soporte/servidor con vigencias conocidas no destruye tramos anteriores. La edición ordinaria propone cambios sobre lo existente y muestra su ámbito; mover un alias de un Grupo a otro no puede ocurrir por una escritura ambigua en la fila de un hijo. No convertir un dato incompleto en borrado ni una corrección de nombre en una entidad nueva.

## 5. Importar los nuevos formatos sin perder lo existente

### Tabla de Clientes.xlsx

Archivo privado: 14.636 bytes, SHA-256 `e49c814ba588dfcf3040d9a145331bf930fd693ec2981198a84451c43c9c9aef`. Hoja `Hoja1`, A1:H88: **87 filas fuente**, 54 nombres BC, 75 IDs de organización Zendesk, 46 alias Wrike y 70 alias PAP. Estos conteos no son un número de Clientes comerciales activos.

| Columna | Mapeo |
| --- | --- |
| A GRUPO CLIENTE VINCLE | Grupo BC común a las relaciones de esta fila |
| B organization_wrike | Equivalencia Wrike → Grupo; Cliente solo con evidencia adicional compatible |
| C organization_id_zendesk | Identidad exacta Zendesk como texto decimal |
| D Organization_name_zendesk | Cliente de esa organización, dentro del Grupo |
| E Nivel_Servicio_acutal | Gold, Platinum, Silver Recurrente, Silver On Demand |
| F SERVIDOR | OP/CLOUD |
| G Organization_name_PAP | Equivalencia PAP → Grupo y, cuando esté sustentado, Cliente/proyecto |
| H TIPO | Complejidad del proyecto |

Detecta este formato por cabeceras, no por nombre de archivo o pestaña. Conserva el lector anterior CLIENTES de 11 columnas y sus tres parejas de Grupo; no trasladar posiciones del formato nuevo al antiguo. Nada se suma por repetir filas de correspondencia.

Excepciones privadas verificadas: filas **63 y 82** tienen el mismo ID Zendesk con **Grupo y servidor distintos**; también generan conflicto en el alias PAP. No elegir primera/última fila ni crear dos Clientes con el mismo ID. Reutiliza la identidad existente, presenta la diferencia para resolver y conserva el Grupo/servidor anterior mientras no se acepte un cambio inequívoco. No bloquear las demás filas.

El alias Wrike de filas 21/24:29/32/43 sigue apareciendo entre tres Grupos y el PAP de 26/32/43/74 entre cuatro. Resolver con ticket/organización de cada hecho cuando sea inequívoco y compatible; si falta evidencia, localizar el caso sin asignarlo a todos los candidatos. Filas 67 y 71:73 sin Grupo son organizaciones internas/pruebas; no inventarles ingresos o Grupo externo.

La importación crea lo ausente, completa campos vacíos no ambiguos y **previsualiza diferencias con datos ya existentes**. Un vacío del Excel no borra lo informado ni reactiva un Cliente inactivo. No machacar decisiones manuales, vigencias o estados al repetirlo. El formato no contiene Activo/Inactivo: conservar los estados existentes; las nuevas entidades externas pueden nacer activas según la política ordinaria registrada.

### Tabla de Personal.xlsx

Archivo privado: 16.598 bytes, SHA-256 `09f73c43789959549d2eade9008d2f0206899320e54e678155acfdf12c1d4e9b`. Hoja `Hoja1`, A1:F76: 75 filas, seis columnas **Persona PAP · Persona Zendesk · Nivel · Equipo · PMO · Persona Wrike**. Filas 47/75 son duplicado exacto; hay cinco celdas con fórmula PMO y resultado almacenado.

Admite el archivo de seis columnas, el antiguo de siete con Zendesk duplicado y el enriquecimiento anterior PERSONAL PMO. No exigir la columna duplicada ni que las dos tablas estén en un mismo archivo. Este adjunto **no trae rol PMO**: preservar ANA/DEV ya existentes; ausencia no significa borrar rol. Admite opcionalmente una columna inequívoca Rol PMO/Perfil PMO en futuras importaciones, sin confundirla con el viejo Zendesk duplicado.

Sin ejecutar fórmulas ni enlaces externos: validar los resultados PMO contra Equipo. No convertir una fórmula con equipo vacío en «No PMO» confirmado. Identidades por alias exactos normalizados, sin fusiones por parecido. Marcadores/pruebas e incompletos conservan las reglas anteriores y su explicación acotada.

## 6. Personal con la misma gestión en tabla

Pantalla panorámica, una persona canónica por fila:

**Nombre · Alias PAP · Alias Zendesk · Alias Wrike · Equipo · Nivel · PMO Sí/No/Sin informar · Rol PMO · Activo · Enlaces**.

Alta sencilla y edición de alias/equipo/nivel/rol en fila o panel compacto, con búsquedas/orden y estado de vínculos. Múltiples alias por sistema siguen siendo posibles; una celda no obliga a quedarse con el primero. PMO y el resto forman un único maestro, con rol vigente únicamente cuando la pertenencia PMO lo permite.

No exigir Wrike a toda la plantilla; una cuenta ausente en un sistema no es un fallo por sí sola. Sí señalar horas/PAP con un alias real que aún no identifica una persona. Las modificaciones disparan el reenlace y recalculan la política PMO por fecha del trabajo.

Persona inactiva no implica borrar o dejar sin atribuir sus horas históricas. **Personal** son técnicos/colaboradores; **Usuarios** son licencias contratadas por cliente/mes; **cuentas de acceso** son Admin/Consulta. No fusionar estas tres entidades ni crear cuentas de login a partir del Excel.

## 7. Activo/Inactivo como filtro común de clientes

Añade control visible **Estado: Activos / Inactivos / Todos**, predeterminado **Activos**, a Comparativa, Calidad, Pulse, selector de Análisis Cliente, maestro de Clientes y selectores de clientes/usuarios. Aplica a las listas/datos derivados de clientes, no a páginas sin objeto comercial como configuración o registros brutos de Cargas.

Reutiliza `isActive` de Grupo/Cliente. Es estado comercial **actual**, tal como pide Dennis; no borrado ni estado histórico deducido por fechas de actividad. Cambiarlo se audita y puede revertirse. No desactivar equivalencias o borrar ingresos/tiempos al dar de baja a un Cliente.

Semántica única:

- Cliente activo efectivo: su propio estado activo y su Grupo no desactivado. Si no tiene Grupo, se respeta su estado propio; las organizaciones internas siguen fuera de los análisis externos.
- Grupo activo efectivo: Grupo no desactivado y al menos un Cliente externo activo, o Grupo sin Clientes externos con estado propio activo —por ejemplo uno económico aún pendiente de completar—. Con todos sus Clientes inactivos se considera inactivo para las listas, conservando el estado explícito del Grupo.
- Un Grupo con hijos activos e inactivos figura en Activos. Sus cifras económicas siguen siendo del **Grupo completo**, también en periodos anteriores: no recortar horas de hijos inactivos dejando todo el ingreso BC sin reparto. El detalle identifica los hijos y su estado.

La selección por Soporte/Servidor y Estado se justifica en el mismo Cliente compatible: no incluir un Grupo en «Activos + Platinum» únicamente porque su hijo Platinum está inactivo. Esta regla selecciona el Grupo, sin alterar su perímetro económico completo. Desactivar un Grupo modifica su estado propio y el estado efectivo de los hijos; no sobrescribe sus banderas individuales. Reactivarlo respeta cuáles hijos estaban ya inactivos por decisión propia.

Default no altera datos existentes ni cambia la pertenencia de un ticket. Un enlace directo a un Cliente inactivo abre su ficha con una etiqueta corta y opción de volver a la selección correspondiente; no 404 ni activación automática.

Actualiza parser, allowlist de URL, formularios, consultas, totales, enlaces entre vistas, detalles y exportaciones. HOTFIX-02 eliminó `estado` como parámetro obsoleto: ahora debe ser un parámetro explícito válido, no seguir ignorándose. El selector conserva periodo/Soporte/Servidor y estos se conservan al cambiar Estado.

Los hechos de clientes inactivos siguen disponibles en Todos/Inactivos y en auditoría; una nueva carga no los descarta por el estado actual del maestro. Los totales y referencias explican su conjunto; no sumar ocultos por accidente ni confundir el filtro comercial con la elegibilidad temporal de PMO.

## 8. Reparar rentabilidad en los cinco periodos

Para cada Grupo y periodo —mes, mes anterior, CUM, año anterior completo, CUM anterior comparable— sigue esta cadena: **conjunto financiero activo → equivalencia BC → importe del Grupo → prorrateo → horas atribuidas del mismo servicio → elegibilidad histórica → ratio**. El detalle devuelve componentes y motivo preciso, no un estado global heredado de otro Grupo.

Corregir los cinco enlaces financieros pendientes si el maestro los permite; los no inequívocos se resuelven desde la tabla y actualizan datos ya cargados. Corregir horas sin persona/Grupo, clasificaciones y snapshots obsoletos usando el reenlace automático existente. No hacer que Dennis reimporte todo para refrescar derivados.

Mantener la clasificación automática de HOTFIX-02: ticket ordinario informado → Soporte, Admin Delegada reconocida → separada, Wrike de mantenimiento N3 reconocido/elegible → Soporte, excepciones explícitas vigentes respetadas. No devolverlo a un esquema que exige rellenar manualmente todos los entornos en Servicio económico.

### Cifra calculable, provisional o no calculable

Con ingreso R y horas H > 0 del mismo perímetro, €/jornada = **R/H × jornada**, con jornada inicial 8 h. El valor de la celda, el orden, el CSV y «Ver cálculo» usan los **mismos componentes** y estado. Usa precisión decimal interna y redondea solo al presentar.

Una incidencia de cobertura/atribución en otro Grupo no anula los valores bien identificados de este. Tampoco la falta de usuarios bloquea €/jornada: ese ratio no usa licencias.

Si existen ingreso y horas observados coherentes pero el perímetro local aún tiene actividad pendiente, muestra el **ratio del conjunto observado como provisional**, con un asterisco/texto accesible y el desglose pendiente en el detalle. No lo presentes como rentabilidad completa ni añadas horas inciertas al denominador a ciegas. La columna Horas debe corresponder al denominador de esa cifra; conserva las demás horas en el desglose. Si la incertidumbre impide identificar incluso ese perímetro, permanece — con causa concreta.

Ingreso real desconocido no se sustituye por cero. H=0 no produce infinito, ni un número verde por tener ingresos sin dedicación. R=0 confirmado con H>0 sí da ratio 0. No copiar ingresos 2025 a 2026; la copia autorizada anterior era de usuarios.

### Decisión de método para Silver On Demand

Para esta propuesta de HOTFIX-03, utiliza **la misma imputación anual prorrateada ya solicitada para todos los planes**, incluido Silver On Demand: anual/12 y proporción de días del mes parcial. Retira ECO 08 como veto técnico que deja en blanco un ratio aritméticamente calculable con ese método.

En On Demand se identifica discretamente que es **imputación/estimación económica**, no facturación mensual real. No inventar distribución real de facturas o tarifa contractual recurrente. Mantener el importe anual fuente y el plan; sin fuente anual no se fabrica. Un Grupo mixto no se anula solo por mezclar planes si ingreso y horas de todo el Grupo son comparables. Documenta este cambio de criterio respecto a la propuesta anterior, no lo dejes a una interpretación de Claude.

### Media filtrada

La referencia se calcula con los Grupos del filtrado con componentes comparables, **ΣR/ΣH × jornada**, no media simple de ratios. Si falta un Grupo, no dejes vacía la desviación de todos los demás: usa el subconjunto comparable y señala una sola vez su alcance —por ejemplo «media de 35/40 grupos»—. Ingreso y horas siempre provienen del mismo subconjunto y estado; no mezclar el R de todos con H de algunos ni presentar esa referencia como completa.

## 9. Comparativa: ordenar todo y colores con objetivo 550

Conserva el formato compacto/panorámico conseguido, los cinco bloques y Soporte/Servidor. Añade únicamente Estado como filtro de negocio. **Todas las columnas de datos ordenan** al pulsar su cabecera: nombre, soporte, servidor, horas, ingresos, usuarios, tarifa, rentabilidad y desviaciones en cada periodo existente.

Revisa la lista `COMPARATIVA_SORTS`, `SORT_KEYS`, parseo, `sortRows`, generación de enlaces y orden del servidor: una clave de tarifa/servidor u otra válida no puede normalizarse silenciosamente a nombre. Alternar ascendente/descendente, flecha y `aria-sort`; orden numérico por valor sin formato y desempate estable por nombre/ID. Ausentes al final en ambos sentidos; valores provisionales ordenables por su cifra, sin tratarlos como cero. Ordenar sobre el filtrado completo antes de paginar. CSV respeta orden y filtros, total no se ordena como un cliente.

### Propuesta inicial de colores económicos, editable

Objetivo T vigente, inicialmente **550 €/jornada**. Aplicar en todos los periodos las bandas de ratio/T:

| Rentabilidad | Color inicial |
| --- | --- |
| Menor que 0,60×T —330 con T=550— | Rojo |
| Desde 0,60×T y menor que 0,80×T —330 a menos de 440— | Naranja |
| Desde 0,80×T y menor que T —440 a menos de 550— | Amarillo |
| Desde T y menor que 1,20×T —550 a menos de 660— | Verde |
| Desde 1,20×T —660 o más— | Verde más intenso |

**550 exactos es verde.** Ausente es neutro. Provisional se distingue y nunca tiene apariencia de dato completo por su color. Mantén contraste del texto y una etiqueta accesible; color no es la única señal. Las desviaciones conservan su signo: positivo frente al objetivo significa menor rendimiento.

Instala bandas iniciales configurables en Configuración → Economía, ligadas al objetivo para que cambiarlo no deje cortes absolutos antiguos. Valida orden/fronteras, permite editar y audita revisiones. Si hay bandas personalizadas activas, respétalas. No poner solo un CSS con 550 repetido en componentes. Análisis Cliente debe usar la misma escala económica al mostrar el mismo dato.

## 10. PAP, incidentes y problemas: recuperar lo que falta

No des por reparados los datos porque la tabla de Clientes se vea bien. Revisa los numeradores en cada transición hasta Calidad/ficha/CSV.

Para PAP: organización/proyecto → alias PAP del maestro → Grupo y Cliente si está sustentado → revisión activa → fecha de producción → causas. Un PAP con cualquier causa que contenga Correctivo es correctivo; multicausa y multiticket cuentan un ID una sola vez. No filtrar solo Resultado=OK, exigir ticket Zendesk, exigir implantación o usar fecha de subida para ubicarlo. Petición cliente sigue como categoría propia y no se convierte por defecto en correctivo/no facturable. Origen cliente se conserva y se distingue en el análisis.

Para tickets: organización Zendesk → Cliente → Grupo, tipo/causas/entorno normalizados según contrato, fecha de creación para flujos; status observado para backlog. Tickets sin horas cuentan. Sistemas del Cliente y Uso Indebido no desaparecen de magnitudes; infraestructura CLOUD se clasifica con su regla. No excluir todos los no Bug_ del export de tickets ni intentar unir organizaciones por nombres iguales entre sistemas.

El ámbito Grupo incluye todos los PAP/tickets que le pertenecen, incluidos hechos solo Grupo; el ámbito Cliente incluye lo que realmente se le atribuye, sin copiar a cada hijo el total del Grupo. Si el Grupo tiene PAP pero ningún Cliente propio está probado, se muestra el valor del Grupo y se ofrece resolver el ámbito inferior; no convertirlo en cero del Grupo ni duplicarlo en los hijos.

Comprueba fechas, ventanas, selección de estado/snapshot, joins que multiplican o eliminan hechos, perfil/cobertura y denominadores. El mismo conjunto observado alimenta tabla, KPI, evolución, detalle y exportación. Recuento de correctivos observado debe verse aunque falten usuarios: en Por usuario se indica que no puede dividirse y en Total muestra el conteo.

## 11. Calidad: interruptor Por usuario / Total

Añade arriba un único control claro **Por usuario | Total**, predeterminado Por usuario. Se conserva en URL, navegación de los seis KPI, ficha/detalle, evolución y CSV. Cambiar modo recalcula valores, referencias, colores y global de forma coherente; no es solo cambiar un texto o multiplicar una cifra en el navegador.

| Medida | Total | Por usuario |
| --- | --- | --- |
| Dedicación | Horas observadas del perfil del KPI | Horas / exposición de usuarios del periodo |
| PAP correctivos | PAP únicos del periodo | PAP / exposición de usuarios |
| Escalados N3 | Tickets únicos del periodo | Tickets / exposición de usuarios |
| Incidentes/problemas: flujo | Conteos únicos del periodo, diferenciados en detalle | Conteos / exposición de usuarios |
| Backlog: stock | Abiertos/envejecidos de la observación elegida | Conteos / usuarios al corte observado |
| Bugs/afectaciones | Unión de problemas de clientes vinculados a Bug_ o causa estándar | Unión / exposición de usuarios |
| Client Health | Feedback categórico | El mismo feedback, sin dividirlo por usuarios |

En Por usuario mostrar unidades comprensibles por **un usuario**, no seguir enseñando «por 100» bajo una etiqueta incompatible. Si internamente se conservan tasas por 100, la conversión de valor, límites y explicación es explícita y probada. Dos PAP con 10 usuarios en un mes completo = **0,2 PAP/usuario**. No es la media de ratios de los Clientes de un Grupo.

Mantén exposición mensual y prorrateo de usuario en mes parcial; con cambios de licencias, usa usuarios mes y periodos equivalentes. El stock usa usuarios de su fecha, sin sumar stocks mensuales. Total **no necesita matriz de usuarios**, ni bloquea su color por ese denominador ausente. Por usuario con usuarios ausentes/0 no divide entre uno ni inventa cero; conserva el numerador visible y motivo local.

Los seis KPI no se suman como horas+PAP+tickets. «Total» se refiere al numerador de cada KPI; el global sigue combinando severidades con sus pesos. Un agregado de por usuario sale de componentes pertinentes del mismo ámbito, sin duplicar licencias compartidas o sumar usuarios de hijos para inventar el total del Grupo.

## 12. Perfil inicial de Calidad operativo y editable

**Cambio expreso de esta propuesta:** ya no inicializar todos los métodos en blanco esperando calibración manual. Implementa el perfil inicial siguiente, claramente documentado como **configuración inicial HOTFIX-03**, editable y versionado. No es un benchmark científico ni una garantía de ausencia de fallos; es el criterio operativo inicial solicitado para comparar clientes.

Instálalo activo al aplicar el hotfix cuando no haya calibración manual activa. Conserva revisiones inmutables y crea una revisión nueva con procedencia técnica si procede, sin fingir que Dennis pulsó Activar ni alterar eventos pasados. No sobrescribir revisiones personalizadas ni borrar borradores; si existe un borrador, mantenerlo y señalar su base anterior. La instalación es idempotente y también funciona en una base nueva. No crear usuarios de login para simular un actor de auditoría.

### Perfiles, referencia y umbrales técnicos

- Dedicación: selección inicial **CS N1, CS N2 y mantenimiento PMO N3** con política histórica de fuentes. ANA/DEV se desglosan; rol PMO ausente no excluye por sí solo horas PMO elegibles conocidas. IT/Plataforma se conservan como desglose/contexto, sin añadirlos silenciosamente al KPI. Todo editable.
- Referencia propia de Calidad por cada ámbito —Grupo y Cliente separados—, modo Total/Por usuario, métrica y periodo. No exigir configurar Pulse para disponer de esa referencia ni alterar los perfiles de Pulse como efecto colateral.
- Cohorte inicial: entidades externas activas con valor válido y cobertura compatible de esa métrica. **Soporte/Servidor, búsqueda, orden y paginación cambian las filas visibles, no recalibran la referencia en cada clic.** El filtro Inactivos puede compararse con la referencia activa, identificada en el detalle. La definición de referencia también es configurable.
- Menor carga es mejor en los cinco KPI técnicos. Percentiles inclusivos **P25/P75**, muestra mínima inicial **5 entidades válidas**: verde x≤P25, amarillo P25<x≤P75, rojo x>P75. Intensidad más favorable hasta P10 y más desfavorable por encima de P90, sin añadir más colores al global.
- Empates: todos los valores iguales y cero confirmado → verde; todos iguales y positivos → amarillo relativo, no un verde colectivo por caer todos justo en P25. Si P25=P75 con muestra no constante, conservar igualdad/empates sin repartir colores por ID/orden; valores iguales tienen resultado igual. Ningún desempate aleatorio.
- Menos de cinco valores válidos → «Muestra insuficiente», sin color definitivo; no «sin calibrar» ni verde inventado. La muestra y cortes se ven en el detalle; la tabla principal permanece limpia.
- Total y Por usuario calculan **referencias distintas de sus propios valores**; no reutilizar un corte de horas/usuario para horas totales ni cambiar el valor dejando el color viejo. Unidades de umbrales existentes se migran/adaptan de forma explícita y solo donde sea equivalente.

### Health, backlog y composición

Health: Positivo→verde, Mixto→amarillo, Negativo→rojo; vacío sigue en blanco. No arrastrar Health de otro mes o asignar positivo por defecto.

Incidentes/problemas: conserva flujo del periodo y componentes de backlog separados; composición inicial **peor señal disponible con cobertura suficiente**, sin sumar un ticket del flujo otra vez como backlog. Edad preocupante inicial: incidente **más de 7 días naturales**, problema **más de 30**, ambos configurables. Evalúa por separado incidentes y problemas envejecidos con su propia referencia/unidad y muestra; los dos tipos siguen visibles en detalle.

Para el stock usa observaciones completas compatibles por contrato de fuente; una recepción del archivo es observación operativa, no extracción real inventada. La política inicial admite la última observación anterior al corte con antigüedad máxima **7 días**, identificando siempre fecha y carácter provisional cuando no sea exacta. Nunca proyectar hacia atrás un status recibido después del corte. Si no existe stock utilizable, **conservar el flujo y marcar la composición parcial**; no borrar sus conteos ni afirmar un global completo. La fuente de un componente ausente no invalida KPI que no la usan.

### Pesos y resultado global inicial

Seis pesos iguales exactos que suman 100 %. Si Health está vacío, los otros cinco tienen 20 % cada uno. Un técnico sin datos no redistribuye su peso ni cuenta como cero. Configuración personalizada exige suma exacta, sin introducir 100,02 por redondear seis veces 16,67.

Severidad: verde=0, amarillo=0,5, rojo=1. Global = suma ponderada. **Verde si ≤0,25; amarillo si >0,25 y ≤0,50; rojo si >0,50.** Por ejemplo, sin Health, tres técnicos rojos y dos verdes dan 0,60 → rojo. No convertir un único rojo en rojo global por otra regla no pedida.

Un global requiere resultados calculables de todos sus KPI con peso positivo. Con datos/componentes parciales, mostrar «Parcial» y las señales conocidas sin pintarlo como completo. **«Sin calibrar» no puede seguir apareciendo por la ausencia del método inicial que esta entrega debe instalar.** Muestra insuficiente, usuarios ausentes y datos parciales son limitaciones distintas, localizadas y accionables.

Configura en Administración pesos, perfiles, referencia, percentiles, muestra mínima, límites del global y edades. Simulación/revisión/activación conservan las garantías existentes. La evolución usa cada mes y modo con sus propios valores, cohorte, usuarios y disponibilidad, manteniendo la revisión de configuración declarada; no copiar cortes del mes actual a todos los meses.

## 13. Pruebas de cierre: datos, interfaz y actualización realista

Base PostgreSQL `_test` aislada con guard efectivo antes de mutar, nunca `cs_app` de Dennis. Fixtures públicas sintéticas. Ensayos de los dos adjuntos reales en entorno privado separado; no versionar nombres/correos/IDs reales, libros, originales descifrados o capturas nominativas. Informar «maestros reales + hechos sintéticos» cuando esa sea la prueba, sin atribuirse sus operativos locales.

Casos mínimos con expectativas independientes:

1. Importar formatos nuevos 8/6 columnas y antiguos 11/7 + PMO; sin depender del nombre de hoja. Repetir no duplica ni borra roles, estados, aliases o ajustes. Duplicado Personal 47/75 consolidado; conflicto Clientes 63/82 localizado, resto aplicado.
2. Crear solo Grupo → aparece en tabla → completar Zendesk/Wrike/PAP → hechos ya cargados se atribuyen automáticamente. Hechos primero/maestros después y orden inverso producen las mismas cantidades. Guardar una corrección no exige reimportar.
3. Múltiples Clientes y alias/proyectos por Grupo: sin producto cartesiano ni duplicación de horas/PAP/ingresos. Datos solo Grupo suman a Grupo y no a todos los hijos. Celdas faltantes/configuradas/No aplica/conflicto reflejan el caso real.
4. Edición desde tabla con conflictos de versión, permisos Consulta, auditoría y vigencias. Alias desactivados/PMO histórico/roles ya informados preservados. Persona inactiva mantiene atribución histórica.
5. Cliente y Grupo Activo/Inactivo/Todos en las cuatro vistas, maestros y exportaciones; parser ya no ignora estado. Grupo mixto y Grupo sin hijos tienen semántica probada. No quitar solo horas de un hijo inactivo del ratio económico del Grupo.
6. Reproducir ratio vacío con R/H conocidos, horas pendientes y sin usuarios. Corregir lo resoluble; con perímetro observado calculable aparece cifra provisional coherente con H mostrado; fuente realmente ausente o H=0 sigue — con razón.
7. Soporte automático, Admin Delegada y excepciones explícitas. Corte PMO 31/12/2024 y 01/01/2025. Un problema financiero de otro Grupo no vacía todos los ratios. Silver On Demand/Grupo mixto con fuente anual sigue el método nuevo en los cinco periodos.
8. Ejemplo económico independiente: anual 12.000, mes completo R=1.000, H=16 → **500 €/jornada** con jornada 8. Con corte 15/30 y H=8 → también 500. Si R=0 confirmado/H>0 → 0; sin fuente no 0.
9. Fronteras económicas con T=550: 329,99 rojo; 330 naranja; 440 amarillo; 549,99 amarillo; 550 verde; 660 verde intenso. Cambiar T desplaza cortes. Desconocido neutro/provisional diferenciado; colores iguales en ficha/CSV con estado.
10. Todas las columnas ordenan ambos sentidos, especialmente tarifa, usuarios, servidor y cada €/jornada; números 9/80/1.200, ausentes y empate estables, sin ordenar solo página. CSV/URL/volver conservan orden y filtros.
11. PAP correcto sin ticket y solo Grupo aparece en Calidad; varias causas con Correctivo cuenta una vez; Petición cliente no implica correctivo; sin fecha se localiza, sin Resultado=OK no se pierde. Recuento tabla/KPI/detalle/CSV concilia.
12. Total con usuarios ausentes muestra/coloriza datos válidos; Por usuario preserva numerador e informa división imposible. Dos PAP y 10 usuarios en mes completo → Total 2 / Por usuario 0,2. Cambiar usuarios no cambia Total; cambia Por usuario. Health no se divide.
13. Perfil inicial activo en instalación nueva y actualización sin calibración; aplicar dos veces no crea activaciones repetidas. Configuración manual/borrador anterior conservados. Calidad funciona sin configurar Pulse.
14. Percentiles por ámbito/modo/mes, mínimo de muestra, ties, todos cero y todos positivos iguales; filtros visuales no mueven cortes y el cambio Total/Por usuario sí recalcula con la unidad apropiada. Sin fuentes no verde.
15. Health vacío redistribuye a 20 %; técnico ausente conserva peso y deja global parcial. Global 0,60 rojo en el ejemplo dado; límites exactos reproducidos. Usuario Consulta no altera configuración ni maestros.
16. Incidentes/problemas con causas/estados y sin horas, edades de 7/8 y 30/31 días, fecha observada/provisional. Un snapshot posterior no reconstruye un backlog anterior. Flujos no se borran por stock ausente ni se suman con él.
17. Menú simplificado con destinos antiguos compatibles; descargas grandes, propiedad de archivo, cancelar, trabajador, salud y copia/recuperación siguen disponibles. Reenlace, exportaciones y vistas recuperan tras fallo representativo sin doble suma.

Ejecuta tipos, lint, build web/trabajador, pruebas pertinentes de maestros/relaciones/motor/Calidad/consultas, migración limpia y actualización con datos existentes. Recorrido de navegador compilado con filas representativas y cifras, **no solo existencia de textos**. Verifica visualmente Administración completa, las dos tablas, Comparativa y Calidad a 1920×1080 y 1536×864; adaptación móvil sin romper acciones.

Usa el volumen representativo existente para detectar N+1 en tablas, referencias y reenlace; informa consultas, tiempos y memoria medidos sin prometerlos como SLA. No repetir campañas enormes ajenas al cambio. Conserva legibilidad, ancho ganado y ficha única de HOTFIX-02.

## 14. Migración, documentación e instrucciones de Dennis

Migraciones incrementales; no editar las anteriores, resetear, `TRUNCATE`, `DROP CASCADE`, `db push` o regenerar maestros al arrancar. Copia verificada antes de cambios de datos/esquema. Configuración inicial y reparación de derivados son idempotentes, auditables y compatibles con revisión anterior. Las revisiones de exportación ya congeladas conservan su manifiesto; lecturas nuevas usan los datos corregidos.

Documenta por separado: formato maestro nuevo/compatibilidad, estado comercial, cálculo provisional/Silver, bandas económicas, modos/unidades de Calidad y perfil inicial. Actualiza contratos, índice, estado y decisiones que esta propuesta modifica. No mantener como pendientes de calibración las reglas que aquí se han definido para inicializar; no declarar aceptadas otras propuestas ajenas.

Guía única del hotfix para **`C:\Projects\cs-app`, PostgreSQL `cs_app`**: parar y copiar, actualizar rama/SHA correcto sin borrar `.env`, dependencias/migración/build de web y trabajador con comandos PowerShell vigentes, preparación de la configuración inicial y arranque. No pedir recrear la base ni volver a cargar todo. Si falta la tabla nueva, importar solo el maestro correspondiente y revisar diferencias; ejecutar recuperación del reenlace solo si está atascado, no lote por lote.

Recorrido corto: crear Grupo y completar una fila → comprobar enlaces → activar/desactivar y filtrar → ordenar rentabilidad → comprobar 550 verde → Calidad Total/Por usuario → revisar PAP de un Grupo → comprobar global y abrir causas de un dato parcial. Explica con lenguaje de usuario dónde quedaron las herramientas técnicas.

Informe final y una sola PR: causas demostradas, qué ratios se recuperaron y por qué, cambios de método propuestos aquí, compatibilidad, valores/estados verificados, importaciones realmente ensayadas, capturas sintéticas de UI, pruebas y guía. No afirmar que se conciliaron los archivos operativos de Dennis o que Windows se probó si no se hizo. No cerrar solo porque el diseño sea más ancho: deben funcionar las relaciones, las cifras, el orden y la configuración inicial.

Detente tras HOTFIX-03; sin fusionar ni desplegar por iniciativa propia.
