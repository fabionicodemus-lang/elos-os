import type { NextConfig } from "next";

// Cabeçalhos de segurança aplicados a todas as páginas.
const securityHeaders = [
  // Força HTTPS por 2 anos, inclusive subdomínios.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Impede que o Elos OS seja embutido em sites de terceiros (clickjacking).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  // Impede o navegador de "adivinhar" o tipo de arquivo.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Não vaza endereços internos para outros sites.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Bloqueia recursos do aparelho que o sistema não usa. Câmera e localização ficam liberadas para fotos de obra.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["exceljs"],
  experimental: {
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
