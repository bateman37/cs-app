# Resultados de validación de CSAPP-01

Entorno de ejecución: Linux (contenedor en la nube), Node 22.22.0, PostgreSQL 16.15 local, 29/10/2026. **No se ha probado en Windows ni con PowerShell**: los comandos de la [guía](../plan/guia-powershell-csapp01.md) están escritos pero no ejecutados allí.

| Comprobación | Comando | Resultado |
| --- | --- | --- |
| Tipos | `npm run typecheck` | Sin errores |
| Lint | `npm run lint` | Sin errores |
| Migración de instalación limpia | `prisma migrate deploy` sobre una base vacía recién creada | Aplicada; también se aplica al preparar las pruebas |
| Pruebas con PostgreSQL real (31) | `npm test` | 31 de 31 correctas (`tests/maestros.test.ts`, `tests/acceso.test.ts`) |
| Build de producción | `npm run build` | Correcto |
| Arranque, sesión y persistencia reales (41) | `next start` sobre `cs_app_test` y un recorrido con Chromium/Playwright (guion ad hoc, no incluido en el repositorio) | 41 de 41; persistencia comprobada tras reiniciar el servidor |
| Arranque de desarrollo | `next dev` | Arranca; `/login` 200 y rutas privadas redirigen |

Cobertura frente a los casos del prompt: sin sesión (páginas, cookie falsa y mutación forjada); perfil Consulta (lectura, mutación forjada rechazada sin tocar datos ni auditoría, tanto en servicio como replicando una petición real de Server Action); grupo con dos Clientes; equivalencia repetida incompatible incluida concurrencia; alias PAP sin crear Cliente ni implantación; OP→CLOUD; desactivación y reactivación; dos ediciones; auditoría y atomicidad; cierre de sesión y reutilización de cookie; instalación repetida de cuentas; navegación y estados vacíos sin cifras; límite de intentos.

Defectos encontrados y corregidos durante la validación: bucle de redirecciones con una cookie caducada; cuenta de credenciales con `accountId` incorrecto (impedía iniciar sesión); función de cliente invocada desde servidor que rompía la ficha con datos de servicio; mensaje de éxito oculto al plegarse un desplegable.

No ejecutado: Windows/PowerShell; prueba de carga o rendimiento; despliegue (fuera de alcance); revisión visual con lector de pantalla.

**Precarga de maestros: no realizada.** No hay fuente privada en el entorno; las tablas están vacías y no se ha insertado ningún cliente. Queda pendiente para cuando Dennis facilite el libro de maestros.
