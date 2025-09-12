// backend/asaas/webhook.js
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { findUserByAsaasId, updateUser } = require('../db');
const admin = require('firebase-admin');

// Middleware para verificar a assinatura do webhook do Asaas
function verifyAsaasSignature(req, res, next) {
    const asaasSignature = req.headers['asaas-signature'];
    const webhookSecret = process.env.ASAAS_WEBHOOK_SECRET;

    if (!asaasSignature) {
        console.warn('Webhook recebido sem assinatura.');
        return res.status(401).send('Assinatura não encontrada.');
    }

    try {
        const hmac = crypto.createHmac('sha256', webhookSecret);
        hmac.update(req.rawBody, 'utf8'); // Usa o corpo bruto da requisição
        const calculatedSignature = hmac.digest('hex');

        if (calculatedSignature !== asaasSignature) {
            console.warn('Assinatura do webhook inválida.');
            return res.status(403).send('Assinatura inválida.');
        }

        // Assinatura válida, continua para o próximo handler
        next();

    } catch (error) {
        console.error('Erro ao verificar assinatura do webhook:', error);
        return res.status(500).send('Erro interno na verificação.');
    }
}

// Rota que recebe as notificações do Asaas
// O middleware de verificação é aplicado antes da lógica principal
router.post('/', verifyAsaasSignature, async (req, res) => {
    const event = req.body;

    console.log(`Webhook Asaas recebido: Evento [${event.event}] para Cliente [${event.payment?.customer}]`);

    // Apenas processa eventos que tenham um ID de cliente
    const asaasCustomerId = event.payment?.customer || event.subscription?.customer;
    if (!asaasCustomerId) {
        console.log('Webhook ignorado: ID do cliente não encontrado no payload.');
        return res.status(200).send('OK - Ignorado');
    }

    try {
        const user = await findUserByAsaasId(asaasCustomerId);
        if (!user) {
            console.warn(`Usuário não encontrado para o cliente Asaas ID: ${asaasCustomerId}`);
            return res.status(404).send('Usuário não encontrado');
        }

        let newStatus = user.premium.status;
        const now = admin.firestore.FieldValue.serverTimestamp();

        // Lógica para atualizar o status baseado no evento do webhook
        switch (event.event) {
            case 'PAYMENT_CONFIRMED':
            case 'PAYMENT_RECEIVED':
                newStatus = 'ACTIVE';
                console.log(`Status do usuário ${user.id} atualizado para ATIVO.`);
                break;

            case 'SUBSCRIPTION_CHARGE_OVERDUE':
            case 'PAYMENT_OVERDUE':
                newStatus = 'INACTIVE';
                console.log(`Status do usuário ${user.id} atualizado para INATIVO (atrasado).`);
                break;

            case 'SUBSCRIPTION_CANCELED':
                newStatus = 'CANCELED';
                console.log(`Assinatura do usuário ${user.id} foi cancelada.`);
                break;

            // Adicione outros eventos que sejam importantes para sua lógica
        }

        // Atualiza o banco de dados se o status mudou
        if (newStatus !== user.premium.status) {
            await updateUser(user.id, {
                'premium.status': newStatus,
                'premium.lastUpdate': now
            });
        }

        res.status(200).send('OK');

    } catch (error) {
        console.error(`Erro ao processar webhook para cliente ${asaasCustomerId}:`, error);
        res.status(500).send('Erro interno ao processar o webhook.');
    }
});

module.exports = router;