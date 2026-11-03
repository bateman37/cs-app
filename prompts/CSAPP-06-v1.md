# CSAPP-06-v1 — Comparativa y Análisis Cliente

## 1. Encargo y resultado funcional

Trabaja exclusivamente en `bateman37/cs-app`. Implementa **CSAPP-06 completa**, sexta de las diez entregas. Archiva este prompt **literal, sin resumirlo ni corregirlo**, en `prompts/CSAPP-06-v1.md` antes de cambiar código, migraciones o pruebas, y enlázalo desde el índice de prompts. Las decisiones técnicas y discrepancias se documentan aparte; no se reescriben prompts ejecutados.

Esta entrega convierte las pantallas pendientes **Comparativa** y **Análisis Cliente** en herramientas utilizables con datos reales de la base: cartera económica, ficha individual, curvas comparables, desgloses y detalle explicable. Ambas consumirán el motor común de CSAPP-05, con las correcciones necesarias que se indican aquí. Incluye CSV de sus resúmenes y una aceptación manual preparada para Dennis.

Conserva exactamente cuatro vistas de negocio: Comparativa, Análisis Cliente, Pulse Rent y Calidad. Administración mantiene maestros, cargas y configuración. **Pulse Rent corresponde a CSAPP-07 y los seis semáforos/Client Health/backlog a CSAPP-08**. La ficha incorpora ahora sus hechos operativos, sin fingir que ya existe el módulo de Calidad. No avances a CSAPP-07, no despliegues ni fusiones la PR.

## 2. Base comprobada, lectura selectiva y Git

Al preparar este prompt el **01/11/2026**, Git muestra:

- `main`: `f71b5b7283ab1081802cc6256899a02f70460a74`, merge de la PR **6** de CSAPP-05.
- Cabeza de esa PR: `c6d520923c78aeac29fcfe01e4f6bc7f58a515d8`, incluida en `main`.
- El informe «PR 6 abierta sin fusionar» está desactualizado. Integración en Git no equivale a aceptación de Dennis, conciliación con sus archivos ni prueba en Windows.

Comprueba otra vez remoto, árbol local e instrucciones. Parte del `main` real; si ha avanzado, explica qué cambia. Respeta trabajo local ajeno. Rama sugerida: `feature/CSAPP-06-comparativa-analisis-cliente`; si el entorno designa otra, úsala manteniendo una PR aislada para esta entrega. **No uses ni intentes `push --force` o `--force-with-lease`**, ni reescribas historia publicada. No mezcles cambios con PR anteriores ni borres la rama remota sobrante mencionada en CSAPP-05: no es necesaria para construir estas pantallas.

Lee primero `AGENTS.md`, `CLAUDE.md`, `docs/00-index.md`, `docs/plan/estado.md` y este prompt. Después:

- `docs/producto/comparativa.md`, `docs/producto/analisis-cliente.md` y `docs/calculos/catalogo.md`, especialmente ECO 01–08 y CAL 01–05, 07–09, 17–30.
- `docs/arquitectura/finanzas-motor-csapp05.md`, los apartados de ámbitos/vigencias de `docs/producto/maestros.md` y `docs/arquitectura/usuarios-matriz-csapp02.md`.
- Solo las reglas necesarias de PAP, tickets, Wrike, bugs y diagnóstico para los desgloses de la ficha, mediante el índice.
- `docs/validacion/csapp-05.md`, política de datos y apartado CSAPP-06 del roadmap.

Entradas de código comprobadas: `src/server/economics/engine.ts` (`runEconomics`, `SERVICE_EVIDENCE_SQL`), `src/server/economics/detail.ts`, `src/domain/finance.ts`, `src/server/economics/settings.ts`, las dos rutas pendientes y `src/app/(app)/administracion/economia/page.tsx`. Reutiliza `TimeActivity`, modelos actuales y formato decimal de `src/lib/money.ts`.

Esta revisión previa fue **lectura dirigida**, sin ejecutar la aplicación ni sus pruebas. Verifica los hallazgos contra la base efectiva. No actualices dependencias por rutina ni rehagas autenticación, importadores o arquitectura. Solo añade migraciones incrementales si hacen falta; las cinco anteriores quedan intactas. No hagas reset ni toques otras bases.

## 3. Cerrar discrepancias del motor antes de publicar cifras

Estas cuestiones están observadas en el código de CSAPP-05 o declaradas como pendientes. Escribe primero contraejemplos y pruebas de regresión significativas; corrige el motor compartido, **no el valor en JSX**. Actualiza su versión si cambia el cálculo. No adaptes contratos para hacer pasar una fórmula incorrecta.

| Punto | Comprobación y comportamiento requerido |
| --- | --- |
| Equivalente anual por usuario | `engine.ts` utiliza `365 / días` en el periodo parcial. CAL «TAR RUN» establece **`12 × R_periodo / usuarios_mes_expuestos`**, coherente con ingreso anual/12 y exposición mensual. Con anual 12000, diez usuarios y corte 15/30: R=500, UM=5, equivalente=**1200 €/usuario·año**, no 1216,67. En doce meses completos, usa ingreso anual/usuarios medios anuales. Respeta la restricción de Silver On Demand. |
| Comparable de mes completo | `buildPeriods` desplaza el último día sin distinguir siempre el cierre comparable. **FULL_MONTH febrero 2025 → CUM anterior hasta 29/02/2024**; CUTOFF 28/02/2025 → hasta 28/02/2024. Conserva 29/02/2024 → 28/02/2023. No confundas ambos modos ni el año anterior completo. |
| Cartera incompleta | El bucle de cartera suma valores y publica `AVAILABLE` aunque algún ratio individual esté parcial por servicio/elegibilidad, exista un filtro que recorta solo horas o falte ingreso en parte del conjunto. Agrega también los estados y motivos: no eludas las restricciones de las filas mediante el total. Devuelve componentes conocidos, grupos afectados y cobertura. Un agregado del conjunto conocido no se anuncia como cartera completa. |
| Cero horas válido | Distingue lo anterior del grupo con ingreso confirmado y **cero horas**: ese ingreso permanece en la cartera. 1000/0 y 1000/10 producen 1600 €/jornada agregados si el resto del perímetro está completo, aunque el primer ratio individual no exista. No excluyas automáticamente todos los ratios individuales no calculables. |
| Explicación de desviaciones | La fórmula numérica puede ser correcta, pero `numerator`/`denominator` actuales guardan objetivo/ratio para la desviación contra objetivo y cartera/grupo para la otra. Devuelve los componentes reales: `(objetivo − ratio) / objetivo` y `(cartera − grupo) / cartera`, más los operandos y unidad necesarios. El detalle debe reconstruir exactamente el valor. |
| Provisional en las series | La serie mensual se construye con `provisional: false`. Propaga el corte y estado reales a filas, puntos, tarjetas y CSV; un mes parcial/en curso no pasa a cerrado por aparecer en una curva. |
| Prueba de lectura consistente | Ya existe una transacción `REPEATABLE READ`, pero no se forzó una escritura concurrente. Compruébalo con dos conexiones y barreras deterministas. La respuesta completa debe pertenecer a una instantánea coherente. No confundas falta de prueba con un fallo demostrado del aislamiento. |

En una cartera con datos necesarios desconocidos o perímetro económico inválido, el ratio principal será no calculable/parcial con motivo y componentes conocidos, sin un número presentado como resultado completo. Aplica lo mismo a sus desviaciones y exportación. La falta de usuarios por sí sola no impide €/jornada. No conviertas una cobertura parcial de un grupo en cero ingreso.

Comprueba asimismo `pendingRecalc`: una advertencia al final de la respuesta no convierte derivados obsoletos en resultados actuales validados. Conserva las magnitudes y explica su estado hasta el reproceso autorizado. No escribas ni reproceses datos automáticamente por visitar una pantalla.

## 4. Contexto común de las dos pantallas

Define un contrato de consulta compartido y validado en servidor: fecha de análisis, modo, servicio, revisión de configuración, ámbito y filtros de cartera; después orden/paginación y pestaña seleccionada. Debe poder conservarse en la URL, recargarse y navegar atrás/adelante. Cambiar filtros reinicia la página sin perder el resto del contexto. Valida fechas, enums, IDs, enteros y columnas de orden mediante listas permitidas; valores SQL parametrizados.

Valores iniciales: **hoy en Europe/Madrid, a fecha de corte, SOPORTE, última configuración activa**. No fechas fijas 2025/2026. Permite mes completo y última mensualidad finalizada como acceso rápido. «Mes completo» del mes en curso sigue siendo provisional: no certifica cierre ni inventa horas de días futuros. Muestra fecha solicitada, corte efectivo, método de ingreso y objetivo aplicados. La jornada/objetivo de una revisión son comunes a todos los bloques de la consulta, conforme a CAL 27.

Etiqueta el dinero como **ingreso imputado** y explica una vez «facturado + potencial anual distribuido linealmente». No lo llames facturas mensuales reales ni beneficio neto. «Rentabilidad» se presenta con su unidad **€/jornada dedicada**. `Diferencia` del export permanece separada como diferencia contra Budget, sin deducir su signo o un Budget absoluto.

Mantén cinco periodos distintos: mes seleccionado, mes anterior completo, CUM actual, año anterior completo y CUM anterior comparable. Las cabeceras muestran fechas/años concretos, no solo «actual/anterior». Enero compara diciembre anterior. Ingresos y horas comparten corte; las horas se suman por fecha de trabajo sin prorratearlas.

Continuar no acepta ZDT 11–13, ZTM 06–08, lista de origen PAP, estados de bugs, convención de Diferencia ni propuestas de Silver. Conserva la tabla de pendientes enlazada, sin convertir cada tarjeta en un aviso técnico. Silver Recurrente y Silver On Demand son distintos. No habilites por defecto ratios mensuales recurrentes ni equivalentes anuales no aprobados de Silver On Demand; muestra ingreso/horas conocidos con la limitación. Aplica la vigencia del plan al periodo valorado: un cambio actual de plan no habilita retrospectivamente otro método; si hay tramos incompatibles sin método aprobado, informa el límite.

## 5. Comparativa: tabla de cartera económica

Implementa `/comparativa`. La fila económica es **Grupo Cliente (BC)**, identificada así aunque el negocio la llamase «cliente» en Excel. No copies el dinero del grupo a cada Cliente/implantación.

| Bloque | Columnas obligatorias |
| --- | --- |
| Identificación | Grupo Cliente con enlace a ficha; plan de soporte; CLOUD/OP; producto(s); complejidad; estado del maestro y cobertura |
| Mes seleccionado | Horas del servicio, ingreso imputado, €/jornada, desviación contra objetivo y contra cartera filtrada |
| Mes anterior completo | Horas, ingreso imputado y €/jornada |
| CUM del año seleccionado | Horas, ingreso, usuarios al corte, usuarios medios del periodo, €/jornada y ambas desviaciones; exposición disponible en detalle |
| Año anterior completo | Horas, ingreso y €/jornada de sus doce meses |
| CUM anterior comparable | Horas, ingreso y €/jornada desde enero hasta el corte equivalente anterior |

Encima de la tabla: número de grupos del conjunto filtrado, ingreso y horas del periodo principal, ratio ponderado de cartera y su cobertura, con selector mes/CUM. Esas tarjetas, subtotales y «media filtrada» usan **todos los grupos filtrados, antes de paginar**. La referencia de mes y CUM se calcula independientemente. No uses media aritmética de ratios ni suma/promedio de porcentajes. Muestra cuántos grupos tienen ingreso sin dedicación y los importes afectados; no los escondas.

Ofrece búsqueda de grupo y denominación BC; filtros de soporte, alojamiento, producto, complejidad, estado y cobertura; servicio independiente del plan; orden estable por las métricas principales y paginación servidor. Los nulos no ordenan como ceros. Un grupo inactivo sigue consultable en su histórico; la baja actual no borra sus filas. Por defecto incluye los estados del maestro y permite filtrarlos explícitamente, sin retirar históricos de forma oculta.

Los filtros de identificación seleccionan **grupos económicos completos**. Para producto o Cliente vinculado, si la condición coincide con parte de un grupo, indica «grupos que contienen…» y conserva el ingreso y horas del grupo entero. No recortes solo las horas para generar una rentabilidad de producto. Reserva filtros de equipo/proyecto a los desgloses operativos, o devuelve la limitación del motor cuando se soliciten.

Metadatos a la fecha del corte. Si el grupo es heterogéneo, muestra valores múltiples; si falta información de algún miembro relevante, informa esa cobertura, sin convertir un único valor conocido en prueba de homogeneidad. Distingue un dato propio del grupo de los valores de sus hijos. En Cliente/implantación, un dato de grupo mostrado como contexto debe rotularse «del grupo»; no inventes el dato propio.

La tabla tendrá cabeceras agrupadas, primera columna y cabecera utilizables al desplazarse, números alineados y control para mostrar bloques. Mes y CUM serán la vista inicial; los otros tres bloques estarán accesibles sin perder filtros. No elimines columnas requeridas para que quepan. Usa desplazamiento horizontal contenido, con anchura adecuada a escritorio y alternativa legible en pantallas pequeñas.

Al abrir una fila, la ficha conserva el grupo, periodo, servicio, revisión y **cohorte filtrada de referencia**. Al volver conserva búsqueda, orden, página y bloques. La desviación de ficha debe coincidir con la de esa fila: no sustituyas la cartera filtrada por todos los grupos ni por el grupo aislado. Si se abre directamente, identifica la referencia general usada; si no hay cartera válida, muestra el motivo.

## 6. Análisis Cliente: ficha de Grupo, Cliente e implantación

Implementa `/analisis-cliente` y sus rutas internas si convienen. Selector con búsqueda servidor por **Grupo Cliente / Cliente / implantación**. No cargues miles de opciones en el navegador ni impongas un `take` fijo que deje entidades inaccesibles.

Cabecera: ámbito elegido, relación grupo/Cliente/implantaciones, soporte, alojamiento, producto, complejidad y usuarios al corte, con cobertura. Permite navegar a hijos/padre manteniendo periodo. Un Cliente sin grupo puede mostrar sus hechos operativos y su falta de asignación económica, sin crear un grupo ficticio.

Organiza la ficha en secciones/pestañas reales:

1. **Resumen y evolución:** tarjetas de los cinco periodos, horas objetivo y curvas descritas en §7.
2. **Dedicación:** equipos/perfiles, fuentes, servicios y causas, con detalle de actividades.
3. **PAP:** magnitudes y tabla de intervenciones según §8.
4. **Tickets y bugs vinculados:** hechos y vínculos disponibles según §8.
5. **Datos y cobertura:** fuentes utilizadas, fechas de observación/extracción, limitaciones y referencia de cálculo, con acceso al detalle de origen permitido por rol.

En Grupo: todas las métricas económicas que el motor sustente. En Cliente/implantación: horas, usuarios y hechos **de su ámbito**, y «ingreso agrupado en Grupo Cliente» con enlace al contexto económico completo; sin ingreso repartido ni ratio propio inventado. Un panel de contexto del grupo se distingue del resultado operativo del Cliente y no se suma a él.

Incluye horas objetivo del mes/CUM y desviación de horas `(horas_reales − horas_objetivo) / horas_objetivo`, distinta de la desviación de €/jornada; ambas tienen nombre, unidad y tratamiento de cero. Mantén esa fórmula en el catálogo/motor, no en la pantalla. Si no hay ingreso propio o el objetivo de horas es cero, explica por qué no se calcula.

Las cuatro vistas mantienen sus rutas. La integración futura de los seis KPI en la ficha puede indicarse brevemente, pero no crees seis ceros, colores, feedback ni un resultado global ficticio. No uses el área de Calidad para tapar la ausencia de secciones que sí corresponden a esta entrega.

## 7. Gráficos y desgloses de dedicación

Implementa visuales que contesten estas preguntas, con tablas equivalentes accesibles:

| Visual | Contenido y regla |
| --- | --- |
| Rentabilidad mensual | €/jornada por mes del año seleccionado y del anterior comparable, objetivo de la revisión elegida, cortes y huecos cuando no hay ratio |
| Horas CUM comparables | Curvas actual/anterior alineadas por mes y corte; el año anterior completo permanece como referencia separada en las cifras |
| Ingreso CUM comparable | Misma alineación; identificación expresa de imputación analítica anual/12 |
| Dedicación mensual | Horas por equipos/perfiles, con sin identificar visible; PAP en panel alineado separado, sin apilar intervenciones sobre horas |
| Real frente a objetivo | Horas reales/objetivo del periodo y comparación de magnitudes anuales, con unidades separadas de euros y ratios |

La serie anterior comparable necesita datos propios: **no copies la serie actual ni sustituyas los meses del año anterior completo por un CUM equivalente**. En el último mes parcial, ambos años se cortan como prescribe el modo. Los meses futuros del año seleccionado quedan sin datos, no como cero. Si ofreces una curva adicional del año anterior completo, será un selector explícito y estará etiquetada como tal.

Los ratios mensuales ausentes interrumpen la curva; no unas huecos ni interpolaciones que parezcan datos observados. Hitos de arranque, migración CLOUD y cambio mayor de versión se anotan con fecha y ámbito, sin excluir automáticamente sus horas o eventos. No inventes hitos ausentes. Leyendas, tooltips y detalles deben indicar periodo, valor, unidad y estado; no solo color.

Tabla de equipos/perfiles para mes, anterior, CUM y CUM anterior comparable: CS N1, CS N2, PMO ANA, PMO DEV, IT N3, Plataforma N4 y grupos sin identificar. Resuelve persona, equipo, nivel y rol a la **fecha del trabajo**; PMO desconocido es elegibilidad pendiente y rol desconocido no elimina horas PMO elegibles. Si hay dimensiones distintas que no corresponden a un perfil previsto, consérvalas sin forzarlas a CS. Los porcentajes de dedicación usan el mismo conjunto de horas que sus componentes y no requieren usuarios.

Clasificación de causas: reutiliza el clasificador común y sus campos de evidencia. Distingue incidente Vincle confirmado, otro soporte clasificado y sin clasificar/pendiente, que reconcilian el total del ámbito de dedicación. Infraestructura de CLOUD depende del alojamiento a fecha del trabajo; OP no se convierte en SaaS por una migración posterior. No clasifiques por rol DEV ni por parecido del nombre. Conserva Sistemas del Cliente y Uso Indebido y sus horas. No confundas «otro soporte» con categoría financiera OTROS ni entorno/tipología con causa raíz.

Un ámbito sin implantación identificada conserva «sin implantación»: no clones actividades en todos los proyectos del Cliente. Minutos exactos hasta agregar, horas después. Los componentes no multiplican registros por alias, vigencias, tickets, causas o vínculos. Una actividad es `(source, entryId)`.

## 8. Hechos operativos de la ficha, sin anticipar semáforos

**PAP.** Total por identidad estable lista+ID, fechas de producción y resultado original visibles. Si cualquier causa es correctiva, ese PAP es correctivo; varias causas/tickets no multiplican el total. Desglosa correctivos estándar, proyecto/personalización/configuración/procesos/infraestructura y origen cliente, evolutivos no facturables cuando exista evidencia y sin clasificar. Si un PAP pertenece a varias categorías, marca la tabla como no aditiva; no inventes una prioridad de causas para hacerla sumar. Origen cliente se conserva y participa en su magnitud. No filtres silenciosamente a Resultado=OK ni llames «ejecutado con éxito» a todo lo cargado. Sin fecha de producción, conserva el hecho y su falta de ubicación temporal, sin usar fecha de título/solicitud como sustituto.

**Tickets.** Conteos únicos por fecha de creación dentro del periodo, con `incident`, `problem` y restantes tipos separados; estados observados se muestran con su fecha de observación. Los tickets sin horas se conservan en estos hechos. Clasificación y tags actuales aplicados a altas históricas se identifican como tal: no afirmes que eran el estado o la causa conocidos en aquella fecha si no existe una observación que lo demuestre. No calcules cierres mensuales, MTTR ni incidentes hijos sin los campos que faltan. Backlog histórico/envejecimiento y su semáforo quedan para CSAPP-08.

**Escalados.** Usa tags exactos existentes: `team_n3_pmo`, `team_it`, `team_plataforma`/`team_plataformavfs`, `team_plataformaarq`, `team_plataformavsw` y `team_n2`. Un ticket con ambos destinos N3 cuenta una vez en total N3 y puede aparecer en ambos desgloses no aditivos. La cohorte mensual es creación del ticket, **no fecha real del escalado**, que no está disponible. N4 no demuestra por sí solo un bug. Reutiliza la clasificación de destinos existente.

**Bugs vinculados.** Cuenta Work Items `Bug_` únicos por producto+ámbito DevOps+ID y muestra sus tickets externos asociados, con vínculos explícitos válidos según la revisión existente. Para el resumen temporal de esta ficha, rotula «bugs vinculados a tickets creados en el periodo»: es una cohorte de tickets, no fecha de aparición/cierre del defecto. Problemas e incidentes afectados son conteos de tickets distintos, separados del número de bugs. Un bug con dos problemas cuenta **1 bug y 2 problemas**; un problema con dos bugs cuenta **1 problema y 2 bugs**. Conserva incertidumbre, enlaces rechazados/pendientes y cobertura parcial fuera del conteo confirmado.

Los bugs centrales de organizaciones internas son contexto, no afectación automática de toda la cartera. La ausencia en otra vista no cierra ni elimina. PR y Ready for Release mantienen su significado confirmado y no se convierten en desplegado/resuelto. No busques la palabra BUG en texto ni enlaces clientes por similitud. No implementes aún el sexto semáforo o su global; deja los conjuntos preparados para reutilización posterior.

Los filtros operativos que no tienen equivalente en otra fuente se declaran por sección: seleccionar «Soporte» en economía no prueba que todo PAP/bug pertenezca a ese servicio. Aplica el filtro solo donde exista clasificación sustentada y explica el alcance; no escondas registros para forzar coherencia. Cada resumen tendrá tabla paginada, periodo y fuente de evidencia.

## 9. Detalle que concilie y permisos de lectura

Cada cifra agregada operativa/económica abre un detalle integrado en estas vistas, manteniendo ámbito, periodo, servicio y filtros. Los ratios abren su explicación con numerador, denominador, factores, fórmula, referencia y estado, y enlaces a sus componentes.

`listIncomeDetail` y `listHoursDetail` actuales son **solo ADMIN**, el primero no recibe periodo/servicio y el segundo no filtra el servicio del total. No los conectes tal cual ni abras Cargas a Consulta. Crea una lectura de negocio autorizada para ADMIN/Consulta, con proyección de campos necesaria y predicado común al resumen. Conserva privadas las funciones/acciones de importación, archivos originales y decisiones.

- Ingreso: año/categoría, importe anual fuente y contribución imputada al periodo, factor temporal, origen y referencia del conjunto; no sumes doce veces el importe anual al explicar doce meses. `Diferencia` separada.
- Horas: fuente, fecha, persona/equipo/rol si están resueltos, ticket/proyecto, minutos/horas, servicio, ámbito y motivo de inclusión. El modo incluido concilia exactamente con la cifra; excluidas, sin clasificar y pendientes se consultan aparte con su motivo.
- PAP/tickets/bugs: identidades estables, fechas, campos relevantes y evidencia de vínculos, sin filas repetidas por joins.

Totales del detalle se calculan sobre **todas** sus filas filtradas, no sobre la página. Prueba reconciliación de detalle contra tarjeta/tabla/gráfico. No escondas errores reales mediante tolerancias o redondeo por fila. Los IDs/conteos coinciden exactamente; explica únicamente diferencias de presentación decimal.

El perfil Consulta puede leer datos analíticos y sus detalles, pero no obtiene archivos fuente, acciones de carga, mutaciones ni auditoría privada de decisiones. No muestres enlaces a rutas ADMIN que solo terminan en un 403; para ADMIN puedes añadir el salto al lote. Valida cada ruta/servicio/exportación en servidor, no solo navegación.

## 10. Lectura coherente, actualización y rendimiento

Reutiliza y amplía `runEconomics` y servicios analíticos comunes; las pantallas no mantienen dos motores ni nuevas fórmulas económicas independientes. Una respuesta de resumen, cohortes y series debe proceder de una lectura coherente; si añades consultas auxiliares, comparten transacción/cliente o mecanismo equivalente. No vuelvas a `prisma` global dentro de helpers que deban pertenecer a esa instantánea.

Prueba con barreras: empieza la lectura, activa desde otra conexión una sustitución financiera y un cambio de usuarios/atribución controlado, continúa la lectura y comprueba que devuelve un conjunto coherente anterior o posterior según su instantánea, **nunca mezclado**. Repite tras actualizar para ver el nuevo estado. Los hooks de sincronización serán solo de pruebas, inaccesibles desde navegador/producción.

La referencia incluye versiones fiables de fuentes/derivaciones, usuarios, maestros y configuración que afectan al resultado. El `MAX(drvVersion)` actual **no identifica todo el estado**: una fila puede pasar de versión 1 a 2 mientras otra sigue en 100. No lo uses solo como garantía de frescura/cache. Elige un mecanismo acotado, como revisiones transaccionales por dominio, y prueba ese contraejemplo; no hace falta construir cierres certificados ni guardar copias de todos los informes.

Si cambian datos entre ver un agregado y abrir detalle/exportar, detecta la referencia distinta y ofrece actualizar, o muestra explícitamente que es una nueva lectura. No prometas conciliación con una pantalla antigua. Evita caché pública y claves compartidas sin autorización/contexto. Al cambiar filtros rápido, una respuesta anterior no debe reemplazar a la nueva ni quedar bajo cabeceras de otro periodo.

Consultas por conjuntos, paginación estable y carga diferida de detalle/pestañas. No llames al motor una vez por fila ni consultes personas/usuarios/meses en bucles de SQL. Para cartera calcula todos sus componentes y el orden global, pero no prepares las series detalladas de miles de fichas para devolver cincuenta filas si no se usan. Gráficos reciben agregados mensuales, no cientos de miles de actividades. Selectores con búsqueda paginada. No mantengas una transacción abierta mientras el usuario decide qué pulsar.

Mide con al menos **1500 grupos y 250000 tiempos sintéticos**: carga inicial, filtros, orden, segunda página, ficha, detalle y CSV. Referencia declarada de CSAPP-05: cartera completa unos 7 s/17 sentencias en aquel entorno; no es un objetivo prometido ni demuestra rapidez de las nuevas vistas. Registra tiempos, consultas, tamaño de respuesta y memoria; corrige N+1 o multiplicaciones confirmadas. No justifiques congelar la UI porque el cálculo termine en servidor.

## 11. CSV de resúmenes y experiencia visual

Entrega exportación **CSV de Comparativa completa filtrada** y de los resúmenes/series de la ficha, con el mismo orden, periodo, columnas disponibles y estados. Nunca exportes solo la página diciendo «cartera completa». No vuelvas a calcular ratios de otra forma ni exportes únicamente cifras renderizadas con sus motivos perdidos.

UTF-8, apertura documentada en Excel en español, escape correcto de comillas/separadores/saltos y prevención de fórmulas en campos textuales que empiecen por caracteres ejecutables al abrirlos. No alteres números negativos válidos para resolver ese riesgo. Incluye fecha/corte, modo, ámbito, servicio, método, revisión, referencia de datos y cobertura en columnas de contexto o una estructura documentada que conserve una cabecera tabular utilizable. Diferencia desconocido de cero también en el CSV.

Los archivos se generan mediante rutas autenticadas y lectura coherente; no son públicos ni incluyen el XLSX/CSV original de Cargas. Limita memoria y no cortes resultados sin avisar. La descarga masiva de **hechos brutos** y sus tareas de fondo se completa en CSAPP-09: en 06 ofrece los resúmenes indicados y detalle paginado, sin botones de descarga masiva simulados ni reimplementar otra cola.

Usa la identidad y componentes existentes de Vincle (`src/app/globals.css`), con una composición analítica clara: filtros compactos, cifras principales, unidades y contexto, tabla comparativa y ficha con gráficos. Puedes ampliar estilos de estas vistas sin rehacer Administración. No inventes un logotipo ni dependas de fuentes externas. Mantén contraste, foco visible, teclado, etiquetas y tablas accesibles para cada gráfico; el color no será la única explicación.

Formato español: euros y horas normalmente dos decimales, porcentajes con una precisión identificada; una fracción 0,25 se presenta como **25 %**. Calcula porcentajes exactos antes de formatear; no cambies el signo confirmado de las desviaciones. El frontend solo podrá convertir decimales a coordenadas gráficas para dibujar: tooltips, exportaciones y cálculos conservan el valor exacto del servidor.

Verifica visualmente escritorio de aproximadamente 1440 px y pantalla estrecha de aproximadamente 390 px: cabeceras/unidades legibles, desplazamiento contenido, leyendas, estados vacíos y errores. Incluye cargando, sin clientes, sin fuentes, sin coincidencias, cobertura parcial y error con acción útil. No llenes una base vacía con ceros o una demo automática.

## 12. Pruebas y corrección de la limpieza del trabajador

Pruebas de dominio, PostgreSQL real y navegador sobre web/trabajador construidos. Versiona los casos y fixtures sintéticas. Mínimos:

| Caso | Resultado verificable |
| --- | --- |
| Prorrateo y equivalente | Anual 12000 a 15/30 → 500; U=10 → UM=5 y TAR RUN=1200; 15/31 y febrero real; doce meses completos |
| Comparables | Enero/diciembre; CUM frente a año completo; FULL_MONTH febrero 2025 incluye 29/02/2024 y CUTOFF no; horas posteriores excluidas |
| Media filtrada | 1000/10 y 1000/30 → **400 €/jornada**; 1000/0 y 1000/10 → **1600**; cambia con filtro de grupos y no cambia con orden/página |
| Parciales | Ingreso ausente, servicio desconocido/conflictivo, elegibilidad pendiente, filtro de solo horas y recálculo pendiente: filas/cartera/desviaciones/CSV no publican un completo falso |
| Explicación | Desviación con objetivo 550 y ratio 400 reconstruye **150/550**; contra cartera 500 y ratio 400 reconstruye **100/500**; formato 25 % para 0,25 |
| Coincidencia entre vistas | Mismo grupo, contexto y referencia → mismas magnitudes en Comparativa, ficha, curva/tablas, detalle y exportación; vuelta conserva filtros/página |
| Ámbitos | Grupo con dos clientes y tiempo solo de grupo suma una vez; Cliente/implantación sin ingreso propio no hereda todo el dinero; usuarios compartidos no se suman |
| Historia PMO | 2024 Zendesk, desde 2025 Wrike para PMO y Zendesk para resto, también en comparación 2026/2025; vigencias y roles sin identificar |
| Metadatos y causas | Cambio OP→CLOUD no reclasifica años anteriores; grupo heterogéneo/desconocido; Sistemas del Cliente y Uso Indebido conservan horas; plan con vigencia y Silver diferenciados |
| Usuarios | 65 hasta mayo, 68 desde junio → 665 usuarios mes/stock 68 a octubre completo; mes vacío ≠ cero; sin usuarios puede existir €/jornada |
| PAP | Un ID con varias causas/tickets cuenta una vez; correctivo con otra causa; origen cliente; resultado no OK; sin fecha; pertenencias no aditivas |
| Tickets y bugs | Ticket sin horas visible; dos tags N3 total uno; grafo bug/problemas en ambos sentidos sin duplicar; interno no identifica clientes; vínculo rechazado/pendiente no confirmado |
| Seguridad | ADMIN y Consulta leen análisis/detalle/CSV; anónimo no; Consulta no accede a originales ni muta cargas/configuración; petición forjada y retorno externo rechazados |
| Coherencia | Carrera real con barreras y dos conexiones; cambio de una fila 1→2 con otra en versión 100 invalida frescura; exportación/detalle no simulan una instantánea antigua |
| Navegador y escala | Filtros, orden numérico, nulos, paginación, selectores, pestañas, detalles, CSV completo, responsive, huecos/provisional en gráficos y datos vacíos |

Además, cierra el defecto de pruebas reportado en CSAPP-05: `tests/cargas-trabajador.test.ts` deja un trabajador hijo vivo si falla la espera antes de su bloque final. Centraliza registro/limpieza de procesos propios con `finally`/hooks, espera su salida y limita el escalado de señales a **los procesos creados por esa prueba**. No uses `killall`, `pkill node` ni afectes web/trabajadores de Dennis.

Demuestra un fallo/timeout forzado que limpia los hijos y permite continuar otra prueba. Para el caso de 300000 filas que excede 120 s también en `main`, distingue recuperación funcional de benchmark y ajusta esperas/fixtures de forma justificada, conservando una interrupción real en curso y la comprobación de no duplicación. No cambies el volumen en silencio para anunciar que el caso original pasó, ni elimines una aserción de integridad para ganar tiempo. Documenta tamaño, comando y límite utilizados y cualquier fallo que persista.

Ejecuta instalación reproducible, typecheck, lint, build, pruebas afectadas y regresión apropiada. Los 338 tests/193 comprobaciones de CSAPP-05 son su informe anterior, no tus resultados. Si hay migración nueva, prueba instalación limpia y actualización desde CSAPP-05 con datos conservados; si no hay migración, dilo. Mantén los nueve importadores y protecciones de base. No repitas el benchmark financiero de 60000 grupos o todas las cargas enormes si no cambias ese motor ni aparece una regresión.

## 13. Datos reales, pendientes y documentación

No cargues datos operativos reales ni financieros 2025/2026, no precargues demos en la base de Dennis ni borres lo que ya haya importado. **Dennis prueba sus cargas**. Todos los casos y mediciones usan bases `_test` aisladas con nombres/protecciones existentes. No hace falta esperar a los archivos privados o a su aceptación de las entregas anteriores para construir estas pantallas; su cobertura debe expresarlo.

No versiones nombres reales, archivos fuente, contraseñas, libros descifrados, volcados ni capturas con datos privados. No ejecutes macros, HTML o enlaces durante consultas. Los estados de bugs, interpretación histórica, vacíos por decisión y demás propuestas siguen identificadas como pendientes, sin nuevas reglas silenciosas.

Actualiza por responsabilidad, con enlaces y lectura selectiva:

- `docs/producto/comparativa.md`: columnas, filtros, cohorte de referencia, navegación y estados; conserva IDs ECO existentes y añade nuevos si hace falta.
- `docs/producto/analisis-cliente.md`: ámbitos, secciones entregadas, curvas, hechos operativos y límites futuros.
- `docs/calculos/catalogo.md`: correcciones verificadas, fórmula de desviación de horas, TAR RUN y versión del motor; no dupliques todo el funcional en otro archivo.
- `docs/arquitectura/analitica-csapp06.md`: servicios compartidos, instantánea/versiones, predicados de detalle, permisos, paginación/exportación y decisiones técnicas.
- `docs/plan/guia-powershell-csapp06.md`: arranque, migración si aplica, pruebas y recorrido breve para Dennis. No declares Windows probado por haber escrito comandos PowerShell.
- `docs/validacion/csapp-06.md`: pruebas y medidas reales, hallazgos, correcciones, revisión visual y límites. Corrige la afirmación de lectura consistente de CSAPP-05 con el alcance de la nueva prueba, sin reescribir qué se probó entonces.
- Estado, roadmap, guía documental, índice y `prompts/README.md`; corrige el estado de PR 6 con Git y enlaza también CSAPP-05 si falta en el índice.

## 14. Definición de terminado y entrega

CSAPP-06 está terminada cuando Comparativa y Análisis Cliente funcionan sobre los datos de la base, consumen el motor corregido, muestran los cinco periodos y curvas comparables, permiten navegar por ámbitos, explican sus cifras con detalles conciliables y permisos correctos, exportan sus resúmenes y tienen pruebas/documentación ejecutadas. **Una maqueta estática, una tabla sin ficha o una ficha que repite solo Comprobación económica no cumplen el encargo.**

Abre PR propia contra `main`, sin fusionar ni desplegar. Descripción para un revisor sin esta conversación: comportamiento final, correcciones de cálculo, validación y límites. El diff es de CSAPP-06 y conserva cambios anteriores. No avances a CSAPP-07.

Respuesta final: rama/PR, SHA base/final, migración o ausencia, qué puede usar Dennis, fallos corregidos con evidencia, comandos ejecutados/cifras/entorno, pendientes reales y recorrido manual corto. No declares aceptación de Dennis ni archivos reales conciliados si no ocurrió.

Recorrido preparado para Dennis: abrir Comparativa con mes actual y con mes completo, filtrar y cambiar página, abrir un Grupo y volver, comparar CUM anterior con año anterior completo, revisar curvas y desglose de una cifra, bajar a Cliente sin repartir ingreso, consultar PAP/tickets/bugs, exportar cartera completa y repetir como Consulta. Si no hay datos cargados, la pantalla explica las fuentes faltantes y ofrece al Administrador sus accesos; no genera resultados de muestra para simular esa aceptación.
