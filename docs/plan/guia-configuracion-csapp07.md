# Guía de configuración de Pulse Rent y Calidad (CSAPP-07)

Administración › Configuración › Economía / Pulse Rent / Calidad. Solo un Administrador guarda borradores, activa o revierte; Consulta ve las reglas aplicadas.

| Acción | Efecto | Escribe lo activo |
| --- | --- | --- |
| **Guardar borrador** | Persiste un borrador por familia (validado; un total de pesos distinto de 100 se rechaza) | No |
| **Simular** (Calidad) | Calcula pesos efectivos, colores y global con escenarios manuales de la URL | No (no escribe nada) |
| **Activar** | Crea atómicamente la revisión siguiente con motivo y auditoría; exige que lo activo siga siendo la base y que el borrador no haya cambiado | Sí |
| **Volver a esta** | Crea una **nueva** activación con la configuración de una anterior (la historia no cambia) | Sí |
| **Descartar borrador** | Elimina el borrador | No |

## Pulse Rent

Perfiles canónicos (hasta dos selectores por perfil: equipo, nivel, PMO); referencias personalizadas (plan, servidor, complejidad, producto, homogéneo, sin Silver); dirección por métrica (la personalizada se rotula). Activar una nueva revisión invalida las bandas anteriores.

## Calidad

Pesos: **Iguales** (1/6) o **Personalizado** (seis porcentajes con hasta dos decimales que sumen exactamente 100). Umbrales por indicador: método absoluto (a < b) o percentiles (dos posiciones en [0,100] sobre una referencia explícita), dirección, muestra mínima, estado **Sin calibrar / Calibrado**. Backlog: bandas de edad «0-7, 8-30, 31-», umbrales preocupantes y composición «peor señal» (propuesta desactivada). Client Health: mapeo categórico propuesto. Global: plantilla de severidad con dos límites en [0,1] (sin límites no hay color final).

Un umbral **Calibrado** es una elección del Administrador registrada con autor y motivo; **no** equivale a validación de Dennis de esos valores. Continuar el roadmap no confirma umbrales, mínimos de muestra ni composición.
