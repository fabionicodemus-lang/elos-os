import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  WORKER_API_KEY: z.string().min(32),
  BROWSERLESS_WS_URL: z.string().url(),
  BROWSERLESS_TOKEN: z.string().min(1),
  KOPER_LOGIN_URL: z.string().url(),
  KOPER_LOGIN_SESSION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(900_000)
    .default(300_000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");

  throw new Error(`Variáveis inválidas do koper-worker: ${details}`);
}

export const env = parsed.data;
