import express from 'express';
import { runHomologation } from './runner.mjs';

const app = express();
app.use(express.json({ limit: '1mb' }));

function authorized(req) {
  const expected = process.env.AGENT_RUN_TOKEN?.trim();
  if (!expected) return false;
  const received = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return received === expected;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'elos-homologation-agent', version: '0.1.0' });
});

app.post('/run', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Não autorizado' });
  try {
    const report = await runHomologation({ phase: String(req.body?.phase || 'smoke') });
    return res.json(report);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

const port = Number(process.env.PORT || 8080);
app.listen(port, '0.0.0.0', () => {
  console.log(`Elos homologation agent listening on ${port}`);
});
