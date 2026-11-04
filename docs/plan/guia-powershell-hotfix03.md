# Guía de actualización CSAPP-HOTFIX-03 para Windows (escrita, **sin probar en Windows**)

Para actualizar **tu instalación existente** en `C:\Projects\cs-app` con la base `cs_app`, conservando `.env`, maestros, usuarios, matrices, archivos cargados, cargas, snapshots y auditoría. No se recrea la base, no se ejecuta SQL a mano y **no tienes que volver a subir los Excels operativos**. Parte de que ya tienes HOTFIX-02 (`main` en `2c7a8d4` o posterior).

## 0. Qué cambia

- **Clientes y Personal son tablas panorámicas** (una fila por Grupo y por Cliente; una por persona) con el estado de cada enlace.
- **Estado: Activos / Inactivos / Todos** (por defecto Activos) en Comparativa, Calidad, Pulse y el selector de Análisis Cliente.
- Cifras recuperadas: Silver On Demand ya no deja el €/jornada en blanco, y con horas pendientes se muestra una cifra **provisional** (asterisco).
- Comparativa ordena por cualquier columna y colorea la rentabilidad respecto a tu objetivo (550 €/jornada = verde).
- Calidad tiene el interruptor **Por usuario | Total** y arranca con un perfil inicial **editable** (ya no «sin calibrar»).
- El menú de Administración queda en **Clientes · Personal · Usuarios · Cargas · Configuración**. Comprobación de datos, Excepciones de servicio y Estado de la aplicación están en **Configuración › Herramientas técnicas**; las Descargas, en **Cargas**.
- **Una migración nueva**: `20261111090000_hotfix03_bandas_economicas` (bandas, procedencia técnica de la configuración y decisiones «No aplica»). No recalcula filas.

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

No sigas si la verificación falla.

## 2. Traer el código sin perder tu `.env`

```powershell
git status
```

No borres cambios tuyos sin guardar. Es normal que `build-info.json` aparezca modificado (`git checkout -- build-info.json`).

Con la PR de HOTFIX-03 **fusionada en `main`**:

```powershell
git checkout main
git pull origin main
```

Si todavía no está fusionada, usa su rama:

```powershell
git fetch origin
git checkout claude/new-session-omvsmd
git pull origin claude/new-session-omvsmd
```

Anota el SHA instalado:

```powershell
git log -1 --oneline
```

## 3. Dependencias, migración, preparación y compilación

```powershell
npm.cmd ci
```

```powershell
npm.cmd run db:migrar
```

Debe aplicar `20261111090000_hotfix03_bandas_economicas`. Si falla, **no repitas ni uses `migrate reset` ni `db push`**: guarda el mensaje y restaura la copia.

Prepara la configuración inicial de Calidad (idempotente: dos ejecuciones no crean revisiones repetidas y no tocan una calibración manual tuya):

```powershell
npm.cmd run hotfix03:preparar
```

Debe decir `INSTALLED` (o `KEPT_MANUAL` / `UP_TO_DATE` si ya la tenías calibrada o instalada).

```powershell
Remove-Item -Recurse -Force .next
```

```powershell
npm.cmd run build:todo
```

```powershell
npm.cmd run ops -- preparar
```

```powershell
npm.cmd run ops -- salud
```

## 4. Arrancar

```powershell
npm.cmd run start:todo
```

Entra por la dirección de `BETTER_AUTH_URL` y pulsa Ctrl+F5. Al arrancar, el trabajador reenlaza solo lo ya cargado si hay una actualización pendiente.

**Si falta la tabla nueva de gestión**: en **Cargas › Precarga de maestros** sube solo `Tabla de Clientes.xlsx` (8 columnas) y/o `Tabla de Personal.xlsx` (6 columnas) y **revisa las diferencias** que muestra la previsualización antes de confirmar. No hace falta subir de nuevo tickets, tiempos, Wrike, PAP ni finanzas. Ejecuta la recuperación del reenlace (botón de Cargas) **solo si queda atascado**, no lote por lote.

## 5. Recorrido corto

1. **Clientes › Nuevo grupo**: crea un Grupo (solo nombre). Aparece como fila «pendiente». Completa su Wrike / Zendesk / PAP desde su ficha (o «+ Cliente»). Mira el estado «Configurado / Sin informar / No aplica / En conflicto» y el contador «Sin atribuir».
2. **Estado**: desactiva un Cliente y filtra Activos / Inactivos / Todos en Comparativa.
3. **Comparativa**: ordena por «€ / jornada» y por «Tarifa». Comprueba que **550 exacto es verde** y que un valor con asterisco es provisional.
4. **Calidad**: cambia **Por usuario / Total**; abre un KPI y vuelve; comprueba que se conserva la medida.
5. **PAP de un Grupo**: Calidad › PAP correctivos › fila del Grupo; el conteo coincide con tabla, KPI, detalle y CSV.
6. **Global y datos parciales**: abre un «Parcial» y sus causas; revisa **Configuración › Herramientas técnicas › Comprobación de datos** (problema · afectados · motivo · acción).

## 6. Si algo sale mal

No improvises SQL ni repitas migraciones. Restaura la copia del paso 1 ([copia y restauración](../operacion/copia-restauracion.md)); lo cargado después de la copia se pierde en esa restauración.
