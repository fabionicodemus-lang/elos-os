"use client";

import { useMemo, useState } from "react";
import { saveRolePermissions } from "./actions";

export type PermissionMatrixGroup = {
  key: string;
  label: string;
  permissions: {
    key: string;
    description: string;
    actionLabel: string;
  }[];
};

export function PermissionMatrix({
  roleId,
  roleName,
  groups,
  initialKeys,
  canManage,
  protectedRole,
  inactive,
}: {
  roleId: string;
  roleName: string;
  groups: PermissionMatrixGroup[];
  initialKeys: string[];
  canManage: boolean;
  protectedRole: boolean;
  inactive: boolean;
}) {
  const [selected, setSelected] = useState(() => new Set(initialKeys));
  const [filter, setFilter] = useState("");
  const editable = canManage && !protectedRole && !inactive;
  const normalizedFilter = filter.trim().toLocaleLowerCase("pt-BR");
  const visibleGroups = useMemo(() => {
    if (!normalizedFilter) return groups;
    return groups
      .map((group) => ({
        ...group,
        permissions: group.permissions.filter((permission) =>
          `${group.label} ${permission.actionLabel} ${permission.description} ${permission.key}`
            .toLocaleLowerCase("pt-BR")
            .includes(normalizedFilter),
        ),
      }))
      .filter((group) => group.permissions.length > 0);
  }, [groups, normalizedFilter]);

  function togglePermission(key: string) {
    if (!editable) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function setGroup(keys: string[], enabled: boolean) {
    if (!editable) return;
    setSelected((current) => {
      const next = new Set(current);
      keys.forEach((key) => enabled ? next.add(key) : next.delete(key));
      return next;
    });
  }

  function setAll(enabled: boolean) {
    setGroup(groups.flatMap((group) => group.permissions.map((permission) => permission.key)), enabled);
  }

  return (
    <form action={saveRolePermissions} className="permission-matrix-form">
      <input type="hidden" name="role_id" value={roleId} />
      <div className="permission-matrix-toolbar">
        <div>
          <span>Matriz de acesso</span>
          <strong>{selected.size} permissões em {roleName}</strong>
        </div>
        <label>
          <span>Localizar permissão</span>
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Ex.: aprovar, financeiro, vistoria" />
        </label>
        {editable ? (
          <div className="permission-bulk-actions">
            <button type="button" onClick={() => setAll(true)}>Marcar todas</button>
            <button type="button" onClick={() => setAll(false)}>Limpar todas</button>
          </div>
        ) : null}
      </div>

      {protectedRole ? (
        <div className="permission-protected-note">Este papel possui acesso total protegido. As permissões são mantidas automaticamente pelo sistema.</div>
      ) : null}
      {inactive ? (
        <div className="permission-protected-note warning">Ative o papel para alterar sua matriz de acesso.</div>
      ) : null}

      <div className="permission-groups">
        {visibleGroups.map((group) => {
          const keys = group.permissions.map((permission) => permission.key);
          const checkedCount = keys.filter((key) => selected.has(key)).length;
          return (
            <section className="permission-group" key={group.key}>
              <header>
                <div><span>{group.key}</span><h3>{group.label}</h3><small>{checkedCount} de {keys.length} selecionadas</small></div>
                {editable ? (
                  <div>
                    <button type="button" onClick={() => setGroup(keys, true)}>Marcar módulo</button>
                    <button type="button" onClick={() => setGroup(keys, false)}>Limpar</button>
                  </div>
                ) : null}
              </header>
              <div className="permission-options">
                {group.permissions.map((permission) => (
                  <label className={`permission-option ${selected.has(permission.key) ? "selected" : ""}`} key={permission.key}>
                    <input
                      type="checkbox"
                      name="permission_keys"
                      value={permission.key}
                      checked={selected.has(permission.key)}
                      disabled={!editable}
                      onChange={() => togglePermission(permission.key)}
                    />
                    <span className="permission-switch" aria-hidden="true" />
                    <span className="permission-copy">
                      <strong>{permission.actionLabel}</strong>
                      <small>{permission.description}</small>
                      <code>{permission.key}</code>
                    </span>
                  </label>
                ))}
              </div>
            </section>
          );
        })}
        {!visibleGroups.length ? <div className="permission-empty">Nenhuma permissão corresponde à pesquisa.</div> : null}
      </div>

      {editable ? (
        <footer className="permission-save-bar">
          <span>As mudanças afetam imediatamente todos os usuários vinculados a este papel.</span>
          <button type="submit">Salvar matriz de permissões</button>
        </footer>
      ) : null}
    </form>
  );
}
