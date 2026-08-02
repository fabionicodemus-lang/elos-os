import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loginKoperAutomatically } from "./auth/koper-auto-login.js";
import { env } from "./config/env.js";
import { discoverStockRoute } from "./diagnostics/discover-stock-route.js";
import { inspectKoperCompanies, inspectKoperFlowContext } from "./diagnostics/inspect-koper-companies.js";
import { inspectKoperEngineering } from "./diagnostics/inspect-koper-engineering.js";
import { inspectFlowEngineeringStaging } from "./diagnostics/inspect-flow-engineering-staging.js";
import { inspectKoperMenuMap } from "./diagnostics/inspect-koper-menu-map.js";
import { inspectKoperNavigation } from "./diagnostics/inspect-koper-navigation.js";
import { inspectStockRequestDetail } from "./diagnostics/inspect-stock-request-detail.js";
import { inspectStockRequests } from "./diagnostics/inspect-stock-requests.js";
import { runLiveRecording } from "./diagnostics/live-recording.js";
import { previewFlowStaging } from "./diagnostics/preview-flow-staging.js";
import { writeFlowStagingSample } from "./diagnostics/write-flow-staging-sample.js";
import { writeFlowProductSample } from "./diagnostics/write-flow-product-sample.js";
import { writeFlowProductCatalog } from "./diagnostics/write-flow-product-catalog.js";
import { writeFlowServiceCatalog } from "./diagnostics/write-flow-service-catalog.js";
import { writeFlowConstructionBudget } from "./diagnostics/write-flow-construction-budget.js";
import { promoteKoperProducts } from "./diagnostics/promote-koper-products.js";
import { promoteKoperServices } from "./diagnostics/promote-koper-services.js";
import { promoteKoperConstructionBudget } from "./diagnostics/promote-koper-construction-budget.js";
import { checkKoperCompositionPromotionReadiness } from "./diagnostics/check-koper-composition-promotion-readiness.js";
import { promoteKoperBudgetCompositions, promoteKoperBudgetInputs } from "./diagnostics/promote-koper-budget-compositions.js";
import { writeFlowActiveStockRequests } from "./diagnostics/write-flow-stock-requests.js";
import { checkStockRequestPromotionReadiness } from "./diagnostics/check-stock-request-promotion-readiness.js";
import { promoteStockRequestInputs } from "./diagnostics/promote-stock-request-inputs.js";
import { promoteActiveStockRequests } from "./diagnostics/promote-active-stock-requests.js";
import { testBrowserlessConnection } from "./diagnostics/test-browserless.js";
import { checkKoperStagingReadiness } from "./elos/supabase.js";

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

  if (
    method === "POST" &&
    url.pathname === "/diagnostics/koper/menu-map"
  ) {
    if (!requireAuthorization(request, response)) {
      return;
    }

    const result = await inspectKoperMenuMap();
    sendJson(response, result.authenticated ? 200 : 422, result);
    return;
  }

  if (
    method === "POST" &&
    url.pathname === "/diagnostics/koper/stock-requests"
  ) {
    if (!requireAuthorization(request, response)) {
      return;
    }

    const result = await inspectStockRequests();
    sendJson(response, result.authenticated && result.clicked ? 200 : 422, result);
    return;
  }

  if (
    method === "POST" &&
    url.pathname === "/diagnostics/koper/stock-route"
  ) {
    if (!requireAuthorization(request, response)) {
      return;
    }

    const result = await discoverStockRoute();
    sendJson(response, result.authenticated ? 200 : 422, result);
    return;
  }

  if (
    method === "POST" &&
    url.pathname === "/diagnostics/koper/stock-request-detail"
  ) {
    if (!requireAuthorization(request, response)) {
      return;
    }

    const result = await inspectStockRequestDetail();
    sendJson(response, result.authenticated && result.rowClicked ? 200 : 422, result);
    return;
  }

  if (
    method === "POST" &&
    url.pathname === "/diagnostics/koper/companies"
  ) {
    if (!requireAuthorization(request, response)) {
      return;
    }

    const result = await inspectKoperCompanies();
    sendJson(response, result.authenticated ? 200 : 422, result);
    return;
  }

  if (
    method === "POST" &&
    url.pathname === "/diagnostics/koper/flow-context"
  ) {
    if (!requireAuthorization(request, response)) {
      return;
    }

    const result = await inspectKoperFlowContext();
    sendJson(
      response,
      result.authenticated && result.flowSelected ? 200 : 422,
      result,
    );
    return;
  }

  if (
    method === "POST" &&
    url.pathname === "/diagnostics/koper/live-recording"
  ) {
    if (!requireAuthorization(request, response)) {
      return;
    }

    const result = await runLiveRecording();
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

  const startupDiagnostic = process.env.KOPER_STARTUP_DIAGNOSTIC;

  const diagnostic =
    startupDiagnostic === "menu-map"
      ? inspectKoperMenuMap
      : startupDiagnostic === "stock-route"
        ? discoverStockRoute
        : startupDiagnostic === "stock-request-detail"
          ? inspectStockRequestDetail
          : startupDiagnostic === "companies"
            ? inspectKoperCompanies
            : startupDiagnostic === "flow-context"
              ? inspectKoperFlowContext
              : startupDiagnostic === "live-recording"
                ? runLiveRecording
                : startupDiagnostic === "engineering-flow"
                  ? inspectKoperEngineering
                  : startupDiagnostic === "engineering-composition-sample"
                    ? async () => {
                      const result = await inspectKoperEngineering({
                        collectFullBudget: true,
                        collectCompositionSample: true,
                      });
                      return {
                        ok: true,
                        authenticated: result.authenticated,
                        flowSelected: result.flowSelected,
                        fullCompositionDetails: result.fullCompositionDetails ?? [],
                        message: result.message,
                        checkedAt: result.checkedAt,
                      };
                    }
                  : startupDiagnostic === "engineering-staging-inspect"
                    ? inspectFlowEngineeringStaging
                  : startupDiagnostic === "supabase-staging"
                    ? checkKoperStagingReadiness
                  : startupDiagnostic === "staging-preview"
                    ? previewFlowStaging
                    : startupDiagnostic === "staging-write-sample"
                      ? writeFlowStagingSample
                      : startupDiagnostic === "product-staging-write-sample"
                        ? writeFlowProductSample
                        : startupDiagnostic === "product-staging-write-full"
                          ? writeFlowProductCatalog
                          : startupDiagnostic === "budget-staging-write-full"
                            ? writeFlowConstructionBudget
                            : startupDiagnostic === "service-staging-write-full"
                              ? writeFlowServiceCatalog
                            : startupDiagnostic === "product-promote-full"
                              ? promoteKoperProducts
                              : startupDiagnostic === "service-promote-full"
                                ? promoteKoperServices
                                : startupDiagnostic === "budget-promote-full"
                                  ? promoteKoperConstructionBudget
                                  : startupDiagnostic === "composition-promotion-readiness"
                                    ? checkKoperCompositionPromotionReadiness
                                    : startupDiagnostic === "budget-input-promote"
                                      ? promoteKoperBudgetInputs
                                      : startupDiagnostic === "composition-promote-full"
                                        ? promoteKoperBudgetCompositions
                                        : startupDiagnostic === "stock-request-active-staging-write-full"
                                          ? writeFlowActiveStockRequests
                                          : startupDiagnostic === "stock-request-promotion-readiness"
                                            ? checkStockRequestPromotionReadiness
                                            : startupDiagnostic === "stock-request-input-promote"
                                              ? promoteStockRequestInputs
                                              : startupDiagnostic === "stock-request-active-promote"
                                                ? promoteActiveStockRequests
                  : null;

  if (diagnostic) {
    void diagnostic()
      .then((result) => {
        console.log("KOPER_STARTUP_DIAGNOSTIC_RESULT", JSON.stringify(result));
      })
      .catch((error: unknown) => {
        console.error("KOPER_STARTUP_DIAGNOSTIC_FAILED", {
          message:
            error instanceof Error ? error.message : "Erro desconhecido",
        });
      });
  }
});
