document.addEventListener('DOMContentLoaded', () => {
    const fabMainBtn = document.getElementById('fab-main-btn');
    const fabOptions = document.querySelector('.fab-options');
    const fabCalculatorBtn = document.getElementById('fab-calculator-btn');
    const fabAgronomistBtn = document.getElementById('fab-agronomist-btn');

    const calculatorWidget = document.getElementById('calculator-widget');
    const agronomistChatModal = document.getElementById('agronomist-chat-modal');

    if (fabMainBtn) {
        fabMainBtn.addEventListener('click', () => {
            fabMainBtn.classList.toggle('open');
            fabOptions.classList.toggle('open');
        });
    }

    if (fabCalculatorBtn) {
        fabCalculatorBtn.addEventListener('click', () => {
            const isVisible = calculatorWidget.style.display === 'block';
            calculatorWidget.style.display = isVisible ? 'none' : 'block';
            // Fecha o menu FAB
            fabMainBtn.classList.remove('open');
            fabOptions.classList.remove('open');
        });
    }

    if (fabAgronomistBtn) {
        fabAgronomistBtn.addEventListener('click', () => {
            agronomistChatModal.classList.remove('hidden');
            agronomistChatModal.style.display = 'flex';
             // Fecha o menu FAB
            fabMainBtn.classList.remove('open');
            fabOptions.classList.remove('open');
        });
    }
    
    // Adiciona funcionalidade para fechar o menu se clicar fora
    document.addEventListener('click', (event) => {
        const fabContainer = document.querySelector('.fab-container');
        if (fabMainBtn.classList.contains('open') && !fabContainer.contains(event.target)) {
            fabMainBtn.classList.remove('open');
            fabOptions.classList.remove('open');
        }
    });
});
