# Cargas separadas de producto: VFS y VSW

## Perfiles CSV comprobados

| Perfil elegido por Dennis | Campos fuente |
| --- | --- |
| VFS | Work Item Type, ID, Title, Created By, Created Date, Assigned To, State, Area Path, Tags, Comment Count, Changed Date, Reported by, Zendesk Ticket ID |
| VSW | ID, Work Item Type, Title, Assigned To, State, Tags, Created By, Created Date, Zendesk Ticket ID, Clients |

CSV UTF8 con BOM, coma como delimitador y campos citados. Parser que respete comas, saltos y comillas interiores. Fechas observadas dd/m/yyyy HH:mm:ss. Validar cabeceras por contenido. Las cargas aparecen separadas en Administración y no se deduce el producto del título. Este perfil no es la facturación anual y no usa su reemplazo destructivo.

BUG 01. Identidad estable por producto/ámbito de proyecto y Work Item ID. Conservar todos los tipos; solo Work Item Type=Bug_ participa en defectos. VFS de ejemplo: 82 filas, 79 Bug_. VSW ampliado: 145 filas, 128 Bug_, 3 Enhancement y 14 Request. Incluye 53 elementos creados en 2025 y 92 en 2026; entre Bug_, 45 son 2025 y 83 de 2026. No descartar años por el nombre del export.

## Estados

BUG 02. Preservar estado original. PR confirmado por Dennis: desarrollo finalizado en rama de desarrollo, pendiente de crear la pull request. No equivale a PR en revisión, merge o producción. Done (Ready for Release) conserva una etapa pendiente de entrega; no prueba despliegue en clientes. New, Selected, In Progress y Blocked se desglosan. Un catálogo configurable identifica etapas y estados terminales explícitos; un desconocido requiere revisión y nunca se cierra por conjetura. No mezclar State de producto con status Zendesk.

BUG 03. Los 128 Bug_ VSW observados son New 65, In Progress 11, PR 21, Done (Ready for Release) 28 y Selected 3. Los cinco Done del archivo son Request. No usar esos cinco como bugs resueltos ni afirmar que el extracto anual contiene todos los cierres históricos.

## Reimportación y alcance

BUG 04. Dennis prueba ambas cargas; la base comienza sin bugs reales precargados. Actualizar por identidad, deduplicar filas idénticas y conservar revisiones, estado observado, lotes y vínculos. Los perfiles admiten listados abiertos o vistas por intervalo, declarando alcance y fecha de extracción. No exigir un año único cuando el archivo legítimamente abarca varios. La presencia en la fotografía y la entidad histórica son cosas distintas.

BUG 05. La ausencia en otro export no borra el bug, no lo cierra y no inventa fecha de resolución/despliegue. Una vista más estrecha no reduce silenciosamente la cobertura de otra más amplia. Comparar fotografías de igual ámbito solo si su alcance está declarado; etiquetar datos fuera de la fotografía actual como no observados en esa vista y mostrar la antigüedad de la última observación, sin adjudicarles estado vigente confirmado. No sumar los mismos IDs por repetir la carga. Cargar VSW no modifica VFS.

## Relación con clientes

BUG 06. Zendesk Ticket ID se resuelve contra ticket_id. Un ticket interno VINCLE BUGS u otro interno es el central, no una asignación a toda la cartera. Si es un ticket externo registrado, queda el vínculo explícito a su Cliente/Grupo Cliente.

BUG 07. Clients puede contener HTML y Markdown. Extraer IDs únicamente de URLs de tickets Zendesk reconocidas; deduplicar. No ejecutar HTML ni visitar enlaces. Menciones con href=# no son tickets. Un ID aún no cargado o una organización nueva se conserva para resolución posterior y se resume en el lote; no bloquea el resto válido.

BUG 08. Nombres en Clients o Reported by son contexto o propuestas de alias revisables. No atribuir automáticamente por título ni asumir que el informante es todo el conjunto afectado. Un problema puede tener varios bugs y un bug varios problemas/clientes. La relación no cambia por sí sola la causa raíz del ticket.

## Salidas

Calidad contiene stock observado de bugs por producto/estado, antigüedad desde Created Date, cobertura del listado, ticket central, vínculos externos y registros sin afectación identificada. Los flujos por fecha de creación se distinguen de ese stock. El sexto indicador cuenta problemas de cliente según el contrato de Calidad, no Work Items multiplicados por vínculos. Los listados son muestras para diseñar; la primera carga real corresponde a Dennis.
