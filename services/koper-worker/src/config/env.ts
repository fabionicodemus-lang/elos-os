import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  WORKER_API_KEY: z.string().min(32),
  BROWSERLESS_WS_URL: z.string().url(),
  BROWSERLESS_TOKEN: z.string().min(1),
  KOPER_LOGIN_URL: z.string().url(),
  KOPER_USERNAME: z.string().min(1),
  KOPER_PASSWORD: z.string().min(1),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(32).optional(),
  BOSSA_COMPANY_ID: z.string().uuid(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");

  throw new Error(`Variáveis inválidas do koper-worker: ${details}`);
}

export const env = parsed.data;
