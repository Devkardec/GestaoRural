// frontend/js/premiumStatus.js
// Funções para exibir status do plano e redirecionar para pagamento

function mostrarStatusPremium(usuario) {
  const statusEl = document.getElementById('premium-status');
  let texto = '';
  switch (usuario.premiumStatus) {
    case 'ativo':
      texto = 'Seu plano Premium está ativo.';
      break;
    case 'trial':
      texto = `Você está no período de teste gratuito até ${new Date(usuario.trialEnd).toLocaleDateString()}`;
      break;
    case 'bloqueado':
      texto = 'Seu acesso Premium está bloqueado. Realize o pagamento para liberar.';
      break;
    default:
      texto = 'Status desconhecido.';
  }
  statusEl.textContent = texto;
}

function redirecionarSeBloqueado(usuario, linkPagamento) {
  if (usuario.premiumStatus === 'bloqueado') {
    window.location.href = linkPagamento;
  }
}

// Exemplo de uso:
// mostrarStatusPremium(usuario);
// redirecionarSeBloqueado(usuario, usuario.linkPagamento);
