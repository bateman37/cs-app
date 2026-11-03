# CSAPP-HOTFIX-01-v2 — Cargas sencillas, actualización de datos y precarga completa

## 1. Una sola entrega que sustituye v1

Trabaja exclusivamente en `bateman37/cs-app`. Implementa **un único CSAPP-HOTFIX-01**, con este alcance completo: todos los requisitos de precarga/unificación de v1, corrección del estado visual de las cargas, formularios sencillos, actualización por última carga, PAP de petición cliente, años financieros abiertos, histórico económico 2022–2025 y usuarios contratados de 2025 con su continuidad.

**Esta versión sustituye íntegramente CSAPP-HOTFIX-01-v1.** Es autocontenida; no ejecutes dos entregas ni mantengas las reglas contradictorias de v1. Archiva literal `prompts/CSAPP-HOTFIX-01-v2.md` antes de modificar código/pruebas/migraciones. Conserva v1 como documento histórico y márcala sustituida en el índice.

Si v1 ya tiene una rama/PR abierta, amplía esa misma entrega con commits normales y reescribe título/descripción para el alcance final. Si aún no empezó, crea rama propia desde una base que contenga **CSAPP-01 a 10**. Comprueba el grafo real; no supongas que `main` está completa. No añadas este trabajo a una PR anterior distinta, no hagas force-push, reset de datos o cambios ajenos. PR sin fusionar ni desplegar; no es una entrega 11 del roadmap.

Fuentes privadas adjuntas: **`HOJAS DE CARGA.xlsx`**, **`DATA FACTURACIÓN.xlsx`** y cuatro capturas de problemas. El encargo autoriza su uso para implementar y ensayar estas precargas en un entorno aislado. No autoriza afirmar que ya cargaste el PostgreSQL local de Dennis sin acceso a él.

Resultado para Dennis: actualizar su versión conservando `.env` y datos, entrar en Administración, cargar sus archivos sin formularios técnicos y ver Clientes/Personal e históricos incorporados. Una sola guía de aplicación de este hotfix; no introducir maestros uno a uno ni ejecutar SQL manual.

## 2. Lectura y cambios de contrato expresamente pedidos

Lee AGENTS/CLAUDE, índice, estado y contratos dueños de maestros, usuarios, cargas, fuentes, cobertura y cálculos. Entradas: `src/app/(app)/administracion/cargas/`, `src/components/form-kit.tsx`, `src/app/globals.css`, `src/server/uploads/`, `src/server/{pap,bugs,zendesk,wrike,finance}/`, dominio de usuarios, servicios de maestros y esquema Prisma.

La revisión de partida fue lectura dirigida, no ejecución de la app. Hallazgos que debes reproducir y corregir:

| Hallazgo | Consecuencia |
| --- | --- |
| `.btn[disabled]` usa `cursor: wait` en `globals.css` | El botón Confirmar ya inhabilitado parece seguir trabajando después de completarse |
| El formulario expone lista PAP, vista de bugs, ámbitos, intervalos y declaraciones | El recorrido ordinario exige decisiones técnicas que Dennis ha pedido eliminar |
| Wrike tiene seis columnas y ninguna identifica una imputación de forma única; el `id` de tiempos Zendesk es opcional/no garantiza unicidad | No se puede implementar una sustitución correcta usando ticket_id o una coincidencia aproximada de horas |
| `planHistoric` rechaza años >=2025 | El archivo real de 2025 no se incorpora por esa vía |
| El adaptador considera ambiguo que Admin Delegada esté marcado y D no esté vacío | Las filas reales con D=`Admin Delegada` y F=1 se rechazan injustificadamente |
| Usuarios solo permite editar el año actual y bloquea 2025 por constante | Contradice la nueva petición de editar año actual **y anterior** |

Las instrucciones siguientes **modifican las reglas anteriores** de estas materias. Actualiza contratos, versiones de reglas y pruebas con la razón del cambio, sin presentar las expectativas antiguas como requisitos todavía vigentes. Mantén las cuatro vistas y Administración; no reescribas los motores ni actualices dependencias por conveniencia.

## 3. Formularios: archivo y, en finanzas, año

Mantén las entradas identificables de Zendesk tickets, tiempos Zendesk, Wrike, PAP, bugs VFS, bugs VSW y las tres financieras. En el recorrido ordinario cada fuente pide **solo el archivo**; los tres perfiles financieros añaden **Año**, editable a mano.

Retira del formulario normal: lista de origen PAP, vista abierto/intervalo/amplia, ámbito DevOps, extracción, intervalos, cobertura escrita a mano, casilla de conjunto anual completo y nombre de hoja cuando solo hay una compatible. No los escondas dejando validadores del servidor que sigan exigiéndolos. Corrige cliente, tipos de campos, metadata serializada, esquemas, rutas, trabajador y mensajes juntos.

Configuración técnica estable se conserva internamente o en configuración de fuente una sola vez, no en cada subida. PAP utiliza la identidad común de §5. VFS/VSW quedan separados por el perfil elegido. Un único origen/ámbito no exige rellenar su nombre; si el CSV ofrece un ámbito inequívoco, se puede usar. No deduzcas producto solo del nombre del archivo o de un ID numérico coincidente.

**Vista amplia es el contrato predeterminado autorizado por Dennis**, sin otro selector ni casilla: leer todos los registros suministrados, abiertos/cerrados y todos los tipos, sin filtros ocultos de año, estado o categoría. Conservar bruto de filas no calculables con motivo; esto no autoriza convertir errores de fecha/duración en hechos válidos.

Valida automáticamente cabeceras, formato y hoja. Si hay más de una hoja realmente ambigua, informa de ese problema concreto; no obligues a todos los usuarios a rellenar ese dato. Mantén una revisión clara y **Confirmar y activar**, con recuentos/impacto; quita opciones innecesarias, no la trazabilidad o validación.

### Estado final y cursor

Deshabilitado no significa pendiente. Un botón inhabilitado por estado terminado tiene cursor normal/no permitido; solo una operación realmente enviada muestra `aria-busy`, texto y cursor de progreso. Al finalizar no puede seguir girando ni mantener «Enviando» o «Aplicando» sin trabajo.

Separa envío, preparación, activación y recálculo/reversión. Estado COMPLETED con un REDERIVE realmente activo se explica como operación aparte; no falsees el terminal para esconderlo. Revisa `ActionButtons`, `SubmitButton`, `StatusPoller`, limpieza de timers/AbortController, `router.refresh` y transiciones. Detén sondeo cuando no haya trabajo activo y actualiza la ficha una vez. Error, cancelación y desmontaje liberan indicadores. Prueba todas las fuentes, no solo Wrike.

### Año escrito a mano

En **Soporte, Administración Delegada y Otros**, sustituye el select por entrada numérica de cuatro dígitos, inicialmente el año actual Europe/Madrid pero libre para 2026, 2027, 2028 y posteriores. Validación coherente cliente/servidor: entero de cuatro dígitos dentro del rango técnico documentado 1900–9999; sin lista de años codificada ni límite año actual+1. Rechaza vacíos/decimales/texto, sin truncarlos silenciosamente.

El histórico de §6 toma el año de cada fila y no pide un año único para todo el libro. Cargar un año futuro no altera los ingresos del actual.

## 4. Regla general: lo último cargado sustituye el contenido anterior

Conservar auditoría y revisiones no significa seguir sumando versiones viejas. Una carga posterior con la misma identidad sustituye la **versión activa** anterior, sin sumar antiguo+nuevo ni pedir una corrección manual en el caso inequívoco.

Orden determinista: asigna una secuencia de recepción aceptada al lote en servidor. Entre lotes **completados con éxito**, gana la mayor secuencia para su identidad/ámbito. Un lote fallido, cancelado o pendiente no desplaza al activo. Si un trabajador antiguo termina tarde, no pisa el lote posterior. No uses posición de fila ni reloj del navegador. Reprocesar no convierte un lote antiguo en la carga más reciente.

Esto sustituye la regla anterior de que una observación o Changed Date antiguos siempre impedían actualizar: **si Dennis vuelve a subir el archivo, su carga posterior manda sobre el estado actual**, aunque el export traiga fechas antiguas. Las fechas originales se conservan como datos/procedencia y no se reescriben para fabricar actualidad.

| Fuente | Identidad o ámbito activo y actualización |
| --- | --- |
| Tickets Zendesk | `ticket_id`; la nueva carga completa los ocho campos y sustituye contenido activo. Conserva revisiones/observaciones, tickets sin horas y organizaciones internas |
| PAP | ID PAP único de esta aplicación; §5 elimina la necesidad de lista por carga y consolida namespaces heredados |
| Bugs | Identidad Work Item por producto VFS/VSW y ámbito real; mismo ID en productos distintos no se fusiona. Nueva versión activa por última carga |
| Finanzas normales | Sustitución completa del conjunto **año+categoría**. No incremental ni suma de descargas; otras categorías/años intactos |
| Tiempos Zendesk / Wrike sin ID estable | Última **instantánea amplia completa por fuente**, según el mecanismo de abajo, no una clave de ticket inventada |
| Maestros y usuarios precargados | Crear/reutilizar y preservar cambios manuales según §7–9. No aplicar a estos maestros un borrado/recreación o una sobrescritura indiscriminada |

Dentro de un archivo, repeticiones exactas cuentan una vez. Para una entidad con **ID realmente único**, dos contenidos contradictorios del mismo ID en el mismo archivo son un error de fuente claro, no «gana la última fila». No apliques esa regla a un campo de tiempo que no sea único.

### Tiempos: resolver la ausencia de ID sin perder horas

El CSV actual de Wrike contiene Usuario, Proyecto, Nombre de la tarea, Ticket Zendesk, Fecha registro y Dedicación (horas). **No contiene ID de imputación**. El `id` de tiempos Zendesk tampoco es siempre una identidad suficiente. No uses ticket, tarea, persona+día, duración o número de fila como un identificador único ficticio: pueden existir varias imputaciones legítimas.

Para estos formatos, implementa una **instantánea activa por fuente**: cada carga amplia completada reemplaza el conjunto visible anterior de esa fuente; anteriores instantáneas/brutos se conservan para historial/reversión. El origen de tiempos Zendesk y el de Wrike tienen punteros separados. Filas idénticas se deduplican; filas distintas legítimas del mismo ticket/persona/día se mantienen. Una duración corregida en el nuevo archivo no se suma a la antigua.

No se intenta adivinar qué evento cambió comparando nombres. Un futuro formato con ID estable puede tener actualización por ID documentada; el actual debe funcionar sin pedir nuevas columnas. Actualiza `TimeActivity`, consultas de detalle, conciliación, PMO y exportaciones para leer solamente el conjunto activo, respetando pertenencia/procedencia compartida. No puede quedar una vista contando también snapshots sustituidos.

En la migración, conserva la actividad legítima vigente como base heredada trazable. No elijas retrospectivamente un archivo antiguo parcial como si ya hubiera tenido este contrato de export completo, ni fabriques un lote con archivo inexistente. La primera nueva carga amplia sustituye esa base de forma explícita y conciliada.

Mensaje breve junto a estas fuentes: **«Carga el export completo: sustituirá los tiempos activos de esta fuente; las cargas anteriores se conservan»**. No añade casillas ni intervalos. No permite interpretar como acumulativo un fichero que solo contiene un mes.

### Ausencias, tipos y reversión

En tickets/PAP/bugs, actualizar IDs presentes no implica cerrar o borrar IDs ausentes: el usuario ha pedido actualizar por ID, no inferir cierres por ausencia. En tiempos el conjunto activo sí lo determina la instantánea completa; en finanzas, el año/categoría completos.

Importa **todos los Work Item Type** en bugs VFS y VSW y todos sus estados. Solo `Bug_` sigue contando como defecto en los KPI; cargar todo no convierte PBI/Task en bugs. PR/Ready for Release no se interpretan como despliegue/cierre por conjetura.

La reversión restaura la versión/snapshot anterior válido sin borrar su historia. Revertir un lote antiguo no puede pisar una versión posterior activa. Mantén fencing, atomicidad y recuperación con dos trabajadores.

## 5. PAP: sin lista manual y con Petición cliente

Deja de pedir «lista de origen». Para esta aplicación, el **ID del PAP identifica la entidad**, por ejemplo subir ID 3450 y después ese mismo ID corregido deja un PAP con el contenido de la última carga. La fecha del título o el nombre del archivo no crean otra identidad.

Migra de forma controlada los PAP ya cargados con distintos `sourceList`: agrupa por ID, conserva todos los brutos/revisiones y elige versión activa por orden de cargas exitosas. Reasocia o resuelve referencias mediante identidad canónica sin duplicar numeradores, causas, tickets, bugs, detalles o exportaciones. No borres auditoría inmutable ni dejes referencias huérfanas. Si falta orden fiable en un caso heredado contradictorio, hazlo visible para resolverlo; no elijas por nombre de lista.

Puedes mantener un namespace técnico único interno y la etiqueta antigua como procedencia, pero **no** como una forma de seguir creando dos PAP activos con el mismo ID.

Añade **Petición cliente** como categoría propia reconocida. Admitir variantes de tildes/caja/espacios, conservando el literal. No debe aparecer «sin clasificar» para esa causa conocida. Mostrarla en resumen, filtros, detalle y exportación.

Petición cliente no equivale automáticamente a Correctivo origen cliente ni a Evolutivo no facturable. Si un PAP tiene varias causas y alguna es correctiva, sigue siendo un PAP correctivo único; puede pertenecer también a Petición cliente con desglose no aditivo. Si solo tiene petición cliente, la clasificación conocida no es UNKNOWN por falta de un patrón viejo. No inventes facturabilidad.

Al corregir un PAP por ID se actualizan causas/fecha/resultado/vínculos activos: no sobreviven asociaciones antiguas sumando afectación. La reversión restituye la versión completa anterior. Se conserva la fecha de producción real y no se añade un filtro Resultado=OK.

## 6. Precarga económica real de 2022 a 2025

Archivo `DATA FACTURACIÓN.xlsx`: 25.373 bytes, SHA-256 `d79f05cddafcb410103d83755ce4e47ea9064d9194a88388190082ae779f6628`. Una hoja `DATA FACTURACIÓN`, rango A1:I165; **164 filas de datos**. H tiene encabezado Usuarios; I está vacía, no es un campo nuevo.

| Columna | Lectura |
| --- | --- |
| A | Grupo cliente / denominación BC |
| B | Facturación anual, importe fuente |
| C | Año, con espacio final en encabezado |
| D | Soporte histórico o literal Admin Delegada |
| E | Facturación mes calculada, referencia que no se suma al anual |
| F | Indicador Admin Delegada 0/1 |
| G | Servidor, con fórmulas de búsqueda externas y valores cacheados |
| H | Usuarios; informados en 2025 |

Controles reales:

| Año | SOPORTE | ADMIN_DELEGADA | Total filas |
| --- | ---: | ---: | ---: |
| 2022 | 35 | 1 | 36 |
| 2023 | 39 | 2 | 41 |
| 2024 | 40 | 4 | 44 |
| 2025 | 39 | 4 | 43 |

No hay OTROS en este archivo. No inventes su importe ni borres conjuntos OTROS o 2026 ya cargados. No hay claves repetidas Grupo+año+categoría en esta versión. Hay 46 grupos económicos distintos; dos no están en el maestro CLIENTES actual.

Implementa una entrada de **Histórico económico y usuarios** desde Administración, con solo este archivo y resumen automático por año/categoría. Puede ser el segundo paso de la puesta en marcha tras los maestros; no se exige mezclar físicamente los dos Excels. Una entrega, dos fuentes privadas, sin preparar CSV intermedios o SQL.

Cambios exigidos:

- Admitir **2025 y anteriores**, sustituyendo el límite anterior `<2025`. No ignorar 2025 ni exigir descargarlo de otro sitio cuando aquí ya está.
- Clasificar Admin Delegada si D lo dice o F=1 de forma coherente; D no vacío no implica Soporte cuando su valor es precisamente Admin Delegada. Las 11 filas administrativas reales no son ambiguas por esa razón.
- En los otros valores conocidos de D, con F=0, categoría SOPORTE. «Silver» histórico no se convierte automáticamente en Silver On Demand/Recurrente actual: conserva subtipo no informado y etiqueta original.
- Utilizar B como importe anual, precisión decimal y conciliación por año/categoría. No ejecutar fórmulas ni enlaces externos. El libro no tiene Total de control de Power BI: conciliar las sumas de B y sus filas, sin rechazarlo por un pie inexistente ni inventar certificación externa.
- E es una comprobación/referencia, no otro ingreso. **E164 usa B164/6**, mientras las demás referencias usan /12: conserva y señala esa excepción; no deduzcas un mes de arranque, no multipliques E por 12 para inventar el anual. El motor puede seguir imputando el anual por su método documentado, mostrando la diferencia de referencia.
- G tiene dos `#N/A`, en filas 28 y 100. No descartar ingresos ni seguir el enlace del VLOOKUP. Resolver grupos con el maestro y conservar ausencia/conflicto de alojamiento; el cache de una búsqueda actual no demuestra vigencia histórica.
- Los dos grupos económicos ausentes del maestro pueden crearse como **Grupo Cliente de procedencia histórica**, sin inventar Cliente Zendesk, IDs, implantaciones o usuarios. No declarar su estado comercial actual a partir de su ausencia en CLIENTES.
- Conservar el archivo original real en almacenamiento de cargas. Si se generan lotes hijos por año/categoría, comparten referencia al original con su checksum y procedencia: no usar rutas ficticias que rompan backup/reversión.

La carga es idempotente y activa los ámbitos presentes según la política de año/categoría de §4, con impacto visible antes de confirmar. Repetir no suma ingresos. Si ya hay 2025 cargado, una sustitución debe ser explícita en el resumen confirmado, no una sobrescritura oculta. Años/categorías no incluidos permanecen intactos.

## 7. Usuarios: base 2025, copia y edición dinámica de dos años

Este segundo Excel **sí aporta usuarios** y amplía el alcance de v1. La primera fuente de maestros no tenía esas cantidades: ahora debes importarlas, no dejar todo pendiente por repetir la limitación anterior.

H contiene **43 valores de 2025 para 39 Grupos**: algunos Grupos aparecen en Soporte y Admin. **No sumes las filas financieras para obtener usuarios**. Hay cuatro discrepancias entre categorías, localizables en H124/H165, H132/H161, H143/H162 y H152/H163. Conserva los dos valores/contextos y permite resolverlas en la revisión de la precarga o después en el maestro; no tomar automáticamente máximo, suma, último de fila ni una categoría sin elección explícita. Carga los grupos inequívocos y deja solo esos denominadores pendientes, nunca cero.

H160 es una fórmula aritmética con resultado almacenado: leerlo/validarlo sin ejecutar fórmulas arbitrarias. Usuarios deben ser enteros no negativos. Si falta dato o no hay un único valor, no inventar.

Reglas de inicialización y mantenimiento:

1. Para cada Grupo con usuarios 2025 resueltos, inicializar **los doce meses de 2025 con ese mismo número**. Es condición inicial uniforme, no doce cantidades que sumar como personas distintas.
2. Inicializar **2026** desde esa base, con posibilidad de incrementos/decrementos por mes. Si ya hay valores/editados, no pisarlos. Tampoco una recarga del Excel revierte ajustes manuales de meses.
3. Dennis autoriza usar esa misma base 2025 para los **años históricos presentes 2022, 2023 y 2024** donde exista ese Grupo y falte el dato. Registrar «Estimado a partir de 2025», no «usuarios observados en 2022». Si el Grupo no tiene base 2025 o está en conflicto, mantener sin informar.
4. Propagación solo a la matriz de **Grupo**. No copiar sus licencias a todos los Clientes/implantaciones ni a Personal. Los ámbitos inferiores necesitan usuarios propios.
5. Nuevas matrices anuales se crean desde la interfaz con año numérico; para continuidad futura puede proponerse copiar diciembre anterior, como acción explícita que conserva ajustes y muestra procedencia. No dejar la app anclada a 2025/2026 ni sembrar años futuros al arrancar.

**Nueva política autorizada de edición ordinaria:** año actual y año anterior, calculados en Europe/Madrid, tanto en interfaz como servidor. Sustituye la restricción anterior de solo año actual y el bloqueo permanente de 2025. En 2026 se editan 2025/2026; en 2027, 2026/2027; en 2028, 2027/2028. Los más antiguos se consultan, salvo la inicialización histórica autorizada de este perfil.

Migra bloqueos de filas 2025 coherentemente con esa ventana sin destruir INITIAL/COPIED/ADJUSTED ni su historial. Cuando el calendario avance, el anterior más antiguo deja de ser editable, incluso mediante peticiones forjadas. No tomar el año enviado por el cliente como reloj de autoridad.

Mantén Aplicar desde este mes, edición de un mes, vista previa y protección de ajustes explícitos. Stock al corte distinto de usuarios mes; null distinto de cero. Las vistas/CSV explican cuándo el denominador es estimado o heredado. No usar licencias estimadas como evidencia de calidad histórica medida, ni cambiar rentabilidad por jornada que no utiliza ese denominador.

## 8. Precarga de Clientes: todo lo incluido en v1

Archivo `HOJAS DE CARGA.xlsx`: 27.038 bytes, SHA-256 `daf8d61de6626c52948c0ef3cbf2dcccd1867094355a7f3f08fc1a9bd264cce8`.

- CLIENTES A1:K77: 74 filas útiles; 46 denominaciones BC, 63 organizaciones Zendesk, 38 alias Wrike y 64 PAP. No 77 clientes ni el antiguo recuento documental de 76; las dos filas finales sin contenido no crean entidades.
- PERSONAL A1:G76: 75 filas, un duplicado exacto, 74 distintas antes de revisar variantes/entradas especiales.
- PERSONAL PMO A1:B18: 17 roles; dieciséis enlaces exactos por alias Wrike tras consolidar duplicado y un caso por revisar.

Un solo perfil **Precarga de maestros** procesa las tres hojas. Reutiliza ClientGroup, Client, Implementation, ExternalIdentity, ServiceTerm, Person, PersonAlias, PersonTerm y catálogos; no crees maestros paralelos. Valida posiciones y cabeceras duplicadas sin sobrescribir unas columnas con otras.

Mapeo de CLIENTES:

| Columnas | Destino |
| --- | --- |
| A/B | Nombre Wrike y su Grupo BC |
| C/D/F | ID Zendesk como texto exacto, nombre de Cliente y Grupo BC |
| E/H | Dos soportes de igual encabezado: consolidar si coinciden, revisar si discrepan |
| G | OP/CLOUD informado |
| I/J | Organización/proyecto PAP y Grupo BC |
| K | Complejidad Basic/Medium/Enterprise del proyecto, no usuarios |

No conectar Wrike a un Cliente solo por compartir fila. Un alias que identifica varios Clientes del mismo Grupo puede apuntar al Grupo; no al primer Cliente. Zendesk repetido por varios PAP sigue siendo un Cliente. Conservar denominaciones BC y equivalencia usada por finanzas, sin inventar códigos ERP.

Para esta precarga, un nombre PAP inequívoco para un único Grupo/Cliente identifica una implantación de ese Cliente; crearla/reutilizarla con alias y complejidad, mostrando el destino en revisión. PAP de varios Clientes/grupos no crea implantaciones ficticias. K4/K5 son diferentes para proyectos distintos del mismo Cliente: no quedarse con primer/último TIPO al nivel Cliente. No prometer tickets por implantación si la fuente no lo identifica.

Los internos/pruebas D67 y D71:D73 se conservan como organizaciones internas, con ID Zendesk y sin Grupo BC inventado, fuera de la cartera externa. Faltas de Wrike/PAP/TIPO no invalidan un Cliente identificable.

Casos reales que se conservan como revisión privada, sin datos nominativos en Git:

- E12/H12, E44/H44, E57/H57 y E58/H58: cuatro discrepancias de soporte; permitir cargar identidad y demás datos válidos dejando ese atributo pendiente.
- Alias Wrike A21/A24:A29/A32/A43: tres Grupos. No asignar por semejanza de nombre ni crear identidades activas solapadas.
- Alias PAP I26/I32/I43/I74: cuatro Grupos. No corregir grafías o repartir por conjetura.
- PAP I22/I23: dos Clientes de un Grupo; puede conservarse atribución a Grupo, no duplicar el alias en dos destinos.

Mantén estas revisiones en la ficha de precarga, **no una bandeja nueva**. Cargar lo válido no convierte en confirmadas las correspondencias pendientes. Resoluciones posteriores guardan autor/motivo y se aplican idempotentemente.

## 9. Personal y PMO: una carga y un maestro

PERSONAL es la fuente principal; PERSONAL PMO la enriquece, no añade automáticamente 17 empleados:

| Fuente | Campo |
| --- | --- |
| PERSONAL A | Alias/correo PAP original |
| B/G | Un único alias Zendesk; G repite B, verificar y no duplicar |
| C/D | Nivel/equipo con catálogo y vigencias |
| E | PMO_MEMBER 0/1 conocido distinto de ausente; contrastar fórmula simple/resultado compartido y Equipo |
| F | Alias Wrike si existe |
| PERSONAL PMO Persona/PERFIL | Enlace por alias Wrike exacto, rol ANA/DEV en la misma Person |

Conservar originales, espacios/caja normalizados según contrato, **sin quitar tildes o palabras para confirmar identidades**. No ejecutar fórmulas arbitrarias ni validar los marcadores de blanco como correos humanos.

PERSONAL 47/75: duplicado exacto, una persona y procedencia de ambas filas. Variantes 13/14, 56/57 y 59/60: proponer revisión, no fusionar correos/personas por semejanza. PERSONAL PMO A18 frente a PERSONAL F74: posible nombre extendido, confirmar enlace, no duplicar automáticamente. PERSONAL 58/65: entrada de prueba y marcador, no dos empleados nuevos activos por defecto; conservar motivo. PERSONAL 32 y otros incompletos: cargar identidad/alias conocidos sin equipo o nivel inventados.

Primero consolidar exactos y luego roles. Coincidencia F↔Persona sustenta la unión aunque el nombre Zendesk difiera; rol ausente sigue desconocido. Rol solo vigente si pertenece a PMO. Una persona PMO realmente nueva sin candidato conflictivo puede añadirse tras revisión con lo conocido, sin adivinar nivel.

Conservar equipos reales CS, CS N2, IT, PMO y PLAT y niveles N1–N4; validar su uso en perfiles analíticos para no perder horas por etiquetas. Correspondencias semánticas adicionales son explícitas, no renombrado silencioso.

Interfaz: **Personal** reúne equipo interno/colaboradores, alias, nivel, pertenencia y rol PMO; **Usuarios contratados** son licencias de clientes por mes; **cuentas de acceso** son Admin/Consulta. Etiquetar claramente. No crear cuentas Better Auth a partir de correos del Excel ni mezclar esas tres tablas.

Maestros: crear lo ausente, reutilizar identidad inequívoca, proponer diferencias y preservar ediciones posteriores/inactivos. No borrar/recrear cada vez. Vigencias [desde,hasta), fecha efectiva elegida o inicial desconocida por revisar (`validFrom=null`), explicando que no acredita toda la historia. No poner hoy/01-01-2025 silenciosamente ni pisar una migración CLOUD o pertenencia PMO histórica conocida.

Conserva límites de solapamiento y versión optimista. La misma fuente reordenada no crea nuevas entidades; fila/celda son procedencia, no clave. Decisiones no se reaplican por número de fila a otro checksum. Si los maestros resuelven hechos ya cargados, mostrar reproceso necesario y ofrecer el recorrido explícito existente, sin reimportar originales ni dar cifras obsoletas por validadas.

## 10. Cobertura, observaciones e interpretación automática

La simplicidad de §3 debe funcionar de extremo a extremo. El contrato de vista amplia pasa a configuración predeterminada de fuente autorizada por Dennis; no pedir en cada subida que confirme todos los estados u otra declaración idéntica. Registra esa procedencia como **contrato de la fuente**, no como una inferencia estadística porque existan filas.

Si el fichero contiene fecha de extracción fiable, se puede usar y conservar su procedencia. Si no, fecha de recepción como observación operativa, identificada como tal; no inventar extracción real ni usar MAX(fecha_creación) como fecha de snapshot. Las fechas de trabajo/creación/producción siguen siendo fechas del dato y no se cambian a recepción.

Vista amplia no inventa un periodo histórico ilimitado: si no puede acreditarse completitud temporal para un cero o stock histórico exacto, muestra el límite concreto **sin bloquear la carga ni exigir intervalos**. Configuración/excepciones de cobertura se pueden revisar en su apartado cuando sean necesarias, no mediante campos obligatorios rutinarios. Mantén ceros sustentados, parcial y ausencia distintos en Pulse/Calidad.

No reconstruir backlog pasado con la revisión actual ni presentar un estado recibido hoy como observación demostrada de hace dos años. Al cambiar activo/versiones, invalidar sellos y materializaciones dependientes. Exportaciones ya congeladas conservan su referencia; lecturas nuevas muestran el nuevo estado. El cambio de política no recalibra ni activa semáforos por defecto.

## 11. Migración, transacciones, permisos y reversión

Antes de activar cambios de identidad/snapshots en la base local, guía a Dennis para una **copia verificada** con parada ordenada. Migraciones incrementales; no editar las anteriores, usar `reset`, `TRUNCATE`, `db push`, `DROP CASCADE` o semillas al arrancar. Conservar `.env`, archivos privados, cuentas, hechos y auditoría.

Planifica migración de cargas existentes: orden ganador, PAP canónico, punteros de tiempos, provenance compartida, snapshots heredados y revisiones activas. El registro original se conserva; el estado analítico activo debe quedar único y conciliado. No basta cambiar la lógica solo para lotes nuevos dejando duplicados antiguos en las vistas.

Aplicación atómica por ámbito y un solo ganador bajo concurrencia, con fencing/lease y versiones. Un fallo mantiene el anterior; reversión se limita a lo que aún sustenta ese lote, sin pisar posteriores. Históricos multiaño: unidad de confirmación coherente y sin éxito global si solo se activó una parte inadvertidamente.

Solo Administrador sube, decide, activa y modifica matrices. Revalida rol en servidor/trabajador; Consulta no puede forjar mutaciones o leer originales privados. Guarda origen/celdas/decisiones, antes/después y ejecutor. La fuente de los maestros y los dos Excels reales no van a Git, fixtures públicas, `public/`, PR ni logs nominativos; en Git solo código, contratos, prompts seguros y sintéticos.

## 12. Pruebas y criterios de cierre

PostgreSQL real de test, guard central y `current_database()` en conexión efectiva antes de mutar. Nunca probar contra `cs_app` de Dennis, limpiar sus cuentas o inyectar sintéticos en su cartera. Fixtures versionadas solo sintéticas; ensayo real de adjuntos en entorno temporal privado.

Casos mínimos, con resultados esperados independientes:

1. COMPLETED sin trabajo activo: Confirmar deshabilitado sin cursor de espera ni `aria-busy`; no quedan llamadas de sondeo indefinidas. Pendiente real sí indica operación; error/cancelación liberan estado. Verificar todas las fuentes.
2. Cada perfil ordinario acepta archivo solo, salvo año financiero. VFS/VSW no devuelve «Indique vista» ni PAP pide lista. Ningún requisito oculto en esquema/servidor.
3. Año manual 2026, 2027 y 2028 en los tres perfiles; vacío, decimal y texto rechazados; reloj de 2027/2028 sin cambiar código. Datos futuros no contaminan actual.
4. Ticket mismo ID, contenido nuevo en carga posterior: uno activo, revisión anterior conservada; export con fecha antigua subido después gana por política nueva. Un lote antiguo que acaba tarde no pisa al posterior.
5. PAP ID 3450 repetido con otra causa/fecha/vínculo: un PAP, contenido nuevo, sin vínculos activos sobrantes. Consolidar duplicados de namespaces anteriores; repetir y revertir sin duplicar.
6. Petición cliente con/sin tilde y multicausa con Correctivo: categoría conocida, total único y correctivo cuando corresponda; no convertirlo en no facturable.
7. VFS/VSW con mismo ID numérico, diversos Work Item Type y estados: almacenar todo, productos separados, solo Bug_ en numeradores; ausencia no cierra.
8. Tiempos/Wrike sin ID único: dos imputaciones distintas del mismo técnico/ticket/día sobreviven; cambiar una duración en snapshot posterior no suma antigua+nueva. Repetición exacta no duplica; revertir restaura snapshot. Fuentes Zendesk/Wrike independientes.
9. Concurrencia, reintentos y SIGKILL representativo durante activación/reversión: puntero/cifras anteriores o nuevos completos, nunca mezcla. `TimeActivity`, detalle y CSV concilian con snapshot activo.
10. Libro histórico real: 164 filas en ocho ámbitos según tabla; las 11 administrativas y las 43 filas de 2025 admitidas. No hay exclusión por límite viejo o D no vacío.
11. Precisión/sumas de B, E no duplicada, excepción E164 conservada, G con dos errores y grupos históricos ausentes sin pérdida de ingreso. Originales disponibles y backup no roto por lotes hijos.
12. Usuarios 2025 repetidos por categoría no se suman; cuatro discrepancias señaladas, resto inicializa doce meses. Copia 2026 y 2022–2024 sin pisar ajustes; procedencia estimada visible, grupos sin base quedan null.
13. Edición en 2026: 2025/2026 sí, 2024 no; en 2027: 2026/2027 sí, 2025 no; en 2028: 2027/2028 sí. Validación de servidor contra mutación forjada; inicialización autorizada no deja un bypass abierto.
14. 65 enero–mayo y 68 junio–octubre: 665 usuarios mes y stock 68. Propagación respeta ajustes posteriores, null distinto de 0 y sin copiar usuarios a hijos.
15. Maestro real: tres hojas, cabeceras repetidas, duplicado personal, 16 roles PMO enlazables y un candidato, internos y alias ambiguos. Cargar lo válido conserva solo las decisiones necesarias; repetir/reordenar no duplica ni pisa cambios.
16. Paridad de Comparativa, ficha, Pulse, Calidad, detalles y exportaciones después de reemplazos/precargas. Mantener corte PMO por fecha de trabajo y fuente: antes de 2025 Zendesk; desde 2025 PMO Wrike/resto Zendesk.

Ejecuta tipos, lint, build web/trabajador, suites de maestros/usuarios/fuentes/cargas afectadas, migración limpia y actualización con datos. Recorrido compilado por navegador: archivo → preparar → confirmar → completado estable; año futuro; PAP actualizado; vista amplia VFS; precargas de ambos archivos; ajuste de mes anterior; descarga conciliada.

Ensaya ambos Excels reales en base aislada: análisis, aplicación de lo válido, repetición y comprobación de conteos/sumas/datos activos. No presentar un dry-run como aplicación real. Informes nominativos privados; validación de Git con conteos seguros y límites. Windows, datos locales de Dennis y proxy solo se reportan ejecutados si realmente lo fueron.

## 13. Guía para aplicar una sola versión en Windows

Entrega instrucciones cortas y secuenciales para **`C:\Projects\cs-app`, base `cs_app`**: parar, copia verificada, traer rama/SHA correcto sin borrar `.env` o cambios ajenos, `npm.cmd ci`, migración incremental, `npm.cmd run build:todo`, preparar almacenes si corresponde y `npm.cmd run start:todo`.

Después, ruta exacta para cargar **HOJAS DE CARGA** y **DATA FACTURACIÓN**, revisar lo excepcional, confirmar y comprobar Clientes/Personal/roles, ingresos 2022–2025 y matriz mensual. Las cargas operativas posteriores usan archivo y año cuando procede. Explica con una frase la sustitución completa de tiempos y la actualización por ID de las otras fuentes.

No repetir una instalación desde cero, recrear la base, pedir SQL/JSON manual, crear una cuenta por empleado o decir que debe rellenar intervalos ocultos para que funcione. No cargar automáticamente datos privados durante el arranque. Las confirmaciones de las precargas reales las hace Dennis en su instalación.

## 14. Documentación, PR e informe

Actualiza contratos dueños de cada regla: v1 del hotfix sustituida, última carga vs fechas originales, PAP único/petición cliente, snapshots de tiempos, vista amplia, financiero histórico incluyendo 2025, usuarios estimados y edición de dos años. Corrige textos «2025 fijo para siempre» o «solo año actual» donde ya no sean verdad; distingue inicialización uniforme de bloqueo de edición. Mantén documentación modular e indexada.

Si permanecen propuestas económicas/Calidad ajenas, conservar su estado sin aceptarlas por este hotfix. Las reglas expresamente cambiadas aquí sí deben quedar actualizadas, no como antiguas decisiones pendientes que impidan esta implementación.

Una sola PR de CSAPP-HOTFIX-01, sin fusionar/desplegar, con título/descripción del alcance final, base real, migraciones, compatibilidad, pruebas, riesgos y guía. Informe final: qué funciona, política exacta por fuente, datos realmente precargados en ensayo, discrepancias pendientes, cifras verificadas, límites Windows y recorrido de Dennis. No afirmar que su PostgreSQL local ya se ha actualizado si solo lo ensayaste en tu entorno.

Detente al completar esta entrega única. No empieces otro roadmap ni publiques por iniciativa propia.
