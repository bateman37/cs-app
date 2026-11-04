# CSAPP-HOTFIX-04-v1 — Edición real en las tablas y reparación de Comparativa

## 1. Encargo cerrado: una entrega, sin otra reinterpretación del Excel

Trabaja exclusivamente en `bateman37/cs-app`. Completa en **una sola entrega y PR**:

1. Clientes editable **en la propia tabla**, con los ocho campos del Excel y estado comercial.
2. Usuarios contratados editable **en la misma matriz mensual que ya existe**.
3. Guardar, revisión y confirmación obligatoria antes de persistir cambios en ambas tablas.
4. Reparar el error real que impide cargar Comparativa tras HOTFIX-03.
5. Corregir navegación y rutas antiguas para que Dennis siempre llegue al editor correcto.

Archiva literalmente `prompts/CSAPP-HOTFIX-04-v1.md` antes de modificar código. Lee AGENTS.md, CLAUDE.md, índice/estado y los contratos de maestros, usuarios, relaciones automáticas y economía afectados. La revisión de partida encontró `main` en `c4a298a`, merge de PR 15, con HOTFIX-03. Verifica la base real y crea una rama nueva desde una base que lo incluya. No trabajar sobre `claude/new-session-omvsmd`, una rama antigua que ya provocó una instalación de código anterior.

El resultado no es una tabla de enlaces a fichas: Dennis debe **cambiar las celdas, pulsar Guardar y confirmar en esa misma pantalla**. No cumple sustituir una ficha larga por un panel lateral obligatorio para cada campo, ni dejar la edición para otra entrega. Historial y ajustes excepcionales pueden mantenerse como consulta secundaria.

No rehacer Calidad, Pulse, modelos económicos o configuración por iniciativa propia. Conservar las mejoras de HOTFIX-01/02/03, datos privados, cuentas, matrices, aliases, vigencias, snapshots, archivos y auditoría. Una única PR sin fusionar ni desplegar; no dar por aceptado por Dennis lo que solo probaste en un contenedor.

## 2. Defectos confirmados y límite del diagnóstico actual

La preparación leyó código de `main`, el Excel y las capturas. No ejecutó la instalación Windows ni leyó su base.

| Evidencia | Corrección obligatoria |
| --- | --- |
| `src/components/nav.tsx` enlaza «Administración» a `/administracion/clientes/grupos` | Llevar al editor canónico `/administracion/clientes` |
| Esa ruta `/grupos` sigue mostrando la lista antigua «Nombre / Denominación BC / Clientes / Estado / Última modificación» | Redirigir las listas antiguas al editor, manteniendo los filtros equivalentes |
| `/administracion/clientes/page.tsx` sí muestra otra tabla, pero sus campos son texto y sus enlaces llevan a fichas | Sustituir las celdas de lectura por edición directa, sin exigir visitar las fichas |
| `/administracion/usuarios/page.tsx` renderiza `Cell` de `_lib.tsx` como texto y pide abrir una fila | Habilitar edición de enero–diciembre en la propia matriz |
| Las acciones de Usuarios redirigen a una ficha después de confirmar | Añadir el recorrido de guardado que permanece en la tabla y conserva selección |
| Comparativa muestra un error de lectura; «Detalle técnico» está plegado en la captura | Obtener la excepción concreta; no adjudicar una causa sin reproducirla |

Revisa también los enlaces de inicio, breadcrumb, volver, diagnóstico y Cargas. No basta corregir un enlace y dejar otras entradas apuntando a la lista anterior. Las fichas históricas pueden seguir accesibles para consulta, pero no son el recorrido ordinario de edición.

## 3. El Excel fija las columnas y las claves de enlace

Adjunto privado `Tabla de Clientes(1).xlsx`, 14.627 bytes, SHA-256 `43bbd68e9ec811139748ada7f847c4a402ae60e67bb2190fdf0185d74df50c49`. Hoja `Hoja1`, A1:H88: 87 filas fuente, 54 nombres de Grupo, 75 IDs de organización. No son 87 clientes comerciales independientes.

La tabla de Clientes debe mostrar en este orden, con nombres de usuario claros:

| Columna | Campo editable y relación que modifica |
| --- | --- |
| A Grupo Cliente | Grupo económico BC; se elige uno existente o se crea uno nuevo desde la tabla |
| B Wrike | Nombre con el que el proyecto/organización aparece en Wrike; equivalencia a su Grupo/ámbito sustentado |
| C Id_Zendesk | ID exacto de organización Zendesk, conservado como texto |
| D Zendesk | Nombre del Cliente/organización Zendesk; no sustituye al ID |
| E Nivel de Servicio | Gold, Platinum, Silver Recurrente, Silver On Demand |
| F SERVIDOR | CLOUD u OP |
| G PAP | Nombre de organización/proyecto de la fuente PAP; equivalencia al Grupo/ámbito sustentado |
| H TIPO | Complejidad del proyecto: Basic, Medium, Enterprise |
| Adicional | Activo/Inactivo y estado resumido de enlaces/edición |

**Todos esos campos son datos de negocio, no títulos decorativos.** Al guardarlos se crean/actualizan las entidades y equivalencias que utiliza el motor. No limitarse a cambiar el texto de una celda mientras `ExternalIdentity` sigue teniendo el valor antiguo.

No exigir que coincidan los nombres de Wrike, PAP, Zendesk y BC. Zendesk tickets se une por organización; tiempos Zendesk por ticket y persona; Wrike/PAP por su nombre de fuente; finanzas por BC. Las relaciones a Grupo válidas ya deben sumar al Grupo, aunque no permitan identificar un hijo. No distribuir hechos o ingresos a todos los Clientes del Grupo.

Mantener los importadores anteriores y aceptar estas cabeceras legibles **Grupo Cliente, Wrike, Id_Zendesk, Zendesk, Nivel de Servicio, SERVIDOR, PAP, TIPO**, además de sus nombres técnicos antiguos. No cambiar posiciones de un formato por las del otro. El archivo es referencia del editor y una fuente importable; no se aplica automáticamente al actualizar el código.

La misma organización aparece en filas 63/82 con Grupo y servidor distintos. Conserva la identidad existente y presenta la discrepancia localizada para resolverla; no generar dos Clientes, elegir la última fila ni bloquear el resto del maestro. Conserva las reglas de alias ambiguos y organizaciones internas ya documentadas. Las filas no son identificadores permanentes.

## 4. Clientes: edición dentro de la cuadrícula

Mantén Administración apaisada, con las ocho columnas visibles a 1920×1080 y zoom 100 %, más Estado/indicadores compactos. Evita nombres largos que hagan crecer cada fila como una ficha. Revisión adicional a 1536×864 y adaptación móvil sin perder acciones.

### Interacción concreta

- Admin pulsa una celda o entra con teclado y cambia su valor mediante input/select. Enter/Tab facilitan moverse entre celdas; no guardan automáticamente.
- Los valores existentes aparecen precargados. Se marcan solo las celdas modificadas.
- Barra compacta con **Guardar cambios (n)** y **Cancelar cambios**. No hay que hacer clic en el nombre del Cliente para llegar a un formulario.
- **Nuevo grupo** y **Añadir Cliente/proyecto** crean borradores en la propia tabla con los campos pertinentes; no otra pantalla. El Grupo puede crearse solo con nombre/denominación BC y estado.
- Soporte, servidor, tipo y estado usan opciones claras. IDs Zendesk son texto decimal exacto; no convertir a float, redondear o reformatear en notación científica.
- Múltiples alias o proyectos se gestionan con un pequeño editor/lista dentro de la celda o popover anclado. No concatenar aliases como una sola equivalencia ni obligar a un panel lateral para escribir un valor normal.
- Consulta ve las mismas cifras, sin controles mutables ni posibilidad de forzar el guardado en servidor.

### Proyección de entidades, no duplicación

La presentación conjunta conserva Grupo, Cliente e implantación como entidades diferentes. Usa ID estable de entidad/identidad en cada edición y explicita el ámbito del campo. No generar el producto cartesiano Wrike×Zendesk×PAP para fabricar filas ni crear otra tabla paralela que después haya que sincronizar.

Si un campo compartido aparece en varias filas —nombre del Grupo, soporte del mismo Cliente o alias del Grupo—, editarlo actualiza el **mismo borrador canónico** en sus representaciones. Guardar lo cambia una vez y la confirmación indica a cuántos registros visibles afecta. No enviar varias escrituras contradictorias del mismo ID porque el usuario modificó dos filas.

Complejidad de proyectos distintos no se aplana arbitrariamente en el Cliente. Un dato heredado de Grupo se distingue y se edita en su ámbito; no se convierte silenciosamente en una propiedad de un hijo.

Cambiar una denominación mantiene las claves fuente que todavía sean válidas para hechos históricos. Si se corrige o reasigna una identidad que ya tiene datos, el resumen muestra el impacto y se respetan sus vigencias: no borrar tickets, ingresos o revisiones para cambiar un nombre. Conflicto de una clave asignada a otro destino requiere resolución explícita, no «gana la última edición».

## 5. Guardar con confirmación y persistencia fiable

Este patrón es común a Clientes y Usuarios, incluidos activar/desactivar, No aplica, altas y cambios de relaciones:

1. Editar solo modifica el borrador local.
2. Pulsar **Guardar cambios** valida y obtiene una previsualización de servidor.
3. Mostrar confirmación: **«¿Estás seguro de que deseas guardar estos cambios?»**, con entidad/ámbito, campos o meses y valores antes→después. Si afecta a otras filas, indicarlo brevemente.
4. Acciones **Cancelar / Sí, guardar**. Cancelar cierra sin escribir y conserva el borrador para corregirlo; Cancelar cambios de la barra sí descarta el borrador, preguntando si lo hay.
5. Tras confirmar, persistir y mostrar éxito breve, valores y versiones nuevos en la tabla; permanecer en la misma pantalla, filtros, año, ámbito y posición razonable de scroll.

**Nada se persiste al perder foco, pulsar Tab, cerrar el diálogo o cancelar.** Un doble clic/reintento no aplica dos veces una operación, duplica entidades ni genera auditorías repetidas. La confirmación debe corresponder al borrador exacto validado; editar mientras está abierta obliga a revisar de nuevo.

Valida en servidor sesión, Admin, IDs, ámbito, catálogos, integridad y versiones esperadas. Conflictos de edición se localizan en la celda/fila, conservando los otros cambios no guardados; no sobrescribir una edición ajena ni refrescar la página borrando el trabajo del usuario.

Un `router.refresh` o sondeo del reenlace en segundo plano no reinicializa los borradores modificados. Se actualizan los datos limpios y se avisa de conflictos reales sin perder la edición en curso.

Cada pulsación de Guardar confirmada es una operación atómica de sus cambios: se aplican completos o se informa del conflicto sin éxito parcial oculto. Audita actor y antes/después; no inventar un usuario técnico para atribuir cambios humanos. Errores de validación se explican junto al campo, no con un stack trace.

Si se cambia filtro, página, año, ámbito o se intenta salir con borrador pendiente, pedir **Guardar / Descartar / Seguir editando**. Guardar pasa siempre por la confirmación; no guardar por el hecho de navegar.

## 6. Usuarios contratados: editar enero–diciembre sin salir

Conserva la tabla actual y su estructura, que Dennis considera buena: selector de año/ámbito/estado, una fila por Grupo/Cliente/implantación y doce meses. Retira el recorrido obligatorio «abrir fila → formulario largo → revisar → volver». No es Personal ni cuentas de acceso: se editan **licencias contratadas**.

En los años editables, cada celda mensual es un input numérico que se puede modificar directamente. Guardar cambios y confirmar funciona como §5. Se pueden editar varios meses y varias filas en una revisión; no exigir doce diálogos para cambiar doce meses.

### Semántica que se conserva

- Año actual y anterior editables, resueltos con reloj servidor Europe/Madrid. En 2026: 2025/2026; en 2027: 2026/2027. Los anteriores son lectura también ante petición forjada.
- Enteros no negativos. **0 confirmado y sin informar son distintos**. Vaciar explícitamente una celda significa dejarla sin informar tras confirmar, no convertir una cadena vacía en cero. Conservar el valor anterior en auditoría.
- Cada ámbito tiene su propia matriz: no copiar el total del Grupo a todos sus Clientes/implantaciones ni sumarlos para inventar usuarios únicos.
- Mantener INITIAL/COPIED/PROPAGATED/ADJUSTED/ESTIMATED y procedencia; un dato heredado no pasa a ajuste manual por el simple hecho de renderizarlo. Solo los meses realmente editados reciben la clasificación correspondiente.
- La inicialización uniforme de 2025 no vuelve a bloquear permanentemente 2025 dentro de su ventana editable, ni una recarga del maestro repone licencias antiguas sobre ajustes manuales.

**Cambiar una celda modifica solo ese mes.** La acción existente «Aplicar desde este mes» permanece como acción compacta en la misma fila/celda: elegir valor/mes, generar el borrador de propagación y ver los meses cambiados o preservados en la confirmación. No arrastrar por defecto un valor hasta diciembre ni pisar ajustes explícitos posteriores. Copiar base del año anterior también permanece en la tabla mediante una operación breve con vista previa y confirmación, sin enviar a la ficha vieja.

Usa `previewMatrixChange` / planes y reglas existentes como base, pero amplía el contrato para guardar lotes de celdas. **No llamar repetidamente al guardado monomes con la misma `expectedVersion`**, porque la segunda celda fallaría o ignoraría concurrencia. Bloquea/valida y versiona cada matriz una vez por guardado, aplica sus cambios de manera coherente y registra las diferencias exactas.

No borrar meses sin modificar al enviar un formulario de página. Las entidades de otras páginas/años tampoco se alteran. Los cambios actualizan exposición, ratios por usuario, sellos y exportaciones derivados; no cambian horas, PAP, tickets ni el modo Total de Calidad. Reutiliza el mecanismo de invalidación/lectura coherente, sin crear otra cola o cálculo incompatible.

## 7. Completar enlaces debe actualizar los datos existentes

Guardar en Clientes actualiza los maestros/identidades reales y dispara el reenlace automático de HOTFIX-02. Dennis **no necesita ir después a Cargas a volver a vincular todo** para que el guardado tenga efecto.

Si el proceso dura, informa en el lugar administrativo existente de «Actualizando relaciones», con progreso real y opción de recuperar un fallo. Al finalizar, Comparativa/ficha/Calidad/Pulse y sus detalles/CSV usan la nueva atribución. No declarar actualizado cuando quedan derivados de la revisión anterior.

Conserva hechos brutos y ganadores por última carga; recalcular relaciones no cambia tiempos, fechas, ingresos o snapshots ni reactiva revisiones sustituidas. Un alias nuevo resuelve lo que estaba pendiente; un hecho pasa de sin asignar a un destino una sola vez, sin duplicar cantidades. Los hechos solo Grupo siguen sumando al Grupo.

La acción de recuperación global existente puede mantenerse en Cargas/Herramientas, pero el recorrido ordinario no es reprocesar archivos uno a uno. Ningún guardado de usuarios debe volver a importar fuentes o reinicializar toda la base.

## 8. Comparativa: diagnosticar y reparar la excepción

La captura del 04/11/2026 muestra **«No se pudo cargar la comparativa»** en noviembre de 2026, con Estado Activos, sin detalle técnico desplegado. No sabemos todavía si falla por esquema/instalación, consulta SQL, datos, configuración o render. **No afirmar que es un error de cálculo concreto sin evidencia.**

### Reproducción y trazabilidad

Reproduce la ruta compilada `/comparativa` con datos representativos de actualización HOTFIX-02→03, incluyendo matrices incompletas, ingresos y horas pendientes, Grupos sin hijos/mixtos y configuración anterior. Captura excepción, código/consulta o stack privado y contexto suficiente para un test. En el log de servidor conserva diagnóstico seguro; al Admin ofrece detalle técnico útil y acción precisa, sin secretos/credenciales ni datos nominativos en la PR.

Comprueba primero:

- SHA del código y de la compilación que está sirviendo la web; no dar por actual una instancia por tener la misma versión `0.1.0`.
- Migraciones aplicadas frente a las esperadas y cliente Prisma generado. HOTFIX-03 añadió **`EconomicSettingsRevision.bandFactors`** mediante `20261111090000_hotfix03_bandas_economicas`.
- Ejecución y compatibilidad de `hotfix03:preparar`; revisiones antiguas con bandas NULL deben seguir teniendo sus valores por defecto documentados.
- Consultas del estado efectivo y pertenencias de Grupo/Cliente, parser/orden y casos sin registros del mes pero sí del CUM.
- Ratios provisionales, referencias parciales, denominadores cero y campos nulos: no castear `null` a un decimal válido o usar una propiedad que no existe.

Si falta una migración, la solución es el recorrido de actualización correcto y un diagnóstico explícito; no inventar columnas en código, ejecutar resets o esconder el error. Si hay regresión de código/datos, añade el contraejemplo y repara su causa. Pueden coexistir problemas: no cerrar el encargo solo por encontrar el primero.

### Resultado esperado

Con datos válidos se carga la tabla completa en los cinco periodos, con ordenación, filtros y bandas de HOTFIX-03. Un dato ausente o un ratio no calculable afecta a su celda, **no derriba toda la página**. Un fallo real de base/conexión mantiene un error claro y Reintentar; no se sustituye por una cartera de ceros ni un `catch` que silencie cualquier error.

Mantén R/H×jornada, objetivo inicial 550, prorrateo mensual, CUM comparable, estado Activo/Inactivo/Todos y etiquetas de provisionalidad. La edición del maestro o de usuarios no cambia estas definiciones ni recalibra Calidad como efecto colateral.

## 9. Navegación que no devuelve a pantallas obsoletas

El acceso superior Administración y su pestaña Clientes apuntan a `/administracion/clientes`, editor canónico. Las listas `/administracion/clientes/grupos` y `/administracion/clientes/clientes` redirigen a él, traduciendo parámetros antiguos soportados y sin bucles. La prueba debe comenzar pulsando **Administración desde Comparativa**, no escribiendo a mano la única URL que funciona.

Altas ordinarias de Grupo/Cliente, volver y enlaces de pendientes abren la tabla/fila/celda correspondiente. Las fichas existentes quedan para historial/gestión excepcional, identificadas como secundarias; su botón Volver devuelve al editor, no a la lista vieja. Las URLs antiguas de detalle siguen permitiendo consulta sin obligar a usarlas para editar lo básico.

Usuarios abre su matriz editable en `/administracion/usuarios`; el nombre de una fila puede tener un acceso secundario al historial, pero no ser el único mecanismo de edición. Las acciones nuevas devuelven resultados al grid en lugar de redirigir a `/{ambito}/{id}`.

Conserva el menú de cinco entradas de HOTFIX-03, el ancho panorámico y las herramientas secundarias. Nada de pestañas nuevas o largas explicaciones técnicas encima de las tablas.

## 10. Pruebas de aceptación que deben ejecutarse

Usa PostgreSQL real `_test` con guard efectivo, nunca `cs_app` de Dennis. Fuentes reales privadas y fixtures públicas sintéticas. No versionar el Excel, nombres/IDs/correos de sus Clientes, dumps o capturas nominativas.

1. Desde Comparativa pulsar Administración → editor correcto. Entrar por las dos listas antiguas → mismo editor, filtros traducidos y sin bucles. Volver de una ficha → tabla nueva.
2. En Clientes editar **cada uno de los ocho campos** y Activo desde la tabla, sin navegación a otra página ni panel lateral obligatorio. Probar campos vacíos, alias múltiples, campos compartidos, Grupo sin Cliente y proyecto con complejidad propia.
3. Antes de confirmar, una segunda sesión/lectura de base sigue viendo el valor anterior. Cancelar confirmación no escribe; confirmar guarda; recargar o reiniciar servidor conserva valores y auditoría. Doble clic/reintento aplica una vez.
4. Modificar claves Wrike/PAP/Zendesk y comprobar **equivalencias reales y atribución posterior**, no solo el texto de la tabla. Nombre BC cambiado no elimina de golpe la atribución histórica de claves todavía válidas. Conflictos se localizan y no se reasignan por parecido.
5. Nuevo Grupo/Cliente/proyecto desde borrador en tabla, guardado confirmado y sin entidades duplicadas/cartesianas. Importar cabeceras nuevas del adjunto y antiguas con el mismo resultado para datos equivalentes. Resolver explícitamente el conflicto 63/82, sin crear dos Clientes para un ID.
6. Usuarios: cambiar varios meses de una fila y de varias filas, guardar una vez, confirmar y comprobar valores/versiones/procedencia. Sin error en segunda celda por versionado monomes. Operación atómica y conflicto concurrente sin perder el borrador de otras filas.
7. Usuarios 0 distinto de sin informar; limpiar una celda auditado; negativo/decimal/texto rechazados. Año actual/anterior editables, anteriores protegidos en servidor y UI, con reloj de 2027 simulado.
8. Aplicar desde mes conserva ajustes explícitos y muestra cambios reales. Caso independiente 65 enero–mayo y 68 junio–octubre: exposición CUM **665 usuarios mes**, stock 68. Cambio solo de julio no modifica junio/agosto por sorpresa.
9. Filtrar/paginar/cambiar año con borrador pendiente ofrece Guardar/Descartar/Seguir; cancelar no pierde datos. Foco, Tab y Enter no persisten automáticamente. Consulta no puede modificar mediante petición forjada.
10. Datos operativos antes del maestro → editar/completar enlaces en tabla → reenlace automático → Comparativa/ficha/PAP/tickets/CSV actualizados sin subir ni reprocesar archivos individualmente. Cantidades fuente conciliadas y sin dobles sumas.
11. Reproducir y resolver la excepción real de Comparativa con un test que falle antes. Añadir actualización de una base con datos del estado anterior; bandas NULL, mes sin horas, CUM con horas, ingresos desconocidos, provisionalidad y estado comercial.
12. Esquema sin la migración de bandas: diagnóstico específico e instrucciones seguras; esquema actualizado: ruta compilada funciona. No usar un test de base vacía como sustituto de este caso.
13. Cifra independiente: R=1.000 y H=16 con jornada 8 → 500 €/jornada; R desconocido/H=0 conservan sus razones. Ordenación y colores iguales antes/después de editar solo usuarios.

Ejecuta tipos, lint, builds de web/trabajador, suites pertinentes y **recorrido completo afectado**, sin dejar los casos antiguos apuntando a la lista anterior. Repite la suite requerida después de la última corrección; no reportar una ejecución fallida antigua junto a un subconjunto corregido como si fuera una suite final verde. Justifica omisiones por entorno.

Revisión visual de Clientes/Usuarios/Comparativa en navegador compilado, con cifras, nombres largos y celdas modificadas/errores: 1920×1080, 1536×864 y adaptación móvil. Las capturas de una tabla de lectura no acreditan edición: realiza y verifica el guardado. Persistencia comprobada después de reiniciar y entrar otra vez.

No hacen falta nuevas campañas de millones de filas. Comprueba consultas por conjuntos y que guardado/reenlace no crean un job por celda o N+1 por Cliente; reutiliza mecanismos existentes. No entregar solo código de un editor que no está conectado al menú ni a la base.

## 11. Actualización Windows sin volver a la rama antigua

Migraciones incrementales solo si son necesarias. No editar antiguas ni usar reset, `db push`, `TRUNCATE`, borrado de maestros, restauración automática de una copia o reinstalación. Conservar `.env`, `cs_app`, originales, matrices y configuración inicial activa de HOTFIX-03. No obligar a recargar datos operativos.

La guía de esta entrega da **un único recorrido sobre `main` después de fusionar su PR**, con los comandos vigentes realmente verificados en `package.json`: parada, copia verificada, estado local, actualización fast-forward, comprobación de SHA, dependencias, migraciones, preparación necesaria, build limpio, almacenes y arranque. Indicar que se ejecutan uno a uno y se detiene ante error.

No incluir `git checkout claude/new-session-omvsmd` como alternativa ni copiar ramas de entregas anteriores. Si para revisión aún se prueba una rama, identificar expresamente la rama real de esta PR fuera de la secuencia de instalación de `main`.

Un `build-info.json` generado puede no estar versionado en la rama antigua: no dar `git restore -- build-info.json` a ciegas. Verificar si está seguido por Git y preservar cambios locales. En la instalación anterior ese comando produjo un error real. La aplicación arrancada debe anunciar el SHA del código que se acaba de compilar; la versión genérica `0.1.0` no basta.

Entrega también un recorrido manual corto: entrar desde Administración → editar una correspondencia → Guardar → cancelar y comprobar que no cambia → confirmar → editar dos meses de Usuarios → confirmar → comprobar Comparativa y reenlace. Los cambios ordinarios se hacen en estas tablas, sin fichas largas ni paso obligatorio por Cargas.

## 12. Documentación, PR y cierre honesto

Actualiza contratos dueños del editor, confirmación, matriz y rutas, más validación y guía. Mantén índices y documentación modular; archiva el prompt literal. Una sola PR propia contra la base correcta, sin force-push ni reescribir historia. Cambios locales ajenos, incluidos `coverage.ts` y su test si siguen presentes en el entorno de Claude, se preservan aparte sin añadirlos o descartarlos por conveniencia.

Informe final: causa demostrada del error de Comparativa, causa de la navegación vieja, campos editables realmente entregados, trazabilidad de guardado/cancelación/concurrencia, resultados de actualización y pruebas después de los últimos cambios. Diferencia ensayos con el maestro real y operativos sintéticos del PostgreSQL local de Dennis. Windows solo se reporta probado si lo ejecutaste.

**No cerrar si el usuario sigue teniendo que abrir fichas para editar las celdas de Clientes o los meses de Usuarios, si no hay confirmación antes de guardar, si el acceso superior vuelve a «Grupos Cliente», o si Comparativa sigue mostrando el error sin causa resuelta.**

Detente al completar HOTFIX-04. No fusionar ni desplegar por iniciativa propia.
