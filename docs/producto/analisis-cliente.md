# Análisis Cliente e histórico detallado

## Ficha individual

Seleccionar cliente y periodo. La cabecera muestra grupo, proyectos, soporte, alojamiento, complejidad, producto, usuarios y cobertura. Conservar el criterio de filtro al volver a Comparativa. Cada cifra abre su desglose y, desde este, los registros de origen con lote, fecha, persona, fuente y motivo de inclusión.

La ficha contiene los indicadores económicos del mes y año, desviaciones contra objetivo, horas dedicadas y objetivo de horas. Añadir acumulado comparable del año anterior sin eliminar la referencia al año completo.

## Gráficos y desgloses

| Visual o tabla | Contenido |
| --- | --- |
| Rentabilidad mensual | Serie en euros por jornada y línea objetivo, con interrupciones cuando falta denominador |
| Dedicación mensual | Horas por equipo y perfil y PAP en una serie o eje identificado, sin sumar horas con intervenciones |
| Resumen anual | Ingreso, dedicación real y objetivo, ratio anual y comparación entre años |
| Equipos y perfiles | CS N1, CS N2, PMO ANA, PMO DEV, IT N3 y Plataforma N4; mes, anterior, CUM y anterior comparable |
| Motivos de dedicación | Incidentes Vincle, otro soporte y sin clasificación; desglose de las cuatro causas más infraestructura SaaS |
| PAP | Evolutivos no facturables, correctivos por categorías, origen cliente y total único |
| Escalados y bugs | Tickets únicos por destino, bugs confirmados y explicación del periodo utilizado |
| Calidad | Los seis KPI, valor por usuario, referencia, semáforo, peso efectivo y resultado global |

En el libro hay cinco gráficos de Análisis Cliente y uno de PulseRent. La aplicación conserva sus preguntas de negocio y elimina sus rangos fijos hasta 2025. Los gráficos ampliarán los años disponibles automáticamente.

## Históricos y producto

La fuente de PMO cambia el 1 de enero de 2025, según el contrato de dedicación. Un año anterior no se obtiene siempre de Zendesk: para analizar 2026, la parte PMO de 2025 ya debe venir de Wrike. Aplicar la misma regla en todos los gráficos y desgloses.

El corte por VSW, VFS o ARQ precisa un campo de producto o una equivalencia de proyecto validada. No deducirlo del destino de un escalado ni del campo TIPO, que es complejidad. Un registro sin producto conserva la categoría «sin identificar».

## Detalle integrado en las vistas

Se abre como detalle o pestaña dentro de las cuatro vistas, sin crear otro módulo de negocio. Será una consulta sobre los datos normalizados y agregados, no una copia manual de la hoja ANÁLISIS DETALLADO. Admitir agrupación por cliente, año, mes, fuente, servicio, equipo, rol, causa, producto y proyecto. Los detalles se paginan y las descargas grandes se generan como tarea en segundo plano. Un gráfico no carga cientos de miles de registros en el navegador.

## Evidencia de calidad

La pestaña Calidad de la ficha permite leer el feedback del mes, ver tendencias y consultar qué tickets o PAP producen el resultado. Las anotaciones de arranque y migración aparecerán en las curvas. Las correlaciones de horas, escalados e incidencias son señales relacionadas; no representan automáticamente seis problemas distintos ni prueban causalidad.

## Diagnóstico y afectación del producto

La ficha usa Grupo Cliente y Cliente existentes y abre el diagnóstico de causas sin eliminar Sistemas del Cliente o Uso indebido. Mostrar problemas e incidentes por separado, lista de bugs vinculados y problemas por causa estándar como métricas distintas. Los vínculos parciales no representan todos los clientes afectados. La sección detallada sigue dentro de las cuatro vistas, sin crear otro módulo.
