# Validación y criterios de aceptación

## Estrategia

Validar tres niveles: contratos de fuente con muestras sintéticas pequeñas; cálculos y reglas con resultados conocidos; conciliación con datos reales por cliente, mes, fuente y servicio. Ejecutar la cobertura pertinente a cada entrega, sin crear una batería de pruebas de componentes visuales sin riesgo. Conservar en Git fixtures sintéticas y resultados de validación agregados, sin exportaciones reales.

## Casos imprescindibles

| Caso | Acción y resultado esperado |
| --- | --- |
| VAL 01 Repetición exacta | Importar dos veces tres filas, una de ellas repetida dentro del archivo; solo dos hechos elegibles |
| VAL 02 Solapamiento | Importar enero a junio y después mayo a octubre; las filas idénticas de mayo y junio no vuelven a sumar |
| VAL 03 Revisiones de ticket | Cambiar causa del mismo ticket; queda un ticket con revisión y se recalculan indicadores afectados |
| VAL 04 Export antiguo | Un formato de tickets sin tags o status se rechaza como incompleto; los datos vigentes quedan intactos |
| VAL 05 Duración | logged_hours=1 y logged_minutes=30 produce 1,5 horas; hour=08:25 no añade 8,416 horas |
| VAL 06 Corte PMO | PMO con 2 horas Zendesk en diciembre 2024 y 3 Zendesk más 4 Wrike en enero 2025; total elegible 6, no 9 |
| VAL 07 Año anterior | En un informe de 2026 la parte PMO de 2025 procede de Wrike, también en el comparable |
| VAL 08 CSV citado | Nombre de tarea con coma, punto y coma y comillas; conservar seis campos y el texto entero |
| VAL 09 Unidad Wrike | Dedicación (horas)=0,5 mantiene 0,5; no dividir por 60 |
| VAL 10 Sin imputación | Wrike sin persona/fecha y cero horas se clasifica como tarea sin log; horas positivas sin fecha requieren resolución |
| VAL 11 Inferencia | Ticket explícito válido tiene prioridad; varios candidatos incompatibles no generan vínculo de ticket y se avisa en el resumen de la carga |
| VAL 12 Cliente por proyecto | Sin ticket pero proyecto inequívoco atribuye horas al cliente, con causa no clasificada |
| VAL 13 Fuente desconocida | Organización o persona sin equivalencia se resume y excluye del cálculo afectado; no se asigna a VINCLE ni crea una bandeja |
| VAL 14 Soporte anual | Sustituir SOPORTE 2026 mantiene 2025, ADMIN_DELEGADA 2026 y OTROS 2026 |
| VAL 15 Fallo transaccional | Fallar al confirmar una sustitución mantiene activo el año anterior completo, sin datos parciales |
| VAL 16 Revisión agregada | Importe anual de admin cambia de 100 a 120; la sustitución del año/categoría deja 120, no 220 |
| VAL 17 Totales Power BI | Total y Filtros se excluyen; suma de detalles reconcilia con el total original en la columna aprobada |
| VAL 18 Usuarios variables | Enero a mayo 65 y junio a octubre 68: UM=665, usuarios a octubre=68; nunca 680 ni 665 usuarios distintos |
| VAL 19 Anualización | Con 66,5 horas de enero a octubre y UM=665, equivalente anual=1,2 horas por usuario |
| VAL 20 Rentabilidad | R=440 y H=8 produce 440 euros por jornada y desviación objetivo de 20 por ciento |
| VAL 21 Media filtrada | Clientes con R=550 H=8 y R=550 H=16 dan cartera 366,6667 euros por jornada; no 412,5 |
| VAL 22 Mes anterior | Enero 2026 compara diciembre 2025; no mes cero de 2026 |
| VAL 23 Comparables | Octubre 2026 presenta enero a octubre 2025 y, aparte, los doce meses de 2025 |
| VAL 24 Corte parcial | Anual=12000, día=15, mes=30: ingreso mensual a corte=500; febrero usa sus días reales |
| VAL 25 Infraestructura | Misma causa de infraestructura en OP no es incidente SaaS; en CLOUD sí, desde su fecha de migración |
| VAL 26 N3 único | Un ticket con team_n3_pmo y team_it cuenta una vez en N3 y en ambos desgloses |
| VAL 27 N2 a N3 | Numerador es intersección N2 y N3; no incluir en ese ratio un N3 sin N2 |
| VAL 28 Bugs | Work Item Bug_ cuenta como defecto; Zendesk Ticket ID y URLs permiten vínculos; la palabra BUG en título o el tipo Request no sustituyen la identidad |
| VAL 29 Tiempo de escalado | Añadir tag en octubre a un ticket creado en junio modifica cohorte junio, sin afirmar escalado real en octubre |
| VAL 30 PAP múltiple | Un PAP estándar y procesos, con dos tickets, sigue siendo una intervención correctiva única |
| VAL 31 Percentiles | Para 0,10,20,30: P25=7,5; mediana=15; P75=22,5 |
| VAL 32 Límites | Comprobar x=P10, P25, P75, P90 y valores alrededor para ambas direcciones de PulseRent |
| VAL 33 Datos ausentes | Sin usuarios, o con fecha_creación inválida, no se publica ratio mensual ni cero ficticio |
| VAL 34 Health ausente | Seis pesos iguales exactos; Client Health blanco redistribuye a cinco pesos efectivos del 20 por ciento |
| VAL 35 Fuente técnica ausente | Bugs y afectación del estándar no medible deja global oficial incompleto; no dar verde por los otros KPI |
| VAL 36 Global explicable | Editor de pesos rechaza suma distinta de 100; límites y opciones del global se leen de configuración |
| VAL 37 Referencia fija | Filtrar solo clientes rojos en la tabla no cambia sus límites de referencia |
| VAL 38 Reversión compartida | Revertir lote A conserva fila aportada también por lote B vigente |
| VAL 39 Concurrencia | Dos cargas del mismo ámbito no activan estados parciales ni duplicados |
| VAL 40 Cierre histórico | Consultar un cierre después de una nueva regla reproduce su versión original |
| VAL 41 Permisos | Consulta sin permiso económico no accede a importes por pantalla, API, archivo o exportación |
| VAL 42 Restauración | Recuperar base y archivos en entorno de prueba y ejecutar una consulta reconciliada |


## Casos de la revisión

| Caso | Resultado esperado |
| --- | --- |
| VAL 43 Navegación | Cuatro vistas principales y Administración; Health y detalle se abren dentro de ellas |
| VAL 44 Correctivo múltiple | Evolutivo más correctivo sigue siendo correctivo y cuenta una vez |
| VAL 45 Origen cliente | PAP correctivo de origen cliente sigue visible, aumenta el total único y se distingue por origen |
| VAL 46 Tres categorías | Sustituir OTROS 2026 no altera soporte, admin ni 2025; no quedan líneas ausentes del nuevo fichero |
| VAL 47 Base inicial | No hay tiempos, tickets o Wrike reales precargados; Dennis puede probar sus importadores |
| VAL 48 Grupo y proyecto | Ingreso de grupo no se copia en cada proyecto; ratio proyecto sin usuarios queda sin denominador |
| VAL 49 Pesos iguales | Modo igual usa seis fracciones de 1/6, no seis porcentajes redondeados que suman 100,02 |
| VAL 50 Sustitución fallida | Un error antes de activar conserva íntegro el último año/categoría válidos |

## Secuencia de validación

Maestros precargados de forma idempotente. Dennis prueba tickets y tiempos tras entrega 03, Wrike/PAP tras 04 y facturación completa 2025/2026 tras 05. Las pruebas automatizadas usan una base de test separada. No migrar automáticamente hechos operativos del libro ni limpiar las cargas de Dennis al actualizar.

Puede conservarse facturación histórica anterior a 2025. Repetir cada carga anual revisada debe demostrar reemplazo de su año/categoría y conservación del resto. Comparativa y ficha se concilian después de las cargas reales; no se declara esa conciliación ya ejecutada por crear documentación.

## Finalización

Cuatro vistas operativas, Administración, diez entregas validadas y documentación indexada. Calidad utiliza fecha/tipo ya disponibles, vínculos explícitos a producto, causas y usuarios por ámbito para sus ratios. Si aún falta algún dato, la vista muestra esa limitación concreta. Publicación, aceptación de Dennis y restauración de copias se reportan solo con evidencia de ejecución.

## Casos de los nuevos ficheros

| Caso | Resultado esperado |
| --- | --- |
| VAL 51 Esquema real | Leer las ocho cabeceras, con fecha_creación/type/status; no exigir descripción |
| VAL 52 Internos | Organización VINCLE BUGS no se clasifica como cliente externo por diferir de VINCLE |
| VAL 53 Cadena parcial | Bug enlaza problema interno y Clients enlaza problema externo; solo este último atribuye cliente y se guarda la procedencia |
| VAL 54 Tipo de elemento | Request con BUG en Title no aumenta número de Bug_ |
| VAL 55 Dos ejes | Entorno configuración y causa estándar conserva ambos, sin concluir ausencia de pruebas |
| VAL 56 Origen cliente | Horas, tickets, escalados y PAP de uso/sistemas del cliente no se eliminan por su atribución |
| VAL 57 Lista abierta | Ready for Release sigue en la lista; Changed Date o ausencia en nueva lista no inventan cierre/despliegue |
| VAL 58 Familias no disponibles | Sin problem_id no reconstruir relación entre incidente y problema por parecido de título |
| VAL 59 Periodo real | Con status pero sin solved_at/fecha de cierre, mostrar creación y stock observado; no cierres mensuales |
| VAL 60 Unión de evidencias | Un problema con causa estándar y enlace a dos Bug_ cuenta una vez en el sexto numerador aprobado y dos bugs únicos aparte |

## Casos adicionales v0.4, definidos y no ejecutados como software

| ID | Caso | Resultado exigido |
| --- | --- | --- |
| V04-01 | Cargar el perfil antiguo sin status | Rechazo claro de estructura incompleta, sin activar |
| V04-02 | Reimportar un ticket open como solved | Misma identidad, nueva revisión; sale del backlog activo observado |
| V04-03 | Incident de 2025 aún open en una vista de octubre 2026 | Incluido en stock; no eliminado por el filtro de creación del mes |
| V04-04 | Pending y hold en incident/problem | Incluidos en no resueltos y desglosados |
| V04-05 | Solved distinto de closed | Ambos fuera del activo, estados originales conservados |
| V04-06 | Estado desconocido | Cobertura no clasificada y aviso; sin open/cero inventado |
| V04-07 | Consultar enero sin fotografía compatible | Stock histórico no disponible; no proyectar estado actual |
| V04-08 | Stock con 100 usuarios y 20 tickets a mitad de mes | 20 por 100 usuarios; sin dividir por exposición parcial |
| V04-09 | VSW ampliado con filas 2025 y 2026 | Conservar ambos años, clasificar por fecha real |
| V04-10 | Repetir VSW o cargar solo VFS | Sin duplicados; VFS/VSW no se sobrescriben entre sí |
| V04-11 | PR y Ready for Release | PR pendiente de crear; ninguno acredita despliegue |
| V04-12 | Bug ausente de otra vista más estrecha | Sin borrado, cierre ni fecha de resolución inventados |
| V04-13 | Problema con causa estándar y dos vínculos Bug_ | Una unidad en el sexto numerador aprobado |
| V04-14 | Cero activos o usuarios sin informar | Conteo cero confirmado o tasa no calculable; edades vacías no aplicables |
| V04-15 | Parámetros de edad sin calibrar | Magnitudes visibles y estado sin calibrar; sin verde automático |
| V04-16 | DOC-00 terminado | Solo Markdown, diez entregas sin iniciar, prompt literal, enlaces válidos y sin secretos/fuentes |

## Casos de aceptación manual de CSAPP-05, definidos y no ejecutados por Dennis

Las pruebas automáticas de Linux con datos sintéticos están en la [validación de CSAPP-05](csapp-05.md); estos casos son los que Dennis comprobará con sus archivos reales.

| ID | Caso | Resultado exigido |
| --- | --- | --- |
| V05-01 | Cargar 2025 y 2026 de soporte, administración delegada y otros | Tres conjuntos independientes por año y categoría; pie verificado; Total conciliado |
| V05-02 | Repetir el mismo archivo de una categoría/año | Los mismos ingresos; ni suma ni cero |
| V05-03 | Sustituir con un fichero con cambios y una fila ausente | Total nuevo (no la suma); el grupo ausente se retira; otras categorías y años intactos |
| V05-04 | Revertir el lote vigente en un lote de prueba | Se restaura el predecesor completo; un lote sustituido no se puede revertir |
| V05-05 | Archivo con otra categoría en el pie o con año explícito distinto | Confirmación bloqueada con el motivo |
| V05-06 | Grupo de origen sin Grupo Cliente | Importe conservado y conciliado; aceptación expresa o completar el maestro y reprocesar |
| V05-07 | Vta Potencial vacía (caso OTROS) | Bloquea sin decisión; con decisión del lote, cero derivado con motivo; nunca usa Diferencia |
| V05-08 | Comprobación 12000 anuales, corte 15 de un mes de 30 días | 500 € del mes en Administración › Comprobación económica |
| V05-09 | Proyecto Wrike/PAP de nombre distinto al grupo | Equivalencia directa a Grupo por fecha del trabajo/producción; el atajo BC ya no atribuye |
| V05-10 | Cambiar el objetivo de 550 | Nueva revisión con autor y fecha; las consultas identifican la revisión usada |
