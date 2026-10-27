/**
 * Cria a instância do WhatsApp na Evolution API e registra o webhook deste backend.
 * (O backend já faz isso sozinho ao subir e o admin também pode fazer pelo painel; este script é a via manual.)
 * Uso: npm run evolution:setup
 */
import { EvolutionClient } from '../src/channels/evolution.js';
import { config, webhookUrl } from '../src/config.js';

const evolution = new EvolutionClient(config);
const url = webhookUrl(config);

if (!evolution.enabled) {
  console.error('Defina EVOLUTION_API_URL e EVOLUTION_API_KEY no .env');
  process.exit(1);
}
if (!url) {
  console.error('Defina PUBLIC_WEBHOOK_URL no .env (URL que a Evolution consegue acessar).');
  process.exit(1);
}

await evolution.ensureInstance(url);
await evolution.setWebhook(url);
console.log(`Instância "${evolution.instance}" pronta e webhook registrado → ${url}`);
console.log(`Estado: ${await evolution.state()}. Conecte o número pelo painel de admin do frontend (ou ${config.EVOLUTION_API_URL}/manager).`);
