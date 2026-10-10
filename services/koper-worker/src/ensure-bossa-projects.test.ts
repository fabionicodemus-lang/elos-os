import assert from "node:assert/strict";
import { test } from "node:test";

process.env.WORKER_API_KEY = "x".repeat(40);
process.env.KOPER_LOGIN_URL = "https://app.koper.com.br/login";
process.env.KOPER_USERNAME = "u";
process.env.KOPER_PASSWORD = "p";
process.env.BOSSA_COMPANY_ID = "11111111-1111-4111-8111-111111111111";

const { ensureBossaProjects, planProjects } = await import("./ensure-bossa-projects.js");
type Row = Record<string, unknown>;

function fake(initial: Row[]) {
  const projects = [...initial];
  const memberships: Row[] = [];
  const request = async (resource: string, o: { method?: string; body?: unknown } = {}) => {
    if (resource === "projects" && (o.method ?? "GET") === "GET") return projects;
    if (resource === "company_memberships") return [{ user_id: "user-1", role_id: "role-1" }];
    if (resource === "projects" && o.method === "POST") {
      const row = { id: `new-${projects.length}`, code: null, ...(o.body as Row) };
      projects.push(row);
      return [{ id: row.id }];
    }
    if (resource === "project_memberships" && o.method === "POST") { memberships.push(o.body as Row); return undefined; }
    throw new Error(`chamada inesperada: ${o.method} ${resource}`);
  };
  return { projects, memberships, request: request as never };
}

const flow = { id: "p-flow", name: "Flow Aptos", code: "FLOW", status: "active", created_by: "user-1" };
const hom = { id: "p-hom", name: "[HOMOLOGAÇÃO] Residencial Aurora", code: "HOM-001", status: "planning", created_by: "user-1" };

test("plano não grava; --write cria só as que faltam e é idempotente", async () => {
  const db = fake([flow, hom, { id: "p-alma", name: "Alma Seahouses", code: null, status: "active", created_by: "user-1" }]);
  const plan = await ensureBossaProjects(false, db.request);
  assert.deepEqual(plan.toCreate, ["Soul Residence", "Jazz Residence", "Escritório Bossa"]);
  assert.equal(db.projects.length, 3);

  const run = await ensureBossaProjects(true, db.request);
  assert.deepEqual(run.created, ["Soul Residence", "Jazz Residence", "Escritório Bossa"]);
  assert.equal(db.projects.length, 6);
  assert.ok(db.projects.slice(3).every((p) => p.created_by === "user-1" && p.company_id === process.env.BOSSA_COMPANY_ID));
  assert.equal(db.memberships.length, 3);
  assert.ok(db.memberships.every((m) => m.user_id === "user-1" && m.role_id === "role-1"));

  const again = await ensureBossaProjects(true, db.request);
  assert.deepEqual(again.created, []);
  assert.equal(db.projects.length, 6);
});

test("homologação e arquivada não contam; ambíguo não cria", () => {
  const plan = planProjects([
    { id: "1", name: "[HOMOLOGAÇÃO] Soul", code: null, status: "active", created_by: "u" },
    { id: "2", name: "Jazz antigo", code: null, status: "archived", created_by: "u" },
    { id: "3", name: "Alma Seahouses", code: null, status: "active", created_by: "u" },
    { id: "4", name: "Alma - empresa", code: null, status: "active", created_by: "u" },
  ]);
  assert.deepEqual(plan.toCreate.map((t) => t.name), ["Soul Residence", "Jazz Residence", "Escritório Bossa"]);
  assert.deepEqual(plan.ambiguous.map((a) => a.key), ["alma"]);
});

test("sem obra do Flow como referência, não cria nada", async () => {
  const db = fake([hom]);
  await assert.rejects(() => ensureBossaProjects(true, db.request), /FLOW_REFERENCE_AMBIGUOUS_0/);
  assert.equal(db.projects.length, 1);
});
