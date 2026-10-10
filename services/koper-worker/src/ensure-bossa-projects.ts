/**
 * Garante no Elos OS as obras que recebem os custos vindos do Koper.
 *
 * Regra definida pelo Fábio em 2026-10-10 (docs/koper-mirror.md, Seção 2):
 * Flow, Alma, Soul, Jazz e Escritório Bossa. O Flow já existe; este script cria
 * somente as que faltarem. Nunca altera nem apaga obra existente.
 *
 *   node dist/ensure-bossa-projects.js           # plano: lista o que existe e o que faltaria
 *   node dist/ensure-bossa-projects.js --write   # cria as que faltam
 *
 * `created_by` é obrigatório em `projects`; usa o mesmo usuário que criou a obra do Flow
 * e, como na migration 0062, vincula esse usuário à obra nova com o papel que ele tem na empresa.
 */
import { pathToFileURL } from "node:url";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Project = { id: string; name: string; code: string | null; status: string; created_by: string };
type Membership = { user_id: string; role_id: string | null };
type Requester = typeof requestSupabase;

export type TargetProject = {
  key: "alma" | "soul" | "jazz" | "office";
  match: RegExp;
  name: string;
  status: "active" | "completed";
  project_type: "residential" | "other";
  description: string;
};

export const TARGETS: TargetProject[] = [
  {
    key: "alma",
    match: /\balma\b/i,
    name: "Alma Seahouses",
    status: "active",
    project_type: "residential",
    description: "Custos do Koper: empresa Alma Seahouses - Bossa e centros de custo do Alma na empresa Bossa.",
  },
  {
    key: "soul",
    match: /\bsoul\b/i,
    name: "Soul Residence",
    status: "completed",
    project_type: "residential",
    description: "Custos do Koper: centro de custo Soul Residence da empresa Bossa.",
  },
  {
    key: "jazz",
    match: /\bjazz\b/i,
    name: "Jazz Residence",
    status: "completed",
    project_type: "residential",
    description: "Custos do Koper: centro de custo Jazz Residence da empresa Bossa.",
  },
  {
    key: "office",
    match: /escrit[oó]rio|matriz/i,
    name: "Escritório Bossa",
    status: "active",
    project_type: "other",
    description: "Custos do Koper: centros de custo Matriz e Escritório Central da empresa Bossa.",
  },
];

export type ProjectPlan = {
  existing: Array<{ key: string; id: string; name: string }>;
  ambiguous: Array<{ key: string; names: string[] }>;
  toCreate: TargetProject[];
};

/** Homologação e arquivadas não contam como a obra real. */
const isRealProject = (project: Project) => !/homologa/i.test(project.name) && project.status !== "archived";

export function planProjects(projects: Project[]): ProjectPlan {
  const plan: ProjectPlan = { existing: [], ambiguous: [], toCreate: [] };
  for (const target of TARGETS) {
    const matches = projects.filter((project) => isRealProject(project) && target.match.test(project.name));
    const first = matches[0];
    if (matches.length === 1 && first) plan.existing.push({ key: target.key, id: first.id, name: first.name });
    else if (matches.length > 1) plan.ambiguous.push({ key: target.key, names: matches.map((project) => project.name) });
    else plan.toCreate.push(target);
  }
  return plan;
}

export async function ensureBossaProjects(write: boolean, request: Requester = requestSupabase) {
  const company = `eq.${env.BOSSA_COMPANY_ID}`;
  const projects = await request<Project[]>("projects", {
    query: new URLSearchParams({ select: "id,name,code,status,created_by", company_id: company, order: "created_at.asc", limit: "500" }),
  });
  const flow = projects.filter((project) => isRealProject(project) && /\bflow\b/i.test(project.name));
  const plan = planProjects(projects);
  const summary = {
    write,
    projects: projects.map((project) => ({ id: project.id, name: project.name, code: project.code, status: project.status })),
    flowProjects: flow.length,
    existing: plan.existing,
    ambiguous: plan.ambiguous,
    toCreate: plan.toCreate.map((target) => target.name),
  };
  console.log("KOPER_PROJECTS_PLAN", JSON.stringify(summary));
  if (!write || plan.toCreate.length === 0) return { ...summary, created: [] as string[] };

  const owner = flow[0];
  if (flow.length !== 1 || !owner) throw new Error(`KOPER_PROJECTS_FLOW_REFERENCE_AMBIGUOUS_${flow.length}`);
  const memberships = await request<Membership[]>("company_memberships", {
    query: new URLSearchParams({ select: "user_id,role_id", company_id: company, user_id: `eq.${owner.created_by}`, status: "eq.active", limit: "1" }),
  });
  const roleId = memberships[0]?.role_id ?? null;

  const created: string[] = [];
  for (const target of plan.toCreate) {
    const inserted = await request<Array<{ id: string }>>("projects", {
      method: "POST",
      body: {
        company_id: env.BOSSA_COMPANY_ID,
        name: target.name,
        status: target.status,
        project_type: target.project_type,
        description: target.description,
        created_by: owner.created_by,
      },
      prefer: "return=representation",
      query: new URLSearchParams({ select: "id" }),
    });
    const id = inserted[0]?.id;
    if (!id) throw new Error(`KOPER_PROJECTS_INSERT_NOT_CONFIRMED_${target.key}`);
    await request("project_memberships", {
      method: "POST",
      body: { project_id: id, user_id: owner.created_by, role_id: roleId },
      prefer: "resolution=ignore-duplicates,return=minimal",
      query: new URLSearchParams({ on_conflict: "project_id,user_id" }),
    });
    created.push(target.name);
  }

  const after = await request<Project[]>("projects", {
    query: new URLSearchParams({ select: "id,name,code,status,created_by", company_id: company, order: "created_at.asc", limit: "500" }),
  });
  const check = planProjects(after);
  if (check.toCreate.length || check.ambiguous.length > plan.ambiguous.length) throw new Error("KOPER_PROJECTS_POST_VERIFICATION_FAILED");
  console.log("KOPER_PROJECTS_RESULT", JSON.stringify({ created, existing: check.existing }));
  return { ...summary, created };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ensureBossaProjects(process.argv.includes("--write")).catch((error: unknown) => {
    console.error("KOPER_PROJECTS_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) }));
    process.exitCode = 1;
  });
}
