"use client";

import { useRef, useState } from "react";
import { deleteProject } from "./delete-action";
import type { ProjectRegistryData } from "./project-dialogs";

export function ProjectDeleteDialog({ project }: { project: ProjectRegistryData }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [confirmation, setConfirmation] = useState("");
  const canDelete = confirmation.trim() === project.name;

  function closeDialog() {
    setConfirmation("");
    dialogRef.current?.close();
  }

  return (
    <>
      <button
        className="project-table-action"
        type="button"
        style={{ color: "var(--danger)" }}
        onClick={() => dialogRef.current?.showModal()}
      >
        Excluir
      </button>

      <dialog ref={dialogRef} className="budget-modal project-modal">
        <form action={deleteProject} className="budget-modal-form">
          <input type="hidden" name="project_id" value={project.id} />

          <header className="budget-modal-head">
            <div>
              <span>{project.code || "Empreendimento"}</span>
              <h2>Excluir {project.name}</h2>
            </div>
            <button type="button" className="budget-modal-close" onClick={closeDialog} aria-label="Fechar">×</button>
          </header>

          <div className="budget-modal-body">
            <div className="auth-message error" style={{ marginTop: 0 }}>
              <strong>Exclusão permanente.</strong> Os dados vinculados a esta obra também podem ser excluídos do Elos OS. Essa ação não pode ser desfeita.
            </div>

            <label style={{ display: "grid", gap: 8, marginTop: 18, fontSize: 12, fontWeight: 750 }}>
              <span>Para confirmar, digite exatamente <strong>{project.name}</strong></span>
              <input
                name="confirmation"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                style={{ minHeight: 44, border: "1px solid #d7e0df", borderRadius: 11, padding: "0 12px" }}
              />
            </label>
          </div>

          <footer className="budget-modal-foot">
            <button type="button" className="budget-secondary-button" onClick={closeDialog}>Cancelar</button>
            <button
              type="submit"
              className="budget-primary-button"
              disabled={!canDelete}
              style={{ background: canDelete ? "var(--danger)" : undefined, borderColor: canDelete ? "var(--danger)" : undefined }}
            >
              Excluir definitivamente
            </button>
          </footer>
        </form>
      </dialog>
    </>
  );
}
