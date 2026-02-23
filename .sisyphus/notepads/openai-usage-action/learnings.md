## 2026-02-24
- Rendering script can support both aggregated usage JSON and raw OpenAI usage page JSON by normalizing into one internal shape.
- SVG output remains compact and readable with fixed `500x250` layout, a shared system font stack, and per-theme color tokens.
- Compact number formatting works well for dashboard cards when using `M` and `K` suffixes with trimmed trailing zeros.
- Local integration test checklist: render both themes; assert SVG exists (>1KB), contains `<svg` and `OpenAI Usage Stats`, light uses `#f6f8fa`, dark uses `#0d1117`, and values from `dist/usage.json` (totals + per-model percentages) appear in both SVGs.
- When running ad-hoc Node checks in zsh, prefer wrapping `node -e` content in single quotes to avoid `${...}` shell expansion.
## README Update
- Successfully added OpenAI Usage Stats card to README.md.
- Used <picture> tag for theme support.
- Referenced output branch for SVG files.
