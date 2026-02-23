# OpenAI Usage Stats GitHub Action

## TL;DR

> **Quick Summary**: 创建 GitHub Action，通过 OpenAI Admin API 获取各模型的 Token 使用量，生成美观的统计卡片 SVG（亮/暗双主题），用于装饰 GitHub Profile 页面。
> 
> **Deliverables**:
> - GitHub Action workflow (`.github/workflows/openai-usage.yml`)
> - 数据获取脚本 (`scripts/fetch-openai-usage.mjs`)
> - SVG 生成脚本 (`scripts/render-openai-usage-card.mjs`)
> - 测试 fixture (`fixtures/usage-completions.sample.json`)
> - 亮/暗主题 SVG 输出
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Workflow → Scripts → Integration

---

## Context

### Original Request
创建 GitHub Action，通过 GitHub 环境变量输入 OpenAI 的 admin key，获取当前用户在 OpenAI 所有 AI 大模型的使用量，将使用量制作成美观的 SVG 图片保存在 output 分支中，用于装饰 GitHub 个人 profile 页面。

### Interview Summary
**Key Discussions**:
- 时间范围：作为变量配置（默认 30 天）
- SVG 样式：统计卡片风格
- 显示指标：核心指标（总Token数 + 各模型分布 Top 5 + Others）
- 主题支持：亮色 + 暗色双版本
- 执行频率：每天自动运行

**Research Findings**:
- API 端点: `GET https://api.openai.com/v1/organization/usage/completions`
- 认证方式: Bearer Token (Admin Key)
- 关键参数: `start_time`, `group_by=["model"]`, `bucket_width="1d"`
- 返回字段: `input_tokens`, `output_tokens`, `num_model_requests`
- 分页: 支持 `page`/`next_page`/`has_more`

### Metis Review
**Identified Gaps** (addressed):
- **数据口径**: 仅使用 completions endpoint，排除 embeddings/images
- **并发写风险**: 使用 `crazy-max/ghaction-github-pages` 的 `keep_history: true` 保留既有文件
- **分页处理**: 脚本需循环处理 `has_more` 和 `next_page`
- **模型爆炸**: 采用 Top 5 + Others 策略，自适应布局
- **空数据处理**: 无数据时生成 "0 tokens" 卡片

---

## Work Objectives

### Core Objective
创建完整的 GitHub Action 自动化流程，从 OpenAI API 获取使用量数据并生成美观的统计卡片 SVG。

### Concrete Deliverables
- `.github/workflows/openai-usage.yml` - GitHub Action 配置
- `scripts/fetch-openai-usage.mjs` - Node.js 数据获取脚本
- `scripts/render-openai-usage-card.mjs` - SVG 渲染脚本
- `fixtures/usage-completions.sample.json` - 测试数据
- `dist/openai-usage.svg` - 亮色主题 SVG
- `dist/openai-usage-dark.svg` - 暗色主题 SVG

### Definition of Done
- [ ] Workflow 可通过手动触发运行
- [ ] Workflow 按计划每天自动运行
- [ ] 生成的 SVG 在 output 分支可见
- [ ] README.md 可正确引用生成的 SVG

### Must Have
- OpenAI Admin Key 通过 GitHub Secrets 配置
- 统计卡片展示总 Token 数（input + output）
- 各模型分布（Top 5 + Others）
- 亮色/暗色双主题支持
- 时间范围可配置

### Must NOT Have (Guardrails)
- 不展示 user_id/project_id/api_key_id 维度（隐私风险）
- 不在日志中打印 Admin Key 或完整 API 响应
- 不覆盖 output 分支的现有文件（如 snake SVG）
- 不做 dashboard/多语言/交互图表
- 不引入数据库/缓存等复杂依赖

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: NO（Node.js 脚本，无单元测试框架）
- **Automated tests**: NO
- **Framework**: none
- **Agent-Executed QA**: ALWAYS（验证 SVG 生成和数据获取）

### QA Policy
每个任务包含 agent-executed QA scenarios，验证：
- 脚本执行成功（exit code 0）
- 输出文件存在
- SVG 格式正确（包含 `<svg` 标签）
- 数据聚合逻辑正确

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — 项目结构 + 配置):
├── Task 1: 创建项目目录结构 [quick]
├── Task 2: 创建测试 fixture 数据 [quick]
└── Task 3: 创建 GitHub Action workflow [quick]

Wave 2 (After Wave 1 — 核心脚本):
├── Task 4: 创建数据获取脚本 (fetch-openai-usage.mjs) [deep]
└── Task 5: 创建 SVG 渲染脚本 (render-openai-usage-card.mjs) [visual-engineering]

Wave 3 (After Wave 2 — 集成验证):
├── Task 6: 本地集成测试 [unspecified-high]
└── Task 7: 更新 README.md 引用 [quick]

Wave FINAL (After ALL tasks — independent review):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)

Critical Path: T1 → T4 → T5 → T6 → F1-F4
Parallel Speedup: Wave 1 tasks can run in parallel
Max Concurrent: 3
```

### Dependency Matrix

- **1-3**: — — 4, 5
- **4**: 1, 2 — 5, 6
- **5**: 1, 2 — 6
- **6**: 4, 5 — 7
- **7**: 6 — F1-F4

### Agent Dispatch Summary

- **1**: **3** — T1-T3 → `quick`
- **2**: **2** — T4 → `deep`, T5 → `visual-engineering`
- **3**: **2** — T6 → `unspecified-high`, T7 → `quick`
- **FINAL**: **4** — F1 → `oracle`, F2-F4 → `unspecified-high`/`deep`

---

## TODOs
- [x] 1. 创建项目目录结构

  **What to do**:
  - 创建 `scripts/` 目录存放 Node.js 脚本
  - 创建 `fixtures/` 目录存放测试数据
  - 创建 `dist/` 目录用于输出（添加到 .gitignore）
  - 更新 .gitignore 忽略 dist 目录

  **Must NOT do**:
  - 不修改现有的 .github/workflows/main.yml

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 简单的目录创建任务
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Tasks 4, 5
  - **Blocked By**: None

  **References**:
  - `/.github/workflows/main.yml` - 现有 workflow 结构参考

  **Acceptance Criteria**:
  - [ ] `scripts/` 目录存在
  - [ ] `fixtures/` 目录存在
  - [ ] `.gitignore` 包含 `dist/`

  **QA Scenarios**:
  ```
  Scenario: 目录结构创建成功
    Tool: Bash
    Steps:
      1. ls -la scripts/ fixtures/
      2. grep "dist/" .gitignore
    Expected Result: 目录存在，.gitignore 包含 dist/
    Evidence: .sisyphus/evidence/task-01-dir-structure.txt
  ```

  **Commit**: NO

- [x] 2. 创建测试 fixture 数据

  **What to do**:
  - 创建 `fixtures/usage-completions.sample.json`
  - 包含模拟的 API 响应数据（多个模型）
  - 包含 input_tokens, output_tokens, num_model_requests 字段
  - 用于离线测试 SVG 生成

  **Must NOT do**:
  - 不包含真实的生产数据
  - 不包含敏感信息

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 创建模拟数据文件
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Tasks 4, 5
  - **Blocked By**: None

  **References**:
  - OpenAI API 文档响应格式
  ```json
  {
    "object": "page",
    "data": [{
      "object": "bucket",
      "results": [{
        "model": "gpt-4o",
        "input_tokens": 100000,
        "output_tokens": 50000,
        "num_model_requests": 100
      }]
    }]
  }
  ```

  **Acceptance Criteria**:
  - [ ] `fixtures/usage-completions.sample.json` 存在
  - [ ] JSON 格式正确
  - [ ] 包含至少 5 个模型的模拟数据

  **QA Scenarios**:
  ```
  Scenario: Fixture 文件格式正确
    Tool: Bash
    Steps:
      1. node -e "JSON.parse(require('fs').readFileSync('fixtures/usage-completions.sample.json'))"
      2. cat fixtures/usage-completions.sample.json | grep -c '"model"'
    Expected Result: exit code 0, 模型数量 >= 5
    Evidence: .sisyphus/evidence/task-02-fixture.txt
  ```

  **Commit**: NO

- [x] 3. 创建 GitHub Action workflow

  **What to do**:
  - 创建 `.github/workflows/openai-usage.yml`
  - 配置每日 cron 触发 + 手动触发
  - 配置环境变量 `OPENAI_ADMIN_KEY` 从 Secrets 读取
  - 配置 `LAST_N_DAYS` 输入参数（默认 30）
  - 使用 Node.js 环境运行脚本
  - 使用 `crazy-max/ghaction-github-pages@v3` 推送到 output 分支
  - **关键**: 设置 `keep_history: true` 保留现有文件

  **Must NOT do**:
  - 不在 master push 时触发（避免循环）
  - 不在日志中打印 secrets

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 创建配置文件
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Tasks 4, 5
  - **Blocked By**: None

  **References**:
  - `/.github/workflows/main.yml` - 现有 workflow 结构参考

  **Acceptance Criteria**:
  - [ ] workflow 文件语法正确
  - [ ] 包含 schedule + workflow_dispatch 触发
  - [ ] 使用 `keep_history: true`

  **QA Scenarios**:
  ```
  Scenario: Workflow 语法验证
    Tool: Bash
    Steps:
      1. python3 -c "import yaml; yaml.safe_load(open('.github/workflows/openai-usage.yml'))"
    Expected Result: exit code 0
    Evidence: .sisyphus/evidence/task-03-workflow.txt
  ```

  **Commit**: NO


- [x] 4. 创建数据获取脚本 (fetch-openai-usage.mjs)

  **What to do**:
  - 创建 `scripts/fetch-openai-usage.mjs` (ES Module)
  - 使用原生 fetch 调用 OpenAI API
  - 支持命令行参数：`--start_time`, `--end_time`, `--group_by`, `--bucket_width`, `--out`
  - 处理分页：循环读取 `has_more` 和 `next_page`
  - 聚合数据：按模型汇总 input_tokens, output_tokens, num_model_requests
  - 输出 JSON 格式的聚合结果
  - 错误处理：API 失败时优雅退出，不打印敏感信息

  **Must NOT do**:
  - 不在 console.log 中打印完整响应或 API Key
  - 不硬编码 API Key

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 需要处理 API 调用、分页、数据聚合逻辑
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 5, 6
  - **Blocked By**: Tasks 1, 2

  **References**:
  - API: `GET https://api.openai.com/v1/organization/usage/completions`
  - 认证: `Authorization: Bearer $OPENAI_ADMIN_KEY`
  - 分页: 响应中的 `has_more`, `next_page` 字段

  **Acceptance Criteria**:
  - [ ] 脚本可执行，exit code 0 表示成功
  - [ ] 支持 `--dry-run` 模式使用 fixture 数据
  - [ ] 输出 JSON 包含聚合后的模型数据
  - [ ] 处理空数据情况

  **QA Scenarios**:
  ```
  Scenario: 脚本 dry-run 模式
    Tool: Bash
    Steps:
      1. node scripts/fetch-openai-usage.mjs --dry-run --out test-output.json
      2. cat test-output.json | grep -c '"model"'
    Expected Result: exit code 0, 输出文件包含模型数据
    Evidence: .sisyphus/evidence/task-04-fetch-script.txt

  Scenario: 处理空数据
    Tool: Bash
    Steps:
      1. node scripts/fetch-openai-usage.mjs --dry-run --empty --out empty-output.json
      2. cat empty-output.json | grep '"total_tokens": 0'
    Expected Result: exit code 0, 输出显示 0 tokens
    Evidence: .sisyphus/evidence/task-04-empty-data.txt
  ```

  **Commit**: NO

- [x] 5. 创建 SVG 渲染脚本 (render-openai-usage-card.mjs)

  **What to do**:
  - 创建 `scripts/render-openai-usage-card.mjs`
  - 读取聚合后的 JSON 数据
  - 生成统计卡片风格的 SVG
  - 支持 `--theme` 参数 (light/dark)
  - 卡片内容：
    - 标题："OpenAI Usage Stats"
    - 总 Token 数（格式化：1.2M）
    - 总请求数
    - Top 5 模型分布（条形图/百分比）
    - Others 汇总
  - 美观设计：
    - 圆角卡片
    - 渐变背景
    - 模型图标/颜色区分
    - 亮/暗主题配色

  **Must NOT do**:
  - 不引入重型依赖（不用 D3.js，用字符串拼接）
  - 不生成过大的 SVG 文件

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: 需要设计美观的 SVG 视觉效果
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: 设计美观的卡片布局和配色

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 6
  - **Blocked By**: Tasks 1, 2

  **References**:
  - 参考 GitHub Stats Card 风格
  - 亮色主题：白色背景，深色文字
  - 暗色主题：深色背景，浅色文字

  **Acceptance Criteria**:
  - [ ] 生成有效的 SVG 文件
  - [ ] 包含总 Token 数显示
  - [ ] 包含 Top 5 模型分布
  - [ ] 亮/暗主题正确切换
  - [ ] SVG 尺寸适中（约 400x200）

  **QA Scenarios**:
  ```
  Scenario: SVG 生成 - 亮色主题
    Tool: Bash
    Steps:
      1. node scripts/render-openai-usage-card.mjs --input fixtures/usage-completions.sample.json --out dist/openai-usage.svg --theme light
      2. grep '<svg' dist/openai-usage.svg
      3. grep 'Total Tokens' dist/openai-usage.svg
    Expected Result: exit code 0, SVG 包含正确内容
    Evidence: .sisyphus/evidence/task-05-svg-light.txt

  Scenario: SVG 生成 - 暗色主题
    Tool: Bash
    Steps:
      1. node scripts/render-openai-usage-card.mjs --input fixtures/usage-completions.sample.json --out dist/openai-usage-dark.svg --theme dark
      2. grep '#0d1117' dist/openai-usage-dark.svg  # GitHub 暗色背景
    Expected Result: exit code 0, SVG 使用暗色配色
    Evidence: .sisyphus/evidence/task-05-svg-dark.txt
  ```

  **Commit**: NO

- [x] 6. 本地集成测试

  **What to do**:
  - 在本地运行完整流程
  - 使用 fixture 数据模拟 API 响应
  - 验证两个 SVG 文件生成成功
  - 检查 SVG 文件内容和格式

  **Must NOT do**:
  - 不在本地使用真实 API Key 测试

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 集成测试需要仔细验证
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 7
  - **Blocked By**: Tasks 4, 5

  **References**:
  - `scripts/fetch-openai-usage.mjs`
  - `scripts/render-openai-usage-card.mjs`

  **Acceptance Criteria**:
  - [ ] `dist/openai-usage.svg` 存在且有效
  - [ ] `dist/openai-usage-dark.svg` 存在且有效
  - [ ] 两个 SVG 内容不同（主题差异）

  **QA Scenarios**:
  ```
  Scenario: 完整流程测试
    Tool: Bash
    Steps:
      1. node scripts/fetch-openai-usage.mjs --dry-run --out dist/usage.json
      2. node scripts/render-openai-usage-card.mjs --input dist/usage.json --out dist/openai-usage.svg --theme light
      3. node scripts/render-openai-usage-card.mjs --input dist/usage.json --out dist/openai-usage-dark.svg --theme dark
      4. ls -la dist/*.svg
    Expected Result: 两个 SVG 文件存在，大小 > 1KB
    Evidence: .sisyphus/evidence/task-06-integration.txt
  ```

  **Commit**: NO

- [x] 7. 更新 README.md 引用

  **What to do**:
  - 在 README.md 中添加 OpenAI Usage Stats 卡片引用
  - 使用 `<picture>` 标签支持亮/暗主题切换
  - 参考 snake animation 的引用方式

  **Must NOT do**:
  - 不删除现有的内容

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 简单的 README 编辑
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3
  - **Blocks**: F1-F4
  - **Blocked By**: Task 6

  **References**:
  - `/README.md` - 现有结构
  - `<picture>` 标签模式（参考 snake）

  **Acceptance Criteria**:
  - [ ] README.md 包含 OpenAI Usage 卡片
  - [ ] 使用 `<picture>` 标签支持主题切换
  - [ ] 引用 `output` 分支的 SVG 文件

  **QA Scenarios**:
  ```
  Scenario: README 包含正确引用
    Tool: Bash
    Steps:
      1. grep 'openai-usage.svg' README.md
      2. grep 'prefers-color-scheme' README.md
    Expected Result: README 包含正确的引用和主题切换
    Evidence: .sisyphus/evidence/task-07-readme.txt
  ```

  **Commit**: YES
  - Message: `feat: add OpenAI usage stats GitHub Action`
  - Files: All new files
  - Pre-commit: Verify all scripts work


---

## Final Verification Wave (MANDATORY)

- [ ] F1. **Plan Compliance Audit** — `oracle`
  验证所有 "Must Have" 已实现，所有 "Must NOT Have" 未出现。检查 evidence 文件存在。

- [ ] F2. **Code Quality Review** — `unspecified-high`
  检查代码中无敏感信息泄露、无 console.log 打印密钥、错误处理完善。

- [ ] F3. **Real Manual QA** — `unspecified-high`
  本地运行脚本，验证 SVG 生成正确；检查 output 分支文件。

- [ ] F4. **Scope Fidelity Check** — `deep`
  确认实现范围未超出需求，无功能蔓延。

---

## Commit Strategy

- **Single Commit**: `feat: add OpenAI usage stats GitHub Action`
- **Files**: All new files in single commit

---

## Success Criteria

### Verification Commands
```bash
# 本地测试（使用 fixture）
node scripts/fetch-openai-usage.mjs --dry-run --out usage.json
node scripts/render-openai-usage-card.mjs --input fixtures/usage-completions.sample.json --out dist/openai-usage.svg --theme light
ls dist/openai-usage.svg  # 应存在

# 检查 SVG 格式
grep "<svg" dist/openai-usage.svg  # 应有输出
```

### Final Checklist
- [ ] Workflow 文件语法正确
- [ ] 数据获取脚本可运行
- [ ] SVG 渲染正确
- [ ] 双主题生成
- [ ] output 分支推送正常
- [ ] README 引用正确
