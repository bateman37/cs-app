# CSAPP-05-v1 — Facturación anual y motor económico

## 1. Encargo y resultado

Trabaja exclusivamente en `bateman37/cs-app`. Implementa CSAPP-05 completa, quinta de las diez entregas. Archiva **este prompt literal, sin resumir ni corregirlo**, en `prompts/CSAPP-05-v1.md` antes de modificar aplicación, migraciones o pruebas. Actualiza el índice de prompts. Las decisiones de implementación y sus discrepancias se documentan aparte; no reescribas prompts anteriores.

Hay dos bloques funcionales:

1. Tres cargas financieras XLSX operativas: soporte, administración delegada y otros, con sustitución completa por año y categoría, revisión del impacto, conciliación y recuperación.
2. Un motor económico común con periodos, horas elegibles, ingresos imputados, usuarios, ratios y cobertura. Incorpora su comprobación desde Administración y la configuración económica inicial. Comparativa y Análisis Cliente consumirán este mismo motor en CSAPP-06.

Incluye la corrección acotada de las equivalencias Wrike/PAP que solo identifican un Grupo Cliente, descrita en §4, porque afecta al perímetro económico. No construyas aún los dashboards de CSAPP-06, Pulse Rent ni los semáforos de Calidad. Mantén exactamente las cuatro vistas de negocio existentes y Administración; no crees una quinta vista de negocio.

## 2. Base real, lectura y trabajo en Git

Al preparar este encargo, el 30/10/2026, Git muestra:

- `main`: `24d365813ab2ba2703fa911f4e0dacd31fb781fb`, merge de la PR **5** de CSAPP-04.
- Cabeza de esa PR: `4d8653401830bcc939d73c2798e0667832ee72ba`, incluida en `main`.
- Por tanto, el informe que decía «PR 5 sin fusionar» ha quedado desactualizado. Esto confirma integración en Git, **no aceptación manual de Dennis ni pruebas en Windows**.

Comprueba de nuevo remoto, árbol local, instrucciones y estado antes de empezar. Si `main` avanzó, utiliza su estado real y explica la diferencia. Respeta cambios locales ajenos. Rama sugerida: `feature/CSAPP-05-finanzas-motor-economico`; si el entorno designa otra, úsala manteniendo esta entrega aislada. No añadas cambios a una PR anterior abierta. **No uses ni intentes `push --force` o `--force-with-lease`**, ni reescribas historia publicada. Si hay divergencia, resuelve mediante una rama nueva o un merge normal que conserve historia.

Lee primero `AGENTS.md`, `CLAUDE.md`, `docs/00-index.md`, `docs/plan/estado.md` y este prompt. Después, solo los contratos necesarios:

- `docs/importaciones/facturacion.md` y `docs/calculos/catalogo.md`.
- `docs/producto/comparativa.md`, `docs/producto/analisis-cliente.md`, `docs/producto/administracion.md` y los apartados aplicables de `docs/producto/maestros.md`.
- `docs/arquitectura/motor-cargas-contrato.md`, `docs/arquitectura/usuarios-matriz-csapp02.md` y los apartados de equivalencias, tiempos y recálculo de `docs/arquitectura/wrike-pap-bugs-csapp04.md`.
- `docs/plan/precarga-y-pruebas.md`, la fila CSAPP-05 del roadmap y las decisiones pendientes relevantes.

La revisión previa fue una lectura dirigida del repositorio y de las fuentes, sin ejecutar sus pruebas. Verifica tú el código. Puntos de entrada reales: `src/server/uploads/{profile,registry,activate,batches}.ts`, `src/server/uploads/synthetic/profile.ts`, `src/server/wrike/derive.ts`, `src/server/pap/profile.ts`, `src/server/usuarios.ts`, `src/domain/catalogs.ts` y `prisma/schema.prisma`.

No actualices dependencias por rutina ni cambies el stack. Migraciones incrementales, sin reset, sin editar las cuatro anteriores y sin tocar otras bases. No vuelvas a pedir decisiones ya confirmadas.

## 3. Reglas confirmadas y propuestas anteriores

- **Vta Potencial** es el ingreso anual realizado más cartera casi confirmada. La aplicación lo identifica como «Ingreso anual: facturado + potencial». Su reparto mensual es una imputación analítica, no la facturación real de ese mes.
- **Diferencia** compara con el Budget anual. Se conserva y muestra aparte. No se suma al ingreso, no mide desviación contra 550 y no permite calcular un Budget absoluto mientras no se confirme la convención de signo.
- Las tres categorías se descargan como conjuntos completos. **Todas sustituyen año/categoría**; administración delegada y otros tampoco son incrementales.
- Objetivo inicial: **550 €/jornada de 8 horas**. Las causas del cliente no eliminan horas de rentabilidad. PMO anterior a 2025 procede de Zendesk; desde 01/01/2025 procede de Wrike, y el resto de Zendesk, conforme a pertenencia histórica.
- Grupo Cliente es el ámbito económico BC. Cliente e implantación conservan sus horas y usuarios propios; no reciben un reparto de ingresos inventado.

Continuar no acepta automáticamente ZDT 11–13, ZTM 06–08 ni las propuestas de CSAPP-04. Mantén una tabla breve con regla, comportamiento, prueba y estado. La corrección sin ID ya existe; consérvala. La lista estable de origen PAP sigue siendo un metadato obligatorio implementado, pendiente de validación de Dennis: no la sustituyas por el nombre del archivo. Los catálogos de estados de bugs, la lista de palabras que evita inferencias de tickets y `CSAPP_DEVOPS_PRODUCTS` mantienen su estado de propuestas implementadas; no los modifiques para calcular finanzas. No deduzcas producto o servicio de la etapa de un bug ni de un destino de escalado.

## 4. Equivalencias de proyecto a grupo: resolver la limitación de CSAPP-04

Comprobado en el código actual: `SYSTEM_RULES` permite Wrike y PAP solo sobre Cliente/implantación, aunque `ExternalIdentity` ya tiene `groupId`. Los resolutores recurren a una equivalencia **BC/GROUP_KEY** si coincide el texto del proyecto. Ese atajo mezcla sistemas y deja fuera los proyectos cuyo nombre difiere del grupo.

Permite declarar **Wrike/PAP → Grupo Cliente** directamente desde el maestro existente, con identidad externa propia, destino único, vigencias, autorización, auditoría, versión y exclusión de solapamientos en base de datos. Ajusta validadores, formulario, restricciones y resolutores; no basta cambiar una constante TypeScript. Conserva Cliente/implantación y no abras Zendesk ORG_ID a grupo.

El proyecto de origen «Proyecto A» debe poder apuntar al grupo «Grupo B» sin renombrarse ni crear una falsa clave BC. Resuelve con la fecha del trabajo para Wrike y con la fecha de producción para PAP, manteniendo el comportamiento documentado cuando esa fecha falta. Si el ticket identifica un Cliente del mismo grupo, puede completar ese desglose; si contradice el proyecto, conserva el conflicto y no elijas un destino.

No conviertas automáticamente equivalencias BC en Wrike/PAP. Retira el fallback BC como atribución implícita; si existen registros que dependían de él, muestra el impacto y la acción para crear equivalencias explícitas. Conserva hechos y atribución anterior como evidencia, marca el recálculo pendiente y no publiques esa atribución como validada. Si no existen, regístralo. No repares datos de Dennis sin revisión.

## 5. Tres perfiles financieros y comprobación del archivo

Activa los identificadores ya reservados: `facturacion-soporte`, `facturacion-admin-delegada` y `facturacion-otros`. Utiliza un núcleo común y tres perfiles inequívocos, todos `REPLACE_SCOPE`. Año obligatorio seleccionado en servidor y categoría fija del perfil; no confíes en campos ocultos enviados por el navegador. No apliques a finanzas la limitación de edición de usuarios al año actual: Dennis necesita cargar 2025 y 2026 y consultar/importar históricos permitidos.

Los tres XLSX reales comparten estas cabeceras, comprobadas en la primera fila:

| Columna | Significado |
| --- | --- |
| Grupo cliente | Identidad económica BC de origen |
| Vta Potencial | Ingreso anual, con su precisión de origen |
| Diferencia | Diferencia contra Budget, independiente del ingreso |

Valida por contenido, no por nombre. Admite orden distinto con mapeo inequívoco, espacios exteriores y normalización controlada de cabeceras; rechaza cabeceras duplicadas/ausentes. Conserva columnas adicionales con aviso. Si varias hojas son compatibles, utiliza la selección explícita ya prevista por el motor. Nunca ejecutes fórmulas, macros, consultas IQY, enlaces externos ni HTML. Una celda fórmula requerida sin valor numérico almacenado no se evalúa ni se trata como cero.

El pie real contiene «Filtros aplicados:» y estas selecciones de referencia:

| Perfil | DESC_L4 esperado |
| --- | --- |
| SOPORTE | Plan Gold, Plan Platinum, Plan Silver On Demand, Plan Silver Recurrente o Fee Silver Recurrente |
| ADMIN_DELEGADA | Administración Delegada |
| OTROS | Gestión Activos o Otros |

Los tres incluyen «Año Actual es Año Actual»: **eso no proporciona un año numérico**. Exige el año y la declaración de conjunto anual completo; muestra la fecha de extracción declarada separada de la recepción. Si el archivo contiene un año explícito incompatible o filtros de otra categoría, bloquea la confirmación. Si falta el pie o su formato no permite validarlo, muestra qué no se pudo verificar y exige declaración expresa de categoría/filtros y cobertura completa dentro del lote. No anuncies «archivo correcto» solo por tres cabeceras o por el nombre.

Clasifica como controles, no como clientes, las filas Total, el pie y las filas vacías. Una línea desconocida o un subtotal intermedio no se ignora silenciosamente. Detecta múltiples totales incompatibles. Guarda filtros originales, hoja, filas y controles en la evidencia del lote. Las muestras tienen 40, 4 y 7 filas económicas respectivamente; **son tamaños de ejemplo, nunca restricciones de importación**.

### Importes, vacíos y duplicados

Usa Decimal/PostgreSQL NUMERIC desde el texto de origen, con escala suficiente documentada, conservando el bruto. Los exports contienen decimales con más de dos posiciones, notación científica y residuos diminutos de coma flotante. No pases por `Number` para sumar, normalizar importes o calcular ratios; serializa decimales de manera explícita. Redondea solo para presentar. Mantén ajustes negativos y cero confirmado.

Una `Vta Potencial` vacía no toma el valor de `Diferencia`. El ejemplo OTROS contiene ese caso y el total cuadra con los otros importes: esto justifica ofrecer una **decisión explícita por lote** de tratar esos vacíos como cero, mostrando filas e importes afectados. No es una regla aprobada global. Sin decisión, conserva null y bloquea la sustitución económica incompleta; si se acepta, conserva vacío original, valor derivado cero, actor y motivo. Esta opción exige Total presente y conciliación compatible; no la habilites para texto inválido, fórmulas sin resultado ni por declarar ausente el control. `Diferencia` vacía permanece desconocida; no impide por sí sola usar un ingreso conocido.

La huella incluye los campos fuente económicos normalizados y conserva procedencia. Filas idénticas dentro del archivo cuentan una sola vez. Un mismo grupo de origen con importes contradictorios no se resuelve por posición, suma ni promedio: bloquea hasta corregir. Varias denominaciones que terminan en el mismo grupo canónico requieren revisar la colisión; no asumas que son dos ingresos distintos. No multipliques dinero al unir alias, clientes, usuarios o periodos.

Concilia suma de filas económicas únicas contra Total de Vta Potencial; muestra también el control de Diferencia si existe. Distingue suma bruta, duplicados, suma única y cuantía atribuida/sin asignar. Usa una tolerancia monetaria absoluta explícita, inicialmente propuesta de 0,01 €, visible y versionada en configuración; no una tolerancia por fila ni un porcentaje creciente. Una discrepancia superior bloquea activación. El total de control no es otra fila de ingreso ni se usa para ajustar los detalles. Si falta Total, exige revisión declarada de ese control ausente; no inventes que concilia.

## 6. Resolución BC, impacto y sustitución atómica

Resuelve Grupo cliente mediante las equivalencias **BC/GROUP_KEY** del maestro y normalización existente; sin similitud textual, primer resultado ni creación de grupos ficticios. Conserva la clave original.

El dato es anual: no selecciones arbitrariamente enero, diciembre o la fecha de subida para resolver una identidad con vigencias. Si las asignaciones que intersectan el año señalan inequívocamente un único grupo, registra qué intervalos sustentan esa resolución y sus límites. Si señalan grupos distintos, exige asignación anual explícita y auditada dentro del lote o corregir la fuente; no repartas ni alteres equivalencias históricas para hacerla encajar. Una empresa nueva a mitad de año no debe perderse por no existir su alias el 1 de enero.

Una identidad sin resolver se conserva con su importe. En la revisión se puede completar el maestro y reprocesar. Para activar con importes sin asignar, exige la aceptación expresa ya prevista en FAC 04, indicando qué queda fuera de los informes atribuidos y cuánto. No tires esas filas: siguen siendo parte del conjunto financiero activo y de su conciliación. La cobertura queda parcial, no completa. Una ausencia de grupo en ese conjunto parcial no prueba ingreso cero. No crees una bandeja de pendientes separada.

Antes de confirmar muestra año/categoría, filtros y cobertura, lote activo que se reemplaza, total anterior/nuevo, variación, grupos nuevos/modificados/retirados y sin asignación. Cuenta por separado filas fuente y grupos canónicos. «Retirado» significa que deja de aportar ingreso en ese ámbito, no baja del maestro. Si la extracción declarada es anterior a la del conjunto activo, avisa del retroceso y exige reconocerlo; una sustitución financiera revisada no hereda automáticamente el orden de vigencia de las observaciones de tickets.

- Clave de sustitución estable: año + categoría, con el perfil correspondiente. Un soporte 2026 no toca admin/otros 2026 ni soporte 2025.
- Preparar/revisar no cambia hechos activos. Activar sustituye **todo** el ámbito en una transacción, junto con lote vigente, procedencia y auditoría. Un error o caída antes del commit conserva exactamente el conjunto anterior.
- Repetir el mismo fichero conserva exactamente sus ingresos, sin sumarlos ni dejarlos a cero. En `REPLACE_SCOPE`, «duplicado respecto al lote anterior» **no permite omitirlo del nuevo conjunto**.
- Filas ausentes en una sustitución válida se retiran del conjunto activo. No aceptes un fichero vacío o con solo Total/pie como una orden de borrado; una futura función de vaciar un ámbito requeriría otro diseño.
- Guarda el identificador/versión del conjunto activo que Dennis revisó. Si otra carga lo sustituye antes de confirmar o activar, invalida esa revisión y exige actualizar el impacto y confirmar de nuevo. Serializar dos trabajos no basta para autorizar al segundo a pisar una base distinta de la revisada.
- Revertir solo el lote vigente restaura su predecesor completo, o ausencia de fuente si era el primero; no escribe un conjunto vacío «confirmado». No se puede revertir un lote supersedido saltándose posteriores. Prueba cadenas A→B→C y restauraciones sucesivas, sin alterar otros ámbitos.
- Reprocesar un completado recalcula atribución con maestros actuales y registra versión; **no vuelve a activarlo, no reemplaza un lote posterior y no cambia dinero, año, filtros ni fecha de extracción**. Define también el comportamiento de lotes supersedidos: no deben modificar el conjunto activo.

Reutiliza cola, leases, fencing, staging, bloqueos y almacenamiento privado de CSAPP-02. Si amplías el contrato para revisar el conjunto previo o tomar decisiones de validación, hazlo de forma acotada, con regresión de los seis perfiles existentes y del perfil sintético de sustitución. Los controles nuevos también se verifican en servidor y en el trabajador, no solo en botones.

## 7. Servicio de las horas: hacer visible lo que se sabe

Una categoría financiera no clasifica automáticamente el tiempo. `TimeActivity` existe y une Zendesk/Wrike con origen, minutos, elegibilidad y ámbito; actualmente **no expone todos los datos de servicio, equipo, rol e implantación** que necesita el motor. Extiéndela o crea una proyección común documentada compatible, conservando las garantías anteriores. Una actividad es `(source, entryId)`, contada una vez. No sumes observaciones o procedencias como nuevas horas.

Separa servicio económico —SOPORTE, ADMIN_DELEGADA, OTROS, SIN_CLASIFICAR/CONFLICTO— de plan Gold/Platinum/Silver y de causa. «Otro soporte» de Pulse Rent **no** significa OTROS financiero. Una causa estándar, del cliente o sin clasificar no decide el servicio.

Reutiliza la identificación explícita de administración delegada de tickets. No conviertas `adminDelegada=false` en prueba suficiente de SOPORTE: aún puede haber OTROS. Incorpora en Administración una asignación mínima y auditable de servicio por valor exacto de Entorno y Tipología y/o por identidad de proyecto Wrike, con vigencia. Sin editor genérico de reglas ni semillas inventadas. Para tiempos sin ticket, un proyecto expresamente asignado puede aportar servicio. Dos evidencias incompatibles quedan en conflicto, sin elegir por conveniencia. Muestra el origen de la clasificación y permite revisar las asignaciones.

Horas sin servicio, ámbito o elegibilidad conocidos se conservan en desgloses separados. No las distribuyas proporcionalmente a ingresos, usuarios o equipos. El ratio de soporte usa sus ingresos y horas de soporte; admin y otros usan sus pares propios. Si quedan horas del ámbito y periodo que podrían cambiar ese perímetro, no presentes un ratio de servicio como completo: informa las magnitudes conocidas y el motivo, sin fabricar el denominador. Una vista total debe justificar que incluye el mismo perímetro económico en ambos componentes.

Conserva la política PMO de `TimeActivity` y la fecha del trabajo. No vuelvas a deduplicar entre fuentes por persona/ticket/día. Incluye trabajo atribuido solo al grupo una vez en ese grupo; no lo repitas en cada Cliente. Internos, conflictos y no atribuidos quedan identificados y conciliables, sin inflar clientes externos. Amplía la proyección para los desgloses reales disponibles, dejando desconocido lo que no existe.

## 8. Motor de periodos, ingresos y usuarios

Crea servicios de dominio/servidor reutilizables, con tipos y contratos documentados. Las pantallas futuras no deben reconstruir fórmulas en JSX, SQL independientes o llamadas al Excel. Entrada explícita: ámbito económico o conjunto de grupos, servicio, fecha de análisis y modo **a fecha de corte / mes completo**. El reloj por defecto se obtiene en Europe/Madrid; en pruebas se inyecta en servidor.

Devuelve mes seleccionado, mes anterior completo, CUM actual, año anterior completo, CUM anterior comparable y serie mensual del año seleccionado con magnitudes y cobertura. Enero tiene diciembre anterior como mes anterior. «Mes completo» fija el fin de ese mes; no certifica por sí solo un cierre contable ni inventa horas futuras. El mes en curso se rotula provisional.

Para cada mes `m`, ingreso base = ingreso anual de su año/categoría / 12. Para una fracción de mes, ingreso = base × días incluidos / días naturales reales del mes. No uses 31 fijo, días laborables ni fracción del año. CUM suma meses completos previos más la fracción del seleccionado. Para intervalos que crucen años, cada tramo utiliza el conjunto financiero de su propio año.

Corte diario inclusivo de negocio, convertido a intervalos técnicos con extremo superior exclusivo cuando corresponda para incluir el último día entero. Horas se filtran por fecha de trabajo; ingresos y exposición usan exactamente ese periodo. CUM comparable desplaza el corte un año, limitando el día al último del mes; si se elige mes completo, ambos comparables llegan a sus cierres mensuales. Prueba 29 de febrero: corte diario 29/02/2024 → 28/02/2023. No confundas este comparable con los doce meses completos del año anterior.

No prorratees horas ya registradas: se suman sus minutos elegibles hasta el corte y después se convierten a horas. No incluyas registros posteriores. Las actividades del mismo ticket no pierden sus fechas por un cambio de estado.

Reutiliza `usersAtCutoff` y `userMonthsExposure`, evitando una consulta por grupo/mes. Conserva stock al corte, exposición del periodo y usuarios medios como magnitudes distintas. Para enero–octubre completos, 65 usuarios hasta mayo y 68 desde junio producen **665 usuarios mes y stock 68**. El mes parcial pondera solo su exposición, no el stock. Un mes sin informar vuelve incompleta la exposición; cero confirmado no permite dividir. No sumes usuarios de implantaciones al grupo ni copies su total a cada hijo.

La falta de usuarios afecta a métricas por usuario, **no** impide calcular €/jornada si existen ingreso y horas válidos. Tarifa anual por usuario requiere usuarios medios de los doce meses; para un periodo parcial usa el equivalente anual identificado del catálogo, sin llamarlo tarifa contractual.

## 9. Fórmulas, ámbito y cobertura

Centraliza y devuelve numerador, denominador, unidad, periodo, servicio, ámbito, método, versión y estado del resultado:

| Magnitud | Fórmula |
| --- | --- |
| Euros por jornada dedicada | `R / H × jornada_horas` |
| Horas objetivo | `R / objetivo_euros_jornada × jornada_horas` |
| Desviación contra objetivo | `(objetivo - euros_por_jornada) / objetivo` |
| Ratio de cartera filtrada | `SUM(R) / SUM(H) × jornada_horas` |
| Desviación contra cartera | `(ratio_cartera - ratio_grupo) / ratio_cartera` |

Positivo contra objetivo significa rendimiento por debajo del objetivo; conserva este signo y explícalo. No promedies ratios mensuales, de clientes ni de páginas. El ratio de cartera utiliza **todo el conjunto filtrado**, antes de paginar. Un grupo con ingreso conocido y cero horas conserva ese ingreso en el agregado económico, aunque su ratio individual sea no calculable; expón su cantidad e impacto. Los no calculables no desaparecen silenciosamente.

Sin conjunto financiero activo, ingreso es desconocido, no cero. Un grupo ausente de un conjunto anual completo, validado y atribuido puede tener cero confirmado de esa categoría, conservando la evidencia del ámbito. Un conjunto sin asignaciones resueltas o de cobertura no confirmada no acredita ese cero. Con ingreso cero confirmado y horas positivas el ratio es cero; con ingreso positivo y horas cero no hay ratio ni infinito. Con cartera de ratio cero no calcules su desviación relativa dividiendo por cero. Preserva signos de ajustes; nunca conviertas negativos en cero.

El resultado diferencia al menos dato disponible, parcial/provisional, sin fuente y no calculable con motivo. Devuelve componentes conocidos aunque un ratio no pueda publicarse. No conviertas automáticamente cualquier suma SQL vacía en cero confirmado. Cobertura temporal declarada y frescura son distintas: no inventes completitud de tiempos por el máximo día registrado.

Ingreso BC se calcula al nivel Grupo Cliente. En un Cliente/implantación sin ingreso propio, devuelve sus horas/usuarios y «ingreso agrupado en Grupo Cliente», con referencia al grupo, sin un ratio propio atribuido. Un filtro por producto, proyecto, equipo o alojamiento que recorte solo las horas **no** puede conservar todo el ingreso del grupo y llamarlo rentabilidad de ese subconjunto. Usa perímetro económico completo o devuelve la limitación. Los metadatos se resuelven con vigencia, sin multiplicar filas por tramos; los grupos heterogéneos no toman sin aviso el plan/servidor de un primer hijo.

Silver On Demand tiene pendiente la presentación e imputación no recurrente de ECO 08. Guarda sus ingresos reales del export y permite el análisis anual cuando esté sustentado; no actives una rentabilidad mensual recurrente ni anualices cobros parciales por defecto. Separa Silver Recurrente: no extiendas esa limitación a todo plan que empiece por Silver. Identifica cualquier modo de equivalencia propuesto, sin hacerlo decisión aceptada.

Una ejecución del motor lee un estado coherente de hechos, usuarios, atribuciones y configuración. Define el mecanismo: consulta única/transacción de lectura consistente o versión equivalente. Devuelve lotes financieros vigentes, referencia/versiones de derivación y matriz, versión de fórmulas/configuración y estado de recálculo pendiente. Un cambio concurrente no debe mezclar el ingreso de un lote con su predecesor ni publicar derivados obsoletos como actuales. No hace falta inventar ahora un sistema completo de cierres certificados; sí reproducibilidad y límites explícitos.

## 10. Administración y configuración económica

Integra los tres perfiles en Cargas, con las mismas rutas, progreso y estados. La ficha muestra el impacto, decisiones, conciliación, filas hasta su origen y resultado activo. Incluye navegación entre lote vigente y sustituido y recuperación autorizada. Descargas/archivos y acciones de carga siguen siendo solo Administrador.

Añade dentro de Administración una **comprobación económica** sencilla: seleccionar grupo, servicio, fecha y modo; consultar los periodos de §8, componentes, ratios, usuarios, fuente y motivos de incompletitud; abrir el detalle paginado de ingresos/horas y sus lotes. Debe invocar el motor de producción, no calcular ejemplos en el navegador. Es una herramienta para validar esta entrega, sin adelantar el diseño de los dos dashboards ni mostrar cifras sintéticas en la base de trabajo.

Inicia la página común de configuración en Administración con objetivo 550 €/jornada, jornada de 8 h y tolerancia de conciliación identificada como técnica/propuesta. Persistencia, permiso servidor, validación de valores, auditoría y control de edición obsoleta; revisiones inmutables con autor y fecha de activación. Objetivo y jornada deben ser positivos y tolerancia no negativa. No uses variables de entorno para estos parámetros de negocio. Conserva fijo y nombrado el método confirmado anual/12 y días reales; no ofrezcas métodos no implementados.

Para que las comparaciones compartan unidad y referencia, una consulta usa una única revisión elegida de objetivo/jornada en todos sus bloques; por defecto la última activa. Identifica esa revisión y permite consultar una anterior en la comprobación de Administración. Analizar un periodo antiguo con parámetros actuales es un recálculo identificado, no una sustitución silenciosa de un cierre. No sobrescribas revisiones ni resultados guardados con otra versión. La tolerancia utilizada al validar un lote queda capturada en su revisión de preparación; si cambia antes de activar, aplica la comprobación de obsolescencia y exige revisar de nuevo cuando cambie el resultado de validación.

La misma página se ampliará en CSAPP-07 con pesos, umbrales y referencias. No implementes ahora esos editores ni colores. Integra las asignaciones de servicio de §7 en Administración con búsqueda y revisión de impacto. Los servicios de lectura económicos deberán admitir el perfil Consulta con su autorización de servidor cuando se usen desde las vistas; Consulta no obtiene acceso a cargas, archivos ni mutaciones por disponer de permiso de lectura de resultados.

## 11. Históricos y política de datos

Dennis hará las cargas reales de **2025 y 2026** y repetirá cada categoría para validar sustitución. No las ejecutes tú. Tampoco cargues datos operativos reales ni reinicies maestros/usuarios. Pruebas sintéticas solo en bases aisladas `_test`, con las protecciones existentes.

Prepara una vía asistida e idempotente para financieros **anteriores a 2025** desde la hoja histórica `DATA FACTURACIÓN`, separada de los tres perfiles comerciales. Su esquema comprobado es: `Grupo cliente`, `Facturación anual`, `Año`, `Soporte`, `Facturación mes`, `Admin Delegada`, `Servidor`, `Usuarios` (se admiten espacios de cabecera como `Año `).

Usa grupo, importe anual, año y categoría explícita; las columnas mensuales/formuladas no son otros ingresos. En la muestra hay SOPORTE y ADMIN_DELEGADA de 2022–2024; no inventes OTROS ni Diferencia histórica. `Silver` histórico genérico no autoriza a inventar modalidad de soporte en el maestro. No cambies usuarios o alojamiento al importar ese histórico financiero.

La vía histórica tendrá previsualización/dry-run, alcance por año/categoría y procedencia. Por defecto omite ámbitos que ya tengan un conjunto activo; cualquier sustitución posterior usa la revisión/confirmación financiera normal, nunca un seed que pisa datos. Rechaza 2025 en adelante en esa vía. No la ejecutes automáticamente en migración, arranque ni instalación. Si está disponible la fuente privada autorizada, pueden incorporarse los históricos anteriores a 2025 por el circuito documentado; si no, deja el adaptador probado con datos sintéticos y registra «precarga no realizada: falta fuente». Eso no bloquea los importadores. No ejecutes macros ni subas libros, nombres reales, contraseñas, copias descifradas o archivos de prueba reales al repositorio.

## 12. Validación exigida

Pruebas de dominio, PostgreSQL real e integración con trabajador compilado, más recorrido reproducible de navegador. Los importadores financieros no quedan validados solo con mocks o el perfil sintético de CSAPP-02. Añade casos propios sin copiar valores del código como resultado esperado.

| Caso | Evidencia mínima |
| --- | --- |
| Tres perfiles | XLSX de cada formato, pie/Total, año seleccionado; categoría equivocada y año explícito incompatible rechazados |
| Precisión | Decimales largos/científicos, negativos, cero, residuo diminuto; sumas sin redondeo por fila ni `Number` |
| Vacíos y controles | Vacío de ingreso conserva null sin decisión; aceptación específica de cero; nunca usa Diferencia; Total no se importa; discrepancia bloquea |
| Duplicados | Duplicado idéntico dentro del fichero una vez; clave contradictoria bloqueada; repetición completa mantiene el conjunto |
| Sustitución | Admin 2026 de 100 a 120 deja **120, nunca 220**; una fila ausente se retira; soporte/otros y otros años intactos |
| Atribución | Identidad BC nueva, sin asignar y con cambio de destino en el año; importes conciliados aunque la atribución sea parcial; reproceso recupera el grupo sin cambiar dinero |
| Vigencia revisada | Dos lotes preparados sobre A: al activar B, C no puede sobrescribirlo con la confirmación antigua; requiere impacto actualizado |
| Atomicidad | Fallo inyectado y SIGKILL durante una sustitución por trabajador real: conjunto anterior íntegro o nuevo completo; reinicio sin duplicados ni intermedio visible |
| Recuperación | Cadena A→B→C, reversión vigente y restauraciones sucesivas; supersedido no reversible ni reactivado por REDERIVE |
| Equivalencias | Proyecto Wrike/PAP de nombre distinto al grupo, destino solo grupo, vigencias, conflicto de ticket y rechazo de solapamientos concurrentes |
| Fuente histórica PMO | 2 h Zendesk PMO en 2024 + 3 h Zendesk PMO 2025 excluidas + 4 h Wrike PMO 2025 elegibles → **6 h** en el agregado que comprende ambos años; no PMO sigue Zendesk |
| Servicio | Admin confirmado, soporte y otros expresamente asignados, desconocido y evidencias incompatibles; causas del cliente conservan horas |
| Prorrateo | Anual 12000, corte 15/30 → **500** del mes; corte 15/31 → `1000 × 15/31`; febrero real, cierre y cruce de año |
| Periodos | Enero/diciembre anterior; CUM actual distinto del año anterior completo y del CUM comparable; 29 de febrero y exclusión de horas posteriores al corte |
| Ratio ponderado | Grupos con R/H de 1000/10 y 1000/30 → cartera **400 €/jornada**, no media de 800 y 266,666…; 1000/0 más 1000/10 → **1600 €/jornada** de cartera con el primer ratio individual no calculable; independiente de paginación |
| Cero y falta de dato | Sin fuente ≠ grupo ausente en snapshot completo ≠ ingreso cero ≠ horas cero ≠ usuarios sin informar; sin usuarios sigue pudiendo haber ratio económico |
| Usuarios | 65→68, exposición 665 y stock 68; fracción de mes y hueco; usuarios compartidos sin sumarlos al grupo |
| Ámbito | Grupo con dos clientes y tiempo solo de grupo, cada actividad una vez; ingreso nunca copiado a cada cliente; filtro parcial no produce falsa rentabilidad |
| Configuración | Edición concurrente rechazada, auditoría y versión; nuevo objetivo cambia el resultado esperado conservando referencia a la versión previa |
| Histórico | Solo <2025, seco por defecto, idempotencia, ámbito existente protegido, sin OTROS/usuarios ficticios |
| Seguridad | Sin sesión/Consulta no mutan cargas, decisiones, equivalencias ni parámetros; pruebas de peticiones forjadas, sin datos ni auditoría de éxito indebidos |

En navegador prueba la carga financiera completa, vista previa del reemplazo, decisiones relevantes, repetición, sustitución con retirada, reversión y consulta económica. Usa la web y el trabajador construidos; versiona el recorrido y sus fixtures sintéticas. No basta afirmar que el servicio soporta una acción si la interfaz no permite realizarla.

Mide el circuito financiero a un tamaño representativo y el motor con al menos 250000 tiempos sintéticos repartidos entre grupos/meses, incluyendo Zendesk y Wrike, servicios, vacíos y filtros. Mide consulta de cartera/periodos y detalle paginado: consultas por conjuntos, sin N+1 por grupo/mes, joins que multipliquen horas ni arrays completos en navegador. Anota tamaño, máquina, comandos, tiempos y memoria; no prometas un tiempo objetivo que no has medido. La sustitución no necesita un millón de clientes para demostrar corrección.

Ejecuta los checks aplicables del proyecto: instalación reproducible, tipos, lint, build, suites afectadas y regresión existente. Comprueba migración sobre base limpia y sobre CSAPP-04 con datos sintéticos conservados. Si una prueba falla por límite temporal, informa tamaño y ajuste; no reduzcas cobertura o escondas un fallo para declarar verde. No repitas benchmarks ajenos sin motivo; sí las regresiones del motor/elegibilidad afectadas por cambios comunes.

## 13. Documentación y definición de terminado

Actualiza los contratos propietarios sin copiarlos a un documento gigante:

- `docs/importaciones/facturacion.md`: perfiles, año/filtros, importes, decisiones, conciliación y sustitución.
- `docs/calculos/catalogo.md`: periodos, formulas, estados, servicio y límites de ámbito, con IDs de reglas estables.
- `docs/arquitectura/finanzas-motor-csapp05.md`: esquema físico incremental, relación con `TimeActivity`, cálculo consistente, bloqueos, conjuntos vigentes y versiones. Enlaza a los contratos; no dupliques sus reglas.
- Contratos de maestros/Wrike/PAP y decisiones de CSAPP-04 para dejar claro que el fallback BC fue sustituido por equivalencias explícitas y qué propuestas siguen sin aceptación.
- Guía `docs/plan/guia-powershell-csapp05.md`, guía de cargas, configuración e históricos; comandos ejecutables de instalación, migración, web/trabajador y pruebas para Dennis. Distingue comandos documentados de ejecutados en Windows.
- `docs/validacion/csapp-05.md`, estado, índice documental y de prompts. Registra resultados y limitaciones reales, no porcentajes inventados de aceptación.

Terminado significa: tres perfiles operativos, sustitución y recuperación reales, motor consumido por la comprobación de Administración, configuración económica mínima, equivalencias directas a grupo, vía histórica preparada y pruebas/documentación completas. Los nueve perfiles operativos deben quedar identificados correctamente; no dejar finanzas como pendientes tras implementarlas.

Abre una PR propia contra `main`, **sin fusionarla ni desplegar**. Describe el problema, comportamiento final y validación. Comprueba que el diff corresponde a CSAPP-05. No avances a CSAPP-06.

La respuesta final debe incluir PR/rama, SHA base/final, migración, funcionalidades comprobables, reglas o propuestas pendientes, pruebas ejecutadas con entorno/cifras, lo no probado y pasos breves de Dennis. Para su aceptación manual: cargar 2025/2026 por categoría, repetir, sustituir un fichero con cambios y ausencias, revisar otras categorías, comprobar 12000→500 a 15/30 y probar reversión en su lote de prueba. No afirmes que ya realizó ese recorrido.
