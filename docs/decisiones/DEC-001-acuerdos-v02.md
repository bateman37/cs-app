# Decisiones confirmadas de la revisión funcional

> Registro histórico. En reglas modificadas prevalecen DEC-003 y los contratos temáticos v0.4. Los formatos antiguos de tickets y la propuesta pendiente del sexto indicador están sustituidos. No usar esta evidencia como perfil vigente.

Fecha 29 de octubre de 2026. Fuente: aclaraciones de Dennis en esta conversación. Sustituyen las propuestas incompatibles del borrador v0.1. No implican desarrollo o validación de software ya ejecutados.

| ID | Decisión |
| --- | --- |
| DEC 01 | Solo cuatro vistas principales: Comparativa, Análisis Cliente, Pulse Rent y Calidad. Todo lo demás es Administración o detalle interno de esas vistas |
| DEC 02 | Planificar diez entregas, agrupando funcionalidades completas; no mantener una entrega de migración operativa masiva |
| DEC 03 | Repositorio indicado: bateman37/cs-app. Arquitectura web Next.js/React/TypeScript con PostgreSQL y Prisma, base independiente |
| DEC 04 | Vta Potencial = facturado más cartera casi confirmada. Diferencia = comparación con el Budget anual. No sumarla al ingreso |
| DEC 05 | SOPORTE, ADMIN_DELEGADA y OTROS son acumulados completos y sustituyen todas las líneas del año y categoría elegidos |
| DEC 06 | El mes en curso es accesible e inicial. El ingreso de ese mes se prorratea día de corte/días reales del mes. También hay mes completo y comparación equivalente anterior |
| DEC 07 | Calidad por grupo cliente y por proyecto/implantación. Rentabilidad agrupada en BC cuando no existe desglose real |
| DEC 08 | Un PAP es correctivo si al menos una causa lo es, aunque tenga otras causas. Conservar la selección múltiple |
| DEC 09 | SUSTITUIDA por DEC-002 y DEC-003 (origen cliente sí participa). Texto original: PAP origen cliente se analiza y no penaliza Calidad; Sistemas del Cliente y Uso indebido también deben distinguirse como atribuciones al cliente |
| DEC 10 | Escalados: tickets únicos por tags y mes de creación. No solicitar fecha real de evento |
| DEC 11 | SUSTITUIDA por DEC-002 (sin búsqueda de BUG en descripción). Texto original: Bug de cliente PRO: descripción con palabra BUG, tipo problema y organización registrada de cliente externo distinto de VINCLE. El tag bug actual no sirve para este fin; N4 no es condición |
| DEC 12 | Los seis KPI parten con peso idéntico. Pesos y umbrales administrables; total configurado 100 por ciento. Client Health ausente (llamado «Q0» en el borrador) redistribuye peso entre los otros cinco |
| DEC 13 | No precargar TIME, TICKET/TICKET_TAG o WRIKE. Dennis probará sus cargas. Se permiten maestros y datos financieros históricos; 2025 y 2026 se cargarán manualmente |
| DEC 14 | No existe bandeja independiente de pendientes. Cargas presenta un resumen con importados, duplicados, descartados y avisos |

## Vigencia de este registro

Registro histórico. DEC-002-diagnostico-y-bugs-v03.md sustituye las exclusiones de causas de cliente de DEC 09 y el criterio de búsqueda de BUG de DEC 11. No implementar esas reglas antiguas. El resto sigue vigente.

## Criterios de implementación propuestos sin añadir bloqueos

PAP se cuenta por fecha de producción como en el Excel, conservando Resultado sin imponer filtro OK. PAP se deja para prueba manual de carga. La configuración global de colores conserva propuestas editables hasta que Dennis elija valores; los pesos iguales sí están confirmados.

La precisión de pesos se resuelve con modo de proporciones iguales exactas y modo personalizado con suma decimal exacta. El nuevo fichero de tickets validará el nombre físico de la columna de descripción y tipo. No se vuelve a pedir ahora un archivo que Dennis ha indicado que todavía no puede descargar.
