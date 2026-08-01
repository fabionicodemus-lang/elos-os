import type { Response } from "playwright-core";
import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { collectFieldPaths } from "./discover-stock-route.js";

type BrowserlessCdpSession = {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
};

type RecordedRead = {
  method: string;
  endpoint: string;
  status: number;
  queryKeys: string[];
  dataKeys: string[];
  fieldPaths: string[];
  occurrences: number;
};

type BlockedWrite = {
  method: string;
  endpoint: string;
  occurrences: number;
};

export type LiveRecordingReport = {
  ok: true;
  authenticated: boolean;
  liveUrlIssued: boolean;
  startedAt: string;
  endedAt: string;
  endedReason: "timeout" | "disconnected" | "login-failed";
  viewsLoaded: string[];
  apiReads: RecordedRead[];
  blockedWrites: BlockedWrite[];
  message: string | null;
};

// Empresas autorizadas para troca manual durante a gravação (Seção 3.1 da constituição).
const allowedEnterpriseIds = new Set([
  "1645acb2-de18-11ed-bf03-8af8dfac4eab", // Bossa Empreendimentos
  "6d3b4724-5880-11ee-827d-1219c832db49", // Flow Aptos - Bossa
  "ec9ed276-742a-11ef-8533-1219c832db49", // Alma Seahouses - Bossa
]);

function isAllowedCompanySwitchBody(postData: string | null): boolean {
  if (!postData) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(postData);

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return false;
    }

    const body = parsed as Record<string, unknown>;
    const allowedKeys = new Set(["accessToken", "toEnterpriseId", "changeCompany"]);
    const keys = Object.keys(body);

    return (
      keys.length === 3 &&
      keys.every((key) => allowedKeys.has(key)) &&
      typeof body.accessToken === "string" &&
      body.accessToken.length > 0 &&
      typeof body.toEnterpriseId === "string" &&
      allowedEnterpriseIds.has(body.toEnterpriseId) &&
      Object.hasOwn(body, "changeCompany")
    );
  } catch {
    return false;
  }
}

function recordingDurationMs(): number {
  const parsed = Number(process.env.KOPER_LIVE_RECORDING_MS);
  return Number.isFinite(parsed) && parsed >= 60_000 && parsed <= 3_600_000
    ? parsed
    : 900_000;
}

export async function runLiveRecording(): Promise<LiveRecordingReport> {
  const durationMs = recordingDurationMs();

  return withBrowserless(async ({ browser, context, page }) => {
    const startedAt = new Date();
    const apiReads = new Map<string, RecordedRead>();
    const blockedWrites = new Map<string, BlockedWrite>();
    const viewsLoaded = new Set<string>();
    const pendingResponses: Promise<void>[] = [];

    await page.route("**/*", async (route) => {
      const request = route.request();
      const method = request.method();

      try {
        const parsedUrl = new URL(request.url());
        const hostname = parsedUrl.hostname;
        const isKoper =
          hostname === "koper.com.br" || hostname.endsWith(".koper.com.br");
        const isSafeRead = ["GET", "HEAD", "OPTIONS"].includes(method);
        const isAllowedSwitch =
          method === "POST" &&
          hostname === "api.koper.com.br" &&
          parsedUrl.pathname === "/login/change_company" &&
          isAllowedCompanySwitchBody(request.postData());

        if (isKoper && !isSafeRead && !isAllowedSwitch) {
          const key = `${method} ${parsedUrl.origin}${parsedUrl.pathname}`;
          const existing = blockedWrites.get(key);

          if (existing) {
            existing.occurrences += 1;
          } else if (blockedWrites.size < 100) {
            blockedWrites.set(key, {
              method,
              endpoint: parsedUrl.origin + parsedUrl.pathname,
              occurrences: 1,
            });
          }

          await route.abort("blockedbyclient");
          return;
        }
      } catch {
        // URLs inválidas seguem o fluxo normal do navegador.
      }

      await route.continue();
    });

    const onResponse = (response: Response): void => {
      try {
        const request = response.request();
        const parsedUrl = new URL(response.url());

        if (
          parsedUrl.hostname === "app.koper.com.br" &&
          parsedUrl.pathname.startsWith("/views/") &&
          viewsLoaded.size < 100
        ) {
          viewsLoaded.add(parsedUrl.pathname);
          return;
        }

        if (
          request.method() !== "GET" ||
          parsedUrl.hostname !== "api.koper.com.br" ||
          apiReads.size >= 300
        ) {
          return;
        }

        const queryKeys = [...new Set(parsedUrl.searchParams.keys())]
          .sort()
          .slice(0, 30);
        const key = `${parsedUrl.pathname}|${response.status()}|${queryKeys.join(",")}`;
        const existing = apiReads.get(key);

        if (existing) {
          existing.occurrences += 1;
          return;
        }

        const task = response
          .json()
          .then((body: unknown) => {
            const object =
              typeof body === "object" && body !== null && !Array.isArray(body)
                ? (body as Record<string, unknown>)
                : null;

            apiReads.set(key, {
              method: "GET",
              endpoint: parsedUrl.origin + parsedUrl.pathname,
              status: response.status(),
              queryKeys,
              dataKeys: object ? Object.keys(object).slice(0, 50) : [],
              fieldPaths: collectFieldPaths(body).slice(0, 200),
              occurrences: 1,
            });
          })
          .catch(() => {
            apiReads.set(key, {
              method: "GET",
              endpoint: parsedUrl.origin + parsedUrl.pathname,
              status: response.status(),
              queryKeys,
              dataKeys: [],
              fieldPaths: [],
              occurrences: 1,
            });
          });

        pendingResponses.push(task);
      } catch {
        // Ignora respostas que não possam ser sanitizadas.
      }
    };

    page.on("response", onResponse);

    const buildReport = (
      authenticated: boolean,
      liveUrlIssued: boolean,
      endedReason: LiveRecordingReport["endedReason"],
      message: string | null,
    ): LiveRecordingReport => ({
      ok: true,
      authenticated,
      liveUrlIssued,
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      endedReason,
      viewsLoaded: [...viewsLoaded],
      apiReads: [...apiReads.values()],
      blockedWrites: [...blockedWrites.values()],
      message,
    });

    const login = await performKoperLogin(page);

    if (!login.authenticated) {
      return buildReport(false, false, "login-failed", login.message);
    }

    const cdpSession = (await context.newCDPSession(
      page,
    )) as unknown as BrowserlessCdpSession;
    const liveUrlResult = (await cdpSession.send("Browserless.liveURL", {
      timeout: durationMs,
      interactable: true,
      type: "jpeg",
      quality: 60,
      resizable: true,
      showBrowserInterface: false,
      compressed: true,
      emulateComponents: true,
    })) as { liveURL?: unknown };

    if (typeof liveUrlResult.liveURL !== "string" || liveUrlResult.liveURL.length === 0) {
      return buildReport(
        true,
        false,
        "disconnected",
        "O Browserless não retornou o link visual da gravação.",
      );
    }

    // O link é temporário, privado e não contém o token do Browserless.
    console.log("KOPER_LIVE_URL", liveUrlResult.liveURL);
    console.log(
      "KOPER_LIVE_WINDOW",
      JSON.stringify({ durationMs, expiresAt: new Date(Date.now() + durationMs).toISOString() }),
    );

    const deadline = Date.now() + durationMs;
    let endedReason: LiveRecordingReport["endedReason"] = "timeout";
    let lastPartialAt = Date.now();

    while (Date.now() < deadline) {
      if (!browser.isConnected()) {
        endedReason = "disconnected";
        break;
      }

      if (Date.now() - lastPartialAt >= 60_000) {
        lastPartialAt = Date.now();
        console.log(
          "KOPER_LIVE_PARTIAL",
          JSON.stringify({
            elapsedMs: Date.now() - (deadline - durationMs),
            apiReads: apiReads.size,
            views: viewsLoaded.size,
            blockedWrites: blockedWrites.size,
            lastEndpoints: [...apiReads.values()].slice(-5).map((item) => item.endpoint),
          }),
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }

    await Promise.allSettled(pendingResponses);
    page.off("response", onResponse);
    await page.unroute("**/*").catch(() => undefined);

    return buildReport(true, true, endedReason, null);
  }, { sessionTimeoutMs: durationMs + 180_000 });
}
