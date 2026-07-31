import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

const updatedAt = "31 de julho de 2026";

const documents = {
  privacidade: {
    title: "Política de Privacidade",
    description: "Política de privacidade do Bossa CRM, produto tecnológico da Elos Engenharia.",
    sections: [
      ["1. Quem somos", "O Bossa CRM é uma plataforma SaaS desenvolvida e operada pela Elos Engenharia para apoiar empresas na gestão de atendimento comercial. A Bossa Empreendimentos é a operação que utiliza atualmente a plataforma para relacionamento com clientes e corretores."],
      ["2. Dados tratados", "Podemos tratar dados fornecidos pelo titular ou recebidos por canais autorizados, como nome, telefone, e-mail, empresa ou imobiliária, CRECI, interesse imobiliário, histórico de mensagens, arquivos compartilhados, preferências comerciais, status de entrega e registros técnicos necessários ao funcionamento e à segurança do sistema."],
      ["3. Finalidades", "Os dados são usados para responder solicitações, organizar oportunidades, encaminhar atendimentos, manter histórico de relacionamento, enviar comunicações autorizadas, prevenir abuso e cumprir obrigações legais ou regulatórias."],
      ["4. WhatsApp e Meta", "Quando o atendimento ocorre pelo WhatsApp, mensagens, mídias e eventos necessários podem ser processados pelos serviços oficiais da Meta e integrados ao Bossa CRM. O sistema acessa somente contas, números e ativos selecionados e autorizados pelo administrador da empresa."],
      ["5. Inteligência artificial", "A plataforma pode utilizar inteligência artificial para auxiliar em respostas, classificação de contatos, resumo de conversas e seleção de materiais autorizados. A equipe humana pode revisar, interromper ou assumir o atendimento a qualquer momento."],
      ["6. Compartilhamento e operadores", "Os dados podem ser tratados por fornecedores de infraestrutura, banco de dados, hospedagem, mensageria e inteligência artificial estritamente para operar o serviço. A Elos Engenharia não vende dados pessoais nem os utiliza para publicidade de terceiros."],
      ["7. Segurança e retenção", "São adotados controles de acesso, autenticação, segregação por organização, criptografia de credenciais e armazenamento protegido. Os dados são mantidos pelo período necessário às finalidades informadas e às obrigações legais aplicáveis."],
      ["8. Direitos do titular", "O titular pode solicitar confirmação de tratamento, acesso, correção, informação sobre compartilhamento, oposição e exclusão, observadas as hipóteses legais de conservação."],
      ["9. Contato", "Solicitações relacionadas à privacidade podem ser encaminhadas para fabio.nicodemus@gmail.com."],
    ],
  },
  termos: {
    title: "Termos de Uso",
    description: "Termos de uso do Bossa CRM, produto tecnológico da Elos Engenharia.",
    sections: [
      ["1. Objeto", "Estes termos regulam o uso do Bossa CRM, plataforma SaaS desenvolvida e operada pela Elos Engenharia para atendimento e gestão comercial."],
      ["2. Uso permitido", "O usuário deve utilizar o sistema de forma legítima, segura e compatível com suas atribuições. É proibido acessar contas de terceiros, burlar controles de segurança, extrair dados sem autorização, introduzir código malicioso, enviar spam ou realizar atividades ilícitas."],
      ["3. Credenciais e acesso", "Cada usuário é responsável por proteger suas credenciais e comunicar qualquer suspeita de acesso indevido. O acesso pode ser suspenso diante de risco de segurança ou uso incompatível."],
      ["4. Integrações", "O funcionamento de integrações com Meta, WhatsApp, hospedagem, banco de dados e outros fornecedores depende das condições e disponibilidade desses serviços. Alterações externas podem afetar temporariamente recursos da plataforma."],
      ["5. Conteúdo comercial", "Informações sobre preços, disponibilidade, condições de pagamento, unidades, prazos e propostas dependem de confirmação da empresa responsável pelo atendimento e de seus documentos oficiais."],
      ["6. Inteligência artificial", "Respostas assistidas por inteligência artificial apoiam o atendimento, mas não substituem validação humana em negociações, propostas, reservas, reclamações ou temas sensíveis."],
      ["7. Propriedade intelectual", "O software, identidade visual, textos e demais conteúdos do Bossa CRM são protegidos pela legislação aplicável. O acesso não transfere direitos de propriedade."],
      ["8. Contato", "Dúvidas sobre estes termos podem ser encaminhadas para fabio.nicodemus@gmail.com."],
    ],
  },
  "exclusao-de-dados": {
    title: "Instruções para Exclusão de Dados",
    description: "Como solicitar exclusão de dados relacionados ao Bossa CRM.",
    sections: [
      ["1. Como solicitar", "Envie a solicitação para fabio.nicodemus@gmail.com informando nome, telefone com DDD, e-mail quando houver e quais dados ou conversas deseja excluir."],
      ["2. Confirmação de identidade", "Para proteger o titular, poderão ser solicitadas informações adicionais estritamente necessárias para confirmar a identidade e evitar exclusões indevidas. Nunca solicitamos senhas do Facebook, WhatsApp, Meta ou do CRM."],
      ["3. Prazo e retorno", "Após a validação, a empresa informará o andamento e adotará as medidas cabíveis para excluir ou anonimizar os dados sob seu controle, ressalvados registros mantidos por obrigação legal, exercício regular de direitos, prevenção a fraude ou segurança."],
      ["4. Plataformas de terceiros", "A exclusão no Bossa CRM não elimina automaticamente dados mantidos pela Meta, WhatsApp ou outros fornecedores em suas próprias plataformas. Para esses dados, o titular deve utilizar também os controles oferecidos pelo respectivo fornecedor."],
      ["5. Revogação da integração", "Administradores podem desconectar canais no CRM e revogar acessos no painel da Meta. A desconexão interrompe novos eventos, mas não substitui uma solicitação específica de exclusão dos registros armazenados."],
    ],
  },
} as const;

type DocumentKey = keyof typeof documents;

export async function generateMetadata({ params }: { params: Promise<{ documento: string }> }): Promise<Metadata> {
  const { documento } = await params;
  const document = documents[documento as DocumentKey];
  if (!document) return {};
  return {
    title: `${document.title} | Bossa CRM · Elos Engenharia`,
    description: document.description,
  };
}

export default async function LegalPage({ params }: { params: Promise<{ documento: string }> }) {
  const { documento } = await params;
  const document = documents[documento as DocumentKey];
  if (!document) notFound();

  return (
    <main style={{ minHeight: "100vh", background: "#f4f1eb", padding: "40px 18px", color: "#27343a" }}>
      <article style={{ maxWidth: 920, margin: "0 auto", background: "#fff", borderRadius: 18, padding: "36px clamp(22px, 5vw, 64px)", boxShadow: "0 12px 40px rgba(30, 45, 50, 0.08)" }}>
        <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 1.2, color: "#1c5966", textTransform: "uppercase" }}>
          Elos Engenharia · Bossa CRM
        </div>
        <h1 style={{ fontSize: "clamp(30px, 5vw, 48px)", lineHeight: 1.08, margin: "12px 0 10px", fontFamily: "Georgia, serif" }}>
          {document.title}
        </h1>
        <p style={{ color: "#637078", margin: 0 }}>Atualizado em {updatedAt}</p>
        <div style={{ height: 1, background: "#e4e1db", margin: "28px 0" }} />

        {document.sections.map(([title, text]) => (
          <section key={title} style={{ marginBottom: 26 }}>
            <h2 style={{ fontSize: 20, margin: "0 0 8px" }}>{title}</h2>
            <p style={{ fontSize: 16, lineHeight: 1.75, margin: 0, color: "#46535a" }}>{text}</p>
          </section>
        ))}

        <div style={{ height: 1, background: "#e4e1db", margin: "30px 0 22px" }} />
        <nav style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 14 }}>
          <Link href="/bossa-crm">Sobre o Bossa CRM</Link>
          <Link href="/bossa-crm/legal/privacidade">Privacidade</Link>
          <Link href="/bossa-crm/legal/termos">Termos de uso</Link>
          <Link href="/bossa-crm/legal/exclusao-de-dados">Exclusão de dados</Link>
        </nav>
      </article>
    </main>
  );
}
