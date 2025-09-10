document.addEventListener('DOMContentLoaded', () => {
    const agronomistButton = document.getElementById('agronomist-button');
    const agronomistChatModal = document.getElementById('agronomist-chat-modal');
    const closeChatModalBtn = document.getElementById('close-chat-modal-btn');
    const chatInput = document.getElementById('chat-input');
    const sendChatBtn = document.getElementById('send-chat-btn');
    const chatMessages = document.getElementById('chat-messages');

    // Show the chat modal when the agronomist button is clicked
    agronomistButton.addEventListener('click', () => {
        agronomistChatModal.classList.remove('hidden');
    });

    // Hide the chat modal when the close button is clicked
    closeChatModalBtn.addEventListener('click', () => {
        agronomistChatModal.classList.add('hidden');
    });

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
    sendChatBtn.addEventListener('click', async () => { // Added 'async'
        const message = chatInput.value.trim();
        if (message) {
            addMessage('user', message);
            chatInput.value = '';
            chatInput.disabled = true; // Disable input while waiting for response
            sendChatBtn.disabled = true; // Disable button

            try {
                const response = await fetch('/.netlify/functions/agronomist-query', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ query: message }),
                });

                const data = await response.json();

                if (response.ok) {
                    addMessage('agronomist', data.response);
                } else {
                    addMessage('agronomist', `Erro: ${data.details || 'Não foi possível obter uma resposta.'}`);
                }
            } catch (error) {
                console.error('Error sending message to Netlify Function:', error);
                addMessage('agronomist', 'Desculpe, houve um erro ao conectar com o Consultor Agropecuário. Tente novamente mais tarde.');
            } finally {
                chatInput.disabled = false; // Re-enable input
                sendChatBtn.disabled = false; // Re-enable button
                chatInput.focus(); // Focus back on input
            }
        }
    });

    // Allow sending message with Enter key
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendChatBtn.click();
        }
    });
});