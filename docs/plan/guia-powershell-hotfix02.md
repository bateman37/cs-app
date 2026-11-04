# Guía de actualización CSAPP-HOTFIX-02 para Windows (escrita, **sin probar en Windows**)

Para actualizar **tu instalación existente** en `C:\Projects\cs-app` con la base `cs_app`, conservando `.env`, usuarios, matrices, archivos cargados, cargas y auditoría. No se recrea la base, no se ejecuta SQL a mano y **no tienes que volver a subir los Excels operativos**. Parte de que ya tienes HOTFIX-01 (`main` en `1abda3f` o posterior).

## 0. Qué cambia

- Los datos que ya cargaste (tickets, tiempos Zendesk, Wrike, PAP, facturación) se **reenlazan solos** con los maestros de Clientes: cada vez que cambia un maestro (carga de CLIENTES, edición de una equivalencia, resolución de un conflicto) el trabajador recalcula las atribuciones. Ya no hay que pulsar «Reprocesar» lote a lote.
- Se admite `CLIENTES.xlsx` con **solo la hoja CLIENTES** (sin PERSONAL ni PERSONAL PMO); no se vacía Personal.
- El soporte ordinario ya no queda sin clasificar por falta de asignaciones manuales de entorno.
- Comparativa, Análisis Cliente y Calidad se han rediseñado (ancho completo, dos filtros Soporte/Servidor, ficha de una pantalla, resumen de clientes con los seis indicadores). Pulse Rent no cambia de diseño.
- Hay **una migración nueva**: `20261110090000_hotfix02_enlace_automatico`. Solo añade el estado de actualización y deja la reparación programada; no recalcula filas durante la migración.

## 1. Parar y hacer una copia verificada

```powershell
cd C:\Projects\cs-app
npm.cmd run stop:todo
```

```powershell
npm.cmd run backup:crear -- --destino "D:\Copias CS App" --esperar 120
```

```powershell
npm.cmd run backup:verificar -- "D:\Copias CS App\<carpeta-de-la-copia-que-se-acaba-de-crear>"
```

No sigas si la verificación falla. La carpeta de la copia es tu vuelta atrás ([copia y restauración](../operacion/copia-restauracion.md)).

## 2. Traer el código sin perder tu `.env`

```powershell
git status
```

Si hay cambios tuyos sin guardar, decide qué hacer con ellos antes de seguir (no los borres). Es normal que aparezca `build-info.json` modificado: lo regenera cada compilación y puedes descartarlo con `git checkout -- build-info.json`.

Con la PR de HOTFIX-02 **ya fusionada en `main`**:

```powershell
git checkout main
git pull origin main
```

Si todavía no está fusionada, usa la rama de la PR en su lugar:

```powershell
git fetch origin
git checkout feature/CSAPP-HOTFIX-02-enlace-automatico-y-vistas
git pull origin feature/CSAPP-HOTFIX-02-enlace-automatico-y-vistas
```

Comprueba lo que has instalado y anota el SHA:

```powershell
git log -1 --oneline
```

```powershell
Test-Path src\server\relations\refresh.ts
```

(Si el segundo comando da `False`, el código nuevo no está en la carpeta: repite el paso anterior.)

## 3. Dependencias, migración y compilación

```powershell
npm.cmd ci
```

```powershell
npm.cmd run db:migrar
```

Debe aplicar `20261110090000_hotfix02_enlace_automatico` sin reset. Si falla, **no repitas ni uses `migrate reset` ni `db push`**: guarda el mensaje y restaura la copia.

```powershell
Remove-Item -Recurse -Force .next
```

```powershell
npm.cmd run build:todo
```

La última línea debe decir `build-info.json: versión 0.1.0, SHA …, 13 migraciones`.

```powershell
npm.cmd run ops -- preparar
```

```powershell
npm.cmd run ops -- salud
```

Debe mostrar el SHA nuevo, `Esquema: ok (13/13)` y sin el aviso `ESQUEMA_ADELANTADO`.

## 4. Arrancar y comprobar la actualización automática

```powershell
npm.cmd run start:todo
```

Déjala abierta. Entra por la dirección que figura en `BETTER_AUTH_URL` de tu `.env` (normalmente `http://localhost:3000`) y pulsa Ctrl+F5.

Al arrancar, el trabajador detecta la reparación pendiente y la ejecuta solo. En **Administración** verás el estado «Actualizando relaciones» con su progreso; cuando termine dirá que está al día. Si se queda en «fallo», hay un único botón **Actualizar relaciones de los datos cargados** (solo Administrador) para reintentarlo. No hace falta subir nada.

## 5. Recorrido corto de comprobación

1. **Comparativa:** abre un Grupo con datos. Ves una fila por Grupo con horas, facturación imputada y €/jornada. Prueba los chips **Soporte** y **Servidor** (un clic selecciona, otro deselecciona).
2. **Ficha:** pulsa el nombre de ese Grupo. Se abre su ficha en una pantalla con los gráficos y los tres cuadros de dedicación. Anota tres cifras (horas del mes, facturación del mes, €/jornada) y compáralas con la fila de Comparativa: deben coincidir.
3. **Calidad:** entra en «Resumen de clientes». Pulsa uno de los seis indicadores (por ejemplo «Escalados a N3») y comprueba que abre su apartado con ese cliente seleccionado; usa «Volver al resumen».
4. **Exportar:** descarga el CSV de Comparativa con los mismos filtros y comprueba que sus totales coinciden con los de pantalla.
5. **Excepciones reales:** Administración › Cargas › ficha de la última «Precarga de maestros» lista solo lo que sigue sin resolver (alias que apuntan a varios Grupos, soportes distintos, un ID Zendesk con dos Grupos). Resolverlas dispara de nuevo la actualización automática.

Si actualizas Clientes, **basta con subir `CLIENTES.xlsx`** en Cargas › «Precarga de maestros»: no necesitas reenviar los Excels operativos ni Personal.

## 6. Si algo sale mal

No improvises SQL ni repitas migraciones. Para volver atrás restaura la copia del paso 1 ([copia y restauración](../operacion/copia-restauracion.md)); lo cargado después de la copia se pierde en esa restauración.
