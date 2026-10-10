import { redirect } from "next/navigation";
import "../elos-ia.css";
import { AppShell } from "@/components/app-shell";
import { getElosIaConfig } from "@/lib/elos-ia/config";
import { defaultPersonaForRole, ELOS_IA_PERSONAS } from "@/lib/elos-ia/personas";
import { loadElosIaProjects, resolveElosIaAccess } from "@/lib/elos-ia/server";
import { elosIaToolLabel, elosIaToolPermissions } from "@/lib/elos-ia/tools";
import { loadElosIaUsage, quotaView } from "@/lib/elos-ia/usage";
import { ElosIaChat, type ElosIaChatPersona } from "./elos-ia-chat";

export default async function ElosIaPage() {
  const access = await resolveElosIaAccess();
  if (!access.allowed) {
    redirect("/dashboard?error=Você%20não%20possui%20acesso%20ao%20Elos%20IA.");
  }

  const { workspace } = access;
  const config = getElosIaConfig();
  const [projects, usage] = await Promise.all([
    loadElosIaProjects(workspace),
    loadElosIaUsage(workspace.supabase, workspace.companyId).catch(() => ({ tracking: false, userTokensToday: 0, companyTokensMonth: 0 })),
  ]);
  const activeProject = projects.find((project) => project.id === workspace.projectId) ?? null;
  const activeProjectLabel = activeProject ? [activeProject.code, activeProject.name].filter(Boolean).join(" · ") : null;

  // Só o que a tela precisa: as instruções das personas nunca vão ao navegador.
  const personas: ElosIaChatPersona[] = ELOS_IA_PERSONAS.map((persona) => ({
    key: persona.key,
    label: persona.label,
    tagline: persona.tagline,
    pilotNote: persona.pilotNote ?? null,
    suggestions: persona.suggestions,
    sources: persona.tools
      .filter((tool) => tool !== "listar_obras")
      .map((tool) => ({ label: elosIaToolLabel(tool), available: elosIaToolPermissions(tool).every(access.can) })),
  }));

  return (
    <AppShell
      activeGroup="ai"
      eyebrow="Elos IA · Piloto"
      title="Elos IA"
      description={`${workspace.company.name} · ${activeProjectLabel ?? "Todas as obras"} · respostas com os dados lançados no Elos OS e os próximos passos.`}
    >
      <ElosIaChat
        personas={personas}
        defaultPersona={defaultPersonaForRole(workspace.roleKey)}
        configured={Boolean(config.apiKey)}
        activeProjectLabel={activeProjectLabel}
        initialQuota={quotaView(config, usage)}
        maxQuestionChars={config.maxQuestionChars}
      />
    </AppShell>
  );
}
