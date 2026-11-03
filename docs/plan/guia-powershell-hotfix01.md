# Guía de actualización CSAPP-HOTFIX-01 para Windows (escrita, **sin probar en Windows**)

Para actualizar **tu instalación existente** en `C:\Projects\cs-app` con la base `cs_app`, conservando `.env`, datos, archivos cargados y cuentas. No es una instalación nueva: no se recrea la base ni se ejecuta SQL a mano. Todo se hace desde PowerShell, en la carpeta de la aplicación. Esta guía **no se ha ejecutado en Windows**: los comandos son los mismos que el resto de guías vigentes, pero revisa cada salida antes de seguir.

## 0. Qué cambia (en una frase por tema)

- Las cargas piden **solo el archivo** (las financieras, además, el **año** escrito a mano). Se acabaron las listas PAP, vistas, intervalos y casillas.
- **Lo último que subes manda:** tickets, PAP y bugs se actualizan por su ID. En **tiempos Zendesk y Wrike** cada export **completo** sustituye los tiempos activos de esa fuente (los anteriores se conservan y se pueden restaurar revirtiendo); no subas un archivo de un solo mes esperando que se acumule.
- PAP: un ID = un PAP. **Petición cliente** es una causa propia.
- Dos cargas nuevas de puesta en marcha: **Precarga de maestros** (tu `HOJAS DE CARGA.xlsx`) y **Histórico económico y usuarios** (tu `DATA FACTURACIÓN.xlsx`).
- Usuarios: se pueden editar el **año actual y el anterior**.
- Hay **tres migraciones nuevas** que solo añaden o reorganizan datos de forma controlada: `20261106090000_hotfix01_ultima_carga` (incluye la consolidación de PAP duplicados por ID), `20261107090000_hotfix01_precarga_maestros` y `20261108090000_hotfix01_historico_usuarios`.

## 1. Parar y hacer una copia verificada

```powershell
cd C:\Projects\cs-app
npm.cmd run stop:todo
```

Comprueba que web y trabajador están parados (`npm.cmd run ops -- salud`). Después, la copia (con parada controlada; la carpeta de destino es un ejemplo, usa la tuya y que no esté dentro de `C:\Projects\cs-app`):

```powershell
npm.cmd run backup:crear -- --destino "D:\Copias CS App" --esperar 120
```

```powershell
npm.cmd run backup:verificar -- "D:\Copias CS App\<carpeta-de-la-copia-que-se-acaba-de-crear>"
```

No sigas si la verificación falla. Anota el nombre de la carpeta de la copia: es tu vuelta atrás (ver [copia y restauración](../operacion/copia-restauracion.md)).

## 2. Traer la versión correcta sin perder tu `.env` ni cambios propios

El `.env` y los almacenes no están en Git, así que no se tocan. Mira primero si tienes cambios locales:

```powershell
git status
```

Si hay cambios tuyos sin guardar, no sigas hasta decidir qué hacer con ellos (no los borres). Luego:

```powershell
git fetch origin
git checkout feature/CSAPP-HOTFIX-01-cargas-sencillas-precarga
git pull origin feature/CSAPP-HOTFIX-01-cargas-sencillas-precarga
git log -1 --format=%H
```

Anota el SHA que muestra el último comando; es la versión que has instalado (la PR se revisa sobre ese mismo SHA y no se fusiona ni se despliega por iniciativa de nadie más).

## 3. Dependencias, migración y compilación

```powershell
npm.cmd ci
```

```powershell
npm.cmd run db:migrar
```

`db:migrar` aplica **solo** las tres migraciones nuevas, sin reset. Si algún paso falla, **no repitas ni uses `migrate reset` ni `db push`**: deja el mensaje tal cual y restaura la copia del paso 1 si hace falta.

```powershell
npm.cmd run build:todo
```

```powershell
npm.cmd run ops -- preparar
```

(`preparar` solo enlaza los almacenes existentes con la instalación; no carga datos.)

## 4. Arrancar y comprobar

```powershell
npm.cmd run start:todo
```

Entra con tu cuenta de Administrador y comprueba en Administración › **Operación** que la versión es la nueva, el esquema es compatible y el trabajador está presente. Tus Clientes, Personal, cargas anteriores, cuentas y cifras deben seguir donde estaban.

## 5. Cargar tus dos archivos (Administración › Cargas)

No se carga nada automáticamente al arrancar. Las confirmaciones las haces tú.

### 5.1 Maestros: `HOJAS DE CARGA.xlsx`

1. Cargas › fuente **«Precarga de maestros (hojas de carga)»** › elige el archivo › **Subir y validar**. Es solo el archivo.
2. Espera a «Listo para revisar». La ficha muestra, por hoja (CLIENTES, PERSONAL, PERSONAL PMO), qué se creará, qué se reutiliza y las **revisiones**: cuatro soportes que no coinciden, alias de Wrike o PAP que apuntan a varios Grupos, variantes de nombres de personal y un posible nombre extendido en PMO. No hay una bandeja aparte; todo está en esta ficha.
3. **Confirmar y activar.** Lo válido se carga; lo pendiente queda pendiente (no se asigna por parecido de nombre).
4. Resuelve en la propia ficha las revisiones que quieras (cada decisión pide un motivo y queda auditada). Repetir la carga no duplica nada ni pisa lo que hayas editado después.
5. Comprueba: Administración › **Clientes** (Grupos y Clientes con sus equivalencias), **Personal** (alias, nivel, equipo, PMO y rol ANA/DEV). No se crea ninguna cuenta de acceso.
6. Si la ficha avisa «reproceso necesario» sobre cargas anteriores, abre ese lote y pulsa **Reprocesar**.

### 5.2 Económico: `DATA FACTURACIÓN.xlsx`

1. Cargas › fuente **«Histórico económico y usuarios»** › archivo › **Subir y validar**.
2. En la ficha revisa el resumen por año y categoría (2022 a 2025: Soporte y Administración delegada), el impacto frente a lo ya cargado (si ya tenías 2025, la sustitución aparece explícita) y los Grupos que se crearán como «procedencia histórica».
3. **Confirmar y activar.** Se aplican todos los años y categorías del libro o ninguno. Los años o categorías que el libro no trae (por ejemplo OTROS o 2026) no se tocan.
4. Comprueba los ingresos 2022–2025 en Comparativa / Análisis Cliente.
5. **Usuarios:** el libro trae los de 2025. Cuatro Grupos tienen cifras distintas entre sus categorías: quedan **sin denominador** (nunca cero) hasta que elijas la cifra correcta desde la ficha de ese Grupo o en Administración › **Usuarios**. Los demás se inicializan con el mismo número los 12 meses de 2025, copiados a 2026 y estimados («Estimado a partir de 2025») en 2022–2024, solo en la matriz del Grupo.
6. Administración › **Usuarios**: comprueba una matriz de Grupo, ajusta un mes del año anterior y del actual (se pueden editar los dos) y confirma que años más antiguos solo se consultan.

## 6. Cargas operativas a partir de ahora

- Tickets, PAP, bugs VFS y VSW: **archivo**; actualizan por ID.
- Facturación (tres perfiles): **archivo y año**; sustituyen por completo ese año y categoría.
- Tiempos Zendesk y Wrike: **archivo completo**; sustituyen los tiempos activos de esa fuente. En la ficha, «Impacto de la activación» te dice qué se sustituye antes de confirmar. Se deshace con **Revertir** sobre el último lote.

## 7. Si algo sale mal

No improvises SQL ni repitas migraciones. Para la vuelta atrás de datos, restaura la copia del paso 1 siguiendo [copia y restauración](../operacion/copia-restauracion.md); lo que se hubiera cargado después de la copia se pierde en esa restauración.
