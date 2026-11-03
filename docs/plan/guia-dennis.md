# Guía de puesta en marcha de datos (Dennis)

Para quien ya tiene la aplicación instalada ([instalación y operación](../operacion/instalacion-operacion.md)). Aquí se explica **qué cargar, en qué orden flexible y cómo leer el resultado**. Nada de esto está precargado: las cargas reales, incluidas las finanzas completas 2025 y 2026 y los bugs VFS y VSW por separado, **las realiza Dennis**. Los resultados sintéticos de Claude están en la [validación](../validacion/csapp-10.md); su aceptación va en el [registro de aceptación](../validacion/registro-aceptacion.md), en registros distintos.

## 0. Primer acceso

1. Arranque con `npm run start:todo` y entre con el Administrador creado en la instalación. Administración › **Operación** debe mostrar versión, esquema compatible, trabajador «presente en reposo» y almacenes enlazados.
2. Verá **estados vacíos honestos**: sin cifras, sin colores y con el motivo. Un cuadro sin colores **puede estar funcionando correctamente**: falta configuración o evidencia (cobertura declarada, calibración). Un verde nunca aparece por defecto.
3. Perfil Consulta: lee las cuatro vistas, detalles y CSV; no muta Administración ni accede a originales ni a exportaciones ajenas (se rechaza en servidor, no solo se oculta).

## 1. Maestros mínimos (Administración › Clientes, Personal, Usuarios)

| Paso | Qué | Notas |
| --- | --- | --- |
| 1 | **Grupos Cliente y Clientes** (dos niveles), con sus equivalencias BC/Zendesk/Wrike/PAP | Las organizaciones internas (incluida VINCLE BUGS y las de pruebas) no son clientes externos. Sin equivalencia, una fila se resume y se excluye del cálculo afectado: no se asigna a VINCLE. |
| 2 | **Personal** (persona única, alias por sistema, nivel/equipo/PMO y rol con vigencias) | El personal histórico se conserva con sus vigencias. |
| 3 | **Matriz de usuarios** mensual por Grupo, Cliente e implantación | Se editan el año actual y el anterior; 2025 base (doce meses iguales) y 2026 mensual. Con 65 hasta mayo y 68 desde junio: **665 usuarios mes** de enero a octubre y **stock 68**. Un nulo es distinto de cero; el grupo conserva su total propio sin sumar usuarios compartidos. |
| 4 | **Servicio económico**, soporte/servidor/complejidad/producto, hitos | Con vigencias; no se inventa reparto de ingreso agrupado entre Clientes. |

## 2. Cargas (Administración › Cargas) — orden flexible

No hay un orden rígido ni una bandeja nueva. Cada fuente deja su resumen y avisos dentro de Cargas. Las relaciones que lleguen tarde (una equivalencia, una persona) se resuelven con **Reprocesar** el lote, sin volver a subir el archivo.

| Fuente | Perfil | Para tener en cuenta |
| --- | --- | --- |
| Zendesk tickets (XLSX, ocho campos con `status`) | `zendesk-tickets` | Se conservan los tickets sin horas. Declare la **fecha de extracción**. |
| Zendesk tiempos (XLSX, once campos) | `zendesk-tiempo` | Duración = `logged_hours × 60 + logged_minutes`. Antes de 2025 el PMO sale de Zendesk. |
| Wrike (CSV original) | `wrike` | PMO desde 2025 solo de Wrike; horas decimales (0,5 h = 30 min). Tareas sin imputación se conservan aparte. |
| PAP (XLSX) | `pap` | Un PAP cuenta una vez aunque tenga varias causas; el origen cliente se conserva. |
| Bugs VFS y VSW | `bugs-vfs`, `bugs-vsw` | **Por separado.** Solo `Bug_` es defecto. No se cierra por ausencia en otro export. |
| Facturación 2025 y 2026 | tres perfiles | **Tres categorías** (SOPORTE, ADMIN_DELEGADA, OTROS), cada una con **sustitución anual completa e independiente**. 12.000 €/año con corte 15/30 da **500 €** del mes. No se reparte el ingreso agrupado entre Clientes. |

Pruebas de cada carga: **repetirla** (no debe duplicar), **corregirla**, **reprocesarla** y **revertirla** (solo el lote vigente). Los originales no se alteran ni se deduplican por parecido.

### Declaración de cobertura

Para cada lote declare población, estados y alcance temporal (Cargas › lote › Cobertura). Sin esa declaración un valor es **parcial** (cota inferior) y un cero **no está sustentado**. Es la razón más común de «cuadro sin colores».

## 3. Configuración y calibración (Administración › Configuración)

Mapeos, perfiles, umbrales, referencias, muestras mínimas y composición/global **son elecciones del Administrador**; ninguna está activada. Flujo: **borrador → simulación sobre datos reales → activación** (revisión inmutable, vuelta atrás como nueva activación). Pesos de Calidad: seis iguales de 1/6 (suma exacta 100); sin Client Health los otros cinco pesan 20 %; el modo personalizado exige suma exacta 100. **No hace falta calibrar todo** para probar la parte técnica: calibre lo que quiera ver coloreado.

## 4. Cómo leer las cuatro vistas

- **Comparativa y Análisis Cliente**: mes/corte, mes anterior, CUM actual, año anterior completo y comparable; curva y detalle que conciliados con el ingreso, las horas, los PAP y los tickets.
- **Pulse Rent**: perfiles, usuarios mes, referencias independientes de las filas visibles, ceros sustentados, percentiles y CSV. M11 (no facturable) no se inventa sin fuente.
- **Calidad**: Client Health mensual propio, seis indicadores y global con pesos exactos y cobertura. Backlog por fotografía compatible con fechas y edades propias; flujo por creación y stock separados. N3 único con varios tags; PAP multicausa único; sexto numerador = unión de problemas estándar y vinculados a `Bug_`, sin duplicar IDs. Diagnóstico por origen sin excluir carga ni afirmar causas no demostradas.
- **Exportación completa** (panel de cada vista) en segundo plano; **conciliación** en Administración (niveles 1–4: el nivel 4 puentea Comparativa/Análisis Cliente, Pulse y Calidad para el mismo periodo, servicio y ámbito).

## 5. Qué falta para usar un indicador con confianza

Declaración de cobertura de los lotes que lo sustentan; equivalencias y personal completos (o resumen de faltantes aceptado); usuarios del periodo informados; calibración activada de sus reglas; y la conciliación del periodo sin diferencias no explicadas. Mientras falte algo, la pantalla lo dice.

## 6. Decisiones pendientes (sin repetir las ya resueltas)

Ver la lista con efecto concreto y propietario en [pendientes](../decisiones/pendientes.md#pendientes-y-propuestas-tras-csapp-10). Las dos cuentas sintéticas residuales de CSAPP-06 en `cs_app` siguen pendientes de su decisión: **no se tocan ni se reutilizan como cuentas de producción**.

## 7. Recorrido de aceptación

Los casos con IDs estables, resultado esperado, evidencia, ejecutor, fecha y estado están en el [registro de aceptación](../validacion/registro-aceptacion.md). Todos nacen **pendientes**; solo Dennis o IT los marcan aprobados o fallidos.
