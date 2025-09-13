// backend/asaas/webhook.js
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { findUserByAsaasId, updateUser } = require('../db');
const admin = require('firebase-admin');

// Middleware para verificar autenticação do webhook do Asaas (Access Token preferencial; HMAC opcional)
function verifyAsaasAuth(req, res, next) {
    const accessHeader = req.headers['asaas-access-token'];
    // Passa a aceitar ASAAS_ACCESS_TOKEN OU ASAAS_WEBHOOK_SECRET como “token simples” do header
    const configuredAccessToken = (process.env.ASAAS_ACCESS_TOKEN || process.env.ASAAS_WEBHOOK_SECRET || '').trim();

    // Se configurou um token no ambiente, valide pelo header asaas-access-token
    if (configuredAccessToken) {
        if (!accessHeader || accessHeader !== configuredAccessToken) {
            console.warn('Webhook recebido com asaas-access-token ausente ou inválido.');
            return res.status(401).send('Token de acesso inválido ou ausente.');
        }
        return next();
    }

    // Fallback opcional: HMAC (apenas se você realmente configurou um secret E o Asaas enviar a assinatura)
    const asaasSignature = req.headers['asaas-signature'];
    const webhookSecret = process.env.ASAAS_WEBHOOK_SECRET;
    if (webhookSecret && asaasSignature) {
        try {
            const hmac = crypto.createHmac('sha256', webhookSecret);
            hmac.update(req.rawBody || '', 'utf8');
            const calculatedSignature = hmac.digest('hex');
            if (calculatedSignature !== asaasSignature) {
                console.warn('Assinatura do webhook inválida (HMAC).');
                return res.status(403).send('Assinatura inválida.');
            }
            return next();
        } catch (error) {
            console.error('Erro ao verificar assinatura do webhook (HMAC):', error);
            return res.status(500).send('Erro interno na verificação.');
        }
    }

    // Se nenhum mecanismo estiver configurado, permita mas avise (para não derrubar a fila)
    console.warn('Nenhum mecanismo de autenticação do webhook configurado. Permitindo para evitar falhas de entrega.');
    return next();
}

// Rota que recebe as notificações do Asaas
// Agora: responde 200 o mais rápido possível e processa em background
router.post('/', verifyAsaasAuth, (req, res) => {
    // Garante parse do JSON se body vier vazio (usamos rawBody)
    if (!req.body || Object.keys(req.body).length === 0) {
        try { req.body = JSON.parse(req.rawBody || '{}'); } catch { req.body = {}; }
    }
    const event = req.body || {};

    console.log('📥 Webhook bruto recebido (trecho):', (req.rawBody || '').substring(0, 300));
    console.log(`Webhook Asaas recebido: Evento [${event.event}] para Cliente [${event.payment?.customer}]`);

    // ACK imediato para não acumular falhas/timeout
    res.status(200).send('OK');

    // Processamento assíncrono para não atrasar o ACK
    setImmediate(async () => {
        try {
            const asaasCustomerId = event.payment?.customer || event.subscription?.customer;
            if (!asaasCustomerId) {
                console.log('Webhook ignorado: ID do cliente não encontrado no payload.');
                return;
            }

            const user = await findUserByAsaasId(asaasCustomerId);
            if (!user) {
                console.warn(`Usuário não encontrado para o cliente Asaas ID: ${asaasCustomerId}`);
                return; // Não retornar erro ao Asaas
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

            if (newStatus !== user.premium.status) {
                await updateUser(user.id, {
                    'premium.status': newStatus,
                    'premium.lastUpdate': now
                });
            }
        } catch (error) {
            console.error('Erro ao processar webhook:', error);
        }
    });
});

module.exports = router;