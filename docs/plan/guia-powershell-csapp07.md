# Guía PowerShell de CSAPP-07 (escrita, **sin probar en Windows**)

> **Guía histórica (CSAPP-07).** Describe el arranque de esa entrega y puede contradecir la operación actual. La guía **vigente** de instalación, arranque y operación es [instalación y operación](../operacion/instalacion-operacion.md); los comandos de aquí no se usan en una instalación operativa.

Hay **una migración nueva**: `20261102090000_pulse_calidad_configuracion` (tablas `ConfigRevision` y `ConfigDraft`; no toca ninguna tabla anterior ni reinicia datos). Esta rama (`feature/CSAPP-07-pulse-rent-configuracion`) está **apilada sobre la rama de CSAPP-06** (PR 7, sin fusionar).

```powershell
git fetch origin
git checkout feature/CSAPP-07-pulse-rent-configuracion
npm ci
npm run db:migrar
npm run build
npm start
```

## Pruebas: la base debe ser explícita, aislada y distinta de la tuya

Las pruebas que modifican datos **se niegan** a ejecutarse si `TEST_DATABASE_URL` falta, no acaba en `_test` (el nombre se lee del **path** de la URL), coincide con la base de trabajo, o si la conexión efectiva no está en esa base (`current_database()`). `NODE_ENV=test` no basta. Úsela solo con una base de pruebas propia:

```powershell
$env:TEST_DATABASE_URL = "postgresql://USUARIO:CLAVE@localhost:5432/cs_app_test?schema=public"
npm run typecheck
npm run lint
npm test
npm run e2e:build
npm run e2e
npm run benchmark:pulse   # 1500 grupos / 250000 tiempos sintéticos, solo base _test
```

## Recorrido breve para Dennis

1. **Pulse Rent** (`/pulse-rent`) sin datos: estado vacío; con datos: tabla agrupada por familia, ámbito Grupo Cliente / Cliente / Implantación, periodo y normalización.
2. Perfiles: sin configurar, las métricas por perfil dicen «Perfil sin configurar». Administración › Configuración › **Pulse Rent**: elija equipo y nivel (o PMO) de cada perfil, **Guardar borrador** (no cambia nada), indique motivo y **Activar**.
3. Cambie **Normalización** (anual / del periodo / bruto) y compruebe la unidad de cada columna. Ratios y €/jornada no se dividen de nuevo.
4. Busque o filtre filas: el N de la referencia no cambia. Cambie **Referencia** (Gold OP, sin Silver…): cambia. «Usar los filtros visibles como referencia» la copia como personalizada.
5. Pulse una celda: explicación integrada y detalle que concilia con el numerador. «Ver distribución» de una columna.
6. Exporte los tres CSV (filas filtradas completas, estadísticas, criterios) y repita como usuario Consulta.
7. Administración › Configuración › **Calidad**: pesos iguales (1/6) y sin Client Health (20 %); pruebe personalizado con 99, 101 y 100,02 (se rechazan) y 20+20+15+15+15+15; **simule** con Client Health en blanco (25 y 18,75 %); guarde borrador, active, y «Volver a esta» una revisión anterior (crea una nueva activación). Los umbrales siguen **sin calibrar**.

Pendientes que **no** quedan resueltos por esta entrega: ZDT 11-13, ZTM 06-08, lista de origen PAP, estados de bugs, signo de «Diferencia», Silver (ECO 08), umbrales de Calidad, composición del global y pesos distintos de los iguales confirmados.
