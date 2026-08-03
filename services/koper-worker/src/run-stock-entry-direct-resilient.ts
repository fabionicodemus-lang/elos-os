const originalFetch = globalThis.fetch.bind(globalThis);
const runnerStartedAt = Date.now();
let totalRequests = 0;
let activeRequests = 0;
let lastStage = "startup";
let lastCompletedStage: string | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function safeStage(input: RequestInfo | URL): string {
  try {
    const raw = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const url = new URL(raw);
    return url.pathname;
  } catch {
    return "unknown";
  }
}

async function readResponseBody(response: Response, timeoutMs: number): Promise<ArrayBuffer> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      response.arrayBuffer(),
      new Promise<ArrayBuffer>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("response_body_timeout")), timeoutMs);
      }),
    ]);
  } catch (error: unknown) {
    await response.body?.cancel().catch(() => undefined);
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function bufferedResponse(response: Response, body: ArrayBuffer): Response {
  return new Response(body.byteLength > 0 ? body : null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

console.log("KOPER_STOCK_ENTRY_RUNNER_STARTED", JSON.stringify({
  batchOffset: process.env.KOPER_STOCK_ENTRY_BATCH_OFFSET ?? null,
  batchSize: process.env.KOPER_STOCK_ENTRY_BATCH_SIZE ?? null,
  concurrency: process.env.KOPER_STOCK_ENTRY_HTTP_CONCURRENCY ?? null,
  writeEnabled: process.env.KOPER_STOCK_ENTRY_DIRECT_STAGING_WRITE_ENABLED === "true",
}));

const heartbeat = setInterval(() => {
  console.log("KOPER_STOCK_ENTRY_RUNNER_HEARTBEAT", JSON.stringify({
    elapsedSeconds: Math.round((Date.now() - runnerStartedAt) / 1_000),
    totalRequests,
    activeRequests,
    lastStage,
    lastCompletedStage,
  }));
}, 30_000);

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const stage = safeStage(input);
  totalRequests += 1;
  activeRequests += 1;
  lastStage = stage;
  let lastError: unknown = null;

  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await originalFetch(input, {
          ...init,
          signal: AbortSignal.timeout(45_000),
        });
        const body = await readResponseBody(response, 45_000);
        const completeResponse = bufferedResponse(response, body);
        if (!retryableStatus(response.status) || attempt === 3) return completeResponse;
        console.warn("KOPER_HTTP_RETRY", JSON.stringify({ stage, attempt, status: response.status }));
      } catch (error: unknown) {
        lastError = error;
        const message = error instanceof Error ? error.message : "unknown";
        const reason = /response_body_timeout/i.test(message)
          ? "body_timeout"
          : /timeout|abort/i.test(message)
            ? "timeout"
            : "network";
        console.warn("KOPER_HTTP_RETRY", JSON.stringify({ stage, attempt, reason }));
        if (attempt === 3) throw new Error(`KOPER_HTTP_FAILED:${stage}:${reason}`);
      }
      await delay(500 * attempt);
    }

    throw lastError instanceof Error ? lastError : new Error(`KOPER_HTTP_FAILED:${stage}:unknown`);
  } finally {
    activeRequests -= 1;
    lastCompletedStage = stage;
  }
};

try {
  await import("./stock-entry-direct-staging-job.js");
} finally {
  clearInterval(heartbeat);
  console.log("KOPER_STOCK_ENTRY_RUNNER_FINISHED", JSON.stringify({
    elapsedSeconds: Math.round((Date.now() - runnerStartedAt) / 1_000),
    totalRequests,
    lastStage,
    lastCompletedStage,
  }));
}
