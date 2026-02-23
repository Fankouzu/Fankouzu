#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_INPUT_PATH = "dist/usage.json";
const DEFAULT_PERIOD_DAYS = 30;
const SECONDS_PER_DAY = 24 * 60 * 60;
const SVG_WIDTH = 500;
const SVG_HEIGHT = 250;

const OUTPUT_PATHS = {
  light: "dist/openai-usage.svg",
  dark: "dist/openai-usage-dark.svg",
};

// 丰富的主题配色
const THEMES = {
  light: {
    background: "#ffffff",
    backgroundGradientStart: "#f0fdf4",
    backgroundGradientEnd: "#ecfeff",
    text: "#1e293b",
    muted: "#64748b",
    accent: "#10a37f",
    accentLight: "#34d399",
    highlight: "#0ea5e9",
    barTrack: "#e2e8f0",
    border: "#e2e8f0",
    // 统计数字颜色
    tokenColor: "#10a37f",
    requestColor: "#8b5cf6",
    inputColor: "#8b5cf6",
    outputColor: "#10a37f",
  },
  dark: {
    background: "#0d1117",
    backgroundGradientStart: "#0f172a",
    backgroundGradientEnd: "#1e1b4b",
    text: "#f0f6fc",
    muted: "#8b949e",
    accent: "#22c55e",
    accentLight: "#4ade80",
    highlight: "#38bdf8",
    barTrack: "#21262d",
    border: "#30363d",
    // 统计数字颜色
    tokenColor: "#22c55e",
    requestColor: "#a78bfa",
    inputColor: "#a78bfa",
    outputColor: "#22c55e",
  },
};

// 更丰富的模型颜色
const MODEL_COLORS = {
  // GPT-4 系列
  "gpt-4o": "#10a37f",
  "gpt-4o-mini": "#14b8a6",
  "gpt-4-turbo": "#8b5cf6",
  "gpt-4": "#a855f7",
  // GPT-3.5 系列
  "gpt-3.5-turbo": "#f59e0b",
  // GPT-5 系列
  "gpt-5": "#06b6d4",
  "gpt-5.1": "#0ea5e9",
  "gpt-5.2": "#3b82f6",
  // O1 系列
  "o1-preview": "#ef4444",
  "o1": "#ec4899",
  "o1-mini": "#f97316",
  // Codex
  "codex": "#6366f1",
  Others: "#6b7280",
};

function parseArgs(argv) {
  const theme = argv[0];
  if (!theme || theme.startsWith("--")) {
    throw new Error("Usage: render-openai-usage-card.mjs <light|dark> [--input <path>]");
  }

  if (!Object.hasOwn(OUTPUT_PATHS, theme)) {
    throw new Error(`Invalid theme: ${theme}. Expected \"light\" or \"dark\".`);
  }

  let inputPath = DEFAULT_INPUT_PATH;

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--input") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value for --input");
      }
      inputPath = next;
      i += 1;
      continue;
    }

    if (arg.startsWith("--input=")) {
      const value = arg.slice("--input=".length);
      if (!value) {
        throw new Error("Missing value for --input");
      }
      inputPath = value;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    theme,
    inputPath,
    outPath: OUTPUT_PATHS[theme],
  };
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function trimTrailingZeros(value) {
  return value.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

function formatCompactNumber(value) {
  const absolute = Math.abs(value);

  if (absolute >= 1_000_000) {
    const scaled = value / 1_000_000;
    const decimals = Math.abs(scaled) >= 10 ? 1 : 2;
    return `${trimTrailingZeros(scaled.toFixed(decimals))}M`;
  }

  if (absolute >= 1_000) {
    const scaled = value / 1_000;
    const decimals = Math.abs(scaled) >= 100 ? 0 : 1;
    return `${trimTrailingZeros(scaled.toFixed(decimals))}K`;
  }

  return String(Math.round(value));
}

function formatPercent(value) {
  return `${trimTrailingZeros(toNumber(value).toFixed(1))}%`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

// 截断模型名称以避免与条形图重叠
// 可用宽度: x=38 到 x=138 (约 100px), 在 11px 字体下约 14 个字符
const MAX_MODEL_NAME_LENGTH = 14;

function truncateModelName(name) {
  if (name.length <= MAX_MODEL_NAME_LENGTH) {
    return name;
  }
  // 截断并添加省略号
  return name.slice(0, MAX_MODEL_NAME_LENGTH - 1) + "…";
}

function resolvePeriodDays(period, buckets) {
  const days = Number.parseInt(String(period?.days ?? ""), 10);
  if (Number.isFinite(days) && days > 0) {
    return days;
  }

  const periodStart = toNumber(period?.start_time);
  const periodEnd = toNumber(period?.end_time);
  if (periodStart > 0 && periodEnd > periodStart) {
    return Math.max(1, Math.round((periodEnd - periodStart) / SECONDS_PER_DAY));
  }

  if (Array.isArray(buckets) && buckets.length > 0) {
    let minStart = Number.POSITIVE_INFINITY;
    let maxEnd = Number.NEGATIVE_INFINITY;

    for (const bucket of buckets) {
      const start = toNumber(bucket?.start_time);
      const end = toNumber(bucket?.end_time);
      if (start > 0) {
        minStart = Math.min(minStart, start);
      }
      if (end > 0) {
        maxEnd = Math.max(maxEnd, end);
      }
    }

    if (Number.isFinite(minStart) && Number.isFinite(maxEnd) && maxEnd > minStart) {
      return Math.max(1, Math.round((maxEnd - minStart) / SECONDS_PER_DAY));
    }
  }

  return DEFAULT_PERIOD_DAYS;
}

function normalizeModels(modelEntries, totalTokens) {
  const normalized = modelEntries
    .map((item) => {
      const inputTokens = toNumber(item?.input_tokens);
      const outputTokens = toNumber(item?.output_tokens);
      const requests = toNumber(item?.num_model_requests);
      const modelName = String(item?.model ?? "unknown");
      const modelTotal = inputTokens + outputTokens;
      const percentage = totalTokens > 0 ? Number(((modelTotal / totalTokens) * 100).toFixed(1)) : 0;

      return {
        model: modelName,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        num_model_requests: requests,
        total_tokens: modelTotal,
        percentage,
      };
    })
    .sort((a, b) => b.total_tokens - a.total_tokens);

  return normalized;
}

function normalizeAggregatedPayload(payload) {
  const modelEntries = Array.isArray(payload?.models) ? payload.models : [];

  let totalInput = toNumber(payload?.total_input_tokens);
  let totalOutput = toNumber(payload?.total_output_tokens);
  let totalRequests = toNumber(payload?.total_requests);

  if (totalInput === 0 && totalOutput === 0 && totalRequests === 0) {
    for (const entry of modelEntries) {
      totalInput += toNumber(entry?.input_tokens);
      totalOutput += toNumber(entry?.output_tokens);
      totalRequests += toNumber(entry?.num_model_requests);
    }
  }

  let totalTokens = totalInput + totalOutput;
  if (totalTokens === 0) {
    totalTokens = modelEntries.reduce((sum, entry) => {
      return sum + toNumber(entry?.input_tokens) + toNumber(entry?.output_tokens);
    }, 0);
  }

  const models = normalizeModels(modelEntries, totalTokens);
  const periodDays = resolvePeriodDays(payload?.period, []);

  return {
    totalInput,
    totalOutput,
    totalRequests,
    models,
    periodDays,
  };
}

function normalizeRawPayload(payload) {
  const buckets = Array.isArray(payload?.data) ? payload.data : [];
  const modelMap = new Map();

  for (const bucket of buckets) {
    const results = Array.isArray(bucket?.results) ? bucket.results : [];
    for (const result of results) {
      const modelName = String(result?.model ?? "unknown");
      const inputTokens = toNumber(result?.input_tokens);
      const outputTokens = toNumber(result?.output_tokens);
      const requests = toNumber(result?.num_model_requests);

      if (!modelMap.has(modelName)) {
        modelMap.set(modelName, {
          model: modelName,
          input_tokens: 0,
          output_tokens: 0,
          num_model_requests: 0,
        });
      }

      const item = modelMap.get(modelName);
      item.input_tokens += inputTokens;
      item.output_tokens += outputTokens;
      item.num_model_requests += requests;
    }
  }

  const modelEntries = [...modelMap.values()];
  const totalInput = modelEntries.reduce((sum, entry) => sum + entry.input_tokens, 0);
  const totalOutput = modelEntries.reduce((sum, entry) => sum + entry.output_tokens, 0);
  const totalRequests = modelEntries.reduce((sum, entry) => sum + entry.num_model_requests, 0);
  const totalTokens = totalInput + totalOutput;
  const models = normalizeModels(modelEntries, totalTokens);
  const periodDays = resolvePeriodDays(null, buckets);

  return {
    totalInput,
    totalOutput,
    totalRequests,
    models,
    periodDays,
  };
}

function normalizeUsagePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Input JSON must be an object");
  }

  if (Array.isArray(payload.models)) {
    return normalizeAggregatedPayload(payload);
  }

  if (payload.object === "page" || Array.isArray(payload.data)) {
    return normalizeRawPayload(payload);
  }

  throw new Error("Unsupported usage JSON format");
}

function modelColor(modelName) {
  // 1. 精确匹配
  if (MODEL_COLORS[modelName]) {
    return MODEL_COLORS[modelName];
  }

  // 2. 去除日期后缀后匹配（如 gpt-4o-mini-2024-07-18 → gpt-4o-mini）
  const withoutDate = modelName.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  if (MODEL_COLORS[withoutDate]) {
    return MODEL_COLORS[withoutDate];
  }

  // 3. 前缀匹配（如 gpt-5.2-codex → gpt-5.2）
  const prefixes = Object.keys(MODEL_COLORS).filter((k) => k !== "Others").sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    if (modelName.startsWith(prefix)) {
      return MODEL_COLORS[prefix];
    }
  }

  // 4. 默认颜色
  return MODEL_COLORS.Others;
}

function buildChartRows(models) {
  const topFive = models.slice(0, 5);
  const remaining = models.slice(5);

  const rows = topFive.map((item) => ({
    model: item.model,
    percentage: item.percentage,
    color: modelColor(item.model),
  }));

  if (remaining.length > 0) {
    const othersPercentage = remaining.reduce((sum, item) => sum + item.percentage, 0);
    rows.push({
      model: "Others",
      percentage: Number(othersPercentage.toFixed(1)),
      color: MODEL_COLORS.Others,
    });
  }

  return rows;
}

function renderSvgCard(stats, theme) {
  const colors = THEMES[theme];
  const totalTokens = stats.totalInput + stats.totalOutput;
  const subtitle = `Last ${stats.periodDays} days`;
  const chartRows = buildChartRows(stats.models);

  const labelX = 24;
  const barX = 138;
  const barWidth = 250;
  const percentX = 470;
  const rowStartY = 162;
  const rowGap = 16;
  const barHeight = 12;

  // 生成条形图的行，带有颜色指示点和渐变条
  const rowsMarkup = chartRows
    .map((row, index) => {
      const y = rowStartY + index * rowGap;
      const fillWidth = Math.max(0, Math.min(100, row.percentage)) * (barWidth / 100);
      const safeWidth = fillWidth > 0 && fillWidth < 3 ? 3 : fillWidth;
      const gradientId = `barGradient${index}`;

      return [
        // 颜色指示圆点
        `<circle cx="${labelX + 4}" cy="${y}" r="4" fill="${row.color}" />`,
        // 模型名称（带颜色）
        `<text x="${labelX + 14}" y="${y}" fill="${colors.text}" font-size="11" font-weight="500" dominant-baseline="middle" title="${escapeXml(row.model)}">${escapeXml(truncateModelName(row.model))}</text>`,
        // 条形图背景轨道
        `<rect x="${barX}" y="${y - barHeight / 2}" width="${barWidth}" height="${barHeight}" rx="6" fill="${colors.barTrack}" />`,
        // 渐变定义
        `<defs><linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="0%">`,
        `<stop offset="0%" style="stop-color:${row.color};stop-opacity:1" />`,
        `<stop offset="100%" style="stop-color:${row.color};stop-opacity:0.7" />`,
        `</linearGradient></defs>`,
        // 条形图填充
        `<rect x="${barX}" y="${y - barHeight / 2}" width="${safeWidth.toFixed(2)}" height="${barHeight}" rx="6" fill="url(#${gradientId})" />`,
        // 百分比（带强调色）
        `<text x="${percentX}" y="${y}" fill="${row.color}" font-size="11" font-weight="600" text-anchor="end" dominant-baseline="middle">${formatPercent(row.percentage)}</text>`,
      ].join("\n");
    })
    .join("\n");

  // 标题渐变 ID
  const titleGradientId = "titleGradient";
  const bgGradientId = "bgGradient";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- 背景渐变 -->
    <linearGradient id="${bgGradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${colors.backgroundGradientStart};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${colors.backgroundGradientEnd};stop-opacity:1" />
    </linearGradient>
    <!-- 标题渐变 -->
    <linearGradient id="${titleGradientId}" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:${colors.accent};stop-opacity:1" />
      <stop offset="50%" style="stop-color:${colors.highlight};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${colors.accentLight};stop-opacity:1" />
    </linearGradient>
    <!-- Token 数字渐变 -->
    <linearGradient id="tokenGradient" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:${colors.tokenColor};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${colors.outputColor};stop-opacity:1" />
    </linearGradient>
    <!-- Request 数字渐变 -->
    <linearGradient id="requestGradient" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:${colors.requestColor};stop-opacity:1" />
      <stop offset="100%" style="stop-color:#ec4899;stop-opacity:1" />
    </linearGradient>
  </defs>
  
  <!-- 背景 -->
  <rect x="0" y="0" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" rx="12" fill="url(#${bgGradientId})" />
  <!-- 边框 -->
  <rect x="0.5" y="0.5" width="${SVG_WIDTH - 1}" height="${SVG_HEIGHT - 1}" rx="12" stroke="${colors.border}" stroke-width="1" fill="none" />
  
  <g font-family="Segoe UI, Helvetica, Arial, sans-serif">
    <!-- 标题区域 -->
    <!-- OpenAI Logo -->
    <svg x="24" y="14" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z" fill="url(#${titleGradientId})" />
    </svg>
    <text x="52" y="36" fill="url(#${titleGradientId})" font-size="20" font-weight="700">OpenAI</text>
    <text x="126" y="36" fill="${colors.text}" font-size="20" font-weight="600">Usage Stats</text>
    
    <!-- 分隔线 -->
    <line x1="24" y1="66" x2="476" y2="66" stroke="${colors.border}" stroke-width="1" />
    
    <!-- 统计数据区域 -->
    <!-- Total Tokens -->
    <text x="24" y="86" fill="${colors.muted}" font-size="11" font-weight="500">📊 Total Tokens</text>
    <text x="24" y="112" fill="url(#tokenGradient)" font-size="28" font-weight="700">${formatCompactNumber(totalTokens)}</text>
    
    <!-- Input/Output 分解 -->
    <circle cx="28" cy="130" r="4" fill="${colors.inputColor}" />
    <text x="38" y="130" fill="${colors.inputColor}" font-size="11" font-weight="500" dominant-baseline="middle">${formatCompactNumber(stats.totalInput)} input</text>
    <circle cx="138" cy="130" r="4" fill="${colors.outputColor}" />
    <text x="148" y="130" fill="${colors.outputColor}" font-size="11" font-weight="500" dominant-baseline="middle">${formatCompactNumber(stats.totalOutput)} output</text>
    
    <!-- Requests -->
    <text x="300" y="86" fill="${colors.muted}" font-size="11" font-weight="500">🔄 Requests</text>
    <text x="300" y="112" fill="url(#requestGradient)" font-size="28" font-weight="700">${formatCompactNumber(stats.totalRequests)}</text>
    
    <!-- 分隔线 -->
    <line x1="24" y1="146" x2="476" y2="146" stroke="${colors.border}" stroke-width="1" />
    
    <!-- 模型分布 -->
    ${rowsMarkup}
  </g>
</svg>
`;
}

async function loadJson(filePath) {
  const content = await readFile(filePath, "utf8");
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in ${filePath}`);
  }
}

async function writeSvg(outPath, svg) {
  const absoluteOutPath = path.resolve(outPath);
  await mkdir(path.dirname(absoluteOutPath), { recursive: true });
  await writeFile(absoluteOutPath, svg, "utf8");
}

async function main() {
  const { theme, inputPath, outPath } = parseArgs(process.argv.slice(2));
  const payload = await loadJson(inputPath);
  const normalized = normalizeUsagePayload(payload);
  const svg = renderSvgCard(normalized, theme);
  await writeSvg(outPath, svg);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Failed to render OpenAI usage card: ${message}`);
  process.exitCode = 1;
});
