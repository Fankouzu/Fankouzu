#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const API_URL = "https://api.openai.com/v1/organization/usage/completions";
const DEFAULT_OUT_PATH = "dist/usage.json";
const DEFAULT_LAST_N_DAYS = 30;
const SECONDS_PER_DAY = 24 * 60 * 60;
const FIXTURE_PATH = "fixtures/usage-completions.sample.json";

function parseArgs(argv) {
  let outPath = DEFAULT_OUT_PATH;
  let dryRun = false;
  let empty = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--empty") {
      empty = true;
      continue;
    }
    if (arg === "--out") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value for --out");
      }
      outPath = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--out=")) {
      const value = arg.slice("--out=".length);
      if (!value) {
        throw new Error("Missing value for --out");
      }
      outPath = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { outPath, dryRun, empty };
}

function getPeriod(daysRaw) {
  const parsed = Number.parseInt(daysRaw ?? "", 10);
  const days = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LAST_N_DAYS;
  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - days * SECONDS_PER_DAY;
  return { startTime, endTime, days };
}

async function fetchUsagePages({ startTime, endTime, adminKey }) {
  const allBuckets = [];
  let nextPage = null;

  while (true) {
    const params = new URLSearchParams();
    params.set("start_time", String(startTime));
    params.set("end_time", String(endTime));
    params.append("group_by[]", "model");
    params.set("bucket_width", "1d");
    params.set("limit", "31");
    if (nextPage) {
      params.set("page", nextPage);
    }

    const res = await fetch(`${API_URL}?${params.toString()}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${adminKey}`,
      },
    });

    if (!res.ok) {
      throw new Error(`OpenAI API request failed with status ${res.status}`);
    }

    const payload = await res.json();
    const data = Array.isArray(payload?.data) ? payload.data : [];
    allBuckets.push(...data);

    if (!payload?.has_more || !payload?.next_page) {
      break;
    }
    nextPage = payload.next_page;
  }

  return allBuckets;
}

async function loadDryRunBuckets(empty) {
  if (empty) {
    return [];
  }
  const fixtureText = await readFile(FIXTURE_PATH, "utf8");
  const fixture = JSON.parse(fixtureText);
  return Array.isArray(fixture?.data) ? fixture.data : [];
}

function aggregateUsage(buckets, period) {
  const modelMap = new Map();

  for (const bucket of buckets) {
    const results = Array.isArray(bucket?.results) ? bucket.results : [];
    for (const result of results) {
      const modelName = result?.model ?? "unknown";
      const inputTokens = Number(result?.input_tokens) || 0;
      const outputTokens = Number(result?.output_tokens) || 0;
      const requests = Number(result?.num_model_requests) || 0;

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

  const models = [...modelMap.values()]
    .map((item) => ({
      ...item,
      total_tokens: item.input_tokens + item.output_tokens,
    }))
    .sort((a, b) => b.total_tokens - a.total_tokens);

  const totalInput = models.reduce((sum, item) => sum + item.input_tokens, 0);
  const totalOutput = models.reduce((sum, item) => sum + item.output_tokens, 0);
  const totalRequests = models.reduce((sum, item) => sum + item.num_model_requests, 0);
  const totalTokens = totalInput + totalOutput;

  const normalizedModels = models.map(({ total_tokens: modelTotalTokens, ...item }) => ({
    ...item,
    percentage: totalTokens === 0 ? 0 : Number(((modelTotalTokens / totalTokens) * 100).toFixed(1)),
  }));

  return {
    total_input_tokens: totalInput,
    total_output_tokens: totalOutput,
    total_requests: totalRequests,
    models: normalizedModels,
    period: {
      start_time: period.startTime,
      end_time: period.endTime,
      days: period.days,
    },
  };
}

async function writeOutput(outPath, payload) {
  const absolutePath = path.resolve(outPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  const { outPath, dryRun, empty } = parseArgs(process.argv.slice(2));
  const period = getPeriod(process.env.LAST_N_DAYS);

  let buckets;
  if (dryRun) {
    buckets = await loadDryRunBuckets(empty);
  } else {
    const adminKey = process.env.OPENAI_ADMIN_KEY;
    if (!adminKey) {
      throw new Error("OPENAI_ADMIN_KEY is required unless --dry-run is set");
    }
    buckets = await fetchUsagePages({
      startTime: period.startTime,
      endTime: period.endTime,
      adminKey,
    });
  }

  const aggregated = aggregateUsage(buckets, period);
  await writeOutput(outPath, aggregated);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Failed to fetch OpenAI usage: ${message}`);
  process.exitCode = 1;
});
