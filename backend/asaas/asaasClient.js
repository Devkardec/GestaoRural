// backend/asaas/asaasClient.js
const axios = require('axios');

// As variáveis de ambiente são carregadas no server.js, não precisa do dotenv aqui.
const ASAAS_API_URL = process.env.ASAAS_API_URL;
const ASAAS_API_KEY = process.env.ASAAS_API_KEY;

// Configuração centralizada do cliente Axios para a API do Asaas
const apiClient = axios.create({
    baseURL: ASAAS_API_URL,
    headers: {
        'Content-Type': 'application/json',
        'access_token': ASAAS_API_KEY
    }
});

/**
 * Cria um novo cliente no Asaas.
 * @param {object} customerData - Dados do cliente { name, email, cpfCnpj, phone }.
 * @returns {Promise<object>} Dados do cliente criado no Asaas.
 */
async function createCustomer(customerData) {
    try {
        const response = await apiClient.post('/customers', customerData);
        console.log(`Cliente criado no Asaas: ${response.data.id}`);
        return response.data;
    } catch (error) {
        console.error('Erro ao criar cliente Asaas:', error.response?.data || error.message);
        throw new Error('Falha ao criar cliente no gateway de pagamento.');
    }
}

/**
 * Cria uma nova assinatura recorrente no Asaas.
 * @param {object} subscriptionData - Dados da assinatura { customer, value, description, cycle }.
 * @returns {Promise<object>} Dados da assinatura criada, incluindo o link de pagamento.
 */
async function createSubscription(subscriptionData) {
    try {
        const payload = {
            ...subscriptionData,
            billingType: 'UNDEFINED', // Deixa o cliente escolher (Boleto, Cartão, PIX)
            cycle: subscriptionData.cycle || 'MONTHLY'
        };
        const response = await apiClient.post('/subscriptions', payload);
        console.log(`Assinatura criada no Asaas: ${response.data.id}`);
        return response.data; // A resposta já contém o `paymentLink`
    } catch (error) {
        console.error('Erro ao criar assinatura Asaas:', error.response?.data || error.message);
        throw new Error('Falha ao criar assinatura no gateway de pagamento.');
    }
}

module.exports = {
    createCustomer,
    createSubscription
};