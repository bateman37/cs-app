# Cargas: qué se puede probar (CSAPP-02 y CSAPP-03)

**Administración › Cargas** (solo Administrador) es el motor común de importación. Desde CSAPP-03 hay **dos importadores operativos**: «Zendesk · tickets» y «Zendesk · tiempos» (Wrike, PAP, bugs y facturación llegan después y se muestran como pendientes). Para usarlos con sus XLSX reales siga la [guía de CSAPP-03](guia-powershell-csapp03.md); el motor y los importadores están probados con archivos sintéticos.

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
