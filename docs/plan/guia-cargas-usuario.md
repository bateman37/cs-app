# Cargas: qué se puede probar (CSAPP-02 a CSAPP-05)

**Administración › Cargas** (solo Administrador) es el motor común de importación. Hay **seis importadores operativos**: «Zendesk · tickets» y «Zendesk · tiempos» (CSAPP-03) y «Wrike», «PAP», «Bugs VFS» y «Bugs VSW» (CSAPP-04); la facturación llega después y se muestra como pendiente. Para usarlos con sus archivos reales siga las guías de [CSAPP-03](guia-powershell-csapp03.md) y [CSAPP-04](guia-powershell-csapp04.md); el motor y los importadores están probados con archivos sintéticos.

## Qué verá en su base de trabajo

- «Fuentes»: Tickets y Tiempos de Zendesk disponibles (con fecha de extracción opcional y, solo si el libro tiene varias hojas compatibles, la hoja) y la lista de fuentes previstas, deshabilitadas y con su entrega.
- «Historial de cargas»: vacío.
- Los perfiles sintéticos de prueba **no aparecen** aquí: solo se habilitan en una base de test aislada (variable de servidor igual al nombre de la base, nombre acabado en `_test` y esquema auxiliar creado por las pruebas).

## Cómo ver el flujo completo (entorno de pruebas)

El recorrido automático lo ejecuta de extremo a extremo (subida por la interfaz, trabajador real, previsualización, confirmación, activación, repetición y rechazo):

```bash
npm run e2e:build
TEST_DATABASE_URL="postgresql://USUARIO:CLAVE@localhost:5432/cs_app_test?schema=public" npm run e2e
```

Qué comprueba y qué muestra la ficha de un lote: ver [guía del recorrido](guia-recorrido-navegador.md) y [guía del trabajador](guia-trabajador-cargas.md) (dos procesos: web y trabajador).

## Cómo leer la ficha de un lote

- **Estado y fase** se actualizan solos cada pocos segundos. Mientras no se conoce el total de filas se muestran contadores y fase, nunca un porcentaje inventado; la barra de la subida sí es real (bytes enviados).
- **Contadores**: recibidas, con error (no se activan), válidas, duplicadas, excluidas, revisadas, con aviso e importadas (solo tras activar). Cada una lleva su definición en la pantalla.
- **Confirmar** solo está disponible en «Listo para revisar»; si no, el botón aparece deshabilitado con el motivo. **Cancelar** no es posible durante «Activando»: esa fase aplica los cambios en una transacción atómica y, si falla, se deshace por completo. **Reprocesar** reutiliza el archivo original ya guardado. **Revertir** solo sobre lotes completados y respeta filas compartidas con otros lotes.
- Subir otra vez el mismo archivo crea un lote nuevo con un aviso de checksum repetido; no duplica registros activos.
- La fecha de carga, la extracción declarada, el intervalo y la cobertura son datos separados; la extracción no se deduce del contenido.


## Facturación anual (CSAPP-05): cómo cargar 2025 y 2026

Tres fuentes en **Administración › Cargas**: «Facturación · soporte», «Facturación · administración delegada» y «Facturación · otros». Cada carga **sustituye por completo** su año y su categoría (no suma): soporte 2026 no toca administración delegada 2026, otros 2026 ni soporte 2025.

1. Elija la fuente, el **año** (el pie «Año Actual» del archivo no lo informa), marque que el archivo es el **conjunto anual completo** y, si lo sabe, la fecha de extracción. El archivo es el XLSX de tres columnas: `Grupo cliente`, `Vta Potencial`, `Diferencia`.
2. Espere a «Listo para revisar». La ficha muestra el pie verificado (categoría y filtros), la conciliación contra el Total, el lote activo que se reemplaza, total anterior y nuevo, y los grupos nuevos, modificados y retirados.
3. Resuelva lo pendiente (la ficha lo lista): importes **sin asignar** a un Grupo Cliente (complete el maestro y use «Reprocesar», o acepte expresamente que queden fuera de los informes atribuidos), **vacíos** de Vta Potencial (decisión del lote, con motivo y Total conciliado), asignación anual de un grupo que cambia de destino, colisiones y declaraciones si falta el pie o el Total.
4. Pulse **«Revisar el impacto frente al conjunto vigente»**: guarda qué conjunto vio y su versión. Si otra carga lo sustituye antes de activar, se le pedirá actualizar el impacto y confirmar de nuevo.
5. «Confirmar y activar». Para comprobar la sustitución, **repita la carga** (debe quedar igual, no duplicarse) y después cargue un fichero con cambios y con un grupo ausente (la ficha previa mostrará un grupo retirado y, al activar, el total nuevo, no la suma).
6. «Revertir» (solo el lote vigente) restaura el predecesor completo. Un lote ya sustituido no se revierte saltándose el posterior.

Después puede comprobar cifras en **Administración › Comprobación económica** (12000 anuales con corte el 15 de un mes de 30 días dan 500 € del mes). Los **financieros anteriores a 2025** no se cargan aquí: ver la [guía PowerShell de CSAPP-05](guia-powershell-csapp05.md#4-históricos-anteriores-a-2025-solo-si-tiene-la-hoja).
