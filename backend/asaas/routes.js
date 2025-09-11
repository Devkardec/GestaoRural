// backend/asaas/routes.js
const express = require('express');
const router = express.Router();
const { createCustomer, createSubscription } = require('./asaasClient');
const { findUserByUID, updateUser } = require('../db');
const { checkAuthAndPremium, checkAuth } = require('../middleware/auth');

// Rota para o usuário logado iniciar o processo de assinatura premium.
router.post('/subscription', async (req, res) => {
    // O token do usuário será verificado pelo Firebase Auth no frontend
    // e o UID será enviado no corpo da requisição.
    const { uid, name, email, cpfCnpj, phone, subscriptionPlan } = req.body;

    if (!uid) {
        return res.status(400).json({ error: 'UID do usuário é obrigatório.' });
    }

    try {
        let user = await findUserByUID(uid);
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        let asaasCustomerId = user.asaasCustomerId;

        // 1. Cria o cliente no Asaas se ele ainda não existir
        if (!asaasCustomerId) {
            console.log(`Criando cliente no Asaas para o usuário: ${uid}`);
            const customer = await createCustomer({ name, email, cpfCnpj, phone });
            asaasCustomerId = customer.id;
            await updateUser(uid, { asaasCustomerId }); // Salva o ID do cliente no nosso DB
        }

        // 2. Cria a assinatura no Asaas
        console.log(`Criando assinatura para o cliente Asaas: ${asaasCustomerId}`);
        const subscription = await createSubscription({
            customer: asaasCustomerId,
            value: subscriptionPlan.value, // Ex: 59.90
            description: subscriptionPlan.description, // Ex: "Plano Premium - AgroCultive"
        });

        // 3. Atualiza nosso banco de dados com os detalhes da assinatura
        await updateUser(uid, {
            'premium.subscriptionId': subscription.id,
            'premium.paymentLink': subscription.paymentLink
        });

        // 4. Retorna o link de pagamento para o frontend
        res.status(200).json({ paymentLink: subscription.paymentLink });

    } catch (error) {
        console.error('Erro ao criar processo de assinatura:', error);
        res.status(500).json({ error: 'Falha ao processar a assinatura.' });
    }
});

// Preflight explícito para status (camada adicional de compatibilidade)
router.options('/status', (req,res)=> {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Vary','Origin');
    res.header('Access-Control-Allow-Methods','GET,OPTIONS');
    res.header('Access-Control-Allow-Headers','Origin, X-Requested-With, Content-Type, Accept, Authorization');
    return res.sendStatus(200);
});

// Rota para o frontend verificar o status do usuário.
// Protegida pelo middleware `checkAuth` para garantir que apenas o usuário logado possa ver seu próprio status.
router.get('/status', checkAuth, (req, res) => {
    const user = req.user || {};
    console.log('🎯 Status route accessed by user:', user.uid);

    if (!user.premium) {
        console.warn('⚠️ Usuário sem objeto premium – retornando default.');
        return res.status(200).json({
            premiumStatus: 'TRIAL',
            trialEndDate: new Date(Date.now() + 7*24*60*60*1000)
        });
    }

    try {
        const trialEnd = user.premium.trialEndDate?.toDate ? user.premium.trialEndDate.toDate() : new Date();
        res.status(200).json({
            premiumStatus: user.premium.status || 'TRIAL',
            trialEndDate: trialEnd
        });
        console.log('✅ Status response sent successfully');
    } catch (err) {
        console.error('❌ Error sending status response:', err);
        res.status(500).json({ error: 'Erro interno ao buscar status.' });
    }
});

// Exemplo de uma rota protegida pelo middleware
router.get('/premium-feature', checkAuthAndPremium, (req, res) => {
    // Graças ao middleware, sabemos que req.user existe e tem acesso.
    res.status(200).json({
        message: `Bem-vindo ao recurso premium, ${req.user.name}! Seu status é ${req.user.premium.status}.`
    });
});

module.exports = router;