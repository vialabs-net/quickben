---
"@quickben/plugin-doc-reader": patch
---

Review helpers score a run's reads live: `sampleFieldViews` uses today's expected value and the definition's rules (the run's expected value stays as `runExpected`), and `errorsBySample` and `runProblems` take `current` (a definition and expected values by sample) to do the same. New `liveResults`.
