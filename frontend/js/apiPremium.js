// frontend/js/apiPremium.js
// Funções para consumir API do backend e obter status premium do usuário

async function obterUsuarioPremium(email) {
  try {
    const res = await fetch(`/asaas/usuario?email=${encodeURIComponent(email)}`);
    if (!res.ok) throw new Error('Usuário não encontrado');
    return await res.json();
  } catch (err) {
    console.error('Erro ao obter usuário premium:', err);
    return null;
  }
}

// Exemplo de uso:
// const usuario = await obterUsuarioPremium('maria@teste.com');
// mostrarStatusPremium(usuario);
// redirecionarSeBloqueado(usuario, usuario.linkPagamento);
