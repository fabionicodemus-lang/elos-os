"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

type PreviewItem = { url: string; name: string; type: string };

const FORM_SELECTOR = ".daily-log-editor form, .quality-inspection-editor form, .material-request-page form, .execution-page form";
const FILE_SELECTOR = '.daily-log-editor input[type="file"], .quality-inspection-editor input[type="file"]';

function isImage(file: File) {
  return file.type.startsWith("image/");
}

async function compressImage(file: File): Promise<File> {
  if (!isImage(file) || file.size < 1_800_000 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) return file;
  if (typeof createImageBitmap !== "function") return file;

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const maxSide = 1920;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1 && file.size < 3_000_000) {
      bitmap.close();
      return file;
    }
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return file;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const mime = file.type === "image/png" ? "image/webp" : file.type;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.82));
    if (!blob || blob.size >= file.size) return file;
    const extension = mime === "image/webp" ? "webp" : "jpg";
    const name = file.name.replace(/\.[^.]+$/, "") + "." + extension;
    return new File([blob], name, { type: mime, lastModified: file.lastModified });
  } catch {
    return file;
  }
}

function previewHost(input: HTMLInputElement) {
  let host = input.parentElement?.querySelector<HTMLElement>(".worksite-file-preview");
  if (!host) {
    host = document.createElement("div");
    host.className = "worksite-file-preview";
    input.insertAdjacentElement("afterend", host);
  }
  return host;
}

function renderPreview(input: HTMLInputElement, items: PreviewItem[]) {
  const host = previewHost(input);
  host.innerHTML = "";
  if (!items.length) return;
  const summary = document.createElement("div");
  summary.className = "worksite-file-summary";
  summary.textContent = `${items.length} arquivo(s) pronto(s) para enviar`;
  host.appendChild(summary);
  const grid = document.createElement("div");
  grid.className = "worksite-file-grid";
  for (const item of items.slice(0, 8)) {
    const card = document.createElement("div");
    card.className = "worksite-file-card";
    if (item.type.startsWith("image/")) {
      const img = document.createElement("img");
      img.src = item.url;
      img.alt = item.name;
      card.appendChild(img);
    } else {
      const file = document.createElement("span");
      file.textContent = "PDF";
      card.appendChild(file);
    }
    const name = document.createElement("small");
    name.textContent = item.name;
    card.appendChild(name);
    grid.appendChild(card);
  }
  if (items.length > 8) {
    const more = document.createElement("div");
    more.className = "worksite-file-more";
    more.textContent = `+${items.length - 8}`;
    grid.appendChild(more);
  }
  host.appendChild(grid);
}

function routeLabel(pathname: string) {
  if (pathname.startsWith("/execucao/diario-obras")) return "Diário de Obras";
  if (pathname.startsWith("/execucao/qualidade")) return "Qualidade";
  if (pathname.startsWith("/execucao/cronograma")) return "Cronograma";
  if (pathname.startsWith("/execucao/solicitacoes-materiais")) return "Materiais";
  if (pathname.startsWith("/execucao/contratos-servicos")) return "Contratos";
  return "Obra";
}

export default function WorksiteMobileEnhancer() {
  const pathname = usePathname();
  const [online, setOnline] = useState(true);
  const [dirty, setDirty] = useState(false);
  const label = useMemo(() => routeLabel(pathname), [pathname]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    const urls = new Map<HTMLInputElement, string[]>();
    let processing = false;

    const markDirty = (event: Event) => {
      const target = event.target as Element | null;
      if (target?.closest(FORM_SELECTOR)) setDirty(true);
    };
    const clearDirty = (event: Event) => {
      const target = event.target as Element | null;
      if (target?.matches(FORM_SELECTOR)) setDirty(false);
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };

    const enhanceInput = async (input: HTMLInputElement) => {
      if (processing || !input.files?.length) return;
      processing = true;
      input.dataset.processing = "true";
      try {
        const previous = urls.get(input) ?? [];
        previous.forEach((url) => URL.revokeObjectURL(url));

        const compressed = await Promise.all(Array.from(input.files).map(compressImage));
        if (typeof DataTransfer !== "undefined") {
          const transfer = new DataTransfer();
          compressed.forEach((file) => transfer.items.add(file));
          input.files = transfer.files;
        }
        const nextUrls: string[] = [];
        const preview = compressed.map((file) => {
          const url = isImage(file) ? URL.createObjectURL(file) : "";
          if (url) nextUrls.push(url);
          return { url, name: file.name, type: file.type };
        });
        urls.set(input, nextUrls);
        renderPreview(input, preview);
      } finally {
        delete input.dataset.processing;
        processing = false;
      }
    };

    const onChange = (event: Event) => {
      markDirty(event);
      const input = event.target as HTMLInputElement | null;
      if (!input?.matches(FILE_SELECTOR)) return;
      void enhanceInput(input);
    };

    const applyCaptureHints = () => {
      document.querySelectorAll<HTMLInputElement>(FILE_SELECTOR).forEach((input) => {
        const accept = input.accept.toLowerCase();
        if (accept.includes("image/") || accept.includes("image/jpeg")) {
          input.setAttribute("data-field-photo", "true");
          input.setAttribute("capture", "environment");
          input.setAttribute("aria-label", "Abrir câmera ou escolher fotos");
        }
      });
    };

    applyCaptureHints();
    const observer = new MutationObserver(applyCaptureHints);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("input", markDirty, true);
    document.addEventListener("change", onChange, true);
    document.addEventListener("submit", clearDirty, true);
    window.addEventListener("beforeunload", beforeUnload);

    return () => {
      observer.disconnect();
      document.removeEventListener("input", markDirty, true);
      document.removeEventListener("change", onChange, true);
      document.removeEventListener("submit", clearDirty, true);
      window.removeEventListener("beforeunload", beforeUnload);
      urls.forEach((entries) => entries.forEach((url) => URL.revokeObjectURL(url)));
    };
  }, [dirty]);

  return (
    <>
      <div className={`worksite-connectivity ${online ? "online" : "offline"}`} role="status" aria-live="polite">
        <span>{online ? "●" : "○"}</span>
        <strong>{label}</strong>
        <small>{online ? (dirty ? "alterações ainda não salvas" : "conectado") : "sem internet · não feche esta tela"}</small>
      </div>
      {dirty ? <div className="worksite-dirty-dot" title="Há alterações ainda não salvas">•</div> : null}
    </>
  );
}
