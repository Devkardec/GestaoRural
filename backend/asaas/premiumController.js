// backend/asaas/premiumController.js
// Lógica para controle de trial, status premium e bloqueio automático
// Exemplo usando um banco de dados fictício (substitua pelo seu banco real)

const db = require('../db'); // Implemente ou adapte para seu banco

// Atualiza status premium do usuário conforme evento do Asaas
async function atualizarStatusPremium(evento) {
  const { event, payment, customer } = evento;
  // Exemplo: buscar usuário pelo ID do cliente Asaas
  const usuario = await db.getUsuarioPorClienteAsaas(customer);
  if (!usuario) return;

  // Lógica de atualização conforme evento
  if (event === 'PAYMENT_RECEIVED') {
    // Pagamento confirmado, libera premium
    await db.atualizarUsuario(usuario.id, {
      premiumStatus: 'ativo',
      paymentStatus: 'pago'
    });
  } else if (event === 'PAYMENT_OVERDUE' || event === 'PAYMENT_DELETED') {
    // Pagamento atrasado ou cancelado, bloqueia premium
    await db.atualizarUsuario(usuario.id, {
      premiumStatus: 'bloqueado',
      paymentStatus: 'inadimplente'
    });
  }
  // Adicione outros eventos conforme necessário
}

// Cria usuário com período de teste de 7 dias
async function criarUsuarioTrial(dados) {
  const trialStart = new Date();
  const trialEnd = new Date(trialStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  return await db.criarUsuario({
    ...dados,
    trialStart,
    trialEnd,
    premiumStatus: 'trial',
    paymentStatus: 'pendente'
  });
}

// Verifica e bloqueia usuários que passaram do período de teste sem pagar
async function bloquearUsuariosTrialExpirado() {
  const agora = new Date();
  const usuarios = await db.getUsuariosComTrialExpirado(agora);
  for (const usuario of usuarios) {
    if (usuario.paymentStatus !== 'pago') {
      await db.atualizarUsuario(usuario.id, {
        premiumStatus: 'bloqueado'
      });
    }
  }
}

module.exports = {
  atualizarStatusPremium,
  criarUsuarioTrial,
  bloquearUsuariosTrialExpirado
};
