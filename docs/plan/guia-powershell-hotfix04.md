# Guía de actualización CSAPP-HOTFIX-04 para Windows (escrita, **sin probar en Windows**)

Para actualizar **tu instalación existente** en `C:\Projects\cs-app` con la base `cs_app`, conservando `.env`, maestros, usuarios, matrices, archivos cargados, cargas, snapshots y auditoría. No se recrea la base, no se ejecuta SQL a mano y **no tienes que volver a subir los Excels operativos**.

**Un único recorrido, sobre `main`, después de fusionar la PR de HOTFIX-04.** No uses ramas antiguas (`claude/new-session-omvsmd` ya provocó una instalación de código anterior). Ejecuta los comandos **uno a uno** y **detente en el primer error**: no sigas ni improvises (sin `migrate reset`, `db push`, `TRUNCATE`, borrar maestros ni reinstalar).

Esta entrega **no añade migraciones**. El paso de migración sigue en la guía porque, si tu base no tenía aplicada la de HOTFIX-03 (`20261111090000_hotfix03_bandas_economicas`), es **la causa demostrada** de que Comparativa mostrara «No se pudo cargar la comparativa» (Prisma `P2022`: no existe la columna `EconomicSettingsRevision.bandFactors`). Ahora Comparativa dice exactamente eso y cómo resolverlo.

## 0. Qué cambia

- **Clientes** es una tabla **editable en sus celdas** (Grupo Cliente, Wrike, Id_Zendesk, Zendesk, Nivel de Servicio, Servidor, PAP, Tipo y Activo). Se cambian los valores, se pulsa **Guardar cambios**, se revisa «antes → después» y se confirma en la misma pantalla. Ya no hay que abrir fichas.
- **Usuarios contratados**: los doce meses son editables en la propia matriz, con una única revisión/confirmación para varias celdas y varias filas.
- **Administración** (menú superior) abre `/administracion/clientes`; las listas antiguas (`/grupos`, `/clientes`) redirigen a la tabla.
- **Comparativa**: diagnóstico técnico explícito del error de lectura y, además, corregido un fallo de lectura concurrente cuando falta la revisión inicial de la configuración económica.

## 1. Parar y hacer una copia verificada

```powershell
cd C:\Projects\cs-app
```

```powershell
npm.cmd run stop:todo
```

```powershell
npm.cmd run backup:crear -- --destino "D:\Copias CS App" --esperar 120
```

```powershell
npm.cmd run backup:verificar -- "D:\Copias CS App\<carpeta-de-la-copia-que-se-acaba-de-crear>"
```

No sigas si la verificación falla.

## 2. Estado local y actualización fast-forward

Mira qué hay modificado en tu carpeta:

```powershell
git status --short
```

Anota cualquier cambio tuyo: **no lo borres**. El archivo `build-info.json` se regenera al compilar y puede aparecer modificado; **no ejecutes `git restore -- build-info.json` a ciegas**. Comprueba primero si Git lo sigue (si no lo sigue, el comando da error y no hay nada que restaurar):

```powershell
git ls-files --error-unmatch build-info.json
```

Si lo sigue **y** es lo único modificado, guárdalo aparte en lugar de descartarlo:

```powershell
git stash push -m "build-info local" -- build-info.json
```

Actualiza `main` **solo con fast-forward** (si hay conflicto con cambios locales, se detiene sin tocar nada):

```powershell
git fetch origin main
```

```powershell
git checkout main
```

```powershell
git pull --ff-only origin main
```

Comprueba el SHA que has instalado (debe ser el del merge de la PR de HOTFIX-04 o posterior):

```powershell
git log -1 --format="%H %s"
```

## 3. Dependencias, migraciones, preparación y compilación

```powershell
npm.cmd ci
```

```powershell
npm.cmd run db:migrar
```

Aplica las migraciones pendientes (en una instalación con HOTFIX-03 ya aplicado dirá que no hay nada pendiente). Si falla, **no lo repitas ni uses `migrate reset` ni `db push`**: guarda el mensaje y restaura la copia del paso 1.

```powershell
npm.cmd run hotfix03:preparar
```

Es idempotente: no crea revisiones repetidas ni toca una calibración manual de Calidad.

Compilación limpia (web y trabajador) con los scripts vigentes de `package.json`:

```powershell
Remove-Item -Recurse -Force .next
```

```powershell
npm.cmd run build:todo
```

Enlaza los almacenes existentes (idempotente) y comprueba:

```powershell
npm.cmd run ops -- preparar
```

```powershell
npm.cmd run ops -- salud
```

`salud` debe mostrar `SHA <doce primeros caracteres>` **igual al de `git log -1`** del paso 2 (la versión `0.1.0` es genérica y no prueba nada). Si el SHA no coincide, la compilación no es la de este código: no arranques.

## 4. Arrancar

```powershell
npm.cmd run start:todo
```

Entra por la dirección de `BETTER_AUTH_URL` y pulsa Ctrl+F5. Comprueba otra vez `npm.cmd run ops -- salud` (SHA y trabajador vivo). Al arrancar, el trabajador reenlaza solo lo ya cargado si hay una actualización pendiente; **no hay que subir ni reprocesar archivos**.

## 5. Recorrido manual corto

1. **Administración** (barra superior, estando en Comparativa) → debe abrir **Clientes** (`/administracion/clientes`), la tabla editable.
2. En una fila de Cliente, **edita una correspondencia** (por ejemplo el nombre Wrike del Grupo, o el Nivel de Servicio) → pulsa **Guardar cambios (n)**.
3. En la confirmación pulsa **Cancelar** → comprueba que **no cambió nada** (recarga la página: el valor es el anterior; el borrador sigue en la tabla hasta que lo descartes).
4. Vuelve a **Guardar cambios** → **Sí, guardar** → el valor queda guardado en la misma pantalla. Mira el aviso «Actualizando relaciones» y espera a que termine (sin pasar por Cargas).
5. **Usuarios**: edita **dos meses** de una fila (y, si quieres, otra fila) → **Guardar cambios** → **Sí, guardar**. Vacía una celda para dejarla «sin informar» (no es 0) y escribe 0 para «cero confirmado».
6. **Comparativa**: debe cargar la cartera sin error. Si aparece «No se pudo cargar la comparativa», abre **Detalle técnico** (está desplegado para el Administrador): indica la causa (por ejemplo migraciones pendientes) y la acción.

## 6. Si algo sale mal

No improvises SQL ni repitas migraciones. Restaura la copia del paso 1 ([copia y restauración](../operacion/copia-restauracion.md)); lo cargado después de la copia se pierde en esa restauración.

Para **probar esta entrega antes de fusionarla** (no forma parte de la secuencia de instalación de `main`): la rama de la PR es `feature/CSAPP-HOTFIX-04-edicion-tablas`. Úsala solo en una copia aparte de la carpeta, nunca como alternativa al recorrido de `main`.
