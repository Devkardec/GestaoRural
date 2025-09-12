/**
 * Script utilitário para gerar um novo par de chaves VAPID.
 * Uso: node generate-vapid.js
 * IMPORTANTE: NUNCA commitar a PRIVATE KEY no repositório.
 */

const webpush = require('web-push');

function gerar() {
  const keys = webpush.generateVAPIDKeys();
  console.log('================ VAPID KEYS GERADAS ================');
  console.log('\nPUBLIC KEY (usar em VAPID_PUBLIC_KEY e FRONTEND_VAPID_PUBLIC_KEY):');
  console.log(keys.publicKey);
  console.log('\nPRIVATE KEY (apenas em variável de ambiente VAPID_PRIVATE_KEY):');
  console.log(keys.privateKey);
  console.log('\nSubject sugerido (VAPID_SUBJECT): mailto:suporte@seu-dominio.com');
  console.log('\nPróximos passos:');
  console.log('1. Copiar as duas chaves (NÃO compartilhar a privada).');
  console.log('2. Netlify > Site > Settings > Environment > Add/Edit:');
  console.log('     VAPID_PUBLIC_KEY  = (public)');
  console.log('     VAPID_PRIVATE_KEY = (private)');
  console.log('     VAPID_SUBJECT     = mailto:seu-email@dominio.com');
  console.log('3. Atualizar FRONTEND_VAPID_PUBLIC_KEY em assets/js/index.inline3.js.');
  console.log('4. Deploy e depois limpar SW / aceitar notificações novamente.');
  console.log('=====================================================');
}

try {
  gerar();
} catch (e) {
  console.error('Falha ao gerar chaves VAPID:', e);
  process.exit(1);
}
