"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ENTITY_LABELS, rowText } from "./import-presentation";

type EntityKind = "supplier" | "client" | "payable" | "receivable";
type Project = { id: string; name: string; code: string | null };
type ImportField = { key: string; label: string; required?: boolean; aliases?: string[] };
type Sheet = { name: string; headers: string[]; rowCount: number; samples: Record<string, unknown>[] };
type Inspection = {
  sheets: Sheet[];
  fields: ImportField[];
  suggested_mappings: Record<string, Record<string, string>>;
};

const MAX_FILE_BYTES = 4 * 1024 * 1024;

async function responseBody(response: Response) {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    throw new Error("O servidor não respondeu como esperado. Tente novamente.");
  }
}

function errorMessage(data: Record<string, unknown>, fallback: string) {
  return typeof data.error === "string" ? data.error : typeof data.message === "string" ? data.message : fallback;
}

export function EobraImportForm({ companyId, projects, defaultSourceHost, referenceDate, disabled = false }: {
  companyId: string;
  projects: Project[];
  defaultSourceHost: string;
  referenceDate: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [entityKind, setEntityKind] = useState<EntityKind>("supplier");
  const [sourceHost, setSourceHost] = useState(defaultSourceHost);
  const [reference, setReference] = useState(referenceDate);
  const [projectId, setProjectId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [headerRow, setHeaderRow] = useState("1");
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [singleProjectConfirmed, setSingleProjectConfirmed] = useState(false);
  const [pending, setPending] = useState<"inspect" | "stage" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const financial = entityKind === "payable" || entityKind === "receivable";
  const selectedSheet = inspection?.sheets.find((sheet) => sheet.name === sheetName);
  const selectedProject = projects.find((project) => project.id === projectId);
  const missingFields = inspection?.fields.filter((field) => field.required && !mapping[field.key]) ?? [];

  useEffect(() => () => {
    requestRef.current?.abort();
    requestRef.current = null;
  }, []);

  function resetInspection() {
    setInspection(null);
    setSheetName("");
    setMapping({});
    setSingleProjectConfirmed(false);
    setError(null);
  }

  function validFile() {
    if (!file) throw new Error("Selecione um arquivo CSV ou XLSX exportado do eObra.");
    if (!/\.(csv|xlsx)$/i.test(file.name)) throw new Error("Use um arquivo CSV ou XLSX.");
    if (file.size > MAX_FILE_BYTES) throw new Error("O arquivo deve ter até 4 MB. Separe relatórios maiores em arquivos menores.");
    const row = Number(headerRow);
    if (!Number.isInteger(row) || row < 1 || row > 50) throw new Error("Informe uma linha de cabeçalho entre 1 e 50.");
    return file;
  }

  async function inspectFile() {
    if (requestRef.current) return;
    const request = new AbortController();
    setError(null);
    try {
      const selectedFile = validFile();
      requestRef.current = request;
      resetInspection();
      setPending("inspect");
      const form = new FormData();
      form.set("company_id", companyId);
      form.set("file", selectedFile);
      form.set("entity_kind", entityKind);
      form.set("header_row", headerRow);
      const response = await fetch("/api/imports/eobra/inspect", { method: "POST", body: form, credentials: "same-origin", signal: request.signal });
      const data = await responseBody(response);
      if (request.signal.aborted) return;
      if (!response.ok) throw new Error(errorMessage(data, "Não foi possível ler o arquivo."));
      const result = data as unknown as Inspection;
      if (!Array.isArray(result.sheets) || !result.sheets.length || !Array.isArray(result.fields)) {
        throw new Error("Nenhuma aba com dados foi encontrada. Confira o arquivo e a linha do cabeçalho.");
      }
      const firstSheet = result.sheets[0];
      setInspection(result);
      setSheetName(firstSheet.name);
      setMapping(result.suggested_mappings?.[firstSheet.name] ?? {});
      setSingleProjectConfirmed(false);
    } catch (caught) {
      if (!request.signal.aborted) setError(caught instanceof Error ? caught.message : "Não foi possível ler o arquivo.");
    } finally {
      if (requestRef.current === request) requestRef.current = null;
      if (!request.signal.aborted) setPending(null);
    }
  }

  async function stageFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestRef.current) return;
    const request = new AbortController();
    setError(null);
    try {
      const selectedFile = validFile();
      if (!inspection || !selectedSheet) throw new Error("Leia o arquivo e confira o mapeamento antes de continuar.");
      if (selectedSheet.rowCount > 2000) throw new Error("Cada lote aceita até 2.000 linhas. Separe o relatório em arquivos menores.");
      if (missingFields.length) throw new Error(`Selecione as colunas obrigatórias: ${missingFields.map((field) => field.label).join(", ")}.`);
      if (financial && !selectedProject) throw new Error("Selecione explicitamente a obra que receberá este arquivo.");
      if (financial && !singleProjectConfirmed) throw new Error("Confirme que o arquivo contém somente a obra selecionada.");
      requestRef.current = request;
      setPending("stage");
      const form = new FormData();
      form.set("company_id", companyId);
      form.set("file", selectedFile);
      form.set("entity_kind", entityKind);
      form.set("source_host", sourceHost.trim());
      form.set("reference_date", reference);
      form.set("project_id", financial ? projectId : "");
      form.set("source_sheet", sheetName);
      form.set("header_row", headerRow);
      form.set("mapping", JSON.stringify(mapping));
      form.set("single_project_confirmed", financial && singleProjectConfirmed ? "true" : "false");
      const response = await fetch("/api/imports/eobra/stage", { method: "POST", body: form, credentials: "same-origin", signal: request.signal });
      const data = await responseBody(response);
      if (request.signal.aborted) return;
      if (!response.ok) throw new Error(errorMessage(data, "Não foi possível preparar a prévia."));
      const batchId = typeof data.batch_id === "string" ? data.batch_id : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId)) {
        throw new Error("A prévia não retornou uma identificação válida. Atualize o histórico antes de reenviar.");
      }
      router.push(`/configuracoes/importacoes/${batchId}`);
    } catch (caught) {
      if (requestRef.current === request) requestRef.current = null;
      if (!request.signal.aborted) {
        setError(caught instanceof Error ? caught.message : "Não foi possível preparar a prévia.");
        setPending(null);
      }
    }
  }

  const previewHeaders = selectedSheet?.headers.slice(0, 10) ?? [];
  const sourceProjectHeader = mapping.source_project;
  const sourceProjectSamples = sourceProjectHeader && selectedSheet
    ? [...new Set(selectedSheet.samples.map((sample) => rowText(sample[sourceProjectHeader])).filter((value) => value !== "—"))]
    : [];

  return (
    <form onSubmit={stageFile} className="eobra-import-form">
      <fieldset disabled={disabled || Boolean(pending)}>
        <legend className="elos-visually-hidden">Preparar importação por arquivo</legend>
        <section className="registry-table-panel eobra-card">
          <div className="section-heading"><div><span className="eobra-step">1 · Origem e destino</span><h2>Identifique o que será importado</h2></div></div>
          <div className="eobra-form-grid">
            <label>Tipo de registro<select value={entityKind} onChange={(event) => { setEntityKind(event.target.value as EntityKind); setProjectId(""); resetInspection(); }}>
              {Object.entries(ENTITY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></label>
            <label>Ambiente de origem<input type="text" value={sourceHost} onChange={(event) => { setSourceHost(event.target.value); setSingleProjectConfirmed(false); }} placeholder="empresa.eobra.com.br" required maxLength={253} autoComplete="off" spellCheck={false} /><small>Identifica de qual ambiente vieram os registros.</small></label>
            <label>Data de referência<input type="date" value={reference} onChange={(event) => { setReference(event.target.value); setSingleProjectConfirmed(false); }} required /><small>Data usada para conferir os dados e os saldos.</small></label>
            {financial ? <label className="eobra-wide">Obra de destino<select value={projectId} onChange={(event) => { setProjectId(event.target.value); setSingleProjectConfirmed(false); }} required>
              <option value="">Selecione a obra deste arquivo</option>
              {projects.map((project) => <option value={project.id} key={project.id}>{project.code ? `${project.code} · ` : ""}{project.name}</option>)}
            </select><small>Prepare um arquivo separado por obra. A seleção do cabeçalho do sistema não é aplicada automaticamente aqui.</small></label> : <p className="eobra-muted eobra-wide">Os cadastros de {entityKind === "supplier" ? "fornecedores" : "clientes"} ficarão disponíveis para a empresa ativa.</p>}
          </div>
        </section>

        <section className="registry-table-panel eobra-card">
          <div className="section-heading"><div><span className="eobra-step">2 · Arquivo</span><h2>Leia o relatório exportado do eObra</h2></div><p>CSV ou XLSX · até 4 MB · até 2.000 linhas no arquivo</p></div>
          <div className="eobra-file-grid">
            <label>Arquivo<input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required onChange={(event) => { setFile(event.target.files?.[0] ?? null); resetInspection(); }} /></label>
            <label>Linha do cabeçalho<input type="number" min="1" max="50" step="1" value={headerRow} onChange={(event) => { setHeaderRow(event.target.value); resetInspection(); }} required /><small>Primeira linha com os nomes das colunas.</small></label>
            <button className="elos-button" type="button" onClick={inspectFile} disabled={!file}>{pending === "inspect" ? "Lendo arquivo…" : inspection ? "Ler novamente" : "Ler colunas do arquivo"}</button>
          </div>
          <p className="eobra-muted">Nesta etapa, o arquivo é lido para montar a prévia. A importação dos cadastros e lançamentos será confirmada na próxima tela.</p>
        </section>

        {inspection && selectedSheet ? <section className="registry-table-panel eobra-card">
          <div className="section-heading"><div><span className="eobra-step">3 · Correspondência</span><h2>Confira as colunas</h2></div><p>{selectedSheet.rowCount.toLocaleString("pt-BR")} linha(s) na aba selecionada</p></div>
          <div className="eobra-form-grid">
            <label className="eobra-wide">Aba do arquivo<select value={sheetName} onChange={(event) => { const next = event.target.value; setSheetName(next); setMapping(inspection.suggested_mappings?.[next] ?? {}); setSingleProjectConfirmed(false); }}>
              {inspection.sheets.map((sheet) => <option key={sheet.name} value={sheet.name}>{sheet.name} · {sheet.rowCount.toLocaleString("pt-BR")} linha(s)</option>)}
            </select></label>
          </div>
          <p className="eobra-muted">As sugestões precisam ser conferidas. Campos com * são obrigatórios. O código de origem permite reconhecer um registro em importações futuras.</p>
          <div className="eobra-mapping-grid">
            {inspection.fields.map((field) => <label key={field.key}>{field.label}{field.required ? " *" : ""}<select required={field.required} value={mapping[field.key] ?? ""} onChange={(event) => { setMapping((current) => ({ ...current, [field.key]: event.target.value })); setSingleProjectConfirmed(false); }}>
              <option value="">{field.required ? "Selecione uma coluna" : "Não informado neste arquivo"}</option>
              {selectedSheet.headers.map((header) => <option key={header} value={header}>{header}</option>)}
            </select><small>{mapping[field.key] && selectedSheet.samples[0] ? `Exemplo: ${rowText(selectedSheet.samples[0][mapping[field.key]])}` : "—"}</small></label>)}
          </div>

          <div className="eobra-sample-head"><h3>Amostra do arquivo</h3><p>Até {Math.min(selectedSheet.samples.length, 5)} linhas e 10 colunas. A revisão seguinte considera todas as linhas.</p></div>
          <div className="registry-table-wrap">
            <table className="registry-table eobra-sample-table"><thead><tr>{previewHeaders.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>
              {selectedSheet.samples.slice(0, 5).map((sample, index) => <tr key={index}>{previewHeaders.map((header) => <td key={header}>{rowText(sample[header])}</td>)}</tr>)}
              {!selectedSheet.samples.length ? <tr><td colSpan={Math.max(previewHeaders.length, 1)}>Nenhuma linha de dados nesta aba.</td></tr> : null}
            </tbody></table>
          </div>
          {financial ? <div className="eobra-scope-check">
            <strong>Destino: {selectedProject?.name ?? "selecione uma obra no passo 1"}</strong>
            <p>{sourceProjectHeader ? `Obra na amostra da origem: ${sourceProjectSamples.join("; ") || "sem valor identificado"}.` : "Se o arquivo tiver uma coluna de obra, associe-a no mapeamento para conferir a origem."} Arquivos com mais de uma obra precisam ser separados.</p>
            <label className="eobra-checkbox"><input type="checkbox" checked={singleProjectConfirmed} onChange={(event) => setSingleProjectConfirmed(event.target.checked)} required /><span>Confirmei que este arquivo contém somente a obra selecionada.</span></label>
          </div> : null}
          <div className="eobra-actions"><button className="elos-button primary" type="submit" disabled={!selectedSheet.rowCount || selectedSheet.rowCount > 2000 || Boolean(missingFields.length) || (financial && (!projectId || !singleProjectConfirmed))}>{pending === "stage" ? "Preparando prévia…" : "Preparar prévia para revisão"}</button><span className="eobra-muted">Você verá registros, pendências e totais antes de importar.</span></div>
          {selectedSheet.rowCount > 2000 ? <p role="alert" className="eobra-error">Esta aba ultrapassa 2.000 linhas. Divida o relatório antes de continuar.</p> : null}
        </section> : null}
      </fieldset>
      {error ? <div role="alert" className="auth-message error workspace-message">{error}</div> : null}
      {pending ? <p className="eobra-muted" role="status">{pending === "inspect" ? "Lendo as abas e os cabeçalhos do arquivo…" : "Validando registros e preparando a tela de revisão…"}</p> : null}
    </form>
  );
}
