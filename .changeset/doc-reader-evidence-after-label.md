---
"@quickben/plugin-doc-reader": patch
---

Evidence boxes: when the read value is not in the PDF text, the value after the label in the model's evidence (`Tipo de Combustible : Gasolina` → `Gasolina`) is searched before the whole evidence, so the box lands on the printed value instead of the model's guess.
