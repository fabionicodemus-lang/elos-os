"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

type RoutePresentation = {
  group: string;
  eyebrow: string;
  title: string;
};

function presentationFor(pathname: string): RoutePresentation | null {
  if (pathname === "/empreendimentos") return { group: "Cadastros", eyebrow: "Cadastros · Base do sistema", title: "Empreendimentos" };
  if (pathname.startsWith("/empreendimentos/empresas")) return { group: "Cadastros", eyebrow: "Cadastros · Empreendimentos", title: "Empresas" };
  if (pathname.startsWith("/empreendimentos/locais")) return { group: "Cadastros", eyebrow: "Cadastros · Empreendimentos", title: "Locais da obra" };
  if (pathname.startsWith("/empreendimentos/caracteristicas")) return { group: "Cadastros", eyebrow: "Cadastros · Empreendimentos", title: "Características" };
  if (pathname.startsWith("/empreendimentos/unidades")) return { group: "Cadastros", eyebrow: "Cadastros · Empreendimentos", title: "Unidades" };
  if (pathname.startsWith("/cadastros/clientes")) return { group: "Cadastros", eyebrow: "Cadastros · Pessoas", title: "Clientes" };
  if (pathname.startsWith("/cadastros/fornecedores")) return { group: "Cadastros", eyebrow: "Cadastros · Pessoas", title: "Fornecedores" };

  if (pathname.startsWith("/pos-obra/assistencias")) return { group: "Pós-Obra", eyebrow: "Pós-Obra · Atendimento", title: "Assistência Técnica" };
  if (pathname.startsWith("/pos-obra/garantias")) return { group: "Pós-Obra", eyebrow: "Pós-Obra · Cobertura e manutenção", title: "Garantias" };
  if (pathname.startsWith("/pos-obra/vistorias")) return { group: "Pós-Obra", eyebrow: "Pós-Obra · Entrega", title: "Vistorias de Entrega" };

  if (pathname.startsWith("/rh/colaboradores")) return { group: "RH", eyebrow: "RH · Pessoas", title: "Colaboradores" };
  if (pathname.startsWith("/rh/folha")) return { group: "RH", eyebrow: "RH · Folha", title: "Folha de Pagamento" };
  return null;
}

function replaceLeadingText(element: HTMLElement | null, value: string) {
  if (!element) return;
  const textNode = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
  if (textNode) textNode.textContent = value;
  else element.prepend(document.createTextNode(value));
}

export default function FinalModuleStructure() {
  const pathname = usePathname();

  useEffect(() => {
    const presentation = presentationFor(pathname);
    if (!presentation) return;

    const breadcrumbGroup = document.querySelector<HTMLElement>(".elos-breadcrumb b");
    const breadcrumbTitle = document.querySelector<HTMLElement>(".elos-breadcrumb > span:last-child");
    const eyebrow = document.querySelector<HTMLElement>(".elos-eyebrow");
    const title = document.querySelector<HTMLElement>(".elos-page-top h1");

    if (breadcrumbGroup) breadcrumbGroup.textContent = presentation.group;
    if (breadcrumbTitle) breadcrumbTitle.textContent = presentation.title;
    if (eyebrow) eyebrow.textContent = presentation.eyebrow;
    replaceLeadingText(title, presentation.title);
  }, [pathname]);

  return null;
}
