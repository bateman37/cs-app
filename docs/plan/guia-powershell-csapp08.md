# Guía PowerShell de CSAPP-08 (escrita, **sin probar en Windows**)

> **Guía histórica (CSAPP-08).** Describe el arranque de esa entrega y puede contradecir la operación actual. La guía **vigente** de instalación, arranque y operación es [instalación y operación](../operacion/instalacion-operacion.md); los comandos de aquí no se usan en una instalación operativa.

Hay **una migración nueva**: `20261103090000_calidad_health_cobertura` (tablas `HealthFeedback`, `HealthFeedbackEvent`, `QualityNote` y `UploadCoverageDeclaration`, dos índices y restricciones; no toca ninguna tabla anterior ni la `ConfigRevision` de CSAPP-07). Esta rama (`feature/CSAPP-08-calidad-client-health`) parte de la cabeza de la PR 7, que ya contiene CSAPP-06 y 07: su PR está **apilada** contra esa rama y muestra solo los cambios de 08. Nada de esto está probado en Windows y no sustituye tu aceptación.

```powershell
git fetch origin
git checkout feature/CSAPP-08-calidad-client-health
npm ci
npm run db:migrar
npm run build
npm start
```

## Pruebas: la base debe ser explícita, aislada y distinta de la tuya

Igual que en CSAPP-07: las pruebas que modifican datos se niegan a ejecutarse si `TEST_DATABASE_URL` falta, no acaba en `_test`, coincide con la base de trabajo o la conexión efectiva no es esa base. **No pruebes con `cs_app`.** No se limpian las dos cuentas residuales del incidente de CSAPP-06; decídelo tú.

```powershell
$env:TEST_DATABASE_URL = "postgresql://USUARIO:CLAVE@localhost:5432/cs_app_test?schema=public"
npm run typecheck
npm run lint
npm test
npm run e2e:build
npm run e2e
npm run benchmark:calidad   # 1500 grupos, 250 000 tiempos, 114 000 tickets y seis fotografías sintéticas; solo base _test
```

## Recorrido breve para Dennis (con tus archivos reales, por tu cuenta)

1. **Declara la cobertura** (Administración › Cargas › ficha de cada lote completado): población «todos los clientes», alcance temporal y, en tickets, los estados que contiene el export. Sin declaración un cero no está sustentado y no hay fotografía de backlog. Una carga antigua sin extracción declarada queda «desconocida»: puedes fijar la extracción revisada en la declaración sin cambiar el lote.
2. **Consulta el mes actual** en `/calidad`: seis indicadores por Grupo Cliente (y por Cliente), con avisos concretos.
3. **Completa Client Health** en la pestaña «Client Health»: abre una celda, elige estado (positivo, mixto, negativo o sin feedback), fecha opcional y comentario. Comprueba que sin confirmar el mapeo se ve la categoría «sin calibrar» y que el blanco redistribuye.
4. **Calibra, simula y activa una regla elegida** en Administración › Configuración › Calidad: umbrales por ámbito y unidad, mapeo de Health, perfiles de Dedicación, composición del color de Incidentes y problemas, plantilla del global. Guarda el borrador; previsualízalo sobre tus datos con «Simular el borrador sobre estos datos» (banner «SIMULACIÓN, NO PUBLICADO»); actívalo cuando lo elijas.
5. **Abre los seis indicadores y el global**: fórmula, numerador, denominador, cobertura, fotografía usada y pesos configurados/efectivos.
6. **Revisa un incidente antiguo** en «Backlog por antigüedad» (edad, umbral, motivo) y **una fecha sin fotografía** (debe decir que no hay fotografía compatible).
7. **Compara origen cliente y estándar** en «Diagnóstico por origen» y abre el detalle de una familia.
8. **Navega Grupo → Cliente** (ámbito) y desde la ficha de Análisis Cliente vuelve a Calidad: se conservan ámbito, periodo y entidad.
9. **Descarga el CSV** de la cartera y de la matriz de Client Health.

Todo esto se ha ejercitado en Linux con datos **sintéticos**; no se ha hecho con tus archivos reales ni se declara que lo hayas hecho tú.
