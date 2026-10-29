# Contrato Wrike

## CSV observado y causa de la separación

El fichero DETALLESOPORTEN3 tiene BOM UTF8, delimitador coma y seis campos: Usuario, Proyecto, Nombre de la tarea, Ticket Zendesk, Fecha registro y Dedicación (horas). Un parser CSV que respeta comillas lee las 3546 filas con seis campos, también la fila 1078. No se ha observado corrupción del CSV en esa fila. La apertura y separación manual en Excel puede interpretar delimitadores y perder texto; la aplicación leerá el fichero original.

WRK 01. Usar un parser CSV, nunca split por coma. Conservar comas, punto y coma, saltos y comillas escapadas dentro de los campos. Detectar BOM. El separador decimal observado es coma dentro de un valor citado. Leer la fecha como dd/mm/yyyy. Los números de ticket se guardan como identificadores exactos.

## La macro y las unidades

La macro divide E entre 60 y elimina puntos de F. Sirve para un formato previamente reorganizado con minutos en E y ticket en F. No coincide con el CSV actual: E es fecha y F es dedicación en horas. En el importador actual no se divide la dedicación entre 60. Un futuro perfil que declare minutos deberá tener esquema y unidad distintos; no se decide por la magnitud de un número.

WRK 02. Eliminar separadores de millares de un ticket como 216.527 para obtener 216527; conservar cero como ausencia de ticket. No imponer para siempre seis dígitos a todos los IDs ni aplicar esta limpieza al campo de horas.

## Registros sin dedicación

WRK 03. Hay 73 filas con usuario vacío, fecha vacía y dedicación cero. Se consideran filas de tarea sin imputación: conservarlas en el bruto y excluirlas del hecho de dedicación, con motivo visible. No inventar fecha o persona. Una fila con horas positivas y sin fecha sí es un error de validación que debe resolverse.

## Obtención de ticket y cliente

WRK 04. Prioridad confirmada: ticket explícito válido; si falta, ID inequívoco extraído del nombre; si no hay uno único, excluir la vinculación de ticket y mostrar un aviso en el resumen de la carga. El proyecto puede seguir permitiendo la atribución de horas. La fórmula actual del libro hace lo contrario: toma los primeros dígitos del nombre antes del campo explícito. Esa diferencia debe registrarse en la conciliación.

WRK 05. Buscar patrones de ticket, como #123456 o un ID al principio, y validar candidatos contra el catálogo de tickets. Un número de versión, una fecha o un fragmento de código no se convierten en ticket por contener dígitos. Hay 98 nombres con varios candidatos numéricos de 5 a 9 dígitos y 496 filas sin ticket explícito. Esas cifras son avisos de revisión, no 98 errores confirmados. Si se contradicen campo explícito, nombre y organización, mostrar conflicto en vez de elegir silenciosamente.

WRK 06. Resolver grupo cliente mediante el proyecto Wrike aun cuando no exista ticket. Guardar método de asignación. Cuando ticket y proyecto señalan clientes diferentes, dejar conflicto. Sin ticket puede contarse dedicación del proyecto, pero la causa del incidente no está probada.

## Perfil y clasificación

WRK 07. Resolver usuario y rol ANA/DEV con el maestro unificado y la fecha. Solo usar Wrike para PMO desde enero de 2025. La fórmula actual marca toda dedicación DEV como incidente Vincle y asigna customización si no encuentra causa. Es una heurística del libro, no evidencia de causa raíz. Conservar un modo de equivalencia documentado para conciliar históricos; para Calidad, etiquetar como no clasificado salvo regla aprobada. Nunca atribuir bugs por el rol de quien trabaja.

El resultado muestra horas válidas, excluidas, con cliente por proyecto, con ticket confirmado, inferidas y pendientes. Las filas idénticas se deduplican por todos sus campos. Sin ID de entrada de tiempo en el CSV, una modificación requiere la gestión de revisiones del proceso común.
