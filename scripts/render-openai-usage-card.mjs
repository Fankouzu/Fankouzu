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

const THEMES = {
  light: {
    background: "#f6f8fa",
    text: "#24292f",
    muted: "#57606a",
    barTrack: "#eaeef2",
  },
  dark: {
    background: "#0d1117",
    text: "#f0f6fc",
    muted: "#8b949e",
    barTrack: "#21262d",
  },
};

const MODEL_COLORS = {
  "gpt-4o": "#10a37f",
  "gpt-4o-mini": "#1a7f64",
  "gpt-4-turbo": "#ab68ff",
  "gpt-3.5-turbo": "#74aa9c",
  "o1-preview": "#ff6b6b",
  Others: "#6e7681",
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
  return MODEL_COLORS[modelName] ?? MODEL_COLORS.Others;
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
  const rowStartY = 156;
  const rowGap = 16;
  const barHeight = 10;

  const rowsMarkup = chartRows
    .map((row, index) => {
      const y = rowStartY + index * rowGap;
      const fillWidth = Math.max(0, Math.min(100, row.percentage)) * (barWidth / 100);
      const safeWidth = fillWidth > 0 && fillWidth < 2 ? 2 : fillWidth;

      return [
        `<text x="${labelX}" y="${y}" fill="${colors.muted}" font-size="11" dominant-baseline="middle">${escapeXml(row.model)}</text>`,
        `<rect x="${barX}" y="${y - barHeight / 2}" width="${barWidth}" height="${barHeight}" rx="5" fill="${colors.barTrack}" />`,
        `<rect x="${barX}" y="${y - barHeight / 2}" width="${safeWidth.toFixed(2)}" height="${barHeight}" rx="5" fill="${row.color}" />`,
        `<text x="${percentX}" y="${y}" fill="${colors.muted}" font-size="11" text-anchor="end" dominant-baseline="middle">${formatPercent(row.percentage)}</text>`,
      ].join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" rx="12" fill="${colors.background}" />
  <g font-family="Segoe UI, Helvetica, Arial, sans-serif">
    <text x="24" y="38" fill="${colors.text}" font-size="20" font-weight="700">OpenAI Usage Stats</text>
    <text x="24" y="56" fill="${colors.muted}" font-size="12">${escapeXml(subtitle)}</text>

    <text x="24" y="84" fill="${colors.muted}" font-size="11">Total Tokens</text>
    <text x="24" y="106" fill="${colors.text}" font-size="24" font-weight="700">${formatCompactNumber(totalTokens)}</text>
    <text x="24" y="123" fill="${colors.muted}" font-size="12">${formatCompactNumber(stats.totalInput)} input, ${formatCompactNumber(stats.totalOutput)} output</text>

    <text x="350" y="84" fill="${colors.muted}" font-size="11">Requests</text>
    <text x="350" y="106" fill="${colors.text}" font-size="24" font-weight="700">${formatCompactNumber(stats.totalRequests)}</text>

    <text x="24" y="141" fill="${colors.muted}" font-size="11">Top Models</text>
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
