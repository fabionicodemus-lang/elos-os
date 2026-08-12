import { env } from "../config/env.js";
import { withBrowserless } from "../browser/browserless.js";
import { dryRunStockRequestPromotion } from "./dry-run-stock-request-promotion.js";
import { checkStockRequestAllocationMismatches } from "./check-stock-request-promotion-readiness.js";
import {
  officialStockRequestServiceKey,
  resolveFlowStockRequestServices,
} from "./resolve-flow-stock-request-services.js";

export type BrowserlessDiagnostic = {
  ok: true;
  status: number | null;
  title: string;
  finalUrl: string;
  checkedAt: string;
};

const temporaryDiagnostic = process.env.KOPER_DRY_RUN_MARKER;

if (temporaryDiagnostic === "full-dry-run") {
  void dryRunStockRequestPromotion()
    .then((result) => {
      console.log("KOPER_DRY_RUN_RESULT", JSON.stringify(result));
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      console.error(`KOPER_DRY_RUN_FAILED ${message}`);
    });
}

if (temporaryDiagnostic === "mismatch-shapes") {
  void checkStockRequestAllocationMismatches()
    .then((result) => {
      const rows = result.mismatches.map((row) => {
        const allocationIds = [...new Set(row.links
          .map((link) => link.itemMonitInputId)
          .filter((value): value is string => Boolean(value))
        )];
        return { ...row, uniqueAllocationIds: allocationIds.length, allocationIds };
      });
      const singleIdentity = rows.filter((row) => row.uniqueAllocationIds === 1);
      const multipleIdentities = rows.filter((row) => row.uniqueAllocationIds > 1);
      const summary = {
        ok: true,
        mode: "read-only",
        mismatches: rows.length,
        singleLink: rows.filter((row) => row.linkCount === 1).length,
        multiLinkSingleAllocationIdentity: rows.filter((row) => row.linkCount > 1 && row.uniqueAllocationIds === 1).length,
        singleAllocationIdentityTotal: singleIdentity.length,
        multipleAllocationIdentities: multipleIdentities.length,
        multipleIdentitySamples: multipleIdentities.slice(0, 40).map((row) => ({
          productRequestId: row.productRequestId,
          requestId: row.requestId,
          productName: row.productName,
          productAmount: row.productAmount,
          allocatedAmount: row.allocatedAmount,
          delta: row.delta,
          allocationIds: row.allocationIds,
          links: row.links,
        })),
      };
      console.log("KOPER_MISMATCH_SHAPES_RESULT", JSON.stringify(summary));
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      console.error(`KOPER_MISMATCH_SHAPES_FAILED ${message}`);
    });
}

if (temporaryDiagnostic === "mismatch-services") {
  void checkStockRequestAllocationMismatches()
    .then(async (result) => {
      const rows = result.mismatches.map((row) => {
        const allocationIds = [...new Set(row.links
          .map((link) => link.itemMonitInputId)
          .filter((value): value is string => Boolean(value))
        )];
        return { ...row, allocationIds };
      }).filter((row) => row.allocationIds.length > 1 && row.inputId);

      const syntheticRows = rows.map((row) => ({
        koper_id: row.productRequestId,
        payload: {
          inputId: row.inputId,
          services: row.links,
        },
      }));
      const official = await resolveFlowStockRequestServices(syntheticRows);
      const resolved = rows.map((row) => {
        const serviceIds = [...new Set(row.allocationIds.map((allocationId) => {
          const key = officialStockRequestServiceKey(row.inputId, allocationId);
          return key ? official.get(key)?.koperServiceId ?? null : null;
        }).filter((value): value is string => Boolean(value)))];
        return {
          productRequestId: row.productRequestId,
          requestId: row.requestId,
          productName: row.productName,
          productAmount: row.productAmount,
          allocatedAmount: row.allocatedAmount,
          allocationIds: row.allocationIds,
          serviceIds,
          uniqueServices: serviceIds.length,
          links: row.links,
        };
      });
      console.log("KOPER_MISMATCH_SERVICES_RESULT", JSON.stringify({
        ok: true,
        mode: "read-only",
        rows: resolved.length,
        sameOfficialService: resolved.filter((row) => row.uniqueServices === 1).length,
        multipleOfficialServices: resolved.filter((row) => row.uniqueServices > 1).length,
        resolved,
      }));
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      console.error(`KOPER_MISMATCH_SERVICES_FAILED ${message}`);
    });
}

export async function testBrowserlessConnection(): Promise<BrowserlessDiagnostic> {
  return withBrowserless(async ({ page }) => {
    const response = await page.goto(env.KOPER_LOGIN_URL, {
      waitUntil: "domcontentloaded",
    });

    return {
      ok: true,
      status: response?.status() ?? null,
      title: await page.title(),
      finalUrl: page.url(),
      checkedAt: new Date().toISOString(),
    };
  });
}
