// Lista de todos os elementos de modal no seu aplicativo
        const allModals = [
            'lunar-calendar-modal', 'confirm-modal', 'edit-observation-modal',
            'calendar-modal', 'schedule-modal', 'cashbook-modal', 'supplies-modal',
            'add-animal-modal', 'planting-modal', 'management-modal', 'employee-modal',
            'employee-financial-modal', 'animal-dashboard-modal', 'animal-sub-modal',
            'sales-modal', 'image-observation-modal'
        ].map(id => document.getElementById(id)).filter(Boolean); // Mapeia para elementos e remove nulos

        // Função para verificar se algum modal está visível
        function isAnyModalVisible() {
            return allModals.some(modal => modal.style.display === 'flex');
        }
        
        // Função para fechar o modal que estiver aberto
        function closeVisibleModal() {
            const visibleModal = allModals.find(modal => modal.style.display === 'flex');
            if (visibleModal) {
                visibleModal.style.display = 'none';
                return true;
            }
            return false;
        }

        // Configuração inicial do histórico
        history.replaceState({ page: 'main' }, 'main', window.location.pathname);

        // Observador que adiciona um estado no histórico QUANDO um modal abre
        const observer = new MutationObserver((mutationsList) => {
            for (const mutation of mutationsList) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    const modalElement = mutation.target;
                    // Se o modal ficou visível e ainda não estamos no estado #modal
                    if (modalElement.style.display === 'flex' && !history.state?.modal) {
                        history.pushState({ modal: true }, 'modal', window.location.pathname);
                    }
                }
            }
        });

        // Diz ao observador para "assistir" a todos os modais
        allModals.forEach(modal => {
            observer.observe(modal, { attributes: true });
        });

        // Listener principal para o botão "voltar"
        window.addEventListener('popstate', (event) => {
            // Se o popstate foi acionado, a primeira ação é tentar fechar um modal
            if (closeVisibleModal()) {
                // Se um modal foi fechado, não fazemos mais nada.
                return;
            }

            // Se nenhum modal foi fechado e chegamos ao estado principal, pergunta para sair
            if (event.state?.page === 'main' || !event.state) {
                showConfirm('Sair do App', 'Tem certeza que deseja sair?', () => {
                    // Tenta fechar a janela/PWA se o usuário confirmar
                    window.close();
                });
                // Re-empurra o estado #main para "prender" o usuário
                // caso ele clique em "Cancelar", permitindo uma nova tentativa de voltar.
                history.pushState({ page: 'main' }, 'main', window.location.pathname);
            }
        });