import { healthCheck as insforgeHealth } from '../lib/insforge-client.js';
import { listProvidersStatus } from '../lib/ai-provider.js';

export default async function handler(req, res) {
  const insforge = await insforgeHealth();
  const providers = listProvidersStatus();

  const allOk = insforge.ok && providers.some(p => p.configured);

  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    service: 'proonboarding-api',
    version: '0.2.0',
    timestamp: new Date().toISOString(),
    providers,
    insforge
  });
}
