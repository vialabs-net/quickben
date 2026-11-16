---
"@quickben/admin": patch
"@quickben/plugin-connections": patch
---

Connection and credential pages use the width they get.

| Change                                                                                                                                                                                                                                                                             | Where                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| The row editor sizes columns to their inputs: text and select columns share the free width, numbers stay compact, checkboxes take their header's width, and headers wrap. With the built-in model columns and one host column it fits in about 960 px and scrolls only below that. | `@quickben/admin`              |
| The side card ("Status") sits next to the form when the content box is at least 80rem wide, else below it. The form takes the rest of the width. The breakpoint is a container query, so it follows the host's column, not the viewport.                                           | `@quickben/plugin-connections` |
| One header row: the mark, the title over the subtitle, and the actions. With `pageTitle: "none"` the mark, the subtitle and the actions stay on one line. Credential pages get a key mark.                                                                                         | `@quickben/plugin-connections` |
