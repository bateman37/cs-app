# Guía PowerShell de CSAPP-06 (escrita, **sin probar en Windows**)

No hay migración nueva: basta con las cinco de CSAPP-01 a 05.

```powershell
git fetch origin
git checkout claude/new-session-omvsmd
npm ci
npm run db:migrar
npm run build
npm start
```

Con el trabajador (cargas): `npm run worker` en otra ventana. Pruebas (base `_test` aislada, nunca la tuya):

```powershell
$env:TEST_DATABASE_URL = "postgresql://USUARIO:CLAVE@localhost:5432/cs_app_test?schema=public"
npm run typecheck
npm run lint
npm test
npm run test:largo
npm run e2e:build
npm run e2e
npm run benchmark:analitica   # 1500 grupos / 250000 tiempos sintéticos, solo base _test
```

## Recorrido breve

1. Comparativa con el mes actual; «Mes completo» (provisional si es el mes en curso).
2. Filtrar (plan, búsqueda), ordenar por una columna y cambiar de página; las tarjetas no cambian de página.
3. Abrir un Grupo y volver: se conservan búsqueda, orden, página y bloques.
4. Mostrar «CUM anterior comparable» y «Año anterior completo» y comparar.
5. Curvas de la ficha y abrir el desglose de una cifra (ratio → ingreso → horas).
6. Bajar a un Cliente: ingreso agrupado en el Grupo, sin repartir.
7. Pestañas PAP y Tickets/bugs; Datos y cobertura.
8. Exportar la cartera completa y repetir como usuario Consulta.

Sin datos cargados, las pantallas explican las fuentes que faltan y ofrecen al Administrador sus accesos; no muestran resultados de muestra.
