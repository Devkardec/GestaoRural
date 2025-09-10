const { GoogleGenerativeAI } = require("@google/generative-ai");

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { query } = JSON.parse(event.body);

    if (!query) {
        return { statusCode: 400, body: 'Query parameter is required.' };
    }

    try {
        // Access your API key as an environment variable
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });

        const prompt = `Você é um consultor agrícola virtual chamado "Agrônomo Virtual" para o aplicativo AgroCultive. Sua função é fornecer conselhos e informações úteis sobre agricultura, plantio, pragas, doenças, manejo de culturas, etc. Responda de forma concisa, útil e profissional, focando em práticas agrícolas sustentáveis e eficientes. Se a pergunta não for relacionada à agricultura, responda educadamente que sua especialidade é consultoria agrícola.

        Pergunta do usuário: "${query}"

        Sua resposta como Agrônomo Virtual:`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        return {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ response: text }),
        };
    } catch (error) {
        console.error('Error calling Gemini API:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to get response from Agrônomo Virtual.', details: error.message }),
        };
    }
};