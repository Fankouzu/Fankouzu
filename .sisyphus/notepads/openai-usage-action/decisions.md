## 2026-02-24
- Keep the script dependency-free and implemented as a Node.js ES module to match existing scripts.
- Use theme-specific output files: `dist/openai-usage.svg` for light and `dist/openai-usage-dark.svg` for dark.
- Aggregate model usage by token share and render top 5 rows, with an `Others` rollup row only when model count exceeds five.
