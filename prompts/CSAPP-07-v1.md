# CSAPP-07-v1 — Pulse Rent y configuración de Calidad

## 1. Encargo, base y dependencia de CSAPP-06

Trabaja exclusivamente en `bateman37/cs-app`. Implementa **CSAPP-07 completa**, séptima de las diez entregas. Guarda este prompt literal, sin resumirlo ni corregirlo, en `prompts/CSAPP-07-v1.md` antes de modificar aplicación, migraciones o pruebas. Actualiza el índice de prompts; decisiones y discrepancias se registran aparte.

Dos resultados funcionales:

1. **Pulse Rent operativo**: métricas, normalización por usuarios, referencias explícitas, media/mediana/percentiles, cinco bandas, detalle y CSV.
2. **Configuración en Administración**: referencias y reglas de Pulse Rent; seis pesos, umbrales, composición y opciones de Calidad, con revisión, simulación y activación controlada. El dashboard de Calidad y Client Health se implementan en CSAPP-08.

Al preparar el prompt el **01/11/2026**, el informe pegado por Dennis era de CSAPP-05, pero Git permite localizar CSAPP-06:

| Referencia comprobada | Estado |
| --- | --- |
| `main` `f71b5b7283ab1081802cc6256899a02f70460a74` | Incluye CSAPP-05, merge de PR 6 |
| PR 7, cabeza `8c92ab835d6003016d2222a0396158044b51dcd2` | Contiene CSAPP-06; todavía no incluida en ese `main` |
| Validación declarada por CSAPP-06 | Linux, 392 pruebas, 238 comprobaciones de navegador; sin migración nueva, archivos reales, Windows ni aceptación de Dennis |

Comprueba el estado real al comenzar. Si CSAPP-06 ya está fusionada, parte del `main` actualizado. Si sigue en PR 7, utiliza una **rama nueva de CSAPP-07 basada en su cabeza** y una PR apilada contra la rama de CSAPP-06, dejando clara la dependencia y mostrando solo el diff de 07. Cuando 06 entre en `main`, ajusta la base conservando historia. No reconstruyas 06 desde 05 ni metas 07 en la rama/PR abierta de 06. Si el entorno obliga a reutilizar exactamente una rama ocupada por PR 7 e impide una rama distinta, informa de ese impedimento antes de contaminarla; no resuelvas fusionando por tu cuenta.

Rama sugerida: `feature/CSAPP-07-pulse-rent-configuracion`. No uses ni intentes force-push, rebase de historia publicada ni borrado de ramas ajenas. Respeta cambios locales. Una PR propia sin fusionar ni desplegar. Mantén cuatro vistas: Comparativa, Análisis Cliente, Pulse Rent, Calidad; el resto es Administración. No avances a CSAPP-08.

## 2. Lecturas y reutilización

Lee `AGENTS.md`, `CLAUDE.md`, `docs/00-index.md`, `docs/plan/estado.md` y este prompt. Después, por responsabilidad:

- `docs/producto/pulse-rent.md`, PUL 01–05, y `docs/calculos/catalogo.md`, unidades, denominadores, estadística y motor vigente.
- `docs/producto/administracion.md`, ADM 02–07, 09–11; `docs/producto/calidad.md`, seis indicadores, QLT 03–10/QHL 01; `docs/producto/backlog-antiguedad.md`, BACK 04–10, para configurar correctamente el futuro indicador compuesto.
- `docs/arquitectura/analitica-csapp06.md`, `docs/arquitectura/finanzas-motor-csapp05.md`, matriz de usuarios y contratos de las fuentes solo donde haga falta.
- `docs/validacion/csapp-06.md` y la política de datos/pruebas. No cargues todo el árbol documental ni todos los prompts anteriores.

Código revisado en la cabeza de PR 7: `src/server/analytics/{snapshot,stamp,portfolio,ficha,operational,detail,export}.ts`, `src/domain/analytics-query.ts`, `src/server/economics/{engine,settings}.ts`, `src/domain/{finance,pap}.ts`, página de configuración y núcleo E2E. Reutiliza cálculos, SQL comunes, permisos, formatos y componentes existentes. No llames a la ficha una vez por cliente para construir Pulse Rent: prepara agregaciones por conjuntos.

La revisión para este prompt fue lectura de código/contratos, no ejecución de sus pruebas ni auditoría completa de PR 7. Verifica lo heredado. No actualices stack/dependencias por rutina. Migraciones incrementales; no edites las cinco anteriores ni resetees bases de trabajo.

## 3. Prioridad previa: impedir pruebas sobre una base equivocada

La validación de CSAPP-06 registra un incidente real: una importación estática dejó un cliente conectado a `cs_app`; una preparación de pruebas vació esa base del contenedor, declarada vacía, y creó dos cuentas sintéticas. El informe dice que su limpieza fue bloqueada por permisos. **No se autoriza aquí borrar esas cuentas, limpiar esa base ni reintentar el borrado por otro canal.** Conserva el incidente y su pendiente; este encargo corrige la prevención, no ejecuta una limpieza de datos reales.

Antes de lanzar suites que muten datos:

- En `scripts/e2e/nucleo.ts`, `prepareDatabase(dbUrl, prisma)` comprueba actualmente el nombre de la URL, pero el `TRUNCATE` se ejecuta mediante el cliente recibido. **Comprueba también `current_database()` en la conexión que ejecutará la operación**, contra el destino de test autorizado. Validar A y borrar B queda prohibido por código.
- Centraliza el guard de pruebas para E2E, resets, fixtures, benchmarks y migraciones de test. Exige `TEST_DATABASE_URL` explícita, nombre permitido `cs_app…_test` y destino distinto de la base de trabajo. Ni `NODE_ENV=test` ni un nombre que aparezca en contraseña/query prueban aislamiento.
- Establece el entorno antes de importar singletons; evita que un módulo de casos abra/capture la conexión de desarrollo por sus imports. El cliente validado, el de preparación y los procesos web/trabajador de test deben apuntar al mismo destino aprobado.
- Rechaza una conexión discrepante **antes de cualquier DDL, TRUNCATE, seed, cuenta o migración de prueba**. Un fallo de validación no modifica nada. No se prueban los rechazos ejecutando operaciones destructivas sobre `cs_app`.
- Añade pruebas negativas de URL insegura, variable ausente, importación anticipada y URL válida con cliente conectado a otro destino, con dobles controlados y una base aislada. Verifica que no se emite ninguna mutación y que el recorrido válido continúa. Mantén limpieza de los procesos propios ante fallo; nada de `killall`/`pkill node`.

No ocultes el incidente en el estado ni lo declares solucionado porque una nueva ejecución pase. Registra por separado prevención probada y residuos anteriores pendientes de decisión.

## 4. Catálogo explícito de métricas de Pulse Rent

Implementa `/pulse-rent`. Cada métrica tendrá ID estable, etiqueta, familia, fuente, ámbito admitido, periodo, unidad, numerador, denominador, variante de normalización, dirección y estado de cobertura. No fórmulas de código introducidas por el administrador ni dependencias de etiquetas de pantalla para hacer sumas.

Preserva las **23 métricas de partida**:

| IDs funcionales | Métricas |
| --- | --- |
| 01–03 | CS N1: total, incidente Vincle confirmado, otro soporte clasificado, por usuario |
| 04–06 | CS N2: las mismas tres variantes |
| 07–09 | PMO N3: las mismas tres variantes |
| 10 | Ingreso anual de soporte por usuario; equivalente del periodo como variante identificada |
| 11–14 | PAP evolutivos no facturables, correctivos de proyecto, correctivos estándar, origen cliente; bruto y variantes normalizadas distinguidos |
| 15 | Porcentaje N2→N3: tickets únicos con N2 y N3 / tickets únicos con N2 |
| 16–17 | Horas CUM del año seleccionado; usuarios contratados al corte |
| 18–20 | €/jornada CUM actual; desviación contra objetivo; desviación contra cartera de referencia |
| 21 | €/jornada del año anterior completo, con su periodo explícito |
| 22–23 | Horas totales por usuario YTD/anual equivalente; PAP únicos por usuario del periodo |

Añade las **seis variantes IT N3 y Plataforma N4** —total/incidente/otro soporte de cada perfil— ya previstas en el contrato. Incluye como métricas adicionales seleccionables N3 por usuarios/exposición y porcentaje N3 sobre el conjunto total de tickets, con IDs propios. No sustituyas el denominador N2 de la métrica 15 por todos los tickets.

Los perfiles deben usar IDs/dimensiones canónicas de personal y vigencias, no `label.includes(...)`. Si falta la correspondencia de CS N1/N2/PMO/IT/Plataforma, muestra «perfil sin configurar» y permite resolverla en Administración; no publiques cero por no encontrar una cadena. Conserva PMO de rol desconocido en el total PMO elegible y en su desglose; no descartes sus horas para hacer coincidir ANA+DEV. Mantén la política de fuentes de 2025 y evita duplicados entre Zendesk/Wrike por la elegibilidad existente.

Para horas conserva la partición: incidente confirmado + otro soporte clasificado + sin clasificar/pendiente = total. Las nueve columnas iniciales no permiten esconder el tercer componente: muéstralo en detalle y como variante auxiliar. Si se ofrece equivalencia histórica «total − incidente», identifícala porque incluye lo no clasificado. No confundas otro soporte con OTROS financiero.

Los PAP se cuentan por lista+ID, cualquiera de sus causas correctivas basta y origen cliente permanece. Categorías solapadas no suman el total único. La implementación de 06 declara **sin evidencia de facturación** para evolutivos: no los llames no facturables sin evidencia positiva. Mantén la métrica 11 identificada y no disponible si esa evidencia no existe; el conteo de evolutivos observados se ofrece aparte con su nombre y detalle. No añadas un campo de facturación manual o inventes su valor solo para rellenar la columna.

No conviertas todos los campos a «por usuario»: porcentajes, €/jornada y desviaciones ya son ratios. Horas brutas y stock de usuarios son contexto. Por defecto estos dos se muestran sin juicio favorable/desfavorable; sus estadísticas descriptivas pueden consultarse. Las magnitudes de carga normalizadas usan menor=menor carga; tarifa/€/jornada usan mayor=mejor rendimiento económico; desviaciones económicas conservan su signo. Ninguna de esas bandas declara por sí sola calidad del cliente ni crea un séptimo KPI.

## 5. Periodos, normalización y cobertura

Reutiliza el contrato temporal de CSAPP-06. Por defecto: hoy en Europe/Madrid, corte diario, SOPORTE, filas por Grupo Cliente, CUM actual y normalización anual equivalente de las magnitudes de flujo. Permite mes seleccionado, mes completo y comparación anterior sin mezclar sus cortes. El año anterior completo permanece distinto del CUM comparable. No presentes un mes en curso como cerrado.

Ofrece normalización correcta y un modo de equivalencia histórica separado:

| Magnitud | Normalización correcta |
| --- | --- |
| Horas por usuario mes | `H_periodo / UM_periodo` |
| Horas equivalentes anuales por usuario | `12 × H_periodo / UM_periodo` |
| Eventos por 100 usuarios mes | `100 × eventos_únicos / UM_periodo` |
| Eventos anuales equivalentes por 100 usuarios | `1200 × eventos_únicos / UM_periodo` |
| Tarifa aproximada anual, año completo | `ingreso_anual / usuarios_medios_de_los_12_meses` |
| Equivalente anual de ingreso por usuario | `12 × ingreso_periodo / UM_periodo` |
| Stock de usuarios | Valor del mes del corte, sin sumar ni prorratear |

UM es exposición en usuarios mes: cada mes pesa días incluidos/días reales. Mes completo: UM=usuarios del mes. Corte parcial: pondera exposición e ingreso, **no las horas o eventos ya registrados**. Usuarios medios = UM / exposición temporal en meses, no stock final. 65 hasta mayo y 68 desde junio producen 665 usuarios mes y stock 68 a octubre completo. Un mes sin informar no se rellena con cero ni se omite del denominador.

Las métricas PAP/eventos ofrecen bruto y variante normalizada con unidad visible. El modo inicial normalizado no oculta el numerador original. Una variante se aplica a toda la columna y su referencia: no compares un bruto con percentiles anualizados. Los equivalentes no son predicciones de eventos futuros ni tarifas contractuales.

Equivalencia histórica de horas = `H_CUM / U_corte / número_mes × 12`, con supuesto de usuarios constantes y meses completos explícito. No sustituye la normalización correcta ni se activa en un corte parcial ambiguo. Una referencia usa el mismo método para todos sus miembros. Mantén Silver On Demand y los demás pendientes según el motor; no anualices cobros parciales ni habilites sus ratios recurrentes por disponer de percentiles.

Selector de ámbito: Grupo Cliente, Cliente y, cuando haya atribución real, implantación. Nunca mezcles padres e hijos como observaciones de una misma referencia. Cada ámbito utiliza sus usuarios propios, sin sumar usuarios compartidos ni heredar el total del grupo. En Cliente/implantación sin ingreso propio, métricas económicas no calculables con «ingreso agrupado en Grupo Cliente»; las operativas pueden funcionar.

Conserva cero confirmado, dato ausente, no aplicable, parcial, sin configurar y sin calibrar. Un importador instalado o una consulta SQL vacía no prueban cero. En 06 algunos resúmenes operativos devuelven ceros aun sin fuentes: añade cobertura antes de reutilizarlos. Una fuente relevante ausente/incompleta impide publicar ese cero como evidencia o incorporarlo a una referencia válida. Un mes parcial correctamente cortado sí puede ser calculable y provisional: no lo descartes solo por no haber terminado el mes.

La validez es **por métrica**. Sin usuarios no hay ratio por usuario, pero puede haber €/jornada. Sin horas pueden existir tickets/escalados/PAP. Si faltan causas, conserva el total conocido, la parte sin clasificar y el límite de las variantes afectadas. Registros no asignados y fuentes observadas parcialmente se explican; no produzcas bandas verdes por ausencia de datos.

## 6. Cohortes y estadística reproducible

Separa en la interfaz y el contrato:

1. **Filas visibles:** búsqueda, filtros de presentación, orden, página y columnas.
2. **Referencia estadística:** población elegida explícitamente para calcular cada distribución.
3. **Referencia económica:** cartera ponderada usada por la desviación contra cartera. Por defecto usa los grupos de la referencia elegida, pero se identifica como ratio económico, no como media aritmética de ratios.

Ocultar una fila, buscarla, cambiar página u ordenar no modifica silenciosamente la referencia. Si el usuario elige «usar filtros visibles como referencia», es una acción explícita que copia esos criterios, con descripción/URL; después se distinguen ambas selecciones. La referencia incluye la propia entidad una vez si cumple sus criterios; no apliques leave-one-out implícito.

Referencias iniciales confirmadas: **sin Silver; Gold OP; Gold CLOUD; Platinum OP; Platinum CLOUD**, más todo el conjunto y personalizadas por producto/complejidad. Sin Silver significa plan conocido no Silver, no «cualquier desconocido». Un preset homogéneo no incorpora por accidente grupos con mezcla/incompatibilidad de planes/alojamientos o cobertura insuficiente. No uses el predicado «contiene algún Gold» de Comparativa como equivalente a «grupo homogéneo Gold OP». Explica exclusiones y fechas de los metadatos.

Los filtros seleccionan grupos completos para economía; nunca uses sus ingresos totales contra solo las horas de un producto/equipo. Sin cartera válida la desviación económica queda parcial/no calculable, aunque otras distribuciones existan. En ámbito Cliente/implantación no fabriques cartera de ingresos propios.

Por cada indicador/variante calcula sobre **toda** la cohorte de referencia válida, antes de paginar:

- N de entidades válidas, excluidas y motivos; cero confirmado participa y null no.
- Media aritmética de los valores de la métrica, mediana=P50 y P10/P25/P75/P90.
- Percentil inclusivo continuo: posición `(N−1)×q`, interpolación lineal entre adyacentes ordenados numéricamente, compatible con PERCENTILE.INC. Decimales exactos/racionales; sin convertir importes a `Number` para calcular o comparar.
- Un valor por identidad canónica/ámbito; varios alias, tickets, meses o fuentes no generan más observaciones del mismo cliente.

El N puede diferir por columna. N=0: sin referencia/banda; N=1 y percentiles coincidentes: estadísticas deterministas, tamaño visible y advertencia descriptiva, sin inventar dispersión. No introduzcas un mínimo de muestra arbitrario para cambiar las bandas históricas; el mínimo para colorear **Calidad** se configura aparte. No añadas epsilon ni anchuras artificiales a los límites.

No llames «media de cartera» a la media aritmética de €/jornada de los clientes. Expón por separado esa distribución y el ratio económico `ΣR/ΣH×jornada`. Si la cohorte tiene ingresos/perímetro incompletos, conserva los límites heredados de 06: no obtengas un completo falso sumando solo las filas convenientes.

## 7. Cinco bandas de Pulse Rent y experiencia de uso

Implementa exactamente PUL 03 para magnitudes de carga:

| Intervalo | Banda descriptiva |
| --- | --- |
| `x <= P10` | Verde intenso |
| `P10 < x <= P25` | Verde claro |
| `P25 < x <= P75` | Amarillo |
| `P75 < x <= P90` | Naranja |
| `x > P90` | Rojo |

Para tarifa/€/jornada: `x < P10` rojo; `P10 <= x < P25` naranja; `P25 <= x < P75` amarillo; `P75 <= x < P90` verde claro; `x >= P90` verde intenso. Evalúa en ese orden cuando los cortes coinciden. El sentido invertido conserva sus igualdades propias. Muestra texto/leyenda, no solo fondo coloreado.

La configuración Pulse Rent permite dirección por métrica y referencias versionadas; la revisión inicial reproduce las reglas confirmadas. Una personalización se identifica como tal, sin sobrescribir el modo de equivalencia. No crees una puntuación global Pulse sumando 23/29 columnas ni conviertas estas cinco bandas en los tres colores de Calidad.

Tabla con identidad fija y columnas agrupadas por familia, selección de métricas, búsqueda, orden numérico estable con nulos al final, paginación y controles de periodo/normalización/referencia. Todos los estados y unidades son visibles. Guarda el contexto en URL sin rangos arbitrarios de IDs o SQL. Usa los componentes/estilos Vincle y corrige en los componentes reutilizados los solapamientos/recortes de ejes/hitos ya documentados en 06 si afectan a estos gráficos.

Al seleccionar una columna: distribución de referencia mediante un gráfico sencillo con P10/P25/mediana/P75/P90, N y posición del cliente seleccionado; tabla de estadísticas accesible equivalente. No hacen falta polígonos decorativos ni una librería pesada. Un caso sin muestra o con valores iguales se representa sin una curva inventada.

Cada celda abre una explicación integrada: valor bruto, fórmula, denominador, exposición, ámbito, corte, origen, estado, revisión, criterios de referencia, cortes usados y regla de banda. Desde el numerador se accede al detalle paginado autorizado que concilia con él. El selector de métrica cambia el predicado real del detalle: no abras siempre «todas las horas» cuando se pulsa solo incidente de N1 o PAP estándar.

Exporta **todas las filas visibles filtradas**, no solo la página, con valores, estados y bandas textuales, y estadísticas/criterios de referencia en una estructura tabular documentada. Reutiliza CSV autenticado, BOM/separador/escape, neutralización de fórmulas en texto y decimales de 06. Incluye corte, método, unidad, revisión, N y referencia de datos. No exportes originales de Cargas ni un conjunto truncado sin avisar.

## 8. Configuración común en Administración

Amplía `/administracion/configuracion`, conservando economía de 05, con secciones **Economía / Pulse Rent / Calidad**. Las asignaciones de servicio existentes siguen operativas. No crees otra vista de negocio ni un segundo parámetro independiente para objetivo/jornada.

Persistencia, autorización ADMIN en servidor, formularios accesibles, motivo, autor, comparación antes/después, historial, revisiones inmutables y rechazo de edición obsoleta. Guardar borrador, simular y activar son acciones diferenciadas. Activar requiere validar todo lo necesario para esa sección; volver a una configuración anterior crea una nueva activación identificada, no modifica historia. No exige otra aprobación externa inventada: el Administrador elige la configuración mediante la acción explícita.

Mantén contratos tipados por familia de configuración y un manifiesto de revisiones aplicadas, evitando un JSON de fórmulas arbitrarias o un documento técnico gigante. Economía, Pulse y Calidad pueden evolucionar por separado sin reiniciar valores de las otras secciones. No cambies parámetros al ejecutar una consulta GET. Extiende la referencia/sello de datos de 06 con las configuraciones que afectan al resultado; una nueva referencia/dirección activa debe invalidar las bandas anteriores.

En Pulse configura presets/criterios de referencia, dirección y selección canónica de perfiles. En Calidad configura los seis nombres completos, unidades, normalización, ámbito y método. No muestres códigos Q1 ambiguos como etiquetas de usuario. Los permisos Consulta permiten leer el análisis y conocer qué reglas se aplicaron, no acceder a mutaciones o información privada de auditoría.

## 9. Pesos exactos y cobertura de Calidad

Seis indicadores estables: **Client Health, Dedicación, PAP correctivos, Escalados N3, Incidentes y problemas, Bugs y afectación del estándar**. No añadas rentabilidad como séptimo ni un peso adicional para backlog.

- Modo inicial confirmado **Iguales**: cada uno tiene la fracción exacta `1/6`, total 100 %. No almacenes seis 16,67. La presentación puede mostrar 16,666… y explicar el redondeo.
- Modo Personalizado: seis porcentajes no negativos, hasta dos decimales, suma exacta 100. Compara enteros en centésimas de porcentaje (10000), no una tolerancia flotante. Rechaza 99, 101 y 100,02 tanto en cliente como servidor.
- Peso cero desactiva influencia y conserva dato/configuración. No borres un KPI ni sus columnas por ello.
- Sin feedback Client Health, su celda futura estará en blanco y se redistribuye **su peso** proporcionalmente entre los otros cinco. Con iguales: cinco `1/5`, 20 %. Con personalizados: `peso_i / (100 − peso_Health)`. Sin suma positiva restante, global no calculable.
- Esa excepción no autoriza a convertir una fuente técnica ausente en cero ni a redistribuirla silenciosamente. Política inicial: si falta un KPI técnico de peso positivo, no publicar un global completo; mostrar cobertura. Un KPI de peso cero no bloquea el global por falta de datos.

Implementa funciones puras y su simulador para mostrar pesos configurados/efectivos, elegibilidad y cobertura. En 07 usa escenarios de simulación claramente identificados; no escribe feedback ni muestra un global real por cliente en Calidad. Probar «sin Health» no requiere inventar Health positivo en la base.

## 10. Umbrales, composición y referencias de Calidad

Los pesos iguales sí están confirmados. **Los umbrales numéricos, mínimos de muestra y composición del global no lo están**: inicialízalos sin calibrar/borrador, sin verdes automáticos. No tomes ejemplos de pruebas como valores aprobados. Si el Administrador configura y activa una revisión válida, registra esa elección; continuar este roadmap no equivale a validarlos todos.

Contrato por indicador/componente: tipo numérico o categórico, ámbito, unidad, periodo/exposición, dirección, método absoluto o percentiles, referencia, límites e igualdades, muestra mínima elegida y estado de calibración. No permitir comparar una tasa mensual con un umbral anual ni un stock con usuarios mes.

Para método numérico, ofrece reglas deterministas en la simulación:

- Menor mejor: verde `x<=a`, amarillo `a<x<=b`, rojo `x>b`.
- Mayor mejor: rojo `x<a`, amarillo `a<=x<b`, verde `x>=b`.
- Absolutos: `a<b`, valores/unidades válidos. Percentiles: dos posiciones ordenadas dentro de [0,100] sobre una referencia explícita de la misma métrica; los cortes de valor pueden coincidir, con las igualdades anteriores y aviso. No fuerces la referencia ni P25/P75 por el hecho de existir en Pulse.
- Referencia insuficiente, dato inválido o umbral ausente devuelven sin referencia/no calculable/sin calibrar; nunca verde por defecto. Client Health usa estados categóricos, no límites de horas.

Configuraciones específicas que deben quedar preparadas para CSAPP-08:

| Indicador | Parámetros y límites de diseño |
| --- | --- |
| Client Health | Mapeo positivo/mixto/negativo y ausencia en blanco; propuesta explícita de verde/amarillo/rojo, sin arrastre mensual ni propagación de padre a hijos |
| Dedicación | Selección de perfiles/equipos canónicos y unidad por exposición. CS, PMO, IT y Plataforma se mantienen desglosados; no asumas elegida una selección pendiente |
| PAP correctivos | Total único por cualquier causa correctiva; origen cliente participa. Configurar su tasa y referencia no permite excluir esas causas |
| Escalados N3 | PMO/IT como unión de ticket_id, mes por creación, tasa por exposición; tags no aportan fecha real de escalado |
| Incidentes y problemas | Flujo de altas y backlog envejecido por tipo como componentes separados; parámetros de abajo |
| Bugs y estándar | Unión de problem ticket_id externos vinculados a Bug_ o con causa estándar. No sustituirla por bugs únicos de producto, palabra BUG o escalados N4 |

Para Incidentes y problemas, editor de bandas de edad y umbral preocupante por incident/problem, referencias y tasas. Edad en días naturales al corte observado; envejecido es **edad > umbral**, no >=. Bandas ordenadas, sin solapamiento ni huecos no declarados. Stock divide por usuarios al corte; flujo por exposición. Un ticket antiguo open entra en backlog aunque no tenga alta en el mes. Fechas de cierre/problem_id no existen y no se reconstruyen.

Prepara como **propuesta desactivada** la composición BACK 07: peor señal entre flujo y backlog envejecido de incidentes y problemas. Necesita configurar sus componentes antes de activarse; no suma stock y flujo como tickets adicionales y conserva un único peso principal. El simulador prueba que un backlog rojo no acaba verde por tener pocas altas cuando se elige esa composición. Sin fotografías compatibles no inventa un componente histórico de backlog.

Para el resultado global, ofrece una plantilla propuesta, no activada: severidad verde=0, amarillo=0,5 y rojo=1, suma ponderada con pesos efectivos, con dos límites configurables dentro de [0,1] y sus igualdades declaradas. No asignes 0,33/0,66 u otros límites automáticamente. Esta plantilla permite dejar una regla concreta revisable para 08; no afirma que Dennis la haya aceptado. Si no se elige método/límites o hay cobertura técnica insuficiente, el simulador lo señala y no genera un color final. No actives salvaguardas de «un rojo obliga global rojo» u otras reglas que nadie seleccionó.

La simulación muestra entradas, unidades, reglas, pesos, cobertura y versión; usa ejemplos manuales/sintéticos y estadísticas existentes cuando sean compatibles. No aparenta calcular backlog o feedback reales que todavía no están implementados. Guardar o simular no altera hechos fuente, pesos activos ni colores publicados hasta la activación explícita de la revisión correspondiente.

## 11. Arquitectura, permisos y rendimiento

Un servicio analítico Pulse, funciones estadísticas puras y configuración versionada, reutilizando la lectura coherente y fuentes de 06. Agrega por entidad/periodo/perfil y calcula todas las métricas/reference en lotes, sin una consulta por celda, cliente o percentil. No reintroduzcas importaciones del Excel al visitar Pulse.

La respuesta incluye magnitud exacta, estado, componentes, referencia estadística/económica, revisión, periodo/método y fuente. Tabla, detalle, estadística, gráfico y CSV comparten criterios. Lee datos y configuración en la misma instantánea; conserva el mecanismo de frescura al navegar/exportar. Cambiar filtros rápidamente no debe dejar valores de la petición anterior bajo etiquetas nuevas. Caché solo privada con claves completas, o sin caché si no hace falta.

ADMIN y Consulta leen Pulse y explicaciones. Solo ADMIN modifica presets, pesos, umbrales, borradores o activaciones. Originales, decisiones de Cargas y operaciones de escritura conservan sus permisos. Comprueba sesiones reales y peticiones forjadas, no solo botones escondidos. Sin datos reales, estados vacíos claros y sin demo automática.

Mide con una fixture aislada de unos **1500 grupos, 250000 tiempos y fuentes sintéticas representativas de tickets/PAP**: tabla, cambio de referencia, normalización, orden/paginación, detalle y CSV completo. Registra tamaño, consultas, tiempo y memoria. Evita arrays de todos los tiempos/tickets en navegador; gráficos reciben distribuciones/agregados necesarios, no hechos masivos. No prometas cifras de rendimiento sin medir ni repitas el benchmark financiero ajeno si no cambia su motor.

## 12. Pruebas mínimas y aceptación

Pruebas puras, PostgreSQL real, migraciones y recorrido de navegador con aplicación/trabajador construidos. Fixtures sintéticas y base autorizada después de comprobar §3. Casos relevantes:

| Caso | Evidencia requerida |
| --- | --- |
| Estadística | [0,10,20,30] → P10=3, P25=7,5, mediana=15, P75=22,5, P90=27 y media=15; valores desordenados, negativos válidos, decimales y nulos |
| Bandas | Cinco intervalos y cada igualdad en ambos sentidos; percentiles coincidentes sin epsilon; N=0/N=1; valores constantes |
| Referencia | Ocultar/buscar/paginar no cambia cortes; elegir otra referencia sí; una entidad no se duplica por alias/mes; N válido diferente por columna |
| Normalización | 65→68: 665 usuarios mes y stock 68; exposición parcial; horas registradas no prorrateadas; equivalencia histórica y correcta difieren cuando cambian usuarios |
| Economía | 1000/10 y 1000/30: media de ratios distinta de cartera 400; cero horas conserva ingreso agregado; cartera incompleta no se vuelve AVAILABLE; TAR RUN 12R/UM |
| Unidades | Porcentajes/€/jornada no se dividen otra vez por usuarios; brutos vs tasas; mismo método/corte para todos los miembros de referencia |
| Ámbitos | Usuarios compartidos no se suman al grupo; Cliente sin ingreso propio no lo hereda; cohortes homogéneas excluyen mezclas/desconocidos con motivo |
| Fuentes | Sin fuente no genera cero verde; ticket sin horas sigue en eventos; perfil sin configurar no devuelve cero; faltan usuarios y €/jornada sigue calculable cuando corresponde |
| PAP | Varias causas/tickets un PAP; correctivo con otra causa; origen cliente; total no suma pertenencias; evolutivo no se supone no facturable |
| Escalados | Dos tags N3 cuentan uno; N2→N3 usa intersección sobre N2; cero denominador es no calculable; creación no se etiqueta como fecha real de escalado |
| Pesos | Iguales exactos total 100; sin Health cinco 20; 20+20+15+15+15+15 válido; 99/101/100,02 rechazados; sin Health queda 25+18,75×4; Health=100 y sin dato → no calculable |
| Cobertura de Calidad | KPI técnico ausente no es verde ni se redistribuye como Health; peso cero no bloquea; sin umbrales no hay color |
| Configuración | Borrador/simulación no alteran activo; activación atómica, auditoría, revisión anterior recuperable, edición concurrente rechazada, economía preservada |
| Composición propuesta | Backlog rojo con pocas altas no se suaviza al elegir peor señal; edad exactamente igual al umbral no es envejecida; stock/flujo usan denominadores distintos; sin fotografía no hay histórico inventado |
| Seguridad de pruebas | URL falsa/ausente, cliente discrepante e import anticipado fallan antes de mutar; guard se verifica en el cliente efectivo y pruebas válidas siguen aisladas |
| Permisos y CSV | ADMIN/Consulta leen; Consulta/anónimo no escriben; CSV completo, contexto/estados, escape y fórmulas textuales neutralizadas sin alterar negativos |

Navegador: Pulse sin datos, selección de familias, filtros de filas frente a referencia, normalización, leyenda y detalle de una celda, distribución, orden/página, CSV y perfil Consulta. Administración: pesos iguales/personalizados, rechazo del total inválido, simulación, borrador, activación y edición obsoleta; falta de calibración visible. Revisión visual a 1440 y 390 px, con teclado, etiquetas y alternativas tabulares a gráficos.

Ejecuta typecheck, lint, build, suites afectadas y regresión pertinente de Comparativa/ficha/importadores. Verifica migración en base limpia y actualización desde 06 con datos sintéticos conservados. Los 392 tests/238 comprobaciones previos son el registro de 06, no tus resultados. Diferencia pruebas ejecutadas de casos definidos y declara fallos/ajustes de tamaño o espera. Nada de vaciar bases para resolver un fallo del guard.

## 13. Documentación y entrega

Actualiza por propietario, sin duplicar todo en un documento enorme:

- `docs/producto/pulse-rent.md`: catálogo/variantes, unidades, cohortes, reglas de banda y UI, con IDs estables.
- `docs/calculos/catalogo.md`: fórmulas/percentiles y normalización; enlace a una tabla de métricas si el catálogo crece demasiado.
- `docs/producto/administracion.md`: configuración entregada, borradores/activación, pesos exactos y estado pendiente de calibración; Calidad/backlog solo donde se precisen nuevos contratos de parámetros.
- `docs/arquitectura/pulse-configuracion-csapp07.md`: esquema, servicios, revisiones, sello, predicados, seguridad y rendimiento; enlaza las reglas sin copiarlas todas.
- `docs/plan/guia-powershell-csapp07.md`, guía de configuración y `docs/validacion/csapp-07.md`: comandos, recorrido y resultados reales. No declarar Windows probado por escribir PowerShell.
- Índice, roadmap, guía documental, estado y `prompts/README.md`. Corrige contradicciones heredadas: CSAPP-06 no puede figurar a la vez implementada y sin iniciar; PR 6 ya estaba fusionada. Registra el estado real de PR 7 y la dependencia/base de 07.

No cargues archivos operativos reales ni financieros 2025/2026, no modifiques datos ya importados por Dennis y no crees muestras en su base. No versiones fuentes, nombres reales, secretos, contraseñas, volcados o capturas privadas. Conserva pendientes ZDT/ZTM, lista PAP, estados de bugs, signo de Diferencia, históricos y Silver sin presentarlos como aceptados.

Terminado: Pulse funcional con sus métricas y estados honestos, referencias y normalización explícitas, estadística/bandas reproducibles, detalles conciliables y CSV; configuración operativa con pesos exactos y reglas simulables/versionadas; prevención de la base equivocada probada; migración/pruebas/documentación completas. **No basta una tabla coloreada ni un formulario de pesos que no persista.** No hay aún un global real de Calidad por cliente ni matriz de feedback.

Abre PR propia, sin fusionar ni desplegar; contra `main` si incluye 06, o PR apilada con dependencia visible conforme a §1. Describe comportamiento final, verificación y límites. Respuesta final: rama/PR y base, SHA, migración, qué puede probar Dennis, pruebas/comandos/entorno/medidas, pendientes y recorrido breve. Distingue claramente lo confirmado de las plantillas propuestas y lo activado por el Administrador. Detente al finalizar CSAPP-07.
