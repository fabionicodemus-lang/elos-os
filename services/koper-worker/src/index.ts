import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loginKoperAutomatically } from "./auth/koper-auto-login.js";
import { env } from "./config/env.js";
import { inspectKoperNavigation } from "./diagnostics/inspect-koper-navigation.js";
import { testBrowserlessConnection } from "./diagnostics/test-browserless.js";

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function isAuthorized(request: IncomingMessage): boolean {
  const received = request.headers.authorization;
  const expected = `Bearer ${env.WORKER_API_KEY}`;

  if (!received) {
    return false;
  }

  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);

  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

function requireAuthorization(
  request: IncomingMessage,
  response: ServerResponse,
): boolean {
  if (isAuthorized(request)) {
    return true;
  }

  sendJson(response, 401, { ok: false, error: "UNAUTHORIZED" });
  return false;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      service: "koper-worker",
      environment: env.NODE_ENV,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (method === "POST" && url.pathname === "/diagnostics/browserless") {
    if (!requireAuthorization(request, response)) {
      return;
    }

    const result = await testBrowserlessConnection();
    sendJson(response, 200, result);
    return;
  }

  if (method === "POST" && url.pathname === "/auth/koper/login") {
    if (!requireAuthorization(request, response)) {
      return;
    }

    const result = await loginKoperAutomatically();
    sendJson(response, result.authenticated ? 200 : 422, result);
    return;
  }

  if (
    method === "POST" &&
    url.pathname === "/diagnostics/koper/navigation"
  ) {
    if (!requireAuthorization(request, response)) {
      return;
    }

    const result = await inspectKoperNavigation();
    sendJson(response, result.authenticated ? 200 : 422, result);
    return;
  }

  sendJson(response, 404, { ok: false, error: "NOT_FOUND" });
}

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Erro desconhecido";

    console.error("koper-worker request failed", {
      method: request.method,
      url: request.url,
      message,
    });

    if (!response.headersSent) {
      sendJson(response, 500, {
        ok: false,
        error: "INTERNAL_ERROR",
        message,
      });
      return;
    }

    response.end();
  });
});

server.listen(env.PORT, "0.0.0.0", () => {
  console.log(`koper-worker listening on port ${env.PORT}`);
});
