import { healthCheck as insforgeHealth } from '../lib/insforge-client.js';
import { listProvidersStatus } from '../lib/ai-provider.js';

export default async function handler(req, res) {
  const [insforge, providers] = await Promise.all([
    insforgeHealth(),
    listProvidersStatus()
  ]);

  const anyWorking = providers.some(p => p.reachable);
  const anyConfigured = providers.some(p => p.configured);

  res.status(insforge.ok && anyWorking ? 200 : 503).json({
    status: insforge.ok && anyWorking ? 'ok' : 'degraded',
    service: 'proonboarding-api',
    version: '0.2.2',
    timestamp: new Date().toISOString(),
    providers: providers.map(p => ({
      name: p.name,
      configured: p.configured,
      reachable: p.reachable
    })),
    insforge
  });
}
