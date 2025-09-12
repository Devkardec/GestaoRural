// frontend/js/premiumDynamic.js
// Gera dinamicamente o link de pagamento Asaas atrelado ao usuário logado.

// Requer Firebase já carregado (mesmo esquema da página principal) ou incluir firebase CDN aqui.
// Assumindo que você já incluiu os scripts firebase auth em outra tag <script type="module"> se necessário.

const BACKEND_BASE = 'https://agrocultive-backend.onrender.com'; // Ajuste se mudar domínio

async function obterIdToken() {
  if (!window.firebase || !firebase.auth().currentUser) return null;
  return firebase.auth().currentUser.getIdToken();
}

async function criarOuObterLinkPagamento(plan) {
  const statusEl = document.getElementById('dynamic-premium-status');
  const btn = document.getElementById('dynamic-premium-btn');
  const priceInfo = document.getElementById('dynamic-premium-price');

  try {
    btn.disabled = true;
    btn.textContent = 'Gerando...';

    const idToken = await obterIdToken();
    if (!idToken) {
      statusEl.textContent = 'Faça login para gerar seu link.';
      btn.textContent = 'Login necessário';
      return;
    }

    // 1. Tenta obter link existente
    let existing = await fetch(`${BACKEND_BASE}/asaas/payment-link`, {
      headers: { 'Authorization': 'Bearer ' + idToken }
    });
    if (existing.ok) {
      const data = await existing.json();
      statusEl.textContent = `Status atual: ${data.premiumStatus}`;
      btn.textContent = 'Ir para Pagamento';
      btn.onclick = () => window.open(data.paymentLink, '_blank');
      btn.disabled = false;
      return;
    }

    // 2. Se não existe, cria assinatura
    const user = firebase.auth().currentUser;
    const body = {
      uid: user.uid,
      name: user.displayName || user.email?.split('@')[0] || 'Usuário',
      email: user.email,
      cpfCnpj: '',
      phone: '',
      subscriptionPlan: {
        value: plan.value, // 49.90 exemplo
        description: plan.description,
        cycle: plan.cycle // MONTHLY ou YEARLY
      }
    };

    const created = await fetch(`${BACKEND_BASE}/asaas/subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!created.ok) {
      const errText = await created.text();
      throw new Error('Falha ao criar assinatura: ' + errText);
    }

    const createdData = await created.json();
    statusEl.textContent = 'Assinatura criada. Abra e conclua o pagamento.';
    btn.textContent = 'Abrir Link de Pagamento';
    btn.onclick = () => window.open(createdData.paymentLink, '_blank');
    btn.disabled = false;
  } catch (e) {
    console.error(e);
    statusEl.textContent = 'Erro: ' + e.message;
    btn.textContent = 'Tentar novamente';
    btn.disabled = false;
  }
}

const PLANOS = {
  YEARLY: { value: 49.90, description: 'Plano Premium - AgroCultive (Anual)', cycle: 'YEARLY' },
  MONTHLY: { value: 9.90, description: 'Plano Premium - AgroCultive (Mensal)', cycle: 'MONTHLY' }
};

async function carregarStatusAtual() {
  const statusEl = document.getElementById('dynamic-premium-status');
  const daysEl = document.getElementById('dynamic-days-remaining');
  try {
    const idToken = await obterIdToken();
    if (!idToken) return;
    const resp = await fetch(`${BACKEND_BASE}/asaas/status`, { headers: { 'Authorization': 'Bearer ' + idToken } });
    if (!resp.ok) return;
    const data = await resp.json();
    if (statusEl) statusEl.textContent = `Status: ${data.premiumStatus}`;
    if (daysEl && typeof data.daysRemaining === 'number') {
      if (data.premiumStatus === 'TRIAL') daysEl.textContent = `Dias restantes de teste: ${data.daysRemaining}`;
      else if (data.premiumStatus === 'ACTIVE') daysEl.textContent = 'Assinatura ativa.';
      else daysEl.textContent = '';
    }
  } catch (e) {
    console.warn('Falha ao carregar status:', e.message);
  }
}

// Substitui criação fixa por seleção
window.initPremiumDynamic = function() {
  const btn = document.getElementById('dynamic-premium-btn');
  const select = document.getElementById('dynamic-plan-select');
  if (btn) {
    btn.addEventListener('click', () => {
      const planKey = (select && select.value) || 'YEARLY';
      criarOuObterLinkPagamento(PLANOS[planKey]);
    });
  }
  carregarStatusAtual();
};
