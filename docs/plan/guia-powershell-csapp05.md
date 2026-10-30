# Guía PowerShell de CSAPP-05: migrar, arrancar y probar las finanzas y el motor económico

Escrita para Windows 10/11 con PowerShell, Node.js 22 LTS y PostgreSQL ≥13 local. **No se ha ejecutado en Windows**: lo probado es Linux (ver [validación](../validacion/csapp-05.md)). Los comandos de esta guía están **documentados, no ejecutados en Windows**; los ejecutados en Linux se listan en la validación. Parte de que [CSAPP-01](guia-powershell-csapp01.md) a [CSAPP-04](guia-powershell-csapp04.md) ya funcionan. Todo desde la carpeta del repositorio. No se imprime ninguna credencial. **No se precarga ningún dato: las cargas reales de 2025 y 2026 las realiza usted.**

## 1. Actualizar sin borrar nada

```powershell
git pull
npm ci
npm run db:comprobar
npm run db:migrar
```

`db:migrar` aplica solo `20261031090000_finanzas_motor_economico`: tablas financieras (`FinanceScope`, `FinanceBatch`, `FinanceRow`, `FinanceDecision`), `EconomicSettingsRevision` (con la revisión 1: 550 €/jornada, 8 h y tolerancia de 0,01 €), `ServiceAssignment`, el CHECK ampliado de equivalencias (Wrike/PAP de proyecto → Grupo) y la vista `TimeActivity` ampliada. No hace reset ni toca maestros, personal, usuarios ni lo cargado.

## 2. Reiniciar web y trabajador (dos terminales)

Terminal 1: `npm run build` y `npm start`. Terminal 2: detenga con `Ctrl+C` el trabajador anterior y ejecute `npm run worker` (debe ser la versión nueva: los perfiles financieros viven en el trabajador). No hay variables de entorno nuevas: el objetivo, la jornada y la tolerancia se editan en **Administración › Configuración**.

## 3. Cargar y comprobar (su recorrido de aceptación)

1. **Equivalencias.** En Administración › Clientes, una equivalencia Wrike o PAP de *proyecto* puede apuntar directamente a un Grupo Cliente. Si ya tenía tiempos o PAP atribuidos por la antigua clave BC, **Comprobación económica** muestra el «recálculo pendiente»: cree la equivalencia explícita y use «Reprocesar» en esos lotes.
2. **Cargas.** Siga la [guía de cargas](guia-cargas-usuario.md#facturación-anual-csapp-05-cómo-cargar-2025-y-2026): cargue 2025 y 2026 de cada categoría, **repita** cada una, sustituya con un fichero con cambios y una ausencia, compruebe que las otras categorías no cambian y pruebe **Revertir** en un lote de prueba.
3. **Servicio económico.** Sin asignaciones, las horas quedan «sin clasificar» y los ratios de servicio salen como parciales con su motivo. Añada, con el valor exacto, asignaciones por Entorno y Tipología o por proyecto Wrike (la pantalla muestra primero el impacto).
4. **Comprobación económica.** Elija grupo, servicio, fecha y modo; compruebe, por ejemplo, 12000 anuales con corte 15 de junio → 500 € del mes.
5. **Configuración.** Cambiar el objetivo crea una revisión nueva; una edición obsoleta se rechaza; consultar con una revisión anterior es un recálculo identificado.

## 4. Históricos anteriores a 2025 (solo si tiene la hoja)

Simulación (no escribe nada):

```powershell
npx tsx scripts/importar-historico-financiero.ts --archivo "C:\ruta\privada\libro.xlsx" --admin su.correo@empresa.com
```

Aplicar (solo tras revisar la simulación; omite los años/categorías que ya tienen un conjunto activo y rechaza 2025 en adelante):

```powershell
npx tsx scripts/importar-historico-financiero.ts --archivo "C:\ruta\privada\libro.xlsx" --admin su.correo@empresa.com --aplicar
```

El libro no debe subirse al repositorio ni dejarse en una carpeta del proyecto. La interpretación de la categoría por las columnas «Soporte»/«Admin Delegada» está **pendiente de validar con el libro real**; las filas sin categoría explícita se informan y no se importan.

## 5. Comandos de prueba (solo contra una base de test explícita)

```powershell
$env:TEST_DATABASE_URL = "postgresql://USUARIO:CLAVE@localhost:5432/cs_app_test?schema=public"
npm run typecheck
npm run lint
npm test
npm run e2e:build
npm run e2e
npm run test:largo
```

`npm run test:largo` incluye el trabajador real (fallo inyectado y SIGKILL durante una sustitución financiera) y el volumen de CSAPP-05. Tamaños ajustables con `CSAPP_TEST_FIN_ROWS`, `CSAPP_TEST_TIMES` y `CSAPP_TEST_GROUPS`; con `CSAPP_COUNT_QUERIES=1` el volumen cuenta las sentencias del motor y con `CSAPP_TEST_MEASURES_FILE` anexa las medidas a un archivo.
