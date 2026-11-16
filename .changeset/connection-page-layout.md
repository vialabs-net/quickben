---
"@quickben/admin": patch
"@quickben/plugin-connections": patch
---

Connection and credential pages use the width they have. The form takes the free width and the status card stays 17rem; under 84rem of container width (an admin embedded in a host's settings column) the status card goes under the form. The models row editor sizes its inputs to their content: id and name columns share the free width, numbers and checkboxes stay narrow, headers wrap. It scrolls only when the columns still do not fit. The page header has the provider mark (a key on credential pages) next to the title, the provider under it, and the actions on the same line. New CSS classes in `@quickben/admin/styles.css`: `qb-detail` and `qb-detail-columns`.
