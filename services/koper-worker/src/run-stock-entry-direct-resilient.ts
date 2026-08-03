const originalFetch = globalThis.fetch.bind(globalThis);

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

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const stage = safeStage(input);
  let lastError: unknown = null;

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
};

await import("./stock-entry-direct-staging-job.js");
