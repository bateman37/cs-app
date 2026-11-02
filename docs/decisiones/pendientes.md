# Decisiones abiertas y límites

## Resuelto

Tickets sin horas se conservan; se reutilizan Grupo Cliente y Cliente; las causas del cliente participan y se desglosan; el sexto numerador ha sido aprobado. PR significa desarrollo terminado en rama y pendiente de crear pull request. Existe status en el único export de tickets vigente. No volver a preguntar estos puntos.

## Parámetros por calibrar en Administración

Umbrales por KPI, referencias, mínimos de muestra y reglas del global. En Incidentes y problemas: antigüedad preocupante por tipo, bandas y composición entre volumen reciente y backlog. La propuesta está en el contrato de backlog. Deben distinguirse propuesta, configuración elegida y regla confirmada; no presentar cifras de ejemplo como aprobación de Dennis. Esto no bloquea DOC-00 ni la preparación de las cargas y vistas.

## Datos opcionales futuros

Fecha de resolución/cierre para medir cierres y tiempos de resolución; problem_id para relacionar incidentes hijos con problemas. Updated_at o una fecha de extracción fiable ayudarían a ordenar observaciones. Ninguno existe en el XLSX vigente. Guardar fecha de extracción declarada y fecha de importación por separado, sin deducir la primera de MAX(fecha_creación).

La relación bug-problemas-incidentes es parcial. La organización no registrada se resuelve mediante el maestro y el resumen de carga; no es un defecto de Calidad ni obliga a otra bandeja. En una implantación sin usuarios o sin clave de atribución, mostrar la cobertura real.

## Decisiones técnicas de la implementación

Versiones compatibles, lector XLSX y benchmark se verifican en CSAPP-01/02. La autenticación corporativa y el entorno de producción se concretan cuando corresponda, sin inventar SSO. DOC-00 documenta estas dependencias, sin instalar ni ejecutar nada.


## Pendientes y propuestas tras CSAPP-05

Sin aceptar y pendientes de Dennis: ZDT 11–13 y ZTM 06–08 (CSAPP-04 §2); lista estable de origen PAP (implementada, pendiente de validación); catálogo de estados de bugs, lista de palabras que evita inferencias de tickets y `CSAPP_DEVOPS_PRODUCTS` (propuestas implementadas). Nuevas en CSAPP-05: tolerancia de conciliación de 0,01 € (técnica, CAL 08); vacío de Vta Potencial como cero solo por decisión de lote (FAC 07 propuesto, no regla global); convención de signo de «Diferencia» (sin Budget absoluto); Silver On Demand ECO 08 (sin rentabilidad mensual recurrente); interpretación de la categoría del histórico `DATA FACTURACIÓN` por las columnas «Soporte»/«Admin Delegada» (validar con el libro real). Ver la [tabla de estado](../arquitectura/finanzas-motor-csapp05.md#10-reglas-propuestas-pendientes-o-heredadas-estado-explícito).


## Pendientes y propuestas tras CSAPP-08

Siguen **sin aceptar** (conservan su estado pendiente): ECO 08, ZDT 11–13, ZTM 06–08, la lista de origen PAP, los estados de bugs y el signo de «Diferencia». Continuar en CSAPP-08 no los acepta.

Propuestas de CSAPP-08 que decide el Administrador en Administración › Configuración (nada se activa solo): mapeo de Client Health a colores y su confirmación; selección de perfiles de Dedicación; umbrales, referencias y muestras mínimas por ámbito (Grupo y Cliente) y unidad; composición «peor señal» del color de Incidentes y problemas y umbrales preocupantes de edad; plantilla del global (severidades 0/0,5/1 con límites elegidos); política de fotografía para cortes históricos (exacta o «última anterior dentro de X días»); catálogo de correspondencias de diagnóstico (inicializado solo con las confirmadas).

Decisiones técnicas tomadas y por validar con Dennis: la cobertura se declara por lote en Cargas (población, estados, alcance temporal) en lugar de deducirse de la presencia de filas; un valor sin cobertura declarada es parcial (cota inferior) y un cero no está sustentado; un vínculo a bug es válido con evidencia de un lote completado o confirmación manual; Pulse Rent **todavía** usa su cobertura anterior por existencia de filas (compartir el contrato cambia sus ceros y se decide aparte).


## Pendientes y propuestas tras CSAPP-09

Siguen **sin aceptar**: ECO 08, ZDT 11–13, ZTM 06–08, la lista de origen PAP, los estados de bugs, el signo de «Diferencia» y Silver On Demand. Continuar en CSAPP-09 no los acepta; tampoco se activó ningún mapeo, perfil, umbral, referencia, mínimo de muestra, composición del quinto KPI ni plantilla global (los colores de las pruebas salen de configuraciones elegidas expresamente **solo en fixtures aisladas**).

Pendiente de **Dennis**: conciliación con sus cargas reales (finanzas completas 2025 y 2026 y bugs VFS/VSW separados) — **no ejecutada**; limpieza de las dos cuentas sintéticas residuales de CSAPP-06 en `cs_app` (no tocadas); revisar la PR; ejecutar la [guía](../plan/guia-powershell-csapp09.md) en Windows (sin probar).

Propuestas técnicas de CSAPP-09 (no aceptadas, ajustables): límites iniciales de exportación (2 activas por persona, 6 en total, 24 h de vida, 20 000 000 de filas, partes de 1 000 000); evolución de Calidad **recalculada con la revisión activa** al solicitarla (no el color publicado históricamente: no existe archivo de ese cálculo); puente de conciliación automática de Comparativa/Pulse (no incluido); caché persistente (no introducida: las medidas no la justifican); partición de la evolución en carga diferida si su coste (ver [validación](../validacion/csapp-09.md)) resulta molesto con carteras mayores.
