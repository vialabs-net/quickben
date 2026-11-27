---
"@quickben/plugin-doc-reader": patch
---

`phone` fields take a default country (`phoneCountry`, ISO 3166): read and expected values become E.164 (`+56912345678`) before they are compared, and extractors return E.164. Numbers that do not fit the country's plan stay as digits. Fields take their own `emptyValues` (e.g. a system placeholder `1`). `correctExpectedBulk` accepts `values` by sample id, so each sample can get its own value.
