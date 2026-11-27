---
"@quickben/admin": patch
"@quickben/plugin-templates": patch
---

Native selects inside `.qb-root` hide the browser's arrow and draw their own chevron at the inline end (also in right-to-left text), with the same space before the text and after the chevron. New theme tokens `--qb-select-chevron`, `--qb-select-chevron-inset` and `--qb-select-chevron-space` (`selectChevron`, `selectChevronInset`, `selectChevronSpace` in `theme`). `multiple` and `size` > 1 selects keep the native look. `Select` gains `inline`, a borderless select for a pill with its own padding. The templates editor's selects keep the chevron clear of their text.
