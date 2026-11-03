# Guía breve de Calidad (CSAPP-08)

Para quien consulta la pantalla `/calidad`. Un Administrador además edita Client Health, notas de revisión, cobertura y configuración.

**Qué muestra.** El resultado de un **mes** (hasta el corte efectivo; nunca futuro): seis indicadores y un resultado global por Grupo Cliente o Cliente. No hay resultado global anual.

**Cómo leer una celda.** Valor y unidad; color **con texto** (nunca solo color); estado: *cero confirmado* (hay cobertura que lo sustenta), *sin dato*, *parcial* (valor conocido pero incompleto: no se colorea), *sin calibrar* (faltan umbrales, método o referencia válidos: no hay verde automático) o *en blanco* (Client Health sin feedback).

**Global.** Se genera solo si el Administrador eligió método y límites y todos los indicadores con peso tienen color. Si falta alguno se muestra «Incompleto» con su cobertura y, si hay una señal roja conocida, una alerta roja parcial.

**Pesos.** Iguales 1/6. Sin Client Health (en blanco) los otros cinco pesan 1/5. Un indicador técnico ausente **no** aumenta el peso de los demás. Un Health con feedback pero sin mapeo confirmado conserva su peso.

**Backlog.** Tickets sin resolver con su antigüedad (días naturales desde la creación hasta la observación). El stock procede de una **fotografía declarada completa**; si no hay del día del corte, no se rellena con el estado actual.

**Diagnóstico.** Orienta qué revisar (estándar, configuración, personalización, integración, sistemas del cliente, uso indebido, infraestructura Vincle o del cliente). Es una hipótesis: la etiqueta no demuestra falta de pruebas ni culpa.

**Dónde se arregla un aviso.** Cobertura y fotografías: Administración › Cargas. Umbrales, mapeo, perfiles y global: Administración › Configuración › Calidad. Feedback: pestaña «Client Health».
