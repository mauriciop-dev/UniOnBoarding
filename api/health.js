import { healthCheck as insforgeHealth } from '../lib/insforge-client.js';
import { listProvidersStatus } from '../lib/ai-provider.js';
import { applyCors, isPreflight } from '../lib/cors.js';

export default async function handler(req, res) {
  applyCors(req, res);
  if (isPreflight(req)) return res.status(204).end();

  const [insforge, providers] = await Promise.all([
    insforgeHealth(),
    listProvidersStatus()
  ]);

  const anyWorking = providers.some(p => p.reachable);
  const anyConfigured = providers.some(p => p.configured);

  res.status(insforge.ok && anyWorking ? 200 : 503).json({
    status: insforge.ok && anyWorking ? 'ok' : 'degraded',
    service: 'proonboarding-api',
    version: '0.3.0-gemini-intent',
    timestamp: new Date().toISOString(),
    providers: providers.map(p => ({
      name: p.name,
      configured: p.configured,
      reachable: p.reachable
    })),
    insforge
  });
}
