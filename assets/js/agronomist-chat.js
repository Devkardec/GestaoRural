document.addEventListener('DOMContentLoaded', () => {
    const agronomistChatModal = document.getElementById('agronomist-chat-modal');
    const closeChatModalBtn = document.getElementById('close-chat-modal-btn');
    const chatInput = document.getElementById('chat-input');
    const sendChatBtn = document.getElementById('send-chat-btn');
    const chatMessages = document.getElementById('chat-messages');

    // O botão para abrir o modal agora é gerenciado por fab-menu.js
    // A lógica para mostrar o modal foi removida daqui para evitar conflitos.

    // Hide the chat modal when the close button is clicked
    if (closeChatModalBtn) {
        closeChatModalBtn.addEventListener('click', () => {
            agronomistChatModal.classList.add('hidden');
            agronomistChatModal.style.display = 'none'; // Garante que o modal seja escondido
        });
    }

    // Function to add a message to the chat display
    function addMessage(sender, message) {
        const messageElement = document.createElement('p');
        messageElement.classList.add('mb-2');
        if (sender === 'user') {
            messageElement.classList.add('text-right', 'text-blue-800');
            messageElement.innerHTML = `<strong>Você:</strong> ${message}`;
        } else {
            messageElement.classList.add('text-left', 'text-gray-800');
            // Usa a biblioteca marked para converter Markdown em HTML
            const htmlContent = marked.parse(message);
            messageElement.innerHTML = `<strong>Consultor:</strong> ${htmlContent}`;
        }
        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight; // Scroll to bottom
    }

    // Handle sending messages
    if (sendChatBtn) {
        sendChatBtn.addEventListener('click', async () => { // Added 'async'
            const message = chatInput.value.trim();
            if (message) {
                addMessage('user', message);
                chatInput.value = '';
                chatInput.disabled = true; // Disable input while waiting for response
                sendChatBtn.disabled = true; // Disable button

                // Add loading indicator
                const loadingElement = document.createElement('p');
                loadingElement.id = 'agronomist-loading';
                loadingElement.classList.add('mb-2', 'text-left', 'text-gray-800');
                loadingElement.innerHTML = `<strong>Consultor:</strong> <i class="fas fa-spinner fa-spin"></i> Analisando...`;
                chatMessages.appendChild(loadingElement);
                chatMessages.scrollTop = chatMessages.scrollHeight;

                try {
                    const response = await fetch('/.netlify/functions/agronomist-query', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ query: message }),
                    });

                    const data = await response.json();

                    document.getElementById('agronomist-loading')?.remove();

                    if (response.ok) {
                        addMessage('agronomist', data.response);
                    } else {
                        addMessage('agronomist', `Erro: ${data.details || 'Não foi possível obter uma resposta.'}`);
                    }
                } catch (error) {
                    console.error('Error sending message to Netlify Function:', error);
                    document.getElementById('agronomist-loading')?.remove();
                    addMessage('agronomist', 'Desculpe, houve um erro ao conectar com o Consultor Agropecuário. Tente novamente mais tarde.');
                } finally {
                    chatInput.disabled = false; // Re-enable input
                    sendChatBtn.disabled = false; // Re-enable button
                    chatInput.focus(); // Focus back on input
                }
            }
        });
    }

    // Allow sending message with Enter key
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendChatBtn.click();
            }
        });
    }
});
