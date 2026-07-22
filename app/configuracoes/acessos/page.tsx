import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { addExistingMember, changeMemberRole } from "./actions";

type Member = {
  id: string;
  user_id: string;
  role_id: string;
  status: string;
};

type Profile = {
  id: string;
  email: string;
  full_name: string | null;
};

type Role = {
  id: string;
  key: string;
  name: string;
  description: string | null;
};

export default async function AccessSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getClaims();

  if (authError || !authData?.claims) {
    redirect("/login");
  }

  const cookieStore = await cookies();
  const companyId = cookieStore.get("elos_company_id")?.value;

  if (!companyId) {
    redirect("/dashboard");
  }

  const [{ data: company }, { data: permissionData }] = await Promise.all([
    supabase.from("companies").select("id, name").eq("id", companyId).maybeSingle(),
    supabase.rpc("has_company_permission", {
      target_company_id: companyId,
      target_permission: "admin.users.view",
    }),
  ]);

  if (!company || permissionData !== true) {
    redirect("/dashboard");
  }

  const [{ data: memberData }, { data: roleData }, { data: managePermission }] = await Promise.all([
    supabase
      .from("company_memberships")
      .select("id, user_id, role_id, status")
      .eq("company_id", companyId)
      .order("created_at"),
    supabase
      .from("roles")
      .select("id, key, name, description")
      .eq("company_id", companyId)
      .order("name"),
    supabase.rpc("has_company_permission", {
      target_company_id: companyId,
      target_permission: "admin.users.manage",
    }),
  ]);

  const members = (memberData ?? []) as Member[];
  const roles = (roleData ?? []) as Role[];
  const userIds = members.map((member) => member.user_id);
  const { data: profileData } = userIds.length
    ? await supabase.from("profiles").select("id, email, full_name").in("id", userIds)
    : { data: [] };
  const profiles = (profileData ?? []) as Profile[];
  const canManage = managePermission === true;
  const assignableRoles = roles.filter((role) => role.key !== "owner");

  return (
    <main className="settings-page">
      <header className="settings-header">
        <div>
          <span>Administração</span>
          <h1>Usuários e acessos</h1>
          <p>{company.name}</p>
        </div>
        <Link className="back-link" href="/dashboard">Voltar ao dashboard</Link>
      </header>

      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}

      <section className="access-summary">
        <article><span>Usuários ativos</span><strong>{members.filter((member) => member.status === "active").length}</strong></article>
        <article><span>Papéis disponíveis</span><strong>{roles.length}</strong></article>
        <article><span>Modelo de acesso</span><strong>Empresa + obra</strong></article>
      </section>

      {canManage ? (
        <section className="add-member-panel">
          <div>
            <span>Adicionar usuário existente</span>
            <h2>Liberar acesso à empresa</h2>
            <p>O usuário precisa criar e confirmar a própria conta no Elos OS antes de ser adicionado.</p>
          </div>
          <form action={addExistingMember}>
            <label>E-mail<input name="email" type="email" placeholder="usuario@empresa.com.br" required /></label>
            <label>
              Papel
              <select name="role_key" required defaultValue="engineering">
                {assignableRoles.map((role) => <option key={role.id} value={role.key}>{role.name}</option>)}
              </select>
            </label>
            <button className="auth-primary" type="submit">Adicionar acesso</button>
          </form>
        </section>
      ) : null}

      <section className="members-panel">
        <div className="section-heading">
          <div><span>Equipe</span><h2>Pessoas com acesso</h2></div>
          <p>Os papéis controlam os módulos e ações disponíveis para cada pessoa.</p>
        </div>

        <div className="member-table">
          <div className="member-row member-head">
            <span>Usuário</span><span>Papel</span><span>Status</span><span>Ação</span>
          </div>
          {members.map((member) => {
            const profile = profiles.find((item) => item.id === member.user_id);
            const role = roles.find((item) => item.id === member.role_id);
            const isOwner = role?.key === "owner";

            return (
              <div className="member-row" key={member.id}>
                <div><strong>{profile?.full_name || profile?.email || "Usuário"}</strong><span>{profile?.email}</span></div>
                <div><strong>{role?.name ?? "Sem papel"}</strong><span>{role?.description}</span></div>
                <span className={`status-badge ${member.status}`}>{member.status === "active" ? "Ativo" : member.status}</span>
                <div>
                  {canManage && !isOwner ? (
                    <form className="role-form" action={changeMemberRole}>
                      <input type="hidden" name="membership_id" value={member.id} />
                      <select name="role_key" defaultValue={role?.key}>
                        {assignableRoles.map((option) => <option key={option.id} value={option.key}>{option.name}</option>)}
                      </select>
                      <button type="submit">Salvar</button>
                    </form>
                  ) : (
                    <span className="locked-role">{isOwner ? "Proprietário" : "Somente leitura"}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="roles-panel">
        <div className="section-heading">
          <div><span>Papéis padrão</span><h2>Estrutura inicial de permissões</h2></div>
          <p>A personalização detalhada por módulo, tela e ação será construída sobre esta base.</p>
        </div>
        <div className="role-grid">
          {roles.map((role) => (
            <article key={role.id}><span>{role.key}</span><h3>{role.name}</h3><p>{role.description}</p></article>
          ))}
        </div>
      </section>
    </main>
  );
}
