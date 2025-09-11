// backend/testeRequisicoes.js
// Script para testar cadastro de usuário, assinatura e simular webhook

const axios = require('axios');

async function criarUsuario() {
  const url = 'http://localhost:3001/asaas/criar-usuario';
  const dados = {
    nome: 'Maria Teste',
    email: 'maria@teste.com',
    cpfCnpj: '12345678901',
    telefone: '11988887777',
    valorPlano: 49.90,
    descricaoPlano: 'Pacote Premium'
  };
  try {
    const res = await axios.post(url, dados);
    console.log('Usuário criado:', res.data.usuario);
    console.log('Link de pagamento:', res.data.linkPagamento);
    return res.data.usuario;
  } catch (err) {
    console.error('Erro ao criar usuário:', err.response?.data || err.message);
  }
}

async function simularWebhook(clienteAsaasId, evento = 'PAYMENT_RECEIVED') {
  const url = 'http://localhost:3001/asaas/webhook';
  const body = {
    event: evento,
    customer: clienteAsaasId,
    payment: { id: 'fake-payment-id' }
  };
  try {
    const res = await axios.post(url, body);
    console.log('Webhook enviado:', res.status);
  } catch (err) {
    console.error('Erro ao enviar webhook:', err.response?.data || err.message);
  }
}

// Exemplo de uso
(async () => {
  const usuario = await criarUsuario();
  if (usuario) {
    await simularWebhook(usuario.clienteAsaasId, 'PAYMENT_RECEIVED');
    await simularWebhook(usuario.clienteAsaasId, 'PAYMENT_OVERDUE');
  }
})();
