import express from 'express';
import { runHomologation } from './runner.mjs';
import { runPhase0 } from './phase0.mjs';

const app = express();
app.use(express.json({ limit: '1mb' }));

function authorized(req) {
  const expected = process.env.AGENT_RUN_TOKEN?.trim();
  if (!expected) return false;
  const received = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return received === expected;
}

async function executePhase(phase) {
  return phase === 'phase0' ? runPhase0() : runHomologation({ phase });
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'elos-homologation-agent', version: '0.3.0' });
});

app.post('/run', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Não autorizado' });
  try {
    const phase = String(req.body?.phase || 'smoke');
    const report = await executePhase(phase);
    return res.json(report);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

const port = Number(process.env.PORT || 8080);
app.listen(port, '0.0.0.0', () => {
  console.log(`Elos homologation agent listening on ${port}`);

  const autoPhase = process.env.AUTO_RUN_PHASE?.trim();
  if (autoPhase) {
    setTimeout(async () => {
      try {
        console.log(`[autorun] iniciando fase ${autoPhase}`);
        const report = await executePhase(autoPhase);
        console.log(`[autorun] concluído: ${report.passed}/${report.total} aprovadas; ${report.failed} falhas`);
        for (const result of report.results || []) {
          const detail = result.status === 'passed' ? result.details || 'ok' : result.error || 'falha sem detalhe';
          console.log(`[autorun] ${result.status.toUpperCase()} ${result.name || result.route}: ${detail}`);
        }
      } catch (error) {
        console.error('[autorun] falhou:', error instanceof Error ? error.stack || error.message : String(error));
      }
    }, 3000);
  }
});
