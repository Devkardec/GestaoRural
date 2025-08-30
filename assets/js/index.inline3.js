// Registrar Service Worker apenas em produção ou localhost
        if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
            navigator.serviceWorker.register('/service-worker.js')
                .then(registration => {
                    console.log('Service Worker registrado com sucesso:', registration);
                })
                .catch(error => {
                    console.log('Falha ao registrar Service Worker:', error);
                });
        }

        // Firebase Imports
        import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import {
            getAuth,
            createUserWithEmailAndPassword,
            signInWithEmailAndPassword,
            signOut,
            onAuthStateChanged,
            updateProfile,
            sendPasswordResetEmail
        } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
        import {
            getFirestore,
            collection,
            onSnapshot,
            addDoc,
            doc,
            updateDoc,
            deleteDoc,
            runTransaction,
            setLogLevel,
            writeBatch,
            query,
            where,
            getDocs,
            serverTimestamp,
            setDoc,
            getDoc,
            enableIndexedDbPersistence // ✅ JÁ IMPORTADO
        } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

        // VARIÁVEIS GLOBAIS DO FIREBASE
        let app, auth, db; // ✅ JÁ DECLARADAS

        // Funções auxiliares para notificações
        function scheduleNotification(title, body, scheduledTime, tag = null) {
            if ('Notification' in window && Notification.permission === 'granted') {
                const now = new Date().getTime();
                const delay = scheduledTime - now;
                
                if (delay > 0) {
                    setTimeout(() => {
                        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                            // Enviar mensagem para o service worker
                            navigator.serviceWorker.controller.postMessage({
                                type: 'SHOW_NOTIFICATION',
                                title: title,
                                body: body,
                                tag: tag
                            });
                        } else {
                            // Fallback: mostrar notificação diretamente
                            new Notification(title, {
                                body: body,
                                icon: 'assets/img/faviconsf.png',
                                tag: tag,
                                requireInteraction: true
                            });
                        }
                    }, delay);
                    
                    return true;
                }
            }
            return false;
        }

        function cancelNotification(tag) {
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({
                    type: 'CANCEL_NOTIFICATION',
                    tag: tag
                });
            }
        }

        // Inicializar IndexedDB na inicialização do app
        function initializeIndexedDB() {
            return new Promise((resolve, reject) => {
                // Verificar se IndexedDB está disponível
                if (!window.indexedDB) {
                    console.warn('IndexedDB não está disponível neste navegador');
                    resolve(null);
                    return;
                }
                
                const request = indexedDB.open('AgroCultiveDB', 2);

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;

                    // Criar object store para imagens se não existir
                    if (!db.objectStoreNames.contains('images')) {
                        const imageStore = db.createObjectStore('images', { keyPath: 'id' });
                        imageStore.createIndex('ref', 'ref', { unique: false });
                        imageStore.createIndex('type', 'type', { unique: false });
                        imageStore.createIndex('synced', 'synced', { unique: false });
                    }
                };

                request.onsuccess = (event) => {
                    console.log('IndexedDB inicializado com sucesso');
                    resolve(event.target.result);
                };

                request.onerror = (event) => {
                    console.warn('IndexedDB não pôde ser inicializado:', event.target.error);
                    resolve(null); // Continuar sem IndexedDB ao invés de rejeitar
                };
            });
        }

        // === FUNÇÕES DE UPLOAD E GALERIA DE IMAGENS ===

        // Função para comprimir imagem
        function compressImage(file, maxWidth = 800, quality = 0.8) {
            return new Promise((resolve) => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const img = new Image();

                img.onload = () => {
                    const ratio = Math.min(maxWidth / img.width, maxWidth / img.height);
                    canvas.width = img.width * ratio;
                    canvas.height = img.height * ratio;

                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    canvas.toBlob(resolve, 'image/jpeg', quality);
                };

                img.src = URL.createObjectURL(file);
            });
        }

        // Função para salvar imagem no IndexedDB
        async function saveToIndexedDB(imageData) {
            try {
                const db = await initializeIndexedDB();
                const transaction = db.transaction(['images'], 'readwrite');
                const store = transaction.objectStore('images');

                return new Promise((resolve, reject) => {
                    const request = store.add(imageData);
                    request.onsuccess = () => {
                        console.log('Imagem salva com sucesso no IndexedDB:', imageData.id);
                        resolve(imageData.id);
                    };
                    request.onerror = (event) => {
                        console.error('Erro detalhado ao salvar no IndexedDB:', {
                            error: event.target.error,
                            data: imageData
                        });
                        reject(event.target.error);
                    };
                });
            } catch (error) {
                console.error('Erro ao acessar IndexedDB:', error);
                throw error;
            }
        }

        // Função para buscar imagens do IndexedDB
        async function getFromIndexedDB(ref, type) {
            const db = await initializeIndexedDB();
            const transaction = db.transaction(['images'], 'readonly');
            const store = transaction.objectStore('images');
            const index = store.index('ref');

            return new Promise((resolve, reject) => {
                const request = index.getAll(ref);
                request.onsuccess = () => {
                    const images = request.result.filter(img => img.type === type);
                    resolve(images);
                };
                request.onerror = () => reject(request.error);
            });
        }

        // Função principal de upload
        async function uploadImage(file, ref, type, observation = '') {
            try {
                showToast('Processando imagem...');

                // Comprimir imagem
                const compressedFile = await compressImage(file);

                // Converter para base64
                const reader = new FileReader();
                const base64 = await new Promise((resolve) => {
                    reader.onload = (e) => resolve(e.target.result);
                    reader.readAsDataURL(compressedFile);
                });

                // Criar objeto de imagem
                const imageData = {
                    id: crypto.randomUUID(),
                    ref: ref,
                    type: type,
                    data: base64,
                    observation: observation,
                    timestamp: Date.now(),
                    synced: false,
                    filename: file.name
                };

                // Adicionar log para debug (remover após teste)
                console.log('Dados da imagem antes de salvar:', imageData);

                // Criar uma cópia limpa do objeto para garantir que seja clonável
                const cleanImageData = {
                    id: String(imageData.id),
                    ref: String(imageData.ref),
                    type: String(imageData.type),
                    data: String(imageData.data),
                    observation: String(imageData.observation || ''),
                    timestamp: Number(imageData.timestamp),
                    synced: Boolean(imageData.synced),
                    filename: String(imageData.filename || '')
                };

                // Salvar no IndexedDB usando o objeto limpo
                await saveToIndexedDB(cleanImageData);

                // Atualizar galeria
                renderGallery(ref, type);

                // Tentar sincronizar se online
                if (navigator.onLine) {
                    syncImageToFirebase(cleanImageData);
                }

                showToast('Imagem adicionada com sucesso!');
                return cleanImageData.id;

            } catch (error) {
                console.error('Erro no upload:', error);
                showToast('Erro ao processar imagem.');
                throw error;
            }
        }

        // Função para renderizar galeria
        async function renderGallery(ref, type, containerId = null) {
            try {
                const images = await getFromIndexedDB(ref, type);
                const galleryContainer = containerId ? 
                    document.getElementById(containerId) : 
                    document.getElementById(`gallery-${ref}`);

                if (!galleryContainer) {
                    console.warn(`Contêiner de galeria não encontrado: ${containerId || `gallery-${ref}`}`);
                    return;
                }

                if (images.length === 0) {
                    galleryContainer.innerHTML = '<p class="text-gray-500 text-sm col-span-full text-center py-4">Nenhuma imagem adicionada</p>';
                    return;
                }

                const galleryHTML = images.map(img => {
                    const date = new Date(img.timestamp).toLocaleDateString('pt-BR');
                    return `
                        <div class="relative group cursor-pointer" onclick="showLightbox('${img.id}')">
                            <img src="${img.data}" alt="${img.observation}" 
                                 class="w-full h-16 object-cover rounded-lg border border-gray-200 hover:border-blue-400 transition-colors">
                            <div class="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-opacity rounded-lg flex items-center justify-center">
                                <i class="fas fa-search-plus text-white opacity-0 group-hover:opacity-100 transition-opacity"></i>
                            </div>
                            ${img.observation ? `<div class="absolute bottom-0 left-0 right-0 bg-black bg-opacity-70 text-white text-xs p-1 rounded-b-lg truncate" title="${img.observation}">${img.observation}</div>` : ''}
                        </div>
                    `;
                }).join('');

                galleryContainer.innerHTML = galleryHTML;

            } catch (error) {
                console.error('Erro ao renderizar galeria:', error);
            }
        }

        // Função para exibir lightbox
        async function showLightbox(imageId) {
            try {
                const db = await initializeIndexedDB();
                const transaction = db.transaction(['images'], 'readonly');
                const store = transaction.objectStore('images');

                const request = store.get(imageId);
                request.onsuccess = () => {
                    const image = request.result;
                    if (!image) return;

                    const date = new Date(image.timestamp).toLocaleString('pt-BR');

                    const lightboxHTML = `
                        <div id="image-lightbox" class="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4" onclick="closeLightbox()">
                            <div class="relative max-w-4xl max-h-full" onclick="event.stopPropagation()">
                                <img src="${image.data}" alt="${image.observation}" class="max-w-full max-h-full object-contain rounded-lg">
                                <div class="absolute top-4 right-4">
                                    <button onclick="closeLightbox()" class="bg-black bg-opacity-50 text-white p-2 rounded-full hover:bg-opacity-70">
                                        <i class="fas fa-times"></i>
                                    </button>
                                </div>
                                ${image.observation ? `
                                    <div class="absolute bottom-4 left-4 right-4 bg-black bg-opacity-70 text-white p-3 rounded-lg">
                                        <p class="font-medium">${image.observation}</p>
                                        <p class="text-sm text-gray-300">${date}</p>
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                    `;

                    document.body.insertAdjacentHTML('beforeend', lightboxHTML);
                };

            } catch (error) {
                console.error('Erro ao exibir lightbox:', error);
            }
        }
        window.showLightbox = showLightbox; // <--- ADICIONE ESTA LINHA

        // Função para fechar lightbox
        function closeLightbox() {
            const lightbox = document.getElementById('image-lightbox');
            if (lightbox) {
                lightbox.remove();
            }
        }
        window.closeLightbox = closeLightbox; // <--- ADICIONE ESTA LINHA TAMBÉM

        // Função para sincronizar com Firebase
        async function syncImageToFirebase(imageData) {
            try {
                // Implementar sincronização com Firebase Storage quando online
                console.log('Sincronizando imagem:', imageData.id);
                // TODO: Implementar upload para Firebase Storage
            } catch (error) {
                console.error('Erro na sincronização:', error);
            }
        }

        // Variável para armazenar imagens selecionadas do diário
        let selectedDiaryImages = [];

        // === FUNCIONALIDADE DICA DO DIA ===
        const dailyTips = [
            "Regue suas plantas nas primeiras horas da manhã para evitar evaporação excessiva.",
            "Faça rotação de culturas para manter a fertilidade do solo e prevenir pragas.",
            "Observe as fases da lua para planejar plantios e colheitas mais produtivos.",
            "Mantenha um registro detalhado de aplicações de fertilizantes e defensivos.",
            "Verifique a umidade do solo antes de irrigar para evitar encharcamento.",
            "Use cobertura morta para conservar a umidade e controlar ervas daninhas.",
            "Monitore regularmente suas culturas em busca de sinais de pragas ou doenças.",
            "Planeje a sucessão de plantios para ter colheitas contínuas.",
            "Mantenha ferramentas limpas e afiadas para trabalhos mais eficientes.",
            "Teste o pH do solo regularmente e faça correções quando necessário.",
            "Armazene sementes em local seco e fresco para manter a viabilidade.",
            "Use plantas companheiras para controle natural de pragas.",
            "Faça compostagem dos restos orgânicos para enriquecer o solo.",
            "Monitore as condições climáticas para planejar atividades agrícolas.",
            "Mantenha registros financeiros detalhados de custos e receitas.",
            "Invista em capacitação técnica para melhorar práticas agrícolas.",
            "Use irrigação por gotejamento para economizar água.",
            "Faça análise foliar para detectar deficiências nutricionais.",
            "Mantenha áreas de reserva para preservação da biodiversidade.",
            "Use controle biológico sempre que possível antes de defensivos químicos.",
            "Planeje a colheita no momento ideal de maturação dos frutos.",
            "Mantenha equipamentos calibrados para aplicações precisas.",
            "Diversifique culturas para reduzir riscos econômicos.",
            "Use tecnologia para monitoramento remoto da propriedade.",
            "Mantenha boa relação com fornecedores e compradores.",
            "Invista em armazenamento adequado para preservar a qualidade dos produtos.",
            "Faça manutenção preventiva em equipamentos e máquinas.",
            "Use dados meteorológicos para otimizar aplicações de defensivos.",
            "Mantenha funcionários treinados em segurança no trabalho.",
            "Planeje investimentos com base em análise de viabilidade econômica."
        ];

        function displayDailyTip() {
            const today = new Date();
            const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
            const tipIndex = dayOfYear % dailyTips.length;
            
            const tipElement = document.getElementById('daily-tip-text');
            if (tipElement) {
                tipElement.textContent = dailyTips[tipIndex];
            }
        }

        document.addEventListener('DOMContentLoaded', async () => {
            try {
                await initializeIndexedDB();
                console.log('Sistema de imagens inicializado');
            } catch (error) {
                console.error('Erro ao inicializar sistema de imagens:', error);
            }

            setLogLevel('debug');

            const firebaseConfig = {
                apiKey: "AIzaSyAtwYV-toZBKbSwg2PE4AhTsJ47AaPKD4Q",
                authDomain: "agrocultiveapps.firebaseapp.com",
                projectId: "agrocultiveapps",
                storageBucket: "agrocultiveapps.appspot.com",
                messagingSenderId: "1095510209034",
                appId: "1:1095510209034:web:9dac124513d1eb584a25f3"
            };

            // --- DOM ELEMENTS (condensed for brevity) ---
            const loadingIndicator = document.getElementById('loading-indicator');
            const errorState = document.getElementById('error-state');
            const emptyState = document.getElementById('empty-state');
            const noResults = document.getElementById('no-results');
            const plantingList = document.getElementById('planting-list');
            const addPlantingBtn = document.getElementById('add-planting-btn');
            const manageSuppliesBtn = document.getElementById('manage-supplies-btn');
            const toast = document.getElementById('toast');
            const suppliesModal = document.getElementById('supplies-modal');
            const addAnimalModal = document.getElementById('add-animal-modal');
            const plantingModal = document.getElementById('planting-modal');
            const managementModal = document.getElementById('management-modal');
            const suppliesForm = document.getElementById('supplies-form');
            const addAnimalForm = document.getElementById('add-animal-form');
            const plantingForm = document.getElementById('planting-form');
            const managementForm = document.getElementById('management-form');
            const logForm = document.getElementById('log-form');
            const logList = document.getElementById('log-list');
            const weatherWidget = document.getElementById('weather-widget');
            const plantingModalTitle = document.getElementById('planting-modal-title');
            const plantingIdInput = document.getElementById('planting-id');
            const tabDetails = document.getElementById('tab-details');
            const tabManagement = document.getElementById('tab-management');
            const detailsContent = document.getElementById('details-content');
            const managementContent = document.getElementById('management-content');
            const addManagementBtn = document.getElementById('add-management-btn');
            const suppliesList = document.getElementById('supplies-list');
            const cancelSupplyEditBtn = document.getElementById('cancel-supply-edit-btn');
            const suppliesFormTitle = document.getElementById('supplies-form-title');
            const managementModalTitle = document.getElementById('management-modal-title');
            const supplySelect = document.getElementById('supply-select');
            const quantityUsedInput = document.getElementById('quantity-used');
            const quantityUsedUnit = document.getElementById('quantity-used-unit');
            const calculatedCostEl = document.getElementById('calculated-cost');
            const financialSummarySection = document.getElementById('financial-summary');
            const financialChartCanvas = document.getElementById('financial-chart');
            const statusGrowingCard = document.getElementById('status-growing');
            const statusHarvestedCard = document.getElementById('status-harvested');
            const statusDelayedCard = document.getElementById('status-delayed');
            const statusEmployeesCard = document.getElementById('status-employees');
            const cashbookModal = document.getElementById('cashbook-modal');
            const cashbookBtn = document.getElementById('cashbook-btn');
            const transactionForm = document.getElementById('transaction-form');
            const transactionList = document.getElementById('transaction-list');
            const cashbookBalanceEl = document.getElementById('cashbook-balance');
            const calendarModal = document.getElementById('calendar-modal');
            const calendarBtn = document.getElementById('calendar-btn');
            const scheduleBtn = document.getElementById('schedule-btn');
            const remindersList = document.getElementById('reminders-list');
            const taskForm = document.getElementById('task-form');
            const taskInput = document.getElementById('task-input');
            const tasksList = document.getElementById('tasks-list');
            const scheduleModal = document.getElementById('schedule-modal');
            const scheduleForm = document.getElementById('schedule-form');
            const prevMonthBtn = document.getElementById('prev-month-btn');
            const nextMonthBtn = document.getElementById('next-month-btn');
            const calendarGrid = document.getElementById('calendar-grid');
            const calendarTitle = document.getElementById('calendar-title');
            const monthFilter = document.getElementById('month-filter');
            const lunarCalendarBtn = document.getElementById('lunar-calendar-btn');
            const lunarCalendarModal = document.getElementById('lunar-calendar-modal');
            const lunarPrevMonthBtn = document.getElementById('lunar-prev-month-btn');
            const lunarNextMonthBtn = document.getElementById('lunar-next-month-btn');
            const lunarCalendarGrid = document.getElementById('lunar-calendar-grid');
            const lunarCalendarTitle = document.getElementById('lunar-calendar-title');
            const lunarLegend = document.getElementById('lunar-legend');
            const confirmModal = document.getElementById('confirm-modal');
            const confirmTitle = document.getElementById('confirm-title');
            const confirmMessage = document.getElementById('confirm-message');
            const confirmOkBtn = document.getElementById('confirm-ok-btn');
            const confirmCancelBtn = document.getElementById('confirm-cancel-btn');
            const editObservationModal = document.getElementById('edit-observation-modal');
            const editObservationForm = document.getElementById('edit-observation-form');
            const editObservationIdInput = document.getElementById('edit-observation-id');
            const editObservationText = document.getElementById('edit-observation-text');
            const cancelEditObservationBtn = document.getElementById('cancel-edit-observation');
            const calculatorWidget = document.getElementById('calculator-widget');
            const calculatorToggleBtn = document.getElementById('calculator-toggle-btn');
            const manageEmployeesBtn = document.getElementById('manage-employees-btn');
            const employeeModal = document.getElementById('employee-modal');
            const employeeForm = document.getElementById('employee-form');
            const employeeFormTitle = document.getElementById('employee-form-title');
            const employeeList = document.getElementById('employee-list');
            const cancelEmployeeEditBtn = document.getElementById('cancel-employee-edit-btn');
            const employeeCountEl = document.getElementById('employee-count');
            const employeeFinancialModal = document.getElementById('employee-financial-modal');
            const manageAnimalsBtn = document.getElementById('manage-animals-btn');
            const animalDashboardModal = document.getElementById('animal-dashboard-modal');
            const animalTypeSelector = document.getElementById('animal-type-selector');
            const animalManagementContentWrapper = document.getElementById('animal-management-content-wrapper');
            const animalManagementContent = document.getElementById('animal-management-content');
            const animalPrompt = document.getElementById('animal-prompt');
            const animalTabsContainer = document.getElementById('animal-tabs-container');
            const animalSubModal = document.getElementById('animal-sub-modal');
            const addSaleBtn = document.getElementById('add-sale-btn');
            const salesModal = document.getElementById('sales-modal');
            const saleForm = document.getElementById('sale-form');

            // --- GLOBAL STATE ---
            let userId = null;
            let db; // Make db globally accessible within the script
            let plantingsCollectionRef, suppliesCollectionRef, transactionsCollectionRef,
                scheduledApplicationsCollectionRef, employeesCollectionRef, animalsCollectionRef,
                animalFinancialsCollectionRef, animalProductionCollectionRef, tasksCollectionRef,
                medicationsCollectionRef, remindersCollectionRef;
            let allPlantings = [], allSupplies = [], allTransactions = [], allScheduledApplications = [],
                allEmployees = [], allAnimals = [], allAnimalFinancials = [], allTasks = [],
                allMedications = [], allReminders = [];
            let currentPlantingCache = null;
            let financialChart = null;
            // Variáveis para os novos gráficos
            let donutChart = null;
            let lineChart = null;
            let activeStatusFilter = null;
            let currentCalendarDate = new Date();
            let currentLunarCalendarDate = new Date();
            let confirmCallback = null;
            let activeCalculatorInput = null;
            let currentAnimalType = null;

            // --- CATEGORIES (SORTED ALPHABETICALLY) ---
            const supplyCategories = ['Acaricida', 'Adjuvante', 'Adubo', 'Adubo Foliar', 'Animais', 'Bactericida', 'Ferramentas', 'Fertilizante', 'Fungicida', 'Herbicida', 'Implementos', 'Inseticida', 'Medicamento', 'Mudas', 'Ração', 'Sementes'].sort((a, b) => a.localeCompare(b));
            const seedCategories = ['Sementes', 'Mudas'];
            const applicationCategories = ['Acaricida', 'Adjuvante', 'Adubo', 'Adubo Foliar', 'Bactericida', 'Fertilizante', 'Fungicida', 'Herbicida', 'Inseticida', 'Medicamento', 'Outros'].sort((a, b) => a.localeCompare(b));

            // --- HELPER & CORE FUNCTIONS ---
            // NOVA: Função showToast global e moderna
function showToast(message, type = 'success', duration = 4000) {
    // Garantir que o container existe
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 z-[9999] flex flex-col gap-2 pointer-events-none';
        document.body.appendChild(container);
    }

    // Criar elemento do toast
    const toast = document.createElement('div');
    toast.className = `toast-notification ${type}`;
    
    // Definir ícones por tipo
    const icons = {
        success: 'fas fa-check',
        error: 'fas fa-times',
        warning: 'fas fa-exclamation-triangle',
        info: 'fas fa-info'
    };
    
    toast.innerHTML = `
        <div class="toast-icon">
            <i class="${icons[type] || icons.info}"></i>
        </div>
        <div class="toast-content">${message}</div>
        <button class="toast-close" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    // Adicionar ao container
    container.appendChild(toast);
    
    // Animar entrada
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);
    
    // Auto-remover após duração especificada
    setTimeout(() => {
        toast.classList.add('hide');
        setTimeout(() => {
            if (toast.parentElement) {
                toast.remove();
            }
        }, 400);
    }, duration);
    
    console.log(`[Toast ${type}]:`, message);
}

// Manter compatibilidade global
window.showToast = showToast;
            const formatCurrency = (value) => (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            const showConfirm = (title, message, onConfirm) => { confirmTitle.textContent = title; confirmMessage.textContent = message; confirmCallback = onConfirm; confirmModal.style.display = 'flex'; };
            const hideConfirm = () => { confirmModal.style.display = 'none'; confirmCallback = null; };
            const getPlantingStatus = (planting) => {
                // CORREÇÃO: Verificar finalYieldQuantity ao invés de finalYield
                if (planting.finalYieldQuantity && planting.finalYieldQuantity > 0) {
                    return { text: 'Colhido', key: 'harvested', color: 'bg-green-500' };
                }
                
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const harvestDate = planting.harvestDate ? new Date(planting.harvestDate + 'T00:00:00') : null;
                
                if (!harvestDate) return { text: 'Em Crescimento', key: 'growing', color: 'bg-blue-500' };
                
                const diffDays = (harvestDate - today) / (1000 * 60 * 60 * 24);
                if (diffDays < 0) return { text: 'Colheita Atrasada', key: 'delayed', color: 'bg-red-500' };
                
                return { text: 'Em Crescimento', key: 'growing', color: 'bg-blue-500' };
            };
            const switchTab = (tabName) => { if (tabName === 'details') { tabDetails.classList.add('active'); tabManagement.classList.remove('active'); detailsContent.classList.remove('hidden'); managementContent.classList.add('hidden'); } else { tabDetails.classList.remove('active'); tabManagement.classList.add('active'); detailsContent.classList.add('hidden'); managementContent.classList.remove('hidden'); } };
            const parseLocaleNumber = (stringNumber) => { if (!stringNumber || typeof stringNumber !== 'string') return 0; return parseFloat(stringNumber.replace(/\./g, '').replace(',', '.')); };

            // Função para converter unidades
            const convertUnits = (quantity, fromUnit, toUnit) => {
                if (fromUnit === toUnit) return quantity;
                
                // Tabela de conversão para unidade base (gramas para peso, ml para volume)
                const weightConversions = {
                    'g': 1,
                    'kg': 1000,
                    't': 1000000,
                    '@': 15000, // 1 arroba = 15kg = 15000g
                    'sc': 60000, // 1 saca = 60kg = 60000g
                    'un': 1 // unidade não tem conversão
                };
                
                const volumeConversions = {
                    'mL': 1,
                    'L': 1000,
                    'un': 1 // unidade não tem conversão
                };
                
                // Determinar se é peso ou volume
                const isWeight = ['g', 'kg', 't', '@', 'sc'].includes(fromUnit) && ['g', 'kg', 't', '@', 'sc'].includes(toUnit);
                const isVolume = ['mL', 'L'].includes(fromUnit) && ['mL', 'L'].includes(toUnit);
                
                if (isWeight) {
                    // Converter para gramas, depois para unidade de destino
                    const inGrams = quantity * weightConversions[fromUnit];
                    return inGrams / weightConversions[toUnit];
                } else if (isVolume) {
                    // Converter para ml, depois para unidade de destino
                    const inMl = quantity * volumeConversions[fromUnit];
                    return inMl / volumeConversions[toUnit];
                } else if (fromUnit === 'un' || toUnit === 'un') {
                    // Unidades não podem ser convertidas
                    return quantity;
                }
                
                return quantity; // Fallback
            };

            // Função para calcular custo estimado no agendamento
            const updateScheduleEstimatedCost = () => {
                const selectedSupplies = Array.from(document.getElementById('schedule-supply-from-stock').selectedOptions);
                const quantity = parseFloat(document.getElementById('schedule-quantity').value) || 0;
                const unit = document.getElementById('schedule-unit').value;
                
                let totalCost = 0;
                
                selectedSupplies.forEach(option => {
                    const supply = allSupplies.find(s => s.id === option.value);
                    if (supply && quantity > 0) {
                        // Converter quantidade para unidade do insumo
                        const convertedQuantity = convertUnits(quantity, unit, supply.unit);
                        const unitCost = Number(supply.unitCost) || 0;
                        const cost = convertedQuantity * unitCost;
                        totalCost += cost;
                    }
                });
                
                document.getElementById('schedule-estimated-cost').textContent = formatCurrency(totalCost);
            };

            const updateCalculatedCost = () => { const selectedOption = supplySelect.options[supplySelect.selectedIndex]; const quantityUsed = parseFloat(quantityUsedInput.value) || 0; const selectedUnit = document.getElementById('quantity-used-unit-select')?.value || 'kg'; if (selectedOption && selectedOption.value) { const supply = allSupplies.find(s => s.id === selectedOption.value); if (supply) { let convertedQuantity = quantityUsed; if (selectedUnit !== supply.unit) { convertedQuantity = convertUnits(quantityUsed, selectedUnit, supply.unit); } const unitCost = Number(supply.unitCost) || 0; const totalCost = convertedQuantity * unitCost; calculatedCostElement.textContent = formatCurrency(totalCost); } } else { calculatedCostElement.textContent = 'R$ 0,00'; } };

            // Função para sincronizar imagens pendentes
            async function syncPendingImages() {
                if (!navigator.onLine) return;

                try {
                    const request = indexedDB.open('AgroCultiveDB', 2);

                    request.onsuccess = async (event) => {
                        const db = event.target.result;
                        const tx = db.transaction('images', 'readonly');
                        const store = tx.objectStore('images');
                        const pendingImages = [];

                        store.openCursor().onsuccess = async (e) => {
                            const cursor = e.target.result;
                            if (cursor) {
                                if (!cursor.value.synced) {
                                    pendingImages.push(cursor.value);
                                }
                                cursor.continue();
                            } else {
                                // Sincronizar imagens pendentes
                                for (const image of pendingImages) {
                                    try {
                                        await syncImageToFirebase(image);
                                        console.log('Imagem sincronizada:', image.fileName);
                                    } catch (error) {
                                        console.error('Erro ao sincronizar imagem:', error);
                                    }
                                }

                                if (pendingImages.length > 0) {
                                    showToast(`${pendingImages.length} imagem(ns) sincronizada(s)!`);
                                }
                            }
                        };
                    };
                } catch (error) {
                    console.error('Erro na sincronização:', error);
                }
            }

            // Event listener para detectar quando voltar online
            window.addEventListener('online', () => {
                console.log('Conexão restaurada, sincronizando...');
                syncPendingImages();
            });

            // Event listener para detectar quando ficar offline
            window.addEventListener('offline', () => {
                console.log('Aplicativo funcionando offline');
                showToast('Modo offline ativado');
            });

            // Sincronizar ao carregar a página se estiver online
            window.addEventListener('load', () => {
                if (navigator.onLine) {
                    setTimeout(syncPendingImages, 2000); // Aguardar 2s para carregar completamente
                }
            });

            // --- LUNAR CALENDAR (condensed) ---
            const moonPhases = [{ name: 'Lua Nova', emoji: '🌑', advice: 'Bom para plantar folhosas (alface, couve). Ótimo para controlar pragas.', details: 'Nesta fase, a luminosidade lunar é mínima e a seiva das plantas tende a concentrar-se nas raízes. Isso favorece o desenvolvimento de folhas e caules, tornando-a ideal para o plantio de culturas como alface, couve, espinafre e outras folhosas. É também um excelente período para o controlo de pragas e a eliminação de ervas daninhas, pois as plantas estão menos ativas na sua parte aérea.' }, { name: 'Lua Crescente', emoji: '🌓', advice: 'Excelente para plantar culturas que dão frutos acima do solo (tomate, feijão).', details: 'Com o aumento da luz lunar, a seiva começa a fluir com mais força para a parte superior da planta (caules, folhas e flores). Este período é muito propício para o plantio de culturas que frutificam acima do solo, como tomate, feijão, milho, pimentão e abóbora. O crescimento aéreo é vigoroso, resultando em plantas mais fortes e produtivas.' }, { name: 'Lua Cheia', emoji: '🌕', advice: 'Ideal para plantar raízes (cenoura, batata) e para a colheita de frutas e folhosas.', details: 'A seiva atinge o seu fluxo máximo na parte aérea da planta. A alta luminosidade e a força gravitacional favorecem a absorção de água e nutrientes pelas folhas. É um ótimo momento para a colheita de frutas e hortaliças, que estarão mais suculentas. Também é um bom período para o plantio de espécies de raiz, como cenoura, batata e beterraba, pois a energia lunar impulsiona a germinação.' }, { name: 'Lua Minguante', emoji: '🌗', advice: 'Perfeito para colheita, poda, transplante e plantio de raízes e bulbos.', details: 'Nesta fase, a seiva das plantas começa a descer, concentrando-se novamente nas raízes. A energia da planta é direcionada para o desenvolvimento subterrâneo. É o período ideal para plantar raízes e bulbos (cenoura, rabanete, alho, cebola), realizar podas (pois a cicatrização é mais rápida), fazer transplantes e colher plantas medicinais (que terão maior concentração de princípios ativos nas raízes).' },];
            function getMoonPhase(date) { const day = date.getDate(); let month = date.getMonth() + 1; let year = date.getFullYear(); let c = 0, e = 0, jd = 0, b = 0; if (month < 3) { year--; month += 12; } c = 365.25 * year; e = 30.6 * (month + 1); jd = c + e + day - 694039.09; jd /= 29.5305882; b = parseInt(jd); jd -= b; b = Math.round(jd * 8); if (b >= 8) b = 0; switch (b) { case 0: return moonPhases[0]; case 1: case 2: return moonPhases[1]; case 3: case 4: return moonPhases[2]; case 5: case 6: return moonPhases[3]; case 7: return moonPhases[0]; default: return moonPhases[0]; } }
            const renderLunarCalendar = (date = new Date()) => { currentLunarCalendarDate = new Date(date); const month = currentLunarCalendarDate.getMonth(), year = currentLunarCalendarDate.getFullYear(); lunarCalendarTitle.textContent = currentLunarCalendarDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^\w/, c => c.toUpperCase()); lunarCalendarGrid.innerHTML = ''; const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']; weekdays.forEach(day => { const dayHeader = document.createElement('div'); dayHeader.className = 'font-semibold text-center py-2'; dayHeader.textContent = day; lunarCalendarGrid.appendChild(dayHeader); }); const firstDay = new Date(year, month, 1), lastDay = new Date(year, month + 1, 0); const startDayOfWeek = firstDay.getDay(), daysInMonth = lastDay.getDate(); for (let i = 0; i < startDayOfWeek; i++) { const emptyDay = document.createElement('div'); emptyDay.className = 'calendar-day bg-gray-100'; lunarCalendarGrid.appendChild(emptyDay); } const today = new Date(); today.setHours(0, 0, 0, 0); for (let day = 1; day <= daysInMonth; day++) { const dayDate = new Date(year, month, day);
            const appDate = new Date(app.date + 'T00:00:00'); const dayElement = document.createElement('div'); dayElement.className = 'calendar-day flex flex-col items-center justify-start p-1'; if (dayDate.getTime() === today.getTime()) { dayElement.classList.add('today'); } const phase = getMoonPhase(dayDate); dayElement.innerHTML = `<span class="moon-phase">${phase.emoji}</span><span class="text-center font-medium mt-auto">${day}</span>`; lunarCalendarGrid.appendChild(dayElement); } lunarLegend.innerHTML = `<p class="text-sm text-gray-600 mb-3">Clique numa fase para ver os detalhes. As fases são aproximadas.</p>${moonPhases.map(phase => `<details class="details-section group border-b last:border-b-0 py-2"><summary class="lunar-legend-item cursor-pointer list-none"><span class="lunar-legend-icon">${phase.emoji}</span><div class="flex-grow"><strong class="text-gray-800">${phase.name}</strong><p class="text-gray-600">${phase.advice}</p></div><i class="fas fa-chevron-down group-open:rotate-180 transition-transform mr-2"></i></summary><div class="mt-2 ml-10 pl-2 border-l-2 border-gray-200"><p class="text-sm text-gray-700">${phase.details}</p></div></details>`).join('')}`; };
            const openLunarCalendarModal = () => { lunarCalendarModal.style.display = 'flex'; renderLunarCalendar(); }; const closeLunarCalendarModal = () => { lunarCalendarModal.style.display = 'none'; };

            // --- WEATHER (condensed) ---
            const getWeatherDescription = (code) => { const descriptions = { 0: 'Céu limpo', 1: 'Quase limpo', 2: 'Parcialmente nublado', 3: 'Nublado', 45: 'Nevoeiro', 48: 'Nevoeiro gelado', 51: 'Chuvisco leve', 53: 'Chuvisco moderado', 55: 'Chuvisco forte', 61: 'Chuva fraca', 63: 'Chuva moderada', 65: 'Chuva forte', 71: 'Neve fraca', 73: 'Neve moderada', 75: 'Neve forte', 80: 'Pancadas de chuva fracas', 81: 'Pancadas de chuva moderadas', 82: 'Pancadas de chuva violentas', 95: 'Trovoada', }; return descriptions[code] || 'Condição desconhecida'; };
            const getWeatherIcon = (code, isCurrent = false) => {
                const size = isCurrent ? 'w-16 h-16' : 'w-8 h-8'; // Tamanho maior para o tempo atual

                // SVG para o Sol Amarelo
                const sunIcon = `
                    <svg class="${size} text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 5.05a1 1 0 00-1.414 1.414l.707.707a1 1 0 001.414-1.414l-.707-.707zM3 11a1 1 0 100-2H2a1 1 0 100 2h1z"/>
                    </svg>`;

                // SVG para Nuvens Cinzas
                const cloudIcon = `
                    <svg class="${size} text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M5.5 16a3.5 3.5 0 01-.369-6.98 4 4 0 117.753-1.977A4.5 4.5 0 1113.5 16h-8z"/>
                    </svg>`;

                // SVG para Chuva
                const rainIcon = `
                    <div class="relative ${size}">
                        <svg class="absolute w-full h-full text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M5.5 16a3.5 3.5 0 01-.369-6.98 4 4 0 117.753-1.977A4.5 4.5 0 1113.5 16h-8z"/>
                        </svg>
                        <span class="absolute bottom-0 left-1/4 text-blue-500 text-xs">💧</span>
                        <span class="absolute bottom-1 left-1/2 text-blue-500 text-sm">💧</span>
                    </div>`;
                
                // SVG para Parcialmente Nublado
                const partlyCloudyIcon = `
                    <div class="relative ${size}">
                         <svg class="absolute top-0 left-0 w-3/4 h-3/4 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 5.05a1 1 0 00-1.414 1.414l.707.707a1 1 0 001.414-1.414l-.707-.707zM3 11a1 1 0 100-2H2a1 1 0 100 2h1z"/>
                         </svg>
                        <svg class="absolute bottom-0 right-0 w-full h-full text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M5.5 16a3.5 3.5 0 01-.369-6.98 4 4 0 117.753-1.977A4.5 4.5 0 1113.5 16h-8z"/>
                        </svg>
                    </div>`;

                switch (code) {
                    case 0: // Céu limpo
                        return sunIcon;
                    case 1: // Quase limpo
                    case 2: // Parcialmente nublado
                        return partlyCloudyIcon;
                    case 3: // Nublado
                        return cloudIcon;
                    case 45: // Nevoeiro
                    case 48: // Nevoeiro gelado
                        return cloudIcon; // Usando nuvem para nevoeiro
                    case 51: // Chuvisco leve
                    case 53: // Chuvisco moderado
                    case 55: // Chuvisco forte
                    case 61: // Chuva fraca
                    case 63: // Chuva moderada
                    case 65: // Chuva forte
                    case 80: // Pancadas de chuva fracas
                    case 81: // Pancadas de chuva moderadas
                    case 82: // Pancadas de chuva violentas
                        return rainIcon;
                    case 95: // Trovoada
                        // Adicionar um ícone de trovoada se desejar, por enquanto usando chuva
                        return rainIcon;
                    default:
                        return partlyCloudyIcon; // Ícone padrão
                }
            };
            const fetchWeather = async (lat, lon) => {
    try {
        // Buscar informações da cidade
        const geoApiUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=pt`;
        const geoResponse = await fetch(geoApiUrl);
        const geoData = await geoResponse.json();
        const cityName = geoData.city || geoData.principalSubdivision;

        let weatherData;
        let apiUsed = 'open-meteo';
        
        try {
            // Tentar primeiro a API Open-Meteo
            const weatherApiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max&timezone=auto&forecast_days=7`;
            
            const weatherResponse = await fetch(weatherApiUrl);
            
            if (!weatherResponse.ok) {
                throw new Error(`Open-Meteo API error: ${weatherResponse.status}`);
            }
            
            weatherData = await weatherResponse.json();
            
        } catch (openMeteoError) {
            console.warn('Open-Meteo API failed, trying alternative...', openMeteoError);
            
            // Fallback para OpenWeatherMap com sua chave de API
            try {
                const fallbackUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&lang=pt_br&appid=bbb2edda0ab265a89e81abf19faa6aed`;
                const fallbackResponse = await fetch(fallbackUrl);
                
                if (fallbackResponse.ok) {
                    const fallbackData = await fallbackResponse.json();
                    
                    // Converter dados do OpenWeatherMap para formato Open-Meteo
                    weatherData = {
                        current: {
                            temperature_2m: fallbackData.main.temp,
                            relative_humidity_2m: fallbackData.main.humidity,
                            weather_code: convertOpenWeatherToCode(fallbackData.weather[0].id),
                            wind_speed_10m: fallbackData.wind.speed * 3.6 // converter m/s para km/h
                        },
                        daily: {
                            sunrise: [new Date(fallbackData.sys.sunrise * 1000).toISOString()],
                            sunset: [new Date(fallbackData.sys.sunset * 1000).toISOString()]
                        },
                        hourly: {
                            time: [],
                            temperature_2m: [],
                            weather_code: []
                        }
                    };
                    apiUsed = 'openweather';
                } else {
                    throw new Error('Todas as APIs de clima falharam');
                }
            } catch (fallbackError) {
                // Se tudo falhar, usar dados simulados realistas
                console.warn('All weather APIs failed, using mock data');
                const now = new Date();
                const hour = now.getHours();
                
                // Dados simulados mais realistas baseados na hora do dia
                const baseTemp = 20 + Math.sin((hour - 6) * Math.PI / 12) * 8; // Variação de temperatura ao longo do dia
                
                weatherData = {
                    current: {
                        temperature_2m: Math.round(baseTemp + (Math.random() - 0.5) * 4),
                        relative_humidity_2m: 50 + Math.round(Math.random() * 30),
                        weather_code: hour > 6 && hour < 18 ? (Math.random() > 0.7 ? 2 : 1) : 0, // Mais nuvens durante o dia
                        wind_speed_10m: 5 + Math.random() * 15
                    },
                    daily: {
                        sunrise: [new Date(now.getFullYear(), now.getMonth(), now.getDate(), 6, 0).toISOString()],
                        sunset: [new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 30).toISOString()]
                    },
                    hourly: {
                        time: [],
                        temperature_2m: [],
                        weather_code: []
                    }
                };
                apiUsed = 'mock';
            }
        }

        if (!weatherWidget) return;

        // Verificar se os dados necessários existem
        if (!weatherData || !weatherData.current) {
            throw new Error('Dados incompletos recebidos da API');
        }

        const { current, hourly, daily } = weatherData;
        
        // Verificar se as propriedades necessárias existem
        if (typeof current.temperature_2m === 'undefined' || 
            typeof current.weather_code === 'undefined' ||
            typeof current.wind_speed_10m === 'undefined' ||
            typeof current.relative_humidity_2m === 'undefined') {
            throw new Error('Dados do clima atual incompletos');
        }
        
        // Atualizar data atual
        const currentDate = new Date().toLocaleDateString('pt-BR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long'
        });
        
        // Atualizar painel principal (clima atual)
        updateCurrentWeatherPanel({
            cityName: cityName + (apiUsed !== 'open-meteo' ? ` (${apiUsed})` : ''),
            currentDate,
            temperature: Math.round(current.temperature_2m),
            weatherCode: current.weather_code,
            windSpeed: current.wind_speed_10m.toFixed(1),
            humidity: current.relative_humidity_2m,
            sunrise: daily && daily.sunrise && daily.sunrise[0] ? new Date(daily.sunrise[0]).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--',
            sunset: daily && daily.sunset && daily.sunset[0] ? new Date(daily.sunset[0]).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--'
        });
        
        // Atualizar previsão horária (próximas 12 horas) - apenas se os dados existirem
        // Como não temos container horário, vamos comentar esta linha
        // if (hourly && hourly.time && hourly.temperature_2m && hourly.weather_code && hourly.time.length > 0) {
        //     updateHourlyForecast(hourly);
        // }
        
        // Atualizar previsão diária (próximos 5 dias) - apenas se os dados existirem
        if (daily && daily.time && daily.temperature_2m_max && daily.temperature_2m_min && daily.weather_code) {
            updateDailyForecast(daily);
        }
        
    } catch (error) {
        console.error('Error fetching weather:', error);
        if (weatherWidget) {
            let errorMessage = 'Não foi possível obter a previsão do tempo.';
            let errorDetail = error.message;
            
            // Mensagens de erro mais específicas
            if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                errorMessage = 'Erro de conexão com a internet.';
                errorDetail = 'Verifique sua conexão e tente novamente.';
            } else if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                errorMessage = 'Erro de autenticação da API.';
                errorDetail = 'Chave de API inválida ou expirada.';
            } else if (error.message.includes('429') || error.message.includes('rate limit')) {
                errorMessage = 'Limite de requisições excedido.';
                errorDetail = 'Tente novamente em alguns minutos.';
            }
            
            weatherWidget.innerHTML = `
                <div class="glassmorphism-panel text-center">
                    <div class="text-red-500">${errorMessage}</div>
                    <div class="text-sm text-gray-600 mt-1">${errorDetail}</div>
                    <button onclick="location.reload()" class="mt-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition">
                        Tentar Novamente
                    </button>
                </div>
            `;
        }
    }
};

// Função auxiliar para converter códigos do OpenWeatherMap para Open-Meteo
function convertOpenWeatherToCode(owmCode) {
    // Mapeamento básico de códigos OpenWeatherMap para Open-Meteo
    const codeMap = {
        800: 0,  // clear sky
        801: 1,  // few clouds
        802: 2,  // scattered clouds
        803: 2,  // broken clouds
        804: 3,  // overcast clouds
        500: 61, // light rain
        501: 63, // moderate rain
        502: 65, // heavy rain
        503: 65, // very heavy rain
        504: 65, // extreme rain
        511: 65, // freezing rain
        520: 80, // light intensity shower rain
        521: 81, // shower rain
        522: 82, // heavy intensity shower rain
        531: 82, // ragged shower rain
        200: 95, // thunderstorm
        201: 95, // thunderstorm
        202: 95, // thunderstorm
        210: 95, // thunderstorm
        211: 95, // thunderstorm
        212: 95, // thunderstorm
        221: 95, // thunderstorm
        230: 95, // thunderstorm
        231: 95, // thunderstorm
        232: 95  // thunderstorm
    };
    
    return codeMap[owmCode] || 1; // default to few clouds
}

// Função corrigida para atualizar a previsão horária
function updateHourlyForecast(hourlyData) {
    // Como não temos container para previsão horária no HTML atual, vamos pular esta função
    // ou podemos adicionar os dados horários em outro local
    console.log('Previsão horária disponível:', hourlyData);
    return; // Pular por enquanto
}

// Função corrigida para atualizar a previsão diária
function updateDailyForecast(dailyData) {
    const container = weatherWidget.querySelector('.forecast-5day');
    if (!container || !dailyData || !dailyData.time || !dailyData.temperature_2m_max || !dailyData.temperature_2m_min || !dailyData.weather_code) {
        // Se não temos dados completos, vamos manter os elementos existentes
        return;
    }
    
    // Verificar se temos dados suficientes
    if (dailyData.time.length < 6) {
        console.log('Dados diários insuficientes');
        return;
    }
    
    // Pegar os elementos existentes da previsão de 5 dias
    const forecastDays = container.querySelectorAll('.forecast-day');
    
    // Atualizar cada dia (máximo 6 dias)
    for (let i = 0; i < Math.min(6, forecastDays.length, dailyData.time.length - 1); i++) {
        const dayIndex = i + 1; // Pular o dia atual
        const dayElement = forecastDays[i];
        
        if (!dailyData.time[dayIndex] || 
            typeof dailyData.weather_code[dayIndex] === 'undefined' || 
            typeof dailyData.temperature_2m_max[dayIndex] === 'undefined' || 
            typeof dailyData.temperature_2m_min[dayIndex] === 'undefined') {
            continue;
        }
        
        const date = new Date(dailyData.time[dayIndex] + 'T00:00:00');
        const dayName = date.toLocaleDateString('pt-BR', { weekday: 'short' });
        const iconHTML = getWeatherIcon(dailyData.weather_code[dayIndex], false);
        const maxTemp = Math.round(dailyData.temperature_2m_max[dayIndex]);
        const minTemp = Math.round(dailyData.temperature_2m_min[dayIndex]);

        // Atualizar elementos existentes
        const dayNameEl = dayElement.querySelector('.day-name');
        const dayIconEl = dayElement.querySelector('.day-icon');
        const tempMaxEl = dayElement.querySelector('.temp-max');
        const tempMinEl = dayElement.querySelector('.temp-min');
        
        if (dayNameEl) dayNameEl.textContent = dayName.replace('.', '');
        if (dayIconEl) dayIconEl.innerHTML = iconHTML;
        if (tempMaxEl) tempMaxEl.textContent = `${maxTemp}°`;
        if (tempMinEl) tempMinEl.textContent = `${minTemp}°`;
    }
}

// Função para atualizar o painel do clima atual (corrigida)
function updateCurrentWeatherPanel(data) {
    if (!weatherWidget) return;
    
    const cityNameEl = weatherWidget.querySelector('.city-name');
    const currentDateEl = weatherWidget.querySelector('.current-date');
    const currentIconEl = weatherWidget.querySelector('.weather-icon');
    const currentTempEl = weatherWidget.querySelector('.current-temp');
    const weatherDescriptionEl = weatherWidget.querySelector('.weather-description');
    const windSpeedEl = weatherWidget.querySelector('.wind-speed');
    const humidityEl = weatherWidget.querySelector('.humidity');
    const sunriseEl = weatherWidget.querySelector('.sunrise');
    const sunsetEl = weatherWidget.querySelector('.sunset');
    
    // Atualizar apenas elementos que existem
    if (cityNameEl) cityNameEl.textContent = data.cityName || 'Localização';
    if (currentDateEl) currentDateEl.textContent = data.currentDate || '';
    if (currentIconEl) currentIconEl.innerHTML = getWeatherIcon(data.weatherCode, true);
    if (currentTempEl) currentTempEl.textContent = `${data.temperature}°C`;
    if (weatherDescriptionEl) weatherDescriptionEl.textContent = getWeatherDescription(data.weatherCode);
    if (windSpeedEl) windSpeedEl.textContent = `${data.windSpeed} km/h`;
    if (humidityEl) humidityEl.textContent = `${data.humidity}%`;
    if (sunriseEl) sunriseEl.textContent = data.sunrise || '--:--';
    if (sunsetEl) sunsetEl.textContent = data.sunset || '--:--';
}

            // --- NOVAS FUNÇÕES DO PAINEL FINANCEIRO ---
            const renderNewFinancialDashboard = () => {
                const today = new Date();
                
                // Combinar transações gerais e de animais
                const allCombinedTransactions = [...allTransactions, ...allAnimalFinancials];
                
                const futureTransactions = allCombinedTransactions
                    .filter(t => new Date(t.date + 'T00:00:00') > today)
                    .reduce((sum, t) => sum + (t.type === 'receita' ? t.amount : -t.amount), 0);
                const totalExpenses = allCombinedTransactions
                    .filter(t => t.type === 'despesa')
                    .reduce((sum, t) => sum + t.amount, 0);
                const totalRevenues = allCombinedTransactions
                    .filter(t => t.type === 'receita')
                    .reduce((sum, t) => sum + t.amount, 0);
                
                document.getElementById('future-transactions').textContent = formatCurrency(Math.abs(futureTransactions));
                document.getElementById('open-overdue').textContent = formatCurrency(totalExpenses);
                document.getElementById('paid-consolidated').textContent = formatCurrency(totalRevenues);
                
                renderDonutChart(totalRevenues, totalExpenses, Math.abs(futureTransactions));
                renderLineChart();
            };

            const renderDonutChart = (pago, aberto, vencido) => {
                const ctx = document.getElementById('donut-chart').getContext('2d');
                if (donutChart) donutChart.destroy();
                donutChart = new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels: ['Pago (Receitas)', 'Em Aberto (Despesas)', 'Futuro'],
                        datasets: [{
                            data: [pago, aberto, vencido],
                            backgroundColor: ['#16a34a', '#f97316', '#3b82f6'],
                            borderColor: ['#ffffff'],
                            borderWidth: 4
                        }]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        plugins: { legend: { position: 'bottom', labels: { padding: 20, usePointStyle: true } }, tooltip: { callbacks: { label: (context) => `${context.label}: ${formatCurrency(context.parsed)}` } } },
                        cutout: '70%'
                    }
                });
            };

            const renderLineChart = () => {
                const ctx = document.getElementById('line-chart').getContext('2d');
                if (lineChart) lineChart.destroy();
                const monthlyData = Array(12).fill(0).map(() => ({ receitas: 0, despesas: 0 }));
                const currentYear = new Date().getFullYear();
                
                // Combinar transações gerais e de animais
                const allCombinedTransactions = [...allTransactions, ...allAnimalFinancials];
                
                allCombinedTransactions
                    .filter(t => new Date(t.date + 'T00:00:00').getFullYear() === currentYear)
                    .forEach(t => {
                        const month = new Date(t.date + 'T00:00:00').getMonth();
                        if (t.type === 'receita') monthlyData[month].receitas += t.amount;
                        else monthlyData[month].despesas += t.amount;
                    });
                const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
                const receitasData = monthlyData.map(d => d.receitas);
                const despesasData = monthlyData.map(d => d.despesas);
                lineChart = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: months,
                        datasets: [
                            { label: 'Receitas', data: receitasData, borderColor: '#16a34a', backgroundColor: 'rgba(22, 163, 74, 0.1)', fill: true, tension: 0.4 },
                            { label: 'Despesas', data: despesasData, borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', fill: true, tension: 0.4 }
                        ]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        scales: { y: { beginAtZero: true, ticks: { callback: (value) => formatCurrency(value) } } },
                        plugins: { legend: { position: 'top' }, tooltip: { mode: 'index', intersect: false, callbacks: { label: (context) => `${context.dataset.label}: ${formatCurrency(context.parsed.y)}` } } }
                    }
                });
            };

            // --- RENDER FUNCTIONS (condensed) ---
            const updateDashboard = () => {
                const counts = { growing: 0, harvested: 0, delayed: 0 };
                allPlantings.forEach(p => {
                    const statusKey = getPlantingStatus(p).key;
                    if (counts[statusKey] !== undefined) {
                        counts[statusKey]++;
                    }
                });
                document.getElementById('growing-count').textContent = counts.growing;
                document.getElementById('harvested-count').textContent = counts.harvested;
                document.getElementById('delayed-count').textContent = counts.delayed;
                employeeCountEl.textContent = allEmployees.filter(e => e.status === 'ativo').length;
                
                renderNewFinancialDashboard();
            };
            const renderPlantings = (plantingsToRender) => { plantingList.innerHTML = ''; emptyState.classList.add('hidden'); noResults.classList.add('hidden'); if (allPlantings.length === 0) { emptyState.classList.remove('hidden'); return; } if (plantingsToRender.length === 0) { noResults.classList.remove('hidden'); return; } plantingsToRender.sort((a, b) => new Date(b.plantingDate) - new Date(a.plantingDate)).forEach(planting => plantingList.appendChild(createPlantingCard(planting))); };
            const createPlantingCard = (planting) => { const card = document.createElement('div'); card.className = 'planting-card bg-white rounded-xl shadow-lg p-5 flex flex-col transition-shadow hover:shadow-xl'; const status = getPlantingStatus(planting); const initialCost = Number(planting.initialCost) || 0; const managementCost = (planting.managementHistory || []).reduce((sum, m) => sum + (Number(m.applicationCost) || 0), 0); const totalCost = initialCost + managementCost; const totalRevenueFromSales = (planting.salesHistory || []).reduce((sum, sale) => sum + (Number(sale.price) || 0), 0); const finalYieldDisplay = planting.finalYieldQuantity && planting.finalYieldUnit ? `${planting.finalYieldQuantity} ${planting.finalYieldUnit}` : planting.finalYield || 'N/A'; let profitHTML = ''; if (status.key === 'harvested') { const profit = totalRevenueFromSales - totalCost; profitHTML = `<div class="flex justify-between font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-600'} border-t pt-2 mt-2"><span><i class="fas fa-chart-line fa-fw mr-2"></i>${profit >= 0 ? 'Lucro' : 'Prejuízo'}:</span> <strong>${formatCurrency(profit)}</strong></div>`; } else { profitHTML = `<div class="flex justify-between font-bold text-gray-700 border-t pt-2 mt-2"><span><i class="fas fa-chart-line fa-fw mr-2"></i>Lucro/Prejuízo:</span> <strong>-</strong></div>`; } let managementDetailsHTML = (planting.managementHistory && planting.managementHistory.length > 0) ? (planting.managementHistory.map(entry => { const supply = allSupplies.find(s => s.id === entry.supplyId); const productName = supply ? supply.name : 'Insumo Apagado'; const unit = supply ? supply.unit : ''; return `<li class="text-xs flex justify-between"><span>- ${productName} (${entry.quantityUsed} ${unit})</span> <span>${formatCurrency(entry.applicationCost)}</span></li>`; }).join('')) : '<li class="text-xs text-gray-500">Nenhuma aplicação registada.</li>'; card.innerHTML = `<div class="flex-grow"><div class="flex justify-between items-start mb-2"><h3 class="text-xl font-bold text-gray-800">${planting.cropName}</h3><span class="text-xs font-semibold text-white ${status.color} px-2 py-1 rounded-full">${status.text}</span></div><p class="text-gray-500 mb-4 text-sm">${planting.variety || 'Variedade não informada'}</p><div class="space-y-2 text-sm border-t pt-3 mt-3 bg-gray-50 p-3 rounded-lg"><div class="flex justify-between"><span><i class="fas fa-leaf fa-fw mr-2 text-gray-400"></i>Custo Inicial:</span> <strong>${formatCurrency(initialCost)}</strong></div><details class="details-section"><summary class="cursor-pointer flex justify-between"><span><i class="fas fa-syringe fa-fw mr-2 text-gray-400"></i>Custo de Manejo:</span> <strong>${formatCurrency(managementCost)}</strong></summary><ul class="mt-2 pl-6 space-y-1">${managementDetailsHTML}</ul></details><div class="flex justify-between"><span><i class="fas fa-tractor fa-fw mr-2 text-gray-400"></i>Produção Final:</span> <strong>${finalYieldDisplay}</strong></div><div class="flex justify-between border-t pt-2 mt-2"><span><i class="fas fa-arrow-down fa-fw mr-2 text-red-500"></i>Custo Total:</span> <strong>${formatCurrency(totalCost)}</strong></div><div class="flex justify-between"><span><i class="fas fa-arrow-up fa-fw mr-2 text-green-500"></i>Receita (Vendas):</span> <strong>${formatCurrency(totalRevenueFromSales)}</strong></div>${profitHTML}</div></div><div class="mt-5 pt-4 border-t border-gray-200 flex justify-end gap-3"><button class="manage-btn text-blue-500 hover:text-blue-700 transition" title="Diário"><i class="fas fa-book-open fa-lg"></i></button><button class="edit-btn text-gray-600 hover:text-gray-800 transition" title="Editar Detalhes"><i class="fas fa-pencil-alt fa-lg"></i></button><button class="delete-btn text-red-500 hover:text-red-700 transition" title="Excluir"><i class="fas fa-trash-alt fa-lg"></i></button></div>`; card.querySelector('.manage-btn').addEventListener('click', () => openPlantingModal('manage', planting)); card.querySelector('.edit-btn').addEventListener('click', () => openPlantingModal('edit', planting)); card.querySelector('.delete-btn').addEventListener('click', () => handleDeletePlanting(planting.id)); return card; };
            const renderSupplies = () => { suppliesList.innerHTML = ''; if (allSupplies.length === 0) { suppliesList.innerHTML = `<p class="text-gray-500 text-center p-4">Nenhum insumo em estoque.</p>`; return; } allSupplies.sort((a, b) => a.name.localeCompare(b.name)).forEach(supply => { const costPerUnit = supply.quantity > 0 ? (supply.cost / supply.quantity) : 0; const item = document.createElement('div'); item.className = 'bg-gray-50 p-3 rounded-lg'; item.innerHTML = `<div class="flex justify-between items-center"><div><p class="font-semibold">${supply.name} <span class="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">${supply.category}</span></p><p class="text-sm text-gray-500">${supply.variety ? `Variedade: <strong>${supply.variety}</strong>` : ''}</p><p class="text-sm text-gray-600">Restante: <strong>${Number(supply.remaining).toFixed(2)} / ${supply.quantity} ${supply.unit}</strong></p><p class="text-sm text-gray-500">Custo: ${formatCurrency(costPerUnit)} / ${supply.unit}</p></div><div class="flex gap-3"><button class="edit-supply-btn text-blue-500" data-id="${supply.id}"><i class="fas fa-pencil-alt"></i></button><button class="delete-supply-btn text-red-500" data-id="${supply.id}"><i class="fas fa-trash-alt"></i></button></div></div>`; item.querySelector('.edit-supply-btn').addEventListener('click', () => handleEditSupply(supply)); item.querySelector('.delete-supply-btn').addEventListener('click', () => handleDeleteSupply(supply.id)); suppliesList.appendChild(item); }); };
            const renderLog = (planting) => {
                logList.innerHTML = '';
                const managementHistory = (planting.managementHistory || []).map(entry => ({ type: 'application', ...entry }));
                const logEntries = (planting.log || []).map(entry => ({ type: 'observation', ...entry }));
                const timeline = [...managementHistory, ...logEntries];
                if (timeline.length === 0) {
                    logList.innerHTML = `<p class="text-gray-500 text-center p-4">Nenhum registo no diário.</p>`;
                    return;
                }
                timeline.sort((a, b) => (b.timestamp || new Date(b.date).getTime()) - (a.timestamp || new Date(a.date).getTime()));
                timeline.forEach(entry => {
                    const item = document.createElement('div');
                    item.className = 'bg-white p-3 rounded-md shadow-sm';
                    const date = entry.timestamp ?
                        new Date(entry.timestamp).toLocaleString('pt-BR', {
                            day: '2-digit', month: '2-digit', year: 'numeric',
                            hour: '2-digit', minute: '2-digit'
                        }) :
                        new Date(entry.date + 'T00:00:00').toLocaleDateString('pt-BR'); // CORREÇÃO: Já aplicada
                    if (entry.type === 'application') {
                        const supply = allSupplies.find(s => s.id === entry.supplyId);
                        const productName = supply ? supply.name : 'Insumo Apagado';
                        const unit = supply ? supply.unit : '';
                        item.innerHTML = `<div class="flex items-start gap-3"><i class="fas fa-syringe text-blue-500 fa-lg mt-1"></i><div class="flex-grow"><p class="font-semibold text-sm text-blue-700">Aplicação de Insumo</p><p class="text-sm text-gray-800"><strong>${productName}</strong>: ${entry.quantityUsed} ${unit}</p><p class="text-xs text-gray-500">${date} - Custo: ${formatCurrency(entry.applicationCost)}</p></div><div class="flex gap-3"><button class="delete-log-btn text-red-400 hover:text-red-600" title="Apagar Aplicação"><i class="fas fa-trash-alt"></i></button></div></div>`;
                        item.querySelector('.delete-log-btn').addEventListener('click', () => handleDeleteLogEntry(planting.id, entry));
                    } else {
                        item.innerHTML = `<div class="flex items-start gap-3"><i class="fas fa-comment-dots text-gray-500 fa-lg mt-1"></i><div class="flex-grow"><p class="font-semibold text-sm text-gray-700">Observação</p><p class="text-sm text-gray-800">${entry.text}</p><p class="text-xs text-gray-500 text-right">${date}</p></div><div class="flex gap-3"><button class="edit-log-btn text-blue-400 hover:text-blue-600" title="Editar Observação"><i class="fas fa-pencil-alt"></i></button><button class="delete-log-btn text-red-400 hover:text-red-600" title="Apagar Observação"><i class="fas fa-trash-alt"></i></button></div></div>`;
                        item.querySelector('.edit-log-btn').addEventListener('click', () => handleEditLogEntry(planting.id, entry));
                        item.querySelector('.delete-log-btn').addEventListener('click', () => handleDeleteLogEntry(planting.id, entry));
                    }
                    logList.appendChild(item);
                });
            };
            function renderTransactions() {
                // Combinar e ordenar todas as transações
                const allCombinedTransactions = [...allTransactions, ...allAnimalFinancials]
                    .sort((a, b) => new Date(b.date + 'T00:00:00') - new Date(a.date + 'T00:00:00'));
                
                const transactionList = document.getElementById('transaction-list');
                if (allCombinedTransactions.length === 0) {
                    transactionList.innerHTML = '<p class="text-gray-500 text-center p-4">Nenhuma transação registada.</p>';
                    return;
                }
                
                transactionList.innerHTML = allCombinedTransactions.map(transaction => {
                    const isRevenue = transaction.type === 'receita';
                    const animalTypeLabel = transaction.animalType ? ` (${transaction.animalType})` : '';
                    const isAnimalTransaction = transaction.animalType !== undefined;
                    
                    // --> INÍCIO DA ADIÇÃO
                    let clientInfoHTML = '';
                    if (transaction.clienteNome) {
                        clientInfoHTML = `
                                <p class="text-xs text-gray-500 mt-1 flex items-center">
                                    <i class="fas fa-user mr-2 text-gray-400"></i>
                                    <span class="mr-1">Cliente:</span>
                                    <strong class="text-gray-700">${transaction.clienteNome}</strong>
                                </p>
                            `;
                    }
                    // <-- FIM DA ADIÇÃO
                    
                    return `
                        <div class="transaction-item bg-white p-4 rounded-lg shadow-sm border flex justify-between items-center">
                            <div class="flex-1">
                                <p class="font-semibold text-gray-800">${transaction.description}${animalTypeLabel}</p>
                                <p class="text-sm text-gray-500">${transaction.category} • ${new Date(transaction.date + 'T00:00:00').toLocaleDateString('pt-BR')}</p>
                                ${clientInfoHTML}
                            </div>
                            <div class="flex items-center gap-3">
                                <div class="text-right">
                                    <p class="font-bold ${isRevenue ? 'text-green-600' : 'text-red-600'}">
                                        ${isRevenue ? '+' : '-'} ${formatCurrency(transaction.amount)}
                                    </p>
                                </div>
                                <button 
                                    onclick="${isAnimalTransaction ? 'handleDeleteAnimalTransaction' : 'handleDeleteTransaction'}('${transaction.id}')"
                                    class="text-red-500 hover:text-red-700 hover:bg-red-50 p-2 rounded-full transition-colors"
                                    title="Apagar transação"
                                >
                                    <i class="fas fa-trash-alt text-sm"></i>
                                </button>
                            </div>
                        </div>
                    `;
                }).join('');
            }
            // const renderFinancialChart = () => { if (allPlantings.length === 0 && allSupplies.length === 0) { financialSummarySection.classList.add('hidden'); return; } financialSummarySection.classList.remove('hidden'); let totalProfit = 0, totalLoss = 0; allPlantings.forEach(p => { const revenue = (p.salesHistory || []).reduce((sum, sale) => sum + (Number(sale.price) || 0), 0); if (p.finalYield) { const totalCost = (Number(p.initialCost) || 0) + (p.managementHistory || []).reduce((sum, m) => sum + (Number(m.applicationCost) || 0), 0); const profit = revenue - totalCost; if (profit >= 0) { totalProfit += profit; } else { totalLoss += Math.abs(profit); } } }); const totalSuppliesCost = allSupplies.reduce((total, s) => total + (Number(s.cost) || 0), 0); const ctx = financialChartCanvas.getContext('2d'); if (financialChart) { financialChart.destroy(); } financialChart = new Chart(ctx, { type: 'pie', data: { labels: ['Lucro', 'Prejuízo', 'Custo de Insumos'], datasets: [{ label: 'Resumo Financeiro', data: [totalProfit, totalLoss, totalSuppliesCost], backgroundColor: ['rgba(34, 197, 94, 0.7)', 'rgba(239, 68, 68, 0.7)', 'rgba(59, 130, 246, 0.7)'], borderColor: ['rgba(34, 197, 94, 1)', 'rgba(239, 68, 68, 1)', 'rgba(59, 130, 246, 1)'], borderWidth: 1 }] }, options: { responsive: true, plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: function (context) { let label = context.label || ''; if (label) { label += ': '; } if (context.parsed !== null) { label += formatCurrency(context.parsed); } return label; } } } } } }); };
            const renderReminders = () => {
    const remindersList = document.getElementById('reminders-list');
    
    if (!remindersList) {
        console.warn('Elemento reminders-list não encontrado');
        return;
    }
    
    console.log('🔄 Renderizando lembretes:', allScheduledApplications.length);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const upcomingReminders = allScheduledApplications.filter(app => {
        const appDate = new Date(app.date + 'T00:00:00');
        appDate.setHours(0, 0, 0, 0);
        
        // Incluir aplicações pendentes, agendadas, ativas e concluídas recentemente
        const validStatuses = ['pending', 'scheduled', 'active', 'completed'];
        const hasValidStatus = !app.status || validStatuses.includes(app.status);
        
        return appDate >= today && hasValidStatus;
    }).sort((a, b) => {
        const dateA = new Date(a.date + 'T00:00:00');
        const dateB = new Date(b.date + 'T00:00:00');
        return dateA - dateB;
    });
    
    if (upcomingReminders.length === 0) {
        remindersList.innerHTML = '<p class="text-gray-500 text-center p-4">Nenhum lembrete próximo.</p>';
        return;
    }
    
    remindersList.innerHTML = upcomingReminders.map(reminder => {
        const appDate = new Date(reminder.date + 'T00:00:00');
        const isToday = appDate.toDateString() === today.toDateString();
        const isPast = appDate < today;
        const isCompleted = reminder.status === 'completed';
        const isRefunded = reminder.status === 'refunded';
        
        let statusClass = 'border-blue-200 bg-blue-50';
        let statusText = 'Agendado';
        let statusIcon = 'fas fa-clock';
        
        if (isRefunded) {
            statusClass = 'border-orange-200 bg-orange-50';
            statusText = 'Estornado';
            statusIcon = 'fas fa-undo';
        } else if (isCompleted) {
            statusClass = 'border-green-200 bg-green-50';
            statusText = 'Concluído';
            statusIcon = 'fas fa-check-circle';
        } else if (isPast) {
            statusClass = 'border-red-200 bg-red-50';
            statusText = 'Atrasado';
            statusIcon = 'fas fa-exclamation-triangle';
        } else if (isToday) {
            statusClass = 'border-yellow-200 bg-yellow-50';
            statusText = 'Hoje';
            statusIcon = 'fas fa-bell';
        }
        
        const formattedDate = appDate.toLocaleDateString('pt-BR');
        const formattedTime = reminder.time || '08:00';
        const productNames = reminder.products ? reminder.products.map(p => p.name).join(' + ') : 'Produtos não especificados';
        const targetName = reminder.plantingName || reminder.selectedAnimals || 'Alvo não especificado';
        const dose = reminder.dose || 'Não especificada';
        const quantity = reminder.quantity || 0;
        const unit = reminder.unit || 'kg';
        
        // Calcular estoque reservado
        let reservedInfo = '';
        if (reminder.stockReservations && reminder.stockReservations.length > 0) {
            const totalReserved = reminder.stockReservations.reduce((sum, res) => sum + res.quantityReserved, 0);
            reservedInfo = `<div class="text-xs text-blue-600 mt-1"><i class="fas fa-lock mr-1"></i>Reservado: ${totalReserved.toFixed(2)} ${reminder.stockReservations[0].unit}</div>`;
        }
        
        // Botões de ação baseados no status
        let actionButtons = '';
        if (isRefunded) {
            actionButtons = `<span class="text-orange-600 text-sm font-medium"><i class="fas fa-undo mr-1"></i>Estornado</span>`;
        } else if (isCompleted) {
            const costInfo = reminder.actualCost ? ` - ${formatCurrency(reminder.actualCost)}` : '';
            actionButtons = `
                <div class="flex flex-col gap-1">
                    <span class="text-green-600 text-sm font-medium"><i class="fas fa-check-circle mr-1"></i>Concluído${costInfo}</span>
                    <div class="flex gap-1">
                        <button onclick="handleRefundApplication('${reminder.id}')" 
                                class="bg-orange-500 hover:bg-orange-600 text-white px-2 py-1 rounded text-xs transition-colors flex-1">
                            <i class="fas fa-undo mr-1"></i> Estornar
                        </button>
                        <button onclick="handleDeleteApplication('${reminder.id}')" 
                                class="bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded text-xs transition-colors flex-1">
                            <i class="fas fa-trash mr-1"></i> Apagar
                        </button>
                    </div>
                </div>
            `;
        } else {
            actionButtons = `
                <div class="flex gap-2">
                    <button onclick="handleEditReminder(${JSON.stringify(reminder).replace(/"/g, '&quot;')})" 
                            class="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded text-xs transition-colors">
                        <i class="fas fa-edit mr-1"></i> Editar
                    </button>
                    <button onclick="markReminderAsCompleted('${reminder.id}')" 
                            class="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded text-xs transition-colors">
                        <i class="fas fa-check mr-1"></i> Concluir
                    </button>
                    <button onclick="handleDeleteReminder('${reminder.id}')" 
                            class="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-xs transition-colors">
                        <i class="fas fa-times mr-1"></i> Cancelar
                    </button>
                </div>
            `;
        }
        
        return `
            <div class="reminder-item border-l-4 ${statusClass} p-3 mb-2 rounded-r-lg" data-reminder-id="${reminder.id}">
                <div class="flex justify-between items-start mb-2">
                    <div class="flex-1">
                        <h4 class="font-semibold text-gray-800">${reminder.title || productNames}</h4>
                        <p class="text-sm text-gray-600 mt-1">
                            <i class="fas fa-calendar mr-1"></i>${formattedDate} às ${formattedTime}
                        </p>
                        <p class="text-sm text-gray-600">
                            <i class="fas fa-bullseye mr-1"></i>${targetName}
                        </p>
                        <p class="text-sm text-gray-600">
                            <i class="fas fa-tint mr-1"></i>Dose: ${dose} (${quantity} ${unit})
                        </p>
                        ${reservedInfo}
                        ${reminder.notes ? `<p class="text-xs text-gray-500 mt-1 italic">${reminder.notes}</p>` : ''}
                    </div>
                    <div class="flex flex-col items-end gap-2">
                        <span class="text-xs font-semibold px-2 py-1 rounded-full flex items-center gap-1">
                            <i class="${statusIcon}"></i>${statusText}
                        </span>
                    </div>
                </div>
                <div class="reminder-buttons flex justify-end mt-2">
                    ${actionButtons}
                </div>
            </div>
        `;
    }).join('');
    
    console.log(`✅ Renderizados ${upcomingReminders.length} lembretes`);
};
            const renderCalendar = (date = new Date()) => {
                currentCalendarDate = new Date(date);
                const month = currentCalendarDate.getMonth(), year = currentCalendarDate.getFullYear();
                calendarTitle.textContent = currentCalendarDate.toLocaleDateString('pt-BR', { 
                    month: 'long', 
                    year: 'numeric' 
                }).replace(/^\w/, c => c.toUpperCase());
                
                calendarGrid.innerHTML = '';
                
                const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
                weekdays.forEach(day => {
                    const dayHeader = document.createElement('div');
                    dayHeader.className = 'font-semibold text-center py-2';
                    dayHeader.textContent = day;
                    calendarGrid.appendChild(dayHeader);
                });
                
                const firstDay = new Date(year, month, 1), lastDay = new Date(year, month + 1, 0);
                const startDay = firstDay.getDay(), daysInMonth = lastDay.getDate();
                
                for (let i = 0; i < startDay; i++) {
                    const emptyDay = document.createElement('div');
                    emptyDay.className = 'calendar-day bg-gray-100';
                    calendarGrid.appendChild(emptyDay);
                }
                
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                
                for (let day = 1; day <= daysInMonth; day++) {
                    const dayDate = new Date(year, month, day);
                    const dayElement = document.createElement('div');
                    dayElement.className = 'calendar-day';
                    
                    if (dayDate.getTime() === today.getTime()) {
                        dayElement.classList.add('today');
                    }
                    
                    const dayEvents = allScheduledApplications.filter(app => {
                        const appDate = new Date(app.date + 'T00:00:00');
                        return appDate.getFullYear() === year && 
                               appDate.getMonth() === month && 
                               appDate.getDate() === day;
                    });
                    
                    if (dayEvents.length > 0) {
                        dayElement.classList.add('has-event');
                        
                        // Adiciona funcionalidade de clique
                        dayElement.style.cursor = 'pointer';
                        dayElement.addEventListener('click', () => {
                            showDayDetailsModal(dayDate, dayEvents);
                        });
                        
                        const eventBadge = document.createElement('div');
                        eventBadge.className = 'w-2 h-2 bg-yellow-500 rounded-full mx-auto mb-1';
                        dayElement.appendChild(eventBadge);
                        
                        // Texto abreviado para garantir legibilidade em dispositivos móveis
                        const summaryEl = document.createElement('div');
                        summaryEl.className = 'text-xs text-center px-1 py-0.5 bg-yellow-100 rounded mb-1 font-medium leading-tight';
                        summaryEl.textContent = dayEvents.length === 1 ? '1 Apl.' : `${dayEvents.length} Apls.`;
                        dayElement.appendChild(summaryEl);
                    }
                    
                    const dayNumber = document.createElement('div');
                    dayNumber.className = 'text-center font-medium';
                    dayNumber.textContent = day;
                    dayElement.appendChild(dayNumber);
                    
                    calendarGrid.appendChild(dayElement);
                }
            };

            // ######################################################################
            // ### INÍCIO DA MODIFICAÇÃO ###
            // ######################################################################
            const openPlantingModal = (mode = 'new', planting = null) => {
                plantingModal.style.display = 'flex';
                plantingForm.reset();
                currentPlantingCache = planting;
                plantingIdInput.value = planting ? planting.id : '';

                const newFields = document.getElementById('new-planting-fields');
                const editFields = document.getElementById('edit-planting-fields');
                const seedSelect = document.getElementById('seed-select');
                const seedQuantityUsed = document.getElementById('seed-quantity-used');

                if (mode === 'new') {
                    plantingModalTitle.textContent = 'Novo Plantio';
                    tabManagement.style.display = 'none';
                    newFields.classList.remove('hidden');
                    editFields.classList.add('hidden');

                    // Habilita os campos para validação ao criar um novo plantio
                    seedSelect.disabled = false;
                    seedQuantityUsed.disabled = false;

                    seedSelect.innerHTML = '<option value="">Selecione uma semente/muda</option>';
                    const availableSeeds = allSupplies.filter(s => seedCategories.includes(s.category) && s.remaining > 0);
                    if (availableSeeds.length === 0) {
                        seedSelect.innerHTML = '<option value="">Nenhuma semente/muda no estoque</option>';
                    } else {
                        availableSeeds.forEach(s => {
                            const option = document.createElement('option');
                            option.value = s.id;
                            option.textContent = `${s.name} - ${s.variety || ''} (${Number(s.remaining).toFixed(2)} ${s.unit} disp.)`;
                            option.dataset.unit = s.unit;
                            seedSelect.appendChild(option);
                        });
                    }
                    updateCalculatedInitialCost();
                    switchTab('details');
                } else {
                    plantingModalTitle.textContent = `Editar: ${planting.cropName}`;
                    tabManagement.style.display = 'inline-block';
                    newFields.classList.add('hidden');
                    editFields.classList.remove('hidden');

                    // Desabilita os campos obrigatórios que estão escondidos para evitar erros de validação
                    seedSelect.disabled = true;
                    seedQuantityUsed.disabled = true;

                    document.getElementById('crop-name-display').value = planting.cropName || '';
                    document.getElementById('variety-display').value = planting.variety || '';
                    document.getElementById('planting-date').value = planting.plantingDate || '';
                    document.getElementById('harvest-date').value = planting.harvestDate || '';
                    document.getElementById('final-yield-quantity').value = planting.finalYieldQuantity || '';
                    document.getElementById('final-yield-unit').value = planting.finalYieldUnit || 'kg';
                    document.getElementById('area').value = planting.area || '';
                    renderLog(planting);

                    // Renderizar galeria de imagens do diário quando estiver no modo 'manage'
                    if (mode === 'manage' && planting && typeof renderGallery === 'function') {
                        renderGallery(planting.id, 'diary', 'gallery-placeholder');
                    }

                    switchTab(mode === 'manage' ? 'management' : 'details');
                }
            };
            // ######################################################################
            // ### FIM DA MODIFICAÇÃO ###
            // ######################################################################

            const closePlantingModal = () => { plantingModal.style.display = 'none'; };
            const openSuppliesModal = () => { suppliesModal.style.display = 'flex'; renderSupplies(); const container = document.getElementById('supply-category-buttons'); const customContainer = document.getElementById('custom-category-container'); container.innerHTML = ''; supplyCategories.forEach(cat => { const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'category-btn bg-gray-100 text-gray-800 py-2 px-2 rounded-md border border-gray-300 text-xs'; btn.textContent = cat; btn.dataset.category = cat; container.appendChild(btn); }); const otherBtn = document.createElement('button'); otherBtn.type = 'button'; otherBtn.id = 'other-category-btn'; otherBtn.className = 'category-btn bg-gray-100 text-gray-800 py-2 px-2 rounded-md border border-gray-300 text-xs'; otherBtn.textContent = 'Outros'; otherBtn.dataset.category = 'outros'; container.appendChild(otherBtn); customContainer.classList.add('hidden'); document.getElementById('custom-category-input').value = ''; document.getElementById('supply-variety-container').classList.add('hidden'); };
            const closeSuppliesModal = () => { suppliesModal.style.display = 'none'; suppliesForm.reset(); document.getElementById('supply-id').value = ''; suppliesFormTitle.textContent = 'Adicionar Nova Compra'; cancelSupplyEditBtn.classList.add('hidden'); document.querySelectorAll('#supply-category-buttons .category-btn').forEach(b => b.classList.remove('active')); document.getElementById('supply-variety-container').classList.add('hidden'); };
            const openManagementModal = () => { managementForm.reset(); managementModal.style.display = 'flex'; managementModalTitle.textContent = 'Nova Aplicação'; supplySelect.innerHTML = '<option value="">Selecione um insumo...</option>'; allSupplies.filter(s => s.remaining > 0 && !seedCategories.includes(s.category)).forEach(s => { const option = document.createElement('option'); option.value = s.id; option.textContent = `${s.name} (${Number(s.remaining).toFixed(2)} ${s.unit} restantes)`; option.dataset.unit = s.unit; supplySelect.appendChild(option); }); updateCalculatedCost(); };
            const closeManagementModal = () => { managementModal.style.display = 'none'; };
            const openCashbookModal = () => { cashbookModal.style.display = 'flex'; renderTransactions(); };
            const closeCashbookModal = () => { cashbookModal.style.display = 'none'; };
            const populateScheduleSupplyDropdown = (category = 'all') => {
                const stockSelect = document.getElementById('schedule-supply-from-stock');
                stockSelect.innerHTML = '';
                
                console.log('Tentando popular insumos. Categoria:', category);

                // Verificar se a lista principal de insumos (allSupplies) já foi carregada
                if (!allSupplies || allSupplies.length === 0) {
                    console.warn('A lista "allSupplies" está vazia ou não foi carregada ainda.');
                    stockSelect.innerHTML = '<option value="" disabled>Carregando insumos do estoque...</option>';
                    return;
                }
                
                console.log(`Total de ${allSupplies.length} insumos no estoque.`);

                // Filtra para não incluir sementes/mudas, que não são para "aplicação"
                let filteredSupplies = allSupplies.filter(s => !seedCategories.includes(s.category));
                
                // Filtra pela categoria selecionada, se não for 'todos'
                if (category !== 'all') {
                    filteredSupplies = filteredSupplies.filter(s => s.category === category);
                }
                
                console.log(`${filteredSupplies.length} insumos encontrados para a categoria "${category}".`);

                if (filteredSupplies.length === 0) {
                    stockSelect.innerHTML = '<option value="" disabled>Nenhum produto disponível nesta categoria.</option>';
                    return;
                }
                
                // Popula o select com os insumos filtrados
                filteredSupplies.forEach(s => {
                    const option = document.createElement('option');
                    option.value = s.id;
                    // Mostra o nome, a unidade e o que ainda resta no estoque
                    option.textContent = `${s.name} (${s.unit}) - Restante: ${Number(s.remaining || 0).toFixed(2)}`;
                    option.dataset.name = s.name; // Guarda o nome para uso posterior
                    stockSelect.appendChild(option);
                });
            };
            const openScheduleModal = () => { const modal = document.getElementById('schedule-modal'), plantingSelect = document.getElementById('schedule-planting'); scheduleForm.reset(); document.getElementById('schedule-id').value = ''; document.getElementById('schedule-modal-title').textContent = 'Agendar Aplicação'; plantingSelect.innerHTML = '<option value="">Selecione um plantio</option>'; allPlantings.filter(p => !p.finalYield).forEach(planting => { const option = document.createElement('option'); option.value = planting.id; option.textContent = `${planting.cropName} (${planting.variety || 'Sem variedade'})`; plantingSelect.appendChild(option); }); const filtersContainer = document.getElementById('schedule-category-filters'); filtersContainer.innerHTML = ''; applicationCategories.forEach(cat => { const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'category-btn bg-gray-100 text-gray-800 py-1 px-2 rounded-md border border-gray-300 text-xs'; btn.textContent = cat; btn.dataset.category = cat; if (cat === 'Outros') btn.dataset.category = 'all'; if (cat === 'Outros') btn.textContent = 'Todos'; if (btn.dataset.category === 'all') btn.classList.add('active'); filtersContainer.appendChild(btn); }); populateScheduleSupplyDropdown('all'); modal.style.display = 'flex'; };
            const closeScheduleModal = () => { document.getElementById('schedule-modal').style.display = 'none'; };

            // --- DELETE & EDIT HANDLERS (condensed) ---
            const handleEditSupply = (supply) => { suppliesFormTitle.textContent = `Editar: ${supply.name}`; document.getElementById('supply-id').value = supply.id; document.getElementById('supply-name').value = supply.name; document.getElementById('supply-quantity').value = supply.quantity.toString().replace('.', ','); document.getElementById('supply-unit').value = supply.unit; document.getElementById('supply-cost').value = supply.cost.toString().replace('.', ','); document.getElementById('supply-date').value = supply.date; document.getElementById('supply-units-count').value = (supply.unitsCount || '').toString().replace('.', ','); document.getElementById('supply-quantity-per-unit').value = (supply.quantityPerUnit || '').toString().replace('.', ','); document.getElementById('supply-cost-per-unit').value = (supply.costPerUnit || '').toString().replace('.', ','); const customContainer = document.getElementById('custom-category-container'); const customInput = document.getElementById('custom-category-input'); const varietyContainer = document.getElementById('supply-variety-container'); const isStandardCategory = supplyCategories.includes(supply.category); document.querySelectorAll('#supply-category-buttons .category-btn').forEach(btn => { btn.classList.toggle('active', btn.dataset.category === supply.category); }); if (seedCategories.includes(supply.category)) { varietyContainer.classList.remove('hidden'); document.getElementById('supply-variety').value = supply.variety || ''; } else { varietyContainer.classList.add('hidden'); } if (!isStandardCategory) { document.getElementById('other-category-btn').classList.add('active'); customContainer.classList.remove('hidden'); customInput.value = supply.category; document.getElementById('supply-category').value = 'outros'; } else { customContainer.classList.add('hidden'); customInput.value = ''; document.getElementById('supply-category').value = supply.category; } cancelSupplyEditBtn.classList.remove('hidden'); };
            const handleDeletePlanting = (id) => {
                // Buscar o plantio pelo ID para obter o nome
                const planting = allPlantings.find(p => p.id === id);
                const plantingName = planting ? `${planting.cropName} (${planting.variety || 'Sem variedade'})` : 'este plantio';
                
                showConfirm(
                    'Confirmar Exclusão',
                    `Tem a certeza que quer apagar o plantio "${plantingName}" e todo o seu histórico? Esta ação também irá devolver os insumos utilizados para o estoque.`,
                    async () => {
                        if (!planting) {
                            showToast('Erro: Plantio não encontrado.');
                            return;
                        }

                        try {
                            // Fechar modal se estiver aberto para este plantio ANTES da exclusão
                            if (plantingModal.style.display === 'flex' && currentPlantingCache && currentPlantingCache.id === id) {
                                closePlantingModal();
                            }
                            
                            // Use a transaction to delete the planting and update stock
                            await runTransaction(db, async (transaction) => {
                                const plantingDocRef = doc(plantingsCollectionRef, id);

                                // 1. Return initial seed/seedling to stock
                                if (planting.sourceSupplyId && planting.initialQuantityUsed > 0) {
                                    const seedSupplyRef = doc(suppliesCollectionRef, planting.sourceSupplyId);
                                    const seedSupplyDoc = await transaction.get(seedSupplyRef);
                                    if (seedSupplyDoc.exists()) {
                                        const newRemaining = Number(seedSupplyDoc.data().remaining || 0) + Number(planting.initialQuantityUsed);
                                        transaction.update(seedSupplyRef, { remaining: newRemaining });
                                    }
                                }

                                // 2. Return all supplies from management history to stock
                                if (planting.managementHistory && planting.managementHistory.length > 0) {
                                    for (const entry of planting.managementHistory) {
                                        if (entry.supplyId && entry.quantityUsed > 0) {
                                            const supplyRef = doc(suppliesCollectionRef, entry.supplyId);
                                            const supplyDoc = await transaction.get(supplyRef);
                                            if (supplyDoc.exists()) {
                                                const newRemaining = Number(supplyDoc.data().remaining || 0) + Number(entry.quantityUsed);
                                                transaction.update(supplyRef, { remaining: newRemaining });
                                            }
                                        }
                                    }
                                }

                                // 3. Delete the planting document
                                transaction.delete(plantingDocRef);
                            });
                            
                            // The onSnapshot listener will handle UI updates automatically.
                            showToast(`Plantio "${plantingName}" apagado e insumos devolvidos ao estoque.`);
                        } catch (error) {
                            console.error("Erro ao apagar plantio:", error);
                            showToast('Erro ao apagar plantio.');
                        }
                    }
                );
            };
            const handleDeleteSupply = (id) => {
                // Buscar o insumo pelo ID para obter o nome
                const supply = allSupplies.find(s => s.id === id);
                const supplyName = supply ? supply.name : 'este insumo';
                
                showConfirm(
                    'Confirmar Exclusão', 
                    `Tem a certeza que quer apagar o insumo "${supplyName}"? Isto não pode ser desfeito.`,
                    async () => {
                        try {
                            await deleteDoc(doc(suppliesCollectionRef, id));
                            showToast(`Insumo "${supplyName}" apagado com sucesso!`);
                        } catch (error) {
                            console.error("Erro ao apagar insumo:", error);
                            showToast('Erro ao apagar insumo.');
                        }
                    }
                );
            };
            const handleDeleteTransaction = (id) => {
                // Buscar a transação pelo ID para obter o nome
                const transaction = allTransactions.find(t => t.id === id);
                const transactionName = transaction ? `"${transaction.description}"` : 'esta transação';
                
                showConfirm(
                    'Confirmar Exclusão', 
                    `Tem certeza que deseja apagar a transação ${transactionName}?`, 
                    async () => {
                        try {
                            await deleteDoc(doc(transactionsCollectionRef, id));
                            showToast('Transação apagada com sucesso!');
                        } catch (error) {
                            console.error("Erro ao apagar transação:", error);
                            showToast('Erro ao apagar transação.');
                        }
                    }
                );
            };

            const handleDeleteAnimalTransaction = (id) => {
                // Buscar a transação pelo ID para obter o nome
                const transaction = allAnimalFinancials.find(t => t.id === id);
                const transactionName = transaction ? `"${transaction.description}"` : 'esta transação';
                
                showConfirm(
                    'Confirmar Exclusão', 
                    `Tem certeza que deseja apagar a transação ${transactionName}?`, 
                    async () => {
                        try {
                            await deleteDoc(doc(animalFinancialsCollectionRef, id));
                            showToast('Transação de animal apagada com sucesso!');
                        } catch (error) {
                            console.error("Erro ao apagar transação de animal:", error);
                            showToast('Erro ao apagar transação.');
                        }
                    }
                );
            };
            const handleDeleteReminder = (id) => {
                // Buscar o lembrete pelo ID para obter detalhes
                const reminder = allScheduledApplications.find(r => r.id === id);
                let reminderName = 'este lembrete';
                
                if (reminder) {
                    const planting = allPlantings.find(p => p.id === reminder.plantingId);
                    const plantingName = planting ? `${planting.cropName}` : 'plantio';
                    reminderName = `lembrete para ${plantingName} (${new Date(reminder.date + 'T00:00:00').toLocaleDateString('pt-BR')})`;
                }
                
                showConfirm(
                    'Confirmar Exclusão', 
                    `Tem certeza que deseja apagar o ${reminderName}?`, 
                    async () => {
                        try {
                            await deleteDoc(doc(scheduledApplicationsCollectionRef, id));
                            showToast('Lembrete apagado com sucesso!');
                        } catch (error) {
                            console.error("Erro ao apagar lembrete:", error);
                            showToast('Erro ao apagar lembrete.');
                        }
                    }
                );
            };
            const handleEditReminder = (app) => { 
                openScheduleModal(); 
                document.getElementById('schedule-modal-title').textContent = 'Editar Lembrete'; 
                document.getElementById('schedule-id').value = app.id; 
                document.getElementById('schedule-planting').value = app.plantingId; 
                document.getElementById('schedule-date').value = app.date; 
                
                // Extrair horário da data se existir
                if (app.applicationTime) {
                    const appDateTime = new Date(app.applicationTime);
                    const timeString = appDateTime.toTimeString().slice(0, 5); // HH:MM
                    document.getElementById('schedule-time').value = timeString;
                }
                
                document.getElementById('schedule-notes').value = app.notes; 
                document.getElementById('schedule-dose').value = app.dose; 
                const supplyIds = app.products.map(p => p.id); 
                document.querySelectorAll('#schedule-supply-from-stock option').forEach(opt => { 
                    if (supplyIds.includes(opt.value)) { 
                        opt.selected = true; 
                    } 
                }); 
            };
            const handleEditLogEntry = (plantingId, entry) => { if (entry.type === 'observation') { editObservationIdInput.value = entry.timestamp; editObservationText.value = entry.text; editObservationModal.style.display = 'flex'; } };
            const handleDeleteLogEntry = (plantingId, entryToDelete) => { const title = entryToDelete.type === 'application' ? 'Apagar Aplicação?' : 'Apagar Observação?'; showConfirm(title, 'Esta ação não pode ser desfeita.', async () => { const plantingDocRef = doc(plantingsCollectionRef, plantingId); try { await runTransaction(db, async (transaction) => { const plantingDoc = await transaction.get(plantingDocRef); if (!plantingDoc.exists()) { throw "Plantio não encontrado."; } const data = plantingDoc.data(); if (entryToDelete.type === 'application') { const currentHistory = data.managementHistory || []; const entryIndex = currentHistory.findIndex(e => e.id === entryToDelete.id); if (entryIndex > -1) { const quantityToReturn = Number(entryToDelete.quantityUsed) || 0; if (entryToDelete.supplyId && quantityToReturn > 0) { const supplyDocRef = doc(suppliesCollectionRef, entryToDelete.supplyId); const supplyDoc = await transaction.get(supplyDocRef); if (supplyDoc.exists()) { const currentRemaining = Number(supplyDoc.data().remaining) || 0; transaction.update(supplyDocRef, { remaining: currentRemaining + quantityToReturn }); } } const newHistory = [...currentHistory]; newHistory.splice(entryIndex, 1); transaction.update(plantingDocRef, { managementHistory: newHistory }); } } else { const currentLog = data.log || []; const entryIndex = currentLog.findIndex(e => e.timestamp === entryToDelete.timestamp); if (entryIndex > -1) { const newLog = [...currentLog]; newLog.splice(entryIndex, 1); transaction.update(plantingDocRef, { log: newLog }); } } }); showToast('Registo do diário apagado!'); } catch (error) { console.error("Erro ao apagar registo do diário:", error); showToast('Erro ao apagar registo.'); } }); };
            const filterPlantingsByStatus = (statusKey) => { document.querySelectorAll('.status-card').forEach(c => c.classList.remove('active')); if (activeStatusFilter === statusKey) { activeStatusFilter = null; renderPlantings(allPlantings); } else { activeStatusFilter = statusKey; document.getElementById(`status-${statusKey}`).classList.add('active'); const filtered = allPlantings.filter(p => getPlantingStatus(p).key === statusKey); renderPlantings(filtered); } };
            const updateCalculatedInitialCost = () => {
    // Verificar se todos os elementos necessários existem
    const display = document.getElementById('calculated-initial-cost-display');
    const seedSelect = document.getElementById('seed-select');
    const quantityInput = document.getElementById('seed-quantity-used');
    const unitSpan = document.getElementById('seed-quantity-unit');
    
    // Verificações de segurança para evitar erros de null
    if (!display || !seedSelect || !quantityInput || !unitSpan) {
        console.warn('updateCalculatedInitialCost: Elementos DOM necessários não encontrados');
        return;
    }
    
    const supplyId = seedSelect.value;
    const quantityUsed = parseLocaleNumber(quantityInput.value);
    const selectedOption = seedSelect.options[seedSelect.selectedIndex];
    
    // Verificar se selectedOption existe antes de acessar dataset
    if (selectedOption && selectedOption.dataset) {
        unitSpan.textContent = selectedOption.dataset.unit || '--';
    } else {
        unitSpan.textContent = '--';
    }
    
    // Verificar se o elemento de custo existe antes de tentar atualizar
    const costElement = display.querySelector('p:last-child');
    if (!costElement) {
        console.warn('updateCalculatedInitialCost: Elemento de custo não encontrado');
        return;
    }
    
    if (!supplyId || !quantityUsed) {
        costElement.textContent = formatCurrency(0);
        return;
    }
    
    // Verificar se allSupplies existe e é um array
    if (!window.allSupplies || !Array.isArray(window.allSupplies)) {
        console.warn('updateCalculatedInitialCost: allSupplies não está disponível');
        costElement.textContent = formatCurrency(0);
        return;
    }
    
    const supply = allSupplies.find(s => s.id === supplyId);
    if (!supply || supply.quantity <= 0) {
        costElement.textContent = formatCurrency(0);
        return;
    }
    
    const cost = (supply.cost / supply.quantity) * quantityUsed;
    costElement.textContent = formatCurrency(cost);
};

            // --- AUTHENTICATION FUNCTIONS ---
            function showLoginForm() {
                document.getElementById('login-form').classList.remove('hidden');
                document.getElementById('register-form').classList.add('hidden');
                document.getElementById('forgot-password-form').classList.add('hidden');
            }

            function showRegisterForm() {
                document.getElementById('register-form').classList.remove('hidden');
                document.getElementById('login-form').classList.add('hidden');
                document.getElementById('forgot-password-form').classList.add('hidden');
            }

            function showForgotPasswordForm() {
                document.getElementById('forgot-password-form').classList.remove('hidden');
                document.getElementById('login-form').classList.add('hidden');
                document.getElementById('register-form').classList.add('hidden');
            }

            function getFirebaseErrorMessage(errorCode) {
                const errorMessages = {
                    'auth/user-not-found': 'E-mail não encontrado.',
                    'auth/wrong-password': 'E-mail ou senha inválidos.',
                    'auth/invalid-email': 'E-mail inválido.',
                    'auth/email-already-in-use': 'Este e-mail já está em uso.',
                    'auth/weak-password': 'A senha deve ter pelo menos 6 caracteres.',
                    'auth/too-many-requests': 'Muitas tentativas. Tente novamente mais tarde.',
                    'auth/network-request-failed': 'Erro de conexão. Verifique sua internet.',
                    'auth/invalid-credential': 'E-mail ou senha inválidos.',
                    'auth/user-disabled': 'Esta conta foi desativada.',
                    'auth/operation-not-allowed': 'Operação não permitida.'
                };
                return errorMessages[errorCode] || 'Ocorreu um erro inesperado.';
            }

            function toggleButtonLoading(buttonId, isLoading) {
                const button = document.getElementById(buttonId);
                const textSpan = button.querySelector(`.${buttonId}-text`);
                const spinner = button.querySelector(`.${buttonId}-spinner`);

                button.disabled = isLoading;

                if (isLoading) {
                    textSpan.classList.add('hidden');
                    spinner.classList.remove('hidden');
                } else {
                    textSpan.classList.remove('hidden');
                    spinner.classList.add('hidden');
                }
            }

            // Função para solicitar permissão de notificações
            async function requestNotificationPermission() {
                if ('Notification' in window) {
                    if (Notification.permission === 'default') {
                        const permission = await Notification.requestPermission();
                        if (permission === 'granted') {
                            showToast('Notificações ativadas! Você receberá lembretes das suas tarefas e aplicações.');
                        } else if (permission === 'denied') {
                            showToast('Notificações desativadas. Você pode ativá-las nas configurações do navegador.');
                        }
                    }
                }
            }

            async function handleLogin(e) {
                e.preventDefault();

                const email = document.getElementById('login-email').value;
                const password = document.getElementById('login-password').value;

                if (!email || !password) {
                    showToast('Por favor, preencha todos os campos.');
                    return;
                }

                toggleButtonLoading('login-btn', true);

                try {
                    // USAR A VARIÁVEL GLOBAL 'auth' (sem inicializar novamente)
                    await signInWithEmailAndPassword(auth, email, password);
                    showToast('Login bem-sucedido!');
                    
                    // Solicitar permissão para notificações após login bem-sucedido
                    setTimeout(() => {
                        requestNotificationPermission();
                    }, 2000); // Aguarda 2 segundos para não sobrecarregar o usuário
                    
                } catch (error) {
                    console.error('Erro no login:', error);
                    showToast(getFirebaseErrorMessage(error.code));
                } finally {
                    toggleButtonLoading('login-btn', false);
                }
            }

            async function handleRegister(e) {
                e.preventDefault();

                const name = document.getElementById('register-name').value;
                const email = document.getElementById('register-email').value;
                const password = document.getElementById('register-password').value;
                const confirmPassword = document.getElementById('register-password-confirm').value;

                if (!name || !email || !password || !confirmPassword) {
                    showToast('Por favor, preencha todos os campos.');
                    return;
                }

                if (password !== confirmPassword) {
                    showToast('As senhas não coincidem.');
                    return;
                }

                if (password.length < 6) {
                    showToast('A senha deve ter pelo menos 6 caracteres.');
                    return;
                }

                toggleButtonLoading('register-btn', true);

                try {
                    // USAR A VARIÁVEL GLOBAL 'auth' (sem inicializar novamente)
                    const userCredential = await createUserWithEmailAndPassword(auth, email, password);

                    // Atualizar o perfil do usuário com o nome
                    await updateProfile(userCredential.user, {
                        displayName: name
                    });

                    showToast('Cadastro realizado com sucesso!');
                } catch (error) {
                    console.error('Erro no cadastro:', error);
                    showToast(getFirebaseErrorMessage(error.code));
                } finally {
                    toggleButtonLoading('register-btn', false);
                }
            }

            async function handleForgotPassword(e) {
                e.preventDefault();

                const email = document.getElementById('forgot-email').value;

                if (!email) {
                    showToast('Por favor, digite seu e-mail.');
                    return;
                }

                toggleButtonLoading('forgot-btn', true);

                try {
                    // USAR A VARIÁVEL GLOBAL 'auth' (sem inicializar novamente)
                    await sendPasswordResetEmail(auth, email);
                    showToast('Link de recuperação enviado para seu e-mail.');
                    showLoginForm();
                } catch (error) {
                    console.error('Erro na recuperação:', error);
                    showToast(getFirebaseErrorMessage(error.code));
                } finally {
                    toggleButtonLoading('forgot-btn', false);
                }
            }

            async function handleLogout() {
                try {
                    // USAR A VARIÁVEL GLOBAL 'auth' (sem inicializar novamente)
                    await signOut(auth);
                    showToast('Logout realizado com sucesso!');
                } catch (error) {
                    console.error('Erro no logout:', error);
                    showToast('Erro ao fazer logout.');
                }
            }

            // --- FIREBASE AUTH & DATA INIT (REFACTORED) ---
            async function main() {
                try {
                    // Inicializar Firebase apenas uma vez (SEM const)
                    app = initializeApp(firebaseConfig);
                    auth = getAuth(app);
                    db = getFirestore(app);

                    // ATIVAR PERSISTÊNCIA OFFLINE
                    enableIndexedDbPersistence(db) // ✅ JÁ IMPLEMENTADO
                        .then(() => {
                            console.log('Persistência offline do Firestore ativada!');
                        })
                        .catch((err) => {
                            if (err.code == 'failed-precondition') {
                                console.warn('Falha na persistência: múltiplas abas abertas.');
                            } else if (err.code == 'unimplemented') {
                                console.warn('Persistência não suportada neste navegador.');
                            }
                        });

                    onAuthStateChanged(auth, async (user) => {
                        if (user) {
                            console.log("User is signed in:", user.uid);
                            userId = user.uid;

                            // Exibir nome do usuário
                            const displayName = user.displayName || user.email || userId;
                            document.getElementById('user-display-name').textContent = `Olá, ${displayName}`;

                            // Esconder autenticação, mostrar aplicação principal
                            document.getElementById('auth-container').style.display = 'none';
                            document.getElementById('app-container').style.display = 'block';

                            // Setup collection references com path do usuário
                            const basePath = `users/${userId}`;
                            plantingsCollectionRef = collection(db, `${basePath}/plantios`);
                            suppliesCollectionRef = collection(db, `${basePath}/insumos`);
                            transactionsCollectionRef = collection(db, `${basePath}/transacoes`);
                            scheduledApplicationsCollectionRef = collection(db, `${basePath}/aplicacoesAgendadas`);
                            employeesCollectionRef = collection(db, `${basePath}/funcionarios`);
                            animalsCollectionRef = collection(db, `${basePath}/animais`);
                            animalFinancialsCollectionRef = collection(db, `${basePath}/animalFinancials`);
                            animalProductionCollectionRef = collection(db, `${basePath}/animalProduction`);
                            tasksCollectionRef = collection(db, `${basePath}/tasks`);
                            medicationsCollectionRef = collection(db, `${basePath}/medications`);
                            remindersCollectionRef = collection(db, `${basePath}/reminders`);

                            // Initialize listeners and UI
                            initializeListeners();
                            initializeUIEventListeners();

                            // Weather
                            if (navigator.geolocation) {
                                navigator.geolocation.getCurrentPosition(
                                    (position) => fetchWeather(position.coords.latitude, position.coords.longitude),
                                    () => {
                                        navigator.geolocation.getCurrentPosition(
                                            (position) => fetchWeather(position.coords.latitude, position.coords.longitude),
                                            () => weatherWidget.innerHTML = `<div class="text-gray-500 text-center">Permita a localização para ver a previsão.</div>`,
                                            { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 }
                                        );
                                    },
                                    { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 }
                                );
                            }
                        } else {
                            console.log("No user signed in, showing authentication.");

                            // Limpar dados do usuário
                            userId = null;
                            allPlantings = [];
                            allSupplies = [];
                            allTransactions = [];
                            allScheduledApplications = [];
                            allEmployees = [];
                            allAnimals = [];
                            allTasks = [];
                            allMedications = [];
                            allReminders = [];

                            // Mostrar autenticação, esconder aplicação principal
                            document.getElementById('auth-container').style.display = 'flex';
                            document.getElementById('app-container').style.display = 'none';

                            // Mostrar formulário de login por padrão
                            showLoginForm();

                            loadingIndicator.classList.add('hidden');
                        }
                    });
                } catch (error) {
                    console.error("Firebase Initialization Error:", error);
                    loadingIndicator.classList.add('hidden');
                    errorState.classList.remove('hidden');
                }
            }

            function initializeListeners() {
                // Verificar se as variáveis necessárias estão definidas
                if (!db || !userId) {
                    console.error('Database ou userId não definidos');
                    loadingIndicator.classList.add('hidden');
                    return;
                }

                let initialLoads = 0;
                const totalListeners = 6; // Adjusted as we add more listeners if needed
                const onInitialLoad = () => {
                    initialLoads++;
                    if (initialLoads >= totalListeners) {
                        console.log("All initial data loaded. Rendering application.");
                        loadingIndicator.classList.add('hidden');
                        updateDashboard();
                        renderPlantings(allPlantings);
                        renderReminders();
                    }
                };

                onSnapshot(collection(db, `users/${userId}/plantios`), (snapshot) => {
                    allPlantings = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    if (initialLoads < totalListeners) onInitialLoad();
                    updateDashboard();
                    renderPlantings(allPlantings.filter(p => !activeStatusFilter || getPlantingStatus(p).key === activeStatusFilter));

                    // Verificar se o modal está aberto e o plantio ainda existe
                    if (plantingModal.style.display === 'flex' && currentPlantingCache) {
                        const updatedCache = allPlantings.find(p => p.id === currentPlantingCache.id);
                        if (updatedCache) {
                            currentPlantingCache = updatedCache;
                            renderLog(currentPlantingCache);
                        } else {
                            // Plantio foi excluído, fechar modal
                            currentPlantingCache = null;
                            closePlantingModal();
                        }
                    }
                }, (error) => console.error("Error fetching plantings:", error));
                onSnapshot(collection(db, `users/${userId}/insumos`), (snapshot) => { allSupplies = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); if (initialLoads < totalListeners) onInitialLoad(); if (suppliesModal.style.display === 'flex') renderSupplies(); }, (error) => console.error("Error fetching supplies:", error));
                onSnapshot(collection(db, `users/${userId}/transacoes`), (snapshot) => { allTransactions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); if (initialLoads < totalListeners) onInitialLoad(); updateDashboard(); if (cashbookModal.style.display === 'flex') renderTransactions(); }, (error) => console.error("Error fetching transactions:", error));
        
        // Adicionar listener para transações financeiras de animais
        onSnapshot(collection(db, `users/${userId}/animalFinancials`), (snapshot) => { 
            allAnimalFinancials = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); 
            if (initialLoads < totalListeners) onInitialLoad(); 
            updateDashboard(); 
            if (cashbookModal.style.display === 'flex') renderTransactions(); 
        }, (error) => console.error("Error fetching animal financials:", error));
                onSnapshot(collection(db, `users/${userId}/aplicacoesAgendadas`), (snapshot) => {
                    allScheduledApplications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    if (initialLoads < totalListeners) onInitialLoad();
                    renderReminders();

                    // ADICIONADO: Verifica se o calendário está aberto e o redesenha para refletir as mudanças 
                    const calendarModal = document.getElementById('calendar-modal');
                    if (calendarModal && calendarModal.style.display === 'flex') {
                        renderCalendar(currentCalendarDate);
                    }
                }, (error) => console.error("Error fetching scheduled applications:", error));
                onSnapshot(collection(db, `users/${userId}/funcionarios`), (snapshot) => { allEmployees = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); if (initialLoads < totalListeners) onInitialLoad(); updateDashboard(); if (employeeModal.style.display === 'flex') renderEmployees(); }, (error) => console.error("Error fetching employees:", error));
                onSnapshot(collection(db, `users/${userId}/animais`), (snapshot) => { allAnimals = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); if (initialLoads < totalListeners) onInitialLoad(); if (animalDashboardModal.style.display === 'flex' && currentAnimalType) { renderAnimalTab(document.querySelector('.animal-tab-btn.active')?.dataset.tab || 'herd'); } }, (error) => console.error("Error fetching animals:", error));

                // Listener para tarefas
                onSnapshot(tasksCollectionRef, (snapshot) => {
                    const tasks = [];
                    snapshot.forEach(doc => {
                        tasks.push({ id: doc.id, ...doc.data() });
                    });

                    // Ordenar por status (não concluídas primeiro) e depois por data de criação
                    tasks.sort((a, b) => {
                        if (a.completed !== b.completed) return a.completed ? 1 : -1;
                        const aTime = a.createdAt?.toMillis() || 0;
                        const bTime = b.createdAt?.toMillis() || 0;
                        return bTime - aTime;
                    });

                    allTasks = tasks;
                    renderTasks();
                });
            }

            function setupCalculator() {
                const widget = document.getElementById('calculator-widget');
                const mainDisplay = document.getElementById('calc-main-display'); // <- Alterado
                const expressionDisplay = document.getElementById('calc-expression-display'); // <- Novo
                const buttons = document.getElementById('calculator-buttons');
                const header = document.getElementById('calculator-header');
                
                let currentInput = '0';
                let operator = null;
                let previousInput = null;
                let shouldResetDisplay = false;

                const updateDisplay = () => {
                    mainDisplay.textContent = currentInput.replace('.', ',');
                };

                const calculate = (a, op, b) => {
                    a = parseFloat(a);
                    b = parseFloat(b);
                    if (op === '+') return a + b;
                    if (op === '-') return a - b;
                    if (op === '×') return a * b;
                    if (op === '÷') return b === 0 ? 'Erro' : a / b;
                    return b;
                };

                buttons.addEventListener('click', (e) => {
                    const btn = e.target.closest('.calc-btn'); // Garante que pegamos o botão
                    if (!btn) return;

                    const value = btn.textContent.trim();
                    const icon = btn.querySelector('i');
                    let action = value;
                    if(icon) {
                        if(icon.classList.contains('fa-backspace')) action = '←';
                        if(icon.classList.contains('fa-divide')) action = '÷';
                        if(icon.classList.contains('fa-times')) action = '×';
                        if(icon.classList.contains('fa-minus')) action = '-';
                        if(icon.classList.contains('fa-plus')) action = '+';
                    }

                    if (/\d/.test(action)) {
                        if (shouldResetDisplay || currentInput === '0') {
                            currentInput = action;
                            shouldResetDisplay = false;
                        } else {
                            currentInput += action;
                        }
                    } else if (action === '.') {
                        if (!currentInput.includes('.')) currentInput += '.';
                    } else if (['+', '-', '×', '÷'].includes(action)) {
                        if (operator && !shouldResetDisplay) {
                            const result = calculate(previousInput, operator, currentInput);
                            previousInput = String(result);
                        } else {
                            previousInput = currentInput;
                        }
                        operator = action;
                        shouldResetDisplay = true;
                        expressionDisplay.textContent = `${previousInput.replace('.',',')} ${operator}`;
                    } else if (action === '%') {
                        currentInput = String(parseFloat(currentInput) / 100);
                    } else if (action === '=') {
                        if (operator && previousInput) {
                            expressionDisplay.textContent = `${previousInput.replace('.',',')} ${operator} ${currentInput.replace('.',',')} =`;
                            currentInput = String(calculate(previousInput, operator, currentInput));
                            operator = null;
                            previousInput = null;
                            shouldResetDisplay = true;
                        }
                    } else if (action === 'C') {
                        currentInput = '0';
                        operator = null;
                        previousInput = null;
                        shouldResetDisplay = false;
                        expressionDisplay.textContent = '';
                    } else if (action === '←') {
                        currentInput = currentInput.slice(0, -1) || '0';
                    } else if (action === 'Aplicar') {
                        if (activeCalculatorInput) {
                            activeCalculatorInput.value = currentInput.replace('.', ',');
                            activeCalculatorInput.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                        widget.style.display = 'none';
                    }
                    updateDisplay();
                });

                let isDragging = false, offsetX, offsetY;
                header.addEventListener('mousedown', (e) => {
                    isDragging = true;
                    offsetX = e.clientX - widget.offsetLeft;
                    offsetY = e.clientY - widget.offsetTop;
                });
                document.addEventListener('mousemove', (e) => {
                    if (isDragging) {
                        widget.style.left = (e.clientX - offsetX) + 'px';
                        widget.style.top = (e.clientY - offsetY) + 'px';
                    }
                });
                document.addEventListener('mouseup', () => { isDragging = false; });
                updateDisplay();
            }

            async function handleSupplyRename(supplyId, oldData, newData) { if (oldData.name === newData.name && oldData.variety === newData.variety) { return; } const batch = writeBatch(db); let updatesMade = false; const linkedPlantings = allPlantings.filter(p => p.sourceSupplyId === supplyId); linkedPlantings.forEach(planting => { const plantingRef = doc(plantingsCollectionRef, planting.id); batch.update(plantingRef, { cropName: newData.name, variety: newData.variety }); updatesMade = true; }); const linkedApps = allScheduledApplications.filter(app => app.relatedSupplyId === supplyId); linkedApps.forEach(app => { const appRef = doc(scheduledApplicationsCollectionRef, app.id); batch.update(appRef, { product: newData.name, supplyName: newData.name }); updatesMade = true; }); if (updatesMade) { try { await batch.commit(); showToast('Nomes vinculados atualizados!'); } catch (error) { console.error("Erro ao atualizar nomes vinculados:", error); showToast('Erro na atualização dos nomes.'); } } }

            function updateScheduleSelectedAnimalsCount() {
                const selectedCheckboxes = document.querySelectorAll('.schedule-animal-checkbox:checked');
                const totalAnimals = Array.from(selectedCheckboxes).reduce((sum, cb) => {
                    return sum + parseInt(cb.dataset.quantity || 1);
                }, 0);
                document.getElementById('schedule-selected-animals-count').textContent = totalAnimals;
            }

            // --- EVENT LISTENERS ---
            function initializeUIEventListeners() {
                plantingForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    handlePlantingFormSubmit();
                });

                const updateSupplyTotals = () => { const units = parseLocaleNumber(document.getElementById('supply-units-count').value); const qtyPerUnit = parseLocaleNumber(document.getElementById('supply-quantity-per-unit').value); const costPerUnit = parseLocaleNumber(document.getElementById('supply-cost-per-unit').value); const totalQty = units * qtyPerUnit; const totalCost = units * costPerUnit; document.getElementById('supply-quantity').value = totalQty > 0 ? String(totalQty).replace('.', ',') : ''; document.getElementById('supply-cost').value = totalCost > 0 ? String(totalCost).replace('.', ',') : ''; };
                document.getElementById('supply-units-count').addEventListener('input', updateSupplyTotals); document.getElementById('supply-quantity-per-unit').addEventListener('input', updateSupplyTotals); document.getElementById('supply-cost-per-unit').addEventListener('input', updateSupplyTotals);
                suppliesForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const id = document.getElementById('supply-id').value;
                    const categoryValue = document.getElementById('supply-category').value;
                    let finalCategory = categoryValue;

                    if (categoryValue === 'outros') {
                        finalCategory = document.getElementById('custom-category-input').value.trim();
                        if (!finalCategory) {
                            showToast('Por favor, digite o nome da categoria personalizada.');
                            return;
                        }
                    }

                    if (!finalCategory) {
                        showToast('Por favor, selecione uma categoria para o insumo.');
                        return;
                    }

                    const supplyData = {
                        name: document.getElementById('supply-name').value,
                        variety: document.getElementById('supply-variety').value || '',
                        quantity: parseLocaleNumber(document.getElementById('supply-quantity').value),
                        unit: document.getElementById('supply-unit').value,
                        cost: parseLocaleNumber(document.getElementById('supply-cost').value),
                        date: document.getElementById('supply-date').value,
                        category: finalCategory,
                        unitsCount: parseLocaleNumber(document.getElementById('supply-units-count').value) || null,
                        quantityPerUnit: parseLocaleNumber(document.getElementById('supply-quantity-per-unit').value) || null,
                        costPerUnit: parseLocaleNumber(document.getElementById('supply-cost-per-unit').value) || null,
                    };

                    // Adicionar cálculo do custo unitário
                    supplyData.unitCost = supplyData.quantity > 0 ? supplyData.cost / supplyData.quantity : 0;

                    try {
                        if (id) {
                            const oldSupply = allSupplies.find(s => s.id === id);
                            const quantityChange = supplyData.quantity - oldSupply.quantity;
                            supplyData.remaining = (oldSupply.remaining || 0) + quantityChange;
                            if (supplyData.remaining < 0) supplyData.remaining = 0;

                            await updateDoc(doc(suppliesCollectionRef, id), supplyData);
                            await handleSupplyRename(id, oldSupply, supplyData);
                            showToast('Insumo atualizado!');
                        } else {
                            supplyData.remaining = supplyData.quantity;
                            const newSupply = await addDoc(suppliesCollectionRef, supplyData);
                            await addDoc(transactionsCollectionRef, {
                                description: `Compra de ${supplyData.name}`,
                                amount: supplyData.cost,
                                type: 'despesa',
                                category: 'Insumos',
                                date: supplyData.date,
                                relatedId: newSupply.id
                            });
                            showToast('Insumo adicionado ao estoque!');
                        }
                        closeSuppliesModal();
                    } catch (error) {
                        console.error("Erro ao guardar insumo:", error);
                        showToast('Erro ao guardar.');
                    }
                });
                managementForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const plantingId = currentPlantingCache.id;
                    const supplyId = supplySelect.value;
                    const quantityUsed = parseLocaleNumber(quantityUsedInput.value);
                    
                    // CORREÇÃO: Obter unidade selecionada
                    const selectedUnit = document.getElementById('quantity-used-unit-select')?.value || 'kg';
                    
                    if (!plantingId || !supplyId || !quantityUsed) {
                        showToast("Por favor, preencha todos os campos.");
                        return;
                    }
                    
                    const supply = allSupplies.find(s => s.id === supplyId);
                    
                    // CORREÇÃO: Converter unidades antes da validação
                    const convertedQuantityUsed = convertUnits(quantityUsed, selectedUnit, supply.unit);
                    
                    if (convertedQuantityUsed > supply.remaining) {
                        showToast(`Erro: Quantidade usada (${quantityUsed} ${selectedUnit} = ${convertedQuantityUsed.toFixed(2)} ${supply.unit}) é maior que o estoque disponível (${supply.remaining} ${supply.unit}).`);
                        return;
                    }
                    
                    // CORREÇÃO: Usar quantidade convertida para calcular custo
                    const applicationCost = (supply.cost / supply.quantity) * convertedQuantityUsed;
                    
                    const applicationData = {
                        id: crypto.randomUUID(),
                        supplyId: supplyId,
                        quantityUsed: convertedQuantityUsed, // CORREÇÃO: Salvar quantidade convertida
                        originalQuantityUsed: quantityUsed, // OPCIONAL: Manter quantidade original
                        originalUnit: selectedUnit, // OPCIONAL: Manter unidade original
                        applicationCost: applicationCost,
                        date: document.getElementById('application-date').value,
                    };
                    
                    const supplyDocRef = doc(suppliesCollectionRef, supplyId);
                    const plantingDocRef = doc(plantingsCollectionRef, plantingId);
                    
                    try {
                        await runTransaction(db, async (transaction) => {
                            const supplyDoc = await transaction.get(supplyDocRef);
                            if (!supplyDoc.exists()) throw "Insumo não encontrado.";
                            
                            // CORREÇÃO: Usar quantidade convertida na transação
                            const newRemaining = supplyDoc.data().remaining - convertedQuantityUsed;
                            if (newRemaining < 0) throw "Estoque insuficiente.";
                            
                            const plantingDoc = await transaction.get(plantingDocRef);
                            if (!plantingDoc.exists()) throw "Plantio não encontrado.";
                            
                            const newHistory = [...(plantingDoc.data().managementHistory || []), applicationData];
                            transaction.update(plantingDocRef, { managementHistory: newHistory });
                            transaction.update(supplyDocRef, { remaining: newRemaining });
                        });
                        
                        showToast('Aplicação guardada com sucesso!');
                        closeManagementModal();
                    } catch (error) {
                        console.error("Transação falhou: ", error);
                        showToast(`Erro: ${error.toString()}`);
                    }
                });
                document.getElementById('log-images').addEventListener('change', (e) => {
                    const files = Array.from(e.target.files);
                    if (files.length > 0) {
                        selectedDiaryImages = files;
                        const button = document.querySelector('button[onclick="document.getElementById(\'log-images\').click()"]');
                        button.innerHTML = `<i class="fas fa-camera"></i> ${files.length} 📷`;
                        button.classList.remove('bg-gray-500', 'hover:bg-gray-600');
                        button.classList.add('bg-blue-500', 'hover:bg-blue-600');
                    }
                });
                logForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const textInput = document.getElementById('log-entry-text');
                    const text = textInput.value;

                    if (!text && selectedDiaryImages.length === 0) {
                        showToast('Adicione uma observação ou imagem.');
                        return;
                    }

                    if (!currentPlantingCache) return;

                    try {
                        // Processar imagens se houver
                        if (selectedDiaryImages.length > 0) {
                            showToast('Processando imagens...');
                            for (const file of selectedDiaryImages) {
                                await uploadImage(file, currentPlantingCache.id, 'diary', text || 'Imagem do diário');
                            }
                        }

                        // Adicionar observação de texto se houver
                        if (text) {
                            const newLogEntry = {
                                text: text,
                                timestamp: Date.now(),
                                hasImages: selectedDiaryImages.length > 0
                            };

                            const newLog = (currentPlantingCache.log || []).concat(newLogEntry);
                            const plantingDocRef = doc(plantingsCollectionRef, currentPlantingCache.id);

                            await updateDoc(plantingDocRef, { log: newLog });
                        }

                        showToast('Entrada adicionada ao diário!');
                        textInput.value = '';
                        selectedDiaryImages = [];
                        document.getElementById('log-images').value = '';

                        // Resetar botão
                        const button = document.querySelector('button[onclick="document.getElementById(\'log-images\').click()"]');
                        button.innerHTML = '<i class="fas fa-camera"></i> 📷';
                        button.classList.remove('bg-blue-500', 'hover:bg-blue-600');
                        button.classList.add('bg-gray-500', 'hover:bg-gray-600');

                        // Atualizar galeria
                        await renderGallery(currentPlantingCache.id, 'diary', 'gallery-placeholder');

                    } catch (error) {
                        console.error("Erro ao adicionar ao diário:", error);
                        showToast('Erro ao guardar no diário.');
                    }
                });
                transactionForm.addEventListener('submit', async (e) => { e.preventDefault(); const transactionData = { description: document.getElementById('transaction-description').value, amount: parseLocaleNumber(document.getElementById('transaction-amount').value), type: document.getElementById('transaction-type').value, category: document.getElementById('transaction-category').value, date: document.getElementById('transaction-date').value }; if (!transactionData.description || !transactionData.amount || !transactionData.date) { showToast('Por favor, preencha todos os campos.'); return; } try { await addDoc(transactionsCollectionRef, transactionData); showToast('Transação adicionada com sucesso!'); transactionForm.reset(); } catch (error) { console.error("Erro ao adicionar transação:", error); showToast('Erro ao guardar a transação.'); } });

                // Função para reservar estoque no agendamento
                async function reserveStockForSchedule(products, quantity, unit) {
                    const reservations = [];
                    let totalReserved = 0;
                    
                    for (const product of products) {
                        const supply = allSupplies.find(s => s.id === product.id);
                        if (!supply) continue;
                        
                        const convertedQuantity = convertUnits(quantity, unit, supply.unit);
                        const availableStock = (supply.remaining || 0) - (supply.reserved || 0);
                        
                        if (convertedQuantity > availableStock) {
                            throw new Error(`Estoque insuficiente para ${supply.name}. Disponível: ${availableStock.toFixed(2)} ${supply.unit}, Necessário: ${convertedQuantity.toFixed(2)} ${supply.unit}`);
                        }
                        
                        reservations.push({
                            supplyId: product.id,
                            supplyName: supply.name,
                            quantityReserved: convertedQuantity,
                            unit: supply.unit
                        });
                        totalReserved += convertedQuantity;
                        
                        // Atualizar quantidade reservada no estoque
                        const newReserved = (supply.reserved || 0) + convertedQuantity;
                        await updateDoc(doc(suppliesCollectionRef, product.id), {
                            reserved: newReserved
                        });
                        
                        console.log(`✅ Reservado: ${convertedQuantity.toFixed(2)} ${supply.unit} de ${supply.name}`);
                    }
                    
                    return reservations;
                }

                // Função para liberar estoque reservado
                async function releaseStockReservations(reservations) {
                    if (!reservations || reservations.length === 0) return;
                    
                    for (const reservation of reservations) {
                        try {
                            const supplyRef = doc(suppliesCollectionRef, reservation.supplyId);
                            const supplyDoc = await getDoc(supplyRef);
                            
                            if (supplyDoc.exists()) {
                                const currentData = supplyDoc.data();
                                const newReserved = Math.max(0, (currentData.reserved || 0) - reservation.quantityReserved);
                                
                                await updateDoc(supplyRef, {
                                    reserved: newReserved
                                });
                                
                                console.log(`🔓 Liberação: ${reservation.quantityReserved.toFixed(2)} ${reservation.unit} de ${reservation.supplyName} liberados`);
                            }
                        } catch (error) {
                            console.error(`Erro ao liberar reserva de ${reservation.supplyName}:`, error);
                        }
                    }
                }

                // Função para cancelar aplicação (antes da conclusão)
                async function cancelApplication(reminderId) {
                    const reminder = allScheduledApplications.find(r => r.id === reminderId);
                    if (!reminder) {
                        showToast('❌ Aplicação não encontrada.');
                        return;
                    }
                    
                    const reminderName = reminder.title || 'Aplicação';
                    const date = new Date(reminder.date + 'T00:00:00').toLocaleDateString('pt-BR');
                    
                    showConfirm(
                        'Cancelar Aplicação',
                        `Tem certeza que deseja cancelar "${reminderName}" do dia ${date}?`,
                        async () => {
                            try {
                                if (reminder.status === 'completed') {
                                    showToast('⚠️ Aplicação já concluída. Use a função de estorno.');
                                    return;
                                }
                                
                                // Liberar reservas de estoque
                                if (reminder.stockReservations) {
                                    await releaseStockReservations(reminder.stockReservations);
                                    console.log(`🔄 Cancelamento: Reservas liberadas para ${reminderName}`);
                                }
                                
                                // Deletar aplicação
                                await deleteDoc(doc(scheduledApplicationsCollectionRef, reminderId));
                                
                                showToast(`✅ Aplicação cancelada, insumos liberados.`);
                                console.log(`❌ Cancelamento: ${reminderName} cancelada com sucesso`);
                                
                            } catch (error) {
                                console.error('Erro ao cancelar aplicação:', error);
                                showToast('Erro ao cancelar aplicação.');
                            }
                        }
                    );
                }

                // Função para estornar aplicação (após conclusão)
                async function refundApplication(reminderId) {
                    const reminder = allScheduledApplications.find(r => r.id === reminderId);
                    if (!reminder) {
                        showToast('❌ Aplicação não encontrada.');
                        return;
                    }
                    
                    if (reminder.status !== 'completed') {
                        showToast('⚠️ Apenas aplicações concluídas podem ser estornadas.');
                        return;
                    }
                    
                    const reminderName = reminder.title || 'Aplicação';
                    const date = new Date(reminder.date + 'T00:00:00').toLocaleDateString('pt-BR');
                    
                    showConfirm(
                        'Estornar Aplicação',
                        `Tem certeza que deseja estornar "${reminderName}" do dia ${date}? O estoque será devolvido e o lançamento financeiro será ajustado.`,
                        async () => {
                            try {
                                const stockUpdates = reminder.stockUpdatesApplied || [];
                                const totalCost = reminder.actualCost || 0;
                                
                                // Devolver quantidades ao estoque
                                await runTransaction(db, async (transaction) => {
                                    for (const update of stockUpdates) {
                                        const supplyRef = doc(suppliesCollectionRef, update.supplyId);
                                        const supplyDoc = await transaction.get(supplyRef);
                                        
                                        if (supplyDoc.exists()) {
                                            const currentData = supplyDoc.data();
                                            const newRemaining = (currentData.remaining || 0) + update.quantityToDeduct;
                                            
                                            transaction.update(supplyRef, {
                                                remaining: newRemaining
                                            });
                                            
                                            console.log(`📦 Estorno: Devolvido ${update.quantityToDeduct.toFixed(2)} ${update.unit} de ${update.supplyName}`);
                                        }
                                    }
                                    
                                    // Marcar aplicação como estornada
                                    const reminderRef = doc(scheduledApplicationsCollectionRef, reminderId);
                                    transaction.update(reminderRef, {
                                        status: 'refunded',
                                        refundedAt: new Date(),
                                        updatedAt: new Date()
                                    });
                                });
                                
                                // Lançar estorno no financeiro
                                if (totalCost > 0) {
                                    const refundTransactionData = {
                                        description: `Estorno: ${reminderName}`,
                                        amount: totalCost,
                                        type: 'income',
                                        category: 'Estorno de Insumos',
                                        date: new Date().toISOString().split('T')[0],
                                        source: 'application_refund',
                                        originalApplicationId: reminderId,
                                        createdAt: new Date()
                                    };
                                    
                                    await addDoc(transactionsCollectionRef, refundTransactionData);
                                    console.log(`💰 Estorno: Lançamento financeiro de estorno realizado - ${formatCurrency(totalCost)}`);
                                }
                                
                                // Remover do histórico do plantio se aplicável
                                if (reminder.plantingId) {
                                    const plantingRef = doc(plantingsCollectionRef, reminder.plantingId);
                                    const plantingDoc = await getDoc(plantingRef);
                                    
                                    if (plantingDoc.exists()) {
                                        const plantingData = plantingDoc.data();
                                        const managementHistory = (plantingData.managementHistory || []).filter(
                                            entry => entry.scheduledId !== reminderId
                                        );
                                        
                                        await updateDoc(plantingRef, {
                                            managementHistory: managementHistory
                                        });
                                        
                                        console.log(`📋 Estorno: Removido do histórico do plantio`);
                                    }
                                }
                                
                                showToast(`✅ Aplicação estornada, estoque e financeiro ajustados.`);
                                console.log(`🔄 Estorno: ${reminderName} estornada com sucesso`);
                                
                            } catch (error) {
                                console.error('Erro ao estornar aplicação:', error);
                                showToast('Erro ao estornar aplicação.');
                            }
                        }
                    );
                }

                scheduleForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const scheduleId = document.getElementById('schedule-id').value;

                    // Verificar tipo de aplicação
                    const isAnimalApplication = document.getElementById('schedule-type-animal').classList.contains('active');
                    const quantity = parseLocaleNumber(document.getElementById('schedule-quantity').value) || 0;
                    const unit = document.getElementById('schedule-unit').value || 'kg';

                    let scheduleData = {
                        dose: document.getElementById('schedule-dose').value,
                        quantity: quantity,
                        unit: unit,
                        date: document.getElementById('schedule-date').value,
                        notes: document.getElementById('schedule-notes').value,
                        status: 'pending',
                        createdAt: new Date(),
                        updatedAt: new Date()
                    };

                    let products = [];

                    try {
                        if (isAnimalApplication) {
                            // Agendamento para animais
                            const animalType = document.getElementById('schedule-animal-type').value;
                            const selectedAnimalCheckboxes = document.querySelectorAll('.schedule-animal-checkbox:checked');
                            const selectedSupplyOptions = Array.from(document.getElementById('schedule-supply-from-stock').selectedOptions);

                            if (!animalType || selectedAnimalCheckboxes.length === 0 || selectedSupplyOptions.length === 0) {
                                showToast('Por favor, selecione o tipo de animal, pelo menos um animal e pelo menos um insumo.');
                                return;
                            }

                            const selectedAnimals = Array.from(selectedAnimalCheckboxes).map(cb => ({
                                id: cb.value,
                                name: cb.dataset.name,
                                quantity: parseInt(cb.dataset.quantity || 1)
                            }));

                            products = selectedSupplyOptions.map(opt => ({
                                id: opt.value,
                                name: opt.dataset.name
                            }));

                            scheduleData = {
                                ...scheduleData,
                                type: 'animal',
                                animalType: animalType,
                                selectedAnimals: selectedAnimals.map(a => `${a.name} (${a.quantity})`).join(', '),
                                selectedAnimalIds: selectedAnimals.map(a => a.id),
                                products: products,
                                title: `Aplicação em ${animalType} - ${products.map(p => p.name).join(', ')}`
                            };
                            
                            // Agendar notificação para aplicação em animais
                            const scheduleTime = document.getElementById('schedule-time').value || '08:00';
                            const localDateTime = new Date(scheduleData.date + 'T' + scheduleTime + ':00');
                            const applicationTime = localDateTime.getTime();
                            
                            scheduleData.time = scheduleTime;
                            scheduleData.applicationTime = applicationTime;
                            
                            scheduleNotification(
                                '🐄 Lembrete de Aplicação em Animais',
                                `Hoje: ${scheduleData.title}`,
                                applicationTime,
                                `animal-app-${Date.now()}`
                            );
                            
                        } else {
                            // Agendamento para plantios
                            const plantingId = document.getElementById('schedule-planting').value;
                            const selectedSupplyOptions = Array.from(document.getElementById('schedule-supply-from-stock').selectedOptions);

                            if (!plantingId || selectedSupplyOptions.length === 0) {
                                showToast('Por favor, selecione um plantio e pelo menos um insumo.');
                                return;
                            }

                            const planting = allPlantings.find(p => p.id === plantingId);
                            products = selectedSupplyOptions.map(opt => ({
                                id: opt.value,
                                name: opt.dataset.name
                            }));

                            scheduleData = {
                                ...scheduleData,
                                type: 'planting',
                                plantingId: plantingId,
                                plantingName: planting ? `${planting.cropName} (${planting.variety || 'Sem variedade'})` : 'Plantio',
                                products: products,
                                title: `Aplicação em ${planting ? planting.cropName : 'Plantio'} - ${products.map(p => p.name).join(', ')}`
                            };
                            
                            // Agendar notificação para aplicação em plantios
                            const scheduleTime = document.getElementById('schedule-time').value || '08:00';
                            const localDateTime = new Date(scheduleData.date + 'T' + scheduleTime + ':00');
                            const applicationTime = localDateTime.getTime();
                            
                            scheduleData.time = scheduleTime;
                            scheduleData.applicationTime = applicationTime;
                            
                            scheduleNotification(
                                '🌱 Lembrete de Aplicação em Plantio',
                                `Hoje: ${scheduleData.title}`,
                                applicationTime,
                                `planting-app-${Date.now()}`
                            );
                        }

                        // Reservar estoque
                        if (quantity > 0 && products.length > 0) {
                            const reservations = await reserveStockForSchedule(products, quantity, unit);
                            scheduleData.stockReservations = reservations;
                            console.log(`📦 Agendamento: Estoque reservado.`);
                        }

                        if (scheduleId) {
                            // Editando agendamento existente - atualizar reservas
                            const oldSchedule = allScheduledApplications.find(s => s.id === scheduleId);
                            if (oldSchedule && oldSchedule.stockReservations) {
                                // Liberar reservas antigas
                                await releaseStockReservations(oldSchedule.stockReservations);
                                console.log(`🔄 Edição: Liberadas reservas antigas do agendamento`);
                            }
                            
                            await updateDoc(doc(scheduledApplicationsCollectionRef, scheduleId), scheduleData);
                            showToast('Agendamento atualizado com sucesso!');
                            console.log(`✏️ Edição: Agendamento atualizado e novas reservas aplicadas`);
                        } else {
                            await addDoc(scheduledApplicationsCollectionRef, scheduleData);
                            showToast('Aplicação agendada! Estoque reservado automaticamente.');
                        }
                        
                        closeScheduleModal();
                    } catch (error) {
                        console.error('Erro ao agendar aplicação:', error);
                        if (error.message.includes('Estoque insuficiente')) {
                            showToast(`❌ ${error.message}`);
                        } else {
                            showToast('Erro ao agendar aplicação.');
                        }
                    }
                });
                editObservationForm.addEventListener('submit', async (e) => { e.preventDefault(); const timestampId = Number(editObservationIdInput.value); const newText = editObservationText.value; const plantingDocRef = doc(plantingsCollectionRef, currentPlantingCache.id); try { const planting = allPlantings.find(p => p.id === currentPlantingCache.id); const newLog = planting.log.map(entry => { if (entry.timestamp === timestampId) { return { ...entry, text: newText }; } return entry; }); await updateDoc(plantingDocRef, { log: newLog }); showToast('Observação atualizada!'); editObservationModal.style.display = 'none'; } catch (error) { console.error("Erro ao editar observação:", error); showToast('Erro ao editar observação.'); } });
                lunarCalendarBtn.addEventListener('click', openLunarCalendarModal); lunarPrevMonthBtn.addEventListener('click', () => { currentLunarCalendarDate.setMonth(currentLunarCalendarDate.getMonth() - 1); renderLunarCalendar(currentLunarCalendarDate); }); lunarNextMonthBtn.addEventListener('click', () => { currentLunarCalendarDate.setMonth(currentLunarCalendarDate.getMonth() + 1); renderLunarCalendar(currentLunarCalendarDate); }); lunarCalendarModal.querySelector('.close-lunar-modal-btn').addEventListener('click', closeLunarCalendarModal);
                calendarBtn.addEventListener('click', () => { calendarModal.style.display = 'flex'; renderCalendar(); }); prevMonthBtn.addEventListener('click', () => { currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1); renderCalendar(currentCalendarDate); }); nextMonthBtn.addEventListener('click', () => { currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1); renderCalendar(currentCalendarDate); }); calendarModal.querySelector('.close-modal-btn').addEventListener('click', () => { calendarModal.style.display = 'none'; });
                document.getElementById('supplies-modal').addEventListener('click', (e) => { if (e.target.closest('.category-btn')) { const btn = e.target.closest('.category-btn'); if (btn.dataset.category === 'Animais') { openAddAnimalModal(); return; } const customContainer = document.getElementById('custom-category-container'); const hiddenInput = document.getElementById('supply-category'); const varietyContainer = document.getElementById('supply-variety-container'); document.querySelectorAll('#supply-category-buttons .category-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); if (seedCategories.includes(btn.dataset.category)) { varietyContainer.classList.remove('hidden'); } else { varietyContainer.classList.add('hidden'); } if (btn.dataset.category === 'outros') { customContainer.classList.remove('hidden'); hiddenInput.value = 'outros'; } else { customContainer.classList.add('hidden'); hiddenInput.value = btn.dataset.category; } } });
                document.getElementById('schedule-modal').addEventListener('click', (e) => { if (e.target.closest('.category-btn')) { const btn = e.target; document.querySelectorAll('#schedule-category-filters .category-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); populateScheduleSupplyDropdown(btn.dataset.category); } });
                document.getElementById('seed-select').addEventListener('change', updateCalculatedInitialCost); document.getElementById('seed-quantity-used').addEventListener('input', updateCalculatedInitialCost);
                scheduleModal.querySelector('.cancel-schedule-btn').addEventListener('click', closeScheduleModal);
                scheduleBtn.addEventListener('click', openScheduleModal);

                // Adicionar event listeners para cálculo automático
                document.getElementById('schedule-quantity').addEventListener('input', updateScheduleEstimatedCost);
                document.getElementById('schedule-unit').addEventListener('change', updateScheduleEstimatedCost);
                document.getElementById('schedule-supply-from-stock').addEventListener('change', updateScheduleEstimatedCost);

                monthFilter.addEventListener('change', renderTransactions); addPlantingBtn.addEventListener('click', () => openPlantingModal('new')); manageSuppliesBtn.addEventListener('click', openSuppliesModal); cashbookBtn.addEventListener('click', openCashbookModal); cashbookModal.querySelector('.close-modal-btn').addEventListener('click', closeCashbookModal); plantingModal.querySelectorAll('.cancel-btn, .close-modal-btn').forEach(btn => btn.addEventListener('click', closePlantingModal)); suppliesModal.querySelector('.close-modal-btn').addEventListener('click', closeSuppliesModal); cancelSupplyEditBtn.addEventListener('click', closeSuppliesModal); managementModal.querySelector('#cancel-management-btn').addEventListener('click', closeManagementModal); tabDetails.addEventListener('click', () => switchTab('details')); tabManagement.addEventListener('click', () => switchTab('management')); addManagementBtn.addEventListener('click', () => openManagementModal()); supplySelect.addEventListener('change', () => {
                    const selectedOption = supplySelect.options[supplySelect.selectedIndex];
                    const unit = selectedOption.dataset.unit || 'kg';
                    
                    // Define a unidade padrão no select baseada no insumo
                    const quantityUsedUnitSelect = document.getElementById('quantity-used-unit-select');
                    if (quantityUsedUnitSelect) {
                        quantityUsedUnitSelect.value = unit;
                    }
                    
                    // Recalcula o custo com base no novo insumo selecionado
                    updateCalculatedCost();
                }); quantityUsedInput.addEventListener('input', updateCalculatedCost);
                statusGrowingCard.addEventListener('click', () => filterPlantingsByStatus('growing'));
                statusHarvestedCard.addEventListener('click', () => filterPlantingsByStatus('harvested'));
                statusDelayedCard.addEventListener('click', () => filterPlantingsByStatus('delayed'));
                statusEmployeesCard.addEventListener('click', () => openEmployeeModal());
                confirmOkBtn.addEventListener('click', () => { if (confirmCallback) { confirmCallback(); } hideConfirm(); }); confirmCancelBtn.addEventListener('click', hideConfirm); cancelEditObservationBtn.addEventListener('click', () => { editObservationModal.style.display = 'none'; });
                calculatorToggleBtn.addEventListener('click', () => { calculatorWidget.style.display = calculatorWidget.style.display === 'block' ? 'none' : 'block'; }); document.querySelectorAll('.calc-input').forEach(input => { input.addEventListener('focus', (e) => { activeCalculatorInput = e.target; }); }); setupCalculator();
                manageEmployeesBtn.addEventListener('click', openEmployeeModal);
                employeeModal.querySelector('.close-modal-btn').addEventListener('click', closeEmployeeModal);
                cancelEmployeeEditBtn.addEventListener('click', resetEmployeeForm);
                employeeForm.addEventListener('submit', handleEmployeeFormSubmit);

                // --- REVAMPED ANIMAL MANAGEMENT LISTENERS ---
                manageAnimalsBtn.addEventListener('click', openAnimalDashboard);
                animalDashboardModal.querySelector('.close-modal-btn').addEventListener('click', closeAnimalDashboard);
                animalTypeSelector.addEventListener('click', (e) => {
                    if (e.target.closest('.animal-type-btn')) {
                        const btn = e.target.closest('.animal-type-btn');
                        currentAnimalType = btn.dataset.type;
                        document.querySelectorAll('.animal-type-btn').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        animalPrompt.classList.add('hidden');
                        animalManagementContentWrapper.classList.remove('hidden');

                        const productionTab = document.getElementById('animal-production-tab');
                        if (!['others'].includes(currentAnimalType)) {
                            productionTab.classList.remove('hidden');
                        } else {
                            productionTab.classList.add('hidden');
                        }

                        switchAnimalTab('herd');
                    }
                });
                animalTabsContainer.addEventListener('click', (e) => {
                    if (e.target.closest('.animal-tab-btn')) {
                        const btn = e.target.closest('.animal-tab-btn');
                        switchAnimalTab(btn.dataset.tab);
                    }
                });
                addAnimalForm.addEventListener('submit', handleAddAnimalSubmit);
                document.getElementById('cancel-add-animal-btn').addEventListener('click', closeAddAnimalModal);
                document.getElementById('add-animal-type').addEventListener('change', updateAnimalSubtypeOptions);

                // --- NEW: SALES LISTENERS ---
                addSaleBtn.addEventListener('click', openSalesModal);
                salesModal.querySelector('.close-modal-btn').addEventListener('click', closeSalesModal);
                salesModal.querySelector('.cancel-sale-btn').addEventListener('click', closeSalesModal);
                document.getElementById('sale-type-buttons').addEventListener('click', (e) => {
                    if (e.target.closest('.sale-type-btn')) {
                        switchSaleType(e.target.closest('.sale-type-btn').dataset.type);
                    }
                });
                saleForm.addEventListener('submit', handleSaleFormSubmit);
                document.getElementById('sale-harvest-select').addEventListener('change', updateHarvestSaleInfo);

                taskForm.addEventListener('submit', handleTaskFormSubmit);

                window.toggleTaskCompletion = (taskId) => {
                    const task = allTasks.find(t => t.id === taskId);
                    if (task) {
                        updateTaskStatus(taskId, !task.completed);
                    }
                };
                window.editTask = editTask;
                window.deleteTask = deleteTask;
            window.handleDeleteTransaction = handleDeleteTransaction;
            window.handleDeleteAnimalTransaction = handleDeleteAnimalTransaction;

            // Expor função de upload de imagem de animais ao escopo global
            window.openAnimalImageUpload = openAnimalImageUpload;

                document.getElementById('schedule-type-planting').addEventListener('click', () => {
                    // Ativar modo plantio
                    document.getElementById('schedule-type-planting').classList.add('active', 'bg-blue-100', 'text-blue-800', 'border-blue-300');
                    document.getElementById('schedule-type-planting').classList.remove('bg-gray-100', 'text-gray-800', 'border-gray-300');

                    document.getElementById('schedule-type-animal').classList.remove('active', 'bg-blue-100', 'text-blue-800', 'border-blue-300');
                    document.getElementById('schedule-type-animal').classList.add('bg-gray-100', 'text-gray-800', 'border-gray-300');

                    document.getElementById('planting-selection').classList.remove('hidden');
                    document.getElementById('animal-selection').classList.add('hidden');
                });

                document.getElementById('schedule-type-animal').addEventListener('click', () => {
                    // Ativar modo animal
                    document.getElementById('schedule-type-animal').classList.add('active', 'bg-blue-100', 'text-blue-800', 'border-blue-300');
                    document.getElementById('schedule-type-animal').classList.remove('bg-gray-100', 'text-gray-800', 'border-gray-300');

                    document.getElementById('schedule-type-planting').classList.remove('active', 'bg-blue-100', 'text-blue-800', 'border-blue-300');
                    document.getElementById('schedule-type-planting').classList.add('bg-gray-100', 'text-gray-800', 'border-gray-300');

                    document.getElementById('planting-selection').classList.add('hidden');
                    document.getElementById('animal-selection').classList.remove('hidden');
                });

                // Event listener para seleção de tipo de animal no agendamento
                document.getElementById('schedule-animal-type').addEventListener('change', (e) => {
                    const animalType = e.target.value;
                    const animalListContainer = document.getElementById('schedule-animal-list');
                    const selectedCountEl = document.getElementById('schedule-selected-animals-count');

                    if (!animalType) {
                        animalListContainer.innerHTML = '<p class="text-gray-500 text-sm">Selecione um tipo de animal primeiro</p>';
                        selectedCountEl.textContent = '0';
                        return;
                    }

                    // Filtrar animais do tipo selecionado
                    const animalsOfType = allAnimals.filter(a => a.animalType === animalType && a.status !== 'Vendido');

                    if (animalsOfType.length === 0) {
                        animalListContainer.innerHTML = '<p class="text-gray-500 text-sm">Nenhum animal encontrado para este tipo.</p>';
                        selectedCountEl.textContent = '0';
                        return;
                    }

                    animalListContainer.innerHTML = animalsOfType.map(animal => `
                        <label class="flex items-center space-x-2 p-1 hover:bg-gray-100 rounded cursor-pointer">
                            <input type="checkbox" class="schedule-animal-checkbox" value="${animal.id}" 
                                   data-name="${animal.name}" data-quantity="${animal.quantity || 1}" data-type="${animalType}">
                            <span class="text-sm">${animal.name} (${animal.subtype || animalType}) - Qtd: ${animal.quantity || 1}</span>
                        </label>
                    `).join('');

                    // Event listener para checkboxes
                    animalListContainer.addEventListener('change', (e) => {
                        if (e.target.classList.contains('schedule-animal-checkbox')) {
                            updateScheduleSelectedAnimalsCount();
                        }
                    });

                    selectedCountEl.textContent = '0';
                });

            }

            // --- Function to handle planting form submission ---
            async function handlePlantingFormSubmit() {
                const id = plantingIdInput.value;
                const plantingData = {
                    plantingDate: document.getElementById('planting-date').value,
                    harvestDate: document.getElementById('harvest-date').value || null,
                    area: document.getElementById('area').value || null,
                    finalYieldQuantity: parseLocaleNumber(document.getElementById('final-yield-quantity').value) || null,
                    finalYieldUnit: document.getElementById('final-yield-unit').value || null,
                };

                if (!plantingData.plantingDate) {
                    showToast('A data de plantio é obrigatória.');
                    return;
                }

                try {
                    if (id) {
                        // --- UPDATE EXISTING PLANTING ---
                        await updateDoc(doc(plantingsCollectionRef, id), plantingData);
                        showToast('Plantio atualizado com sucesso!');
                    } else {
                        // --- CREATE NEW PLANTING ---
                        const seedSelect = document.getElementById('seed-select');
                        const seedQuantityUsed = parseLocaleNumber(document.getElementById('seed-quantity-used').value);
                        const seedUnit = document.getElementById('seed-quantity-unit').textContent || 'kg';
                        const sourceSupplyId = seedSelect.value;

                        if (!sourceSupplyId || !seedQuantityUsed || seedQuantityUsed <= 0) {
                            showToast('Selecione uma semente/muda e a quantidade usada.');
                            return;
                        }

                        const supply = allSupplies.find(s => s.id === sourceSupplyId);
                        
                        // CORREÇÃO: Converter unidades antes da validação
                        const convertedQuantityUsed = convertUnits(seedQuantityUsed, seedUnit, supply.unit);
                        
                        if (convertedQuantityUsed > supply.remaining) {
                            showToast(`Quantidade usada (${seedQuantityUsed} ${seedUnit} = ${convertedQuantityUsed.toFixed(2)} ${supply.unit}) é maior que o estoque disponível (${supply.remaining} ${supply.unit}).`);
                            return;
                        }

                        // CORREÇÃO: Usar quantidade convertida para calcular custo
                        const initialCost = (supply.cost / supply.quantity) * convertedQuantityUsed;

                        plantingData.cropName = supply.name;
                        plantingData.variety = supply.variety || '';
                        plantingData.sourceSupplyId = sourceSupplyId;
                        plantingData.initialCost = initialCost;
                        plantingData.managementHistory = [];
                        plantingData.log = [];
                        plantingData.initialQuantityUsed = convertedQuantityUsed; // Salva a quantidade inicial usada

                        const supplyDocRef = doc(suppliesCollectionRef, sourceSupplyId);

                        // Use a transaction to ensure data consistency
                        await runTransaction(db, async (transaction) => {
                            const supplyDoc = await transaction.get(supplyDocRef);
                            if (!supplyDoc.exists()) throw "Insumo (semente) não encontrado.";

                            // CORREÇÃO: Usar quantidade convertida na transação
                            const newRemaining = supplyDoc.data().remaining - convertedQuantityUsed;
                            if (newRemaining < 0) throw "Estoque de sementes insuficiente.";

                            // Update supply stock
                            transaction.update(supplyDocRef, { remaining: newRemaining });
                            // Create the new planting document
                            const newPlantingRef = doc(plantingsCollectionRef);
                            transaction.set(newPlantingRef, plantingData);
                            
                            // Adicionar à lista local imediatamente
                            allPlantings.push({ id: newPlantingRef.id, ...plantingData });
                        });
                        
                        // Atualizar interface imediatamente
                        renderPlantings(allPlantings.filter(p => !activeStatusFilter || getPlantingStatus(p).key === activeStatusFilter));
                        updateDashboard();

                        showToast('Novo plantio guardado com sucesso!');
                    }
                    closePlantingModal();
                } catch (error) {
                    console.error("Erro ao guardar plantio:", error);
                    showToast(`Erro ao guardar: ${error.message}`);
                }
            }

            // === FUNÇÕES DE TAREFAS ===
            const renderTasks = () => {
                const taskList = document.getElementById('task-list');
                if (!taskList) return;

                taskList.innerHTML = '';
                if (allTasks.length === 0) {
                    taskList.innerHTML = '<p class="text-gray-500 text-center p-4">Nenhuma tarefa adicionada.</p>';
                    return;
                }

                allTasks.forEach(task => {
                    const item = document.createElement('div');
                    item.className = `task-item flex items-center gap-3 p-3 rounded-md border ${task.completed ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`;
                    
                    let dateTimeInfo = '';
                    if (task.scheduledDate) {
                        const taskDate = new Date(task.scheduledDate + 'T00:00:00');
                        dateTimeInfo = `<div class="text-xs text-gray-500">📅 ${taskDate.toLocaleDateString('pt-BR')}`;
                        if (task.scheduledTime) {
                            dateTimeInfo += ` às ${task.scheduledTime}`;
                        }
                        dateTimeInfo += '</div>';
                    }

                    item.innerHTML = `
                        <input type="checkbox" ${task.completed ? 'checked' : ''} 
                               onchange="updateTaskStatus('${task.id}', this.checked)"
                               class="w-4 h-4 text-blue-600 rounded">
                        <div class="flex-grow">
                            <span class="${task.completed ? 'line-through text-gray-500' : 'text-gray-800'}">${task.text}</span>
                            ${dateTimeInfo}
                        </div>
                        <div class="flex gap-1">
                            <button onclick="editTask('${task.id}', '${task.text.replace(/'/g, "\\'")}', '${task.scheduledDate || ''}', '${task.scheduledTime || ''}')" 
                                    class="text-blue-600 hover:text-blue-800 p-1 rounded" title="Editar">
                                <i class="fas fa-edit text-xs"></i>
                            </button>
                            <button onclick="deleteTask('${task.id}')" 
                                    class="text-red-600 hover:text-red-800 p-1 rounded" title="Excluir">
                                <i class="fas fa-trash text-xs"></i>
                            </button>
                        </div>
                    `;
                    taskList.appendChild(item);
                });
            };

            // Atualizar função editTask para destacar tarefa em edição
            function editTask(taskId, taskText, scheduledDate, scheduledTime) {
                const taskInput = document.getElementById('task-input');
                const taskDateInput = document.getElementById('task-date');
                const taskTimeInput = document.getElementById('task-time');
                const submitBtn = document.querySelector('#task-form button[type="submit"]');
                
                taskInput.value = taskText;
                taskDateInput.value = scheduledDate || '';
                taskTimeInput.value = scheduledTime || '';
                
                // Criar campo hidden para ID da tarefa sendo editada
                let editingIdInput = document.getElementById('editing-task-id');
                if (!editingIdInput) {
                    editingIdInput = document.createElement('input');
                    editingIdInput.type = 'hidden';
                    editingIdInput.id = 'editing-task-id';
                    document.getElementById('task-form').appendChild(editingIdInput);
                }
                editingIdInput.value = taskId;
                
                submitBtn.innerHTML = '<i class="fas fa-save"></i> Salvar Alterações';
                taskInput.focus();
            }

            // Modificar função de submit do formulário de tarefas
            async function handleTaskFormSubmit(e) {
                e.preventDefault();
                const taskInput = document.getElementById('task-input');
                const taskDate = document.getElementById('task-date');
                const taskTime = document.getElementById('task-time');
                const editingIdInput = document.getElementById('editing-task-id');
                const text = taskInput.value.trim();

                if (!text) return;

                try {
                    const taskData = {
                        text: text,
                        completed: false,
                        createdAt: new Date(),
                        userId: userId
                    };

                    // Adicionar data e horário se fornecidos
                    if (taskDate.value) {
                        taskData.scheduledDate = taskDate.value;
                        if (taskTime.value) {
                            taskData.scheduledTime = taskTime.value;
                            
                            // Agendar notificação para data/horário específicos
                            const scheduledDateTime = new Date(taskDate.value + 'T' + taskTime.value + ':00');
                            const reminderTime = scheduledDateTime.getTime();
                            
                            if (reminderTime > new Date().getTime()) {
                                const notificationScheduled = scheduleNotification(
                                    '🌱 Lembrete de Tarefa da Propriedade',
                                    `Agendado para agora: ${text}`,
                                    reminderTime,
                                    `task-scheduled-${Date.now()}`
                                );
                            }
                        }
                    } else if (taskTime.value) {
                        // Se só horário foi fornecido, usar data de hoje
                        const today = new Date().toISOString().split('T')[0];
                        taskData.scheduledDate = today;
                        taskData.scheduledTime = taskTime.value;
                        
                        const scheduledDateTime = new Date(today + 'T' + taskTime.value + ':00');
                        const reminderTime = scheduledDateTime.getTime();
                        
                        if (reminderTime > new Date().getTime()) {
                            const notificationScheduled = scheduleNotification(
                                '🌱 Lembrete de Tarefa da Propriedade',
                                `Agendado para agora: ${text}`,
                                reminderTime,
                                `task-scheduled-${Date.now()}`
                            );
                        }
                    } else {
                        // Comportamento original: lembrete em 1 hora
                        const reminderTime = new Date().getTime() + (60 * 60 * 1000);
                        const notificationScheduled = scheduleNotification(
                            '🌱 Lembrete de Tarefa da Propriedade',
                            `Não se esqueça: ${text}`,
                            reminderTime,
                            `task-${Date.now()}`
                        );
                    }

                    if (editingIdInput && editingIdInput.value) {
                        // Editando tarefa existente
                        const taskId = editingIdInput.value;
                        await updateDoc(doc(tasksCollectionRef, taskId), {
                            ...taskData,
                            updatedAt: new Date()
                        });
                        showToast('Tarefa atualizada!');
                        editingIdInput.remove();
                    } else {
                        // Criando nova tarefa
                        await addDoc(tasksCollectionRef, taskData);
                        showToast('Tarefa adicionada!');
                    }

                    // Limpar formulário
                    taskInput.value = '';
                    taskDate.value = '';
                    taskTime.value = '';

                    // Restaurar botão
                    const submitBtn = e.target.querySelector('button[type="submit"]');
                    submitBtn.innerHTML = '<i class="fas fa-plus"></i> Adicionar Tarefa';

                    renderTasks();

                } catch (error) {
                    console.error('Erro ao salvar tarefa:', error);
                    showToast('Erro ao salvar tarefa.');
                }
            }

            async function updateTaskStatus(taskId, completed) {
                try {
                    await updateDoc(doc(tasksCollectionRef, taskId), {
                        completed: completed,
                        updatedAt: serverTimestamp()
                    });
                } catch (error) {
                    console.error('Erro ao atualizar tarefa:', error);
                    showToast('Erro ao atualizar tarefa.');
                }
            }

            async function deleteTask(taskId) {
                // Encontra a tarefa na lista para obter o texto dela
                const task = allTasks.find(t => t.id === taskId);
                const taskText = task ? `"${task.text}"` : "esta tarefa";

                // Usa o modal personalizado 'showConfirm' em vez do 'confirm()' do navegador
                showConfirm(
                    'Excluir Tarefa',
                    `Tem certeza que deseja excluir a tarefa ${taskText}?`,
                    async () => {
                        try {
                            await deleteDoc(doc(tasksCollectionRef, taskId));
                            showToast('Tarefa excluída com sucesso!');
                        } catch (error) {
                            console.error('Erro ao excluir tarefa:', error);
                            showToast('Erro ao excluir tarefa.');
                        }
                    }
                );
            }

            async function markReminderAsCompleted(reminderId) {
                try {
                    const reminder = allScheduledApplications.find(r => r.id === reminderId);
                    if (!reminder) {
                        showToast('❌ Aplicação não encontrada.');
                        return;
                    }
                    
                    if (reminder.status === 'completed') {
                        showToast('⚠️ Esta aplicação já foi concluída.');
                        return;
                    }

                    const reminderName = reminder.title || 'Aplicação';
                    const date = new Date(reminder.date + 'T00:00:00').toLocaleDateString('pt-BR');
                    
                    showConfirm(
                        'Concluir Aplicação',
                        `Confirma a conclusão de "${reminderName}" do dia ${date}? Isso irá descontar os insumos do estoque.`,
                        async () => {
                            try {
                                let totalCost = 0;
                                const stockUpdates = [];
                                
                                // Processar cada insumo da aplicação
                                if (reminder.products && reminder.products.length > 0) {
                                    await runTransaction(db, async (transaction) => {
                                        for (const product of reminder.products) {
                                            const supplyRef = doc(suppliesCollectionRef, product.id);
                                            const supplyDoc = await transaction.get(supplyRef);
                                            
                                            if (supplyDoc.exists()) {
                                                const supplyData = supplyDoc.data();
                                                const quantityToDeduct = convertUnits(reminder.quantity, reminder.unit, supplyData.unit);
                                                const currentRemaining = supplyData.remaining || 0;
                                                
                                                if (currentRemaining >= quantityToDeduct) {
                                                    const newRemaining = currentRemaining - quantityToDeduct;
                                                    
                                                    transaction.update(supplyRef, {
                                                        remaining: newRemaining
                                                    });
                                                    
                                                    // Calcular custo
                                                    const unitCost = supplyData.unitCost || 0;
                                                    const supplyCost = quantityToDeduct * unitCost;
                                                    totalCost += supplyCost;
                                                    
                                                    // Registrar para possível estorno
                                                    stockUpdates.push({
                                                        supplyId: product.id,
                                                        supplyName: supplyData.name,
                                                        quantityToDeduct: quantityToDeduct,
                                                        unit: supplyData.unit,
                                                        unitCost: unitCost
                                                    });
                                                    
                                                    console.log(`📦 Descontado: ${quantityToDeduct} ${supplyData.unit} de ${supplyData.name}`);
                                                } else {
                                                    throw new Error(`Estoque insuficiente de ${supplyData.name}. Disponível: ${currentRemaining}, Necessário: ${quantityToDeduct}`);
                                                }
                                            }
                                        }
                                        
                                        // Marcar aplicação como concluída
                                        const reminderRef = doc(scheduledApplicationsCollectionRef, reminderId);
                                        transaction.update(reminderRef, {
                                            status: 'completed',
                                            completedAt: new Date(),
                                            updatedAt: new Date(),
                                            actualCost: totalCost,
                                            stockUpdatesApplied: stockUpdates
                                        });
                                    });
                                    
                                    // Lançamento financeiro
                                    if (totalCost > 0) {
                                        const transactionData = {
                                            description: `Aplicação: ${reminderName}`,
                                            amount: totalCost,
                                            type: 'despesa',
                                            category: 'Insumos',
                                            date: new Date().toISOString().split('T')[0],
                                            source: 'application_completion',
                                            applicationId: reminderId,
                                            createdAt: new Date()
                                        };
                                        
                                        await addDoc(transactionsCollectionRef, transactionData);
                                        console.log(`💰 Lançamento financeiro: ${formatCurrency(totalCost)}`);
                                    }
                                    
                                    showToast(`✅ Aplicação concluída! Custo: ${formatCurrency(totalCost)}`);
                                    
                                } else {
                                    // Se não tem insumos, apenas marcar como concluída
                                    const reminderRef = doc(scheduledApplicationsCollectionRef, reminderId);
                                    await updateDoc(reminderRef, {
                                        status: 'completed',
                                        completedAt: new Date(),
                                        updatedAt: new Date()
                                    });
                                    
                                    showToast('✅ Aplicação marcada como concluída!');
                                }
                                
                            } catch (error) {
                                console.error('❌ Erro ao concluir aplicação:', error);
                                showToast(`❌ Erro: ${error.message}`);
                            }
                        }
                    );
                    
                } catch (error) {
                    console.error('❌ Erro ao marcar aplicação como concluída:', error);
                    showToast('Erro ao marcar aplicação como concluída');
                }
            }

            async function deleteReminder(reminderId) {
                // Encontra o lembrete para montar uma mensagem mais clara
                const reminder = allScheduledApplications.find(r => r.id === reminderId);
                let reminderName = 'este lembrete';
                if (reminder) {
                    const date = new Date(reminder.date + 'T00:00:00').toLocaleDateString('pt-BR');
                    reminderName = `o agendamento "${reminder.title}" do dia ${date}`;
                }

                // Usa o modal personalizado 'showConfirm'
                showConfirm(
                    'Excluir Lembrete',
                    `Tem certeza que deseja apagar ${reminderName}?`,
                    async () => {
                        try {
                            await deleteDoc(doc(scheduledApplicationsCollectionRef, reminderId));
                            showToast('Lembrete apagado com sucesso!');
                        } catch (error) {
                            console.error("Erro ao apagar lembrete:", error);
                            showToast('Erro ao apagar lembrete.');
                        }
                    }
                );
            }

            function editReminder(reminderId) {
                const reminder = allScheduledApplications.find(r => r.id === reminderId);
                if (!reminder) return;
                
                // Usar a função existente handleEditReminder
                handleEditReminder(reminder);
            }


            // === FIM DAS FUNÇÕES DE TAREFAS ===

            // Expor funções dos botões ao escopo global (versão segura)
            window.markReminderAsCompleted = markReminderAsCompleted;
            window.editReminder = editReminder;
            window.deleteReminder = deleteReminder;
            // window.cancelApplication = cancelApplication;  // MANTER COMENTADA
            // window.refundApplication = refundApplication;  // MANTER COMENTADA

            // Função simplificada de estorno (sem quebrar login)
            window.handleRefundApplication = async function(reminderId) {
                const reminder = allScheduledApplications.find(r => r.id === reminderId);
                if (!reminder) {
                    showToast('❌ Aplicação não encontrada.');
                    return;
                }
                
                if (reminder.status !== 'completed') {
                    showToast('⚠️ Apenas aplicações concluídas podem ser estornadas.');
                    return;
                }
                
                const reminderName = reminder.title || 'Aplicação';
                const date = new Date(reminder.date + 'T00:00:00').toLocaleDateString('pt-BR');
                
                showConfirm(
                    'Estornar Aplicação',
                    `Tem certeza que deseja estornar "${reminderName}" do dia ${date}?`,
                    async () => {
                        try {
                            // Marcar como estornada
                            const reminderRef = doc(scheduledApplicationsCollectionRef, reminderId);
                            await updateDoc(reminderRef, {
                                status: 'refunded',
                                refundedAt: new Date(),
                                updatedAt: new Date()
                            });
                            
                            showToast('✅ Aplicação estornada com sucesso!');
                            loadScheduledApplications();
                        } catch (error) {
                            console.error('Erro ao estornar:', error);
                            showToast('❌ Erro ao estornar aplicação.');
                        }
                    }
                );
            };

            // Função para apagar lembrete permanentemente
            window.handleDeleteApplication = async function(reminderId) {
                const reminder = allScheduledApplications.find(r => r.id === reminderId);
                if (!reminder) {
                    showToast('❌ Aplicação não encontrada.');
                    return;
                }
                
                const reminderName = reminder.title || 'Aplicação';
                const date = new Date(reminder.date + 'T00:00:00').toLocaleDateString('pt-BR');
                
                showConfirm(
                    'Apagar Lembrete',
                    `Tem certeza que deseja APAGAR PERMANENTEMENTE o lembrete "${reminderName}" do dia ${date}? Esta ação não pode ser desfeita.`,
                    async () => {
                        try {
                            await deleteDoc(doc(scheduledApplicationsCollectionRef, reminderId));
                            showToast('🗑️ Lembrete apagado permanentemente!');
                            loadScheduledApplications();
                        } catch (error) {
                            console.error('Erro ao apagar:', error);
                            showToast('❌ Erro ao apagar lembrete.');
                        }
                    }
                );
            };

            // --- ENHANCED EMPLOYEE MANAGEMENT ---
            function openEmployeeModal() { employeeModal.style.display = 'flex'; resetEmployeeForm(); renderEmployees(); }
            function closeEmployeeModal() { employeeModal.style.display = 'none'; }
            function resetEmployeeForm() { employeeForm.reset(); document.getElementById('employee-id').value = ''; employeeFormTitle.textContent = 'Novo Funcionário'; cancelEmployeeEditBtn.classList.add('hidden'); }
            function renderEmployees() {
                employeeList.innerHTML = '';
                if (allEmployees.length === 0) { employeeList.innerHTML = `<p class="text-gray-500 text-center p-4">Nenhum funcionário registado.</p>`; return; }
                const contractTypes = { registrado: 'Registrado', temporario: 'Temporário', diarista: 'Diarista' };
                allEmployees.sort((a, b) => a.name.localeCompare(b.name)).forEach(emp => {
                    const item = document.createElement('div');
                    item.className = 'bg-gray-50 p-3 rounded-lg border';
                    const statusClass = emp.status === 'ativo' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
                    item.innerHTML = `
                        <div class="flex justify-between items-start">
                            <div>
                                <p class="font-bold text-lg">${emp.name}</p>
                                <p class="text-sm text-gray-600">${emp.role} - <span class="font-semibold">${contractTypes[emp.contractType] || 'N/A'}</span></p>
                                <p class="text-xs text-gray-500">Salário Base: ${formatCurrency(emp.salary)}</p>
                                <span class="text-xs font-semibold ${statusClass} px-2 py-0.5 rounded-full">${emp.status}</span>
                            </div>
                            <div class="flex flex-col items-end gap-2">
                                <button class="view-financials-btn text-sm bg-green-500 text-white font-semibold py-1 px-3 rounded-lg hover:bg-green-600 flex items-center gap-2" data-id="${emp.id}"><i class="fas fa-dollar-sign"></i> Financeiro</button>
                                <div>
                                    <button class="edit-employee-btn text-blue-500 px-1" data-id="${emp.id}"><i class="fas fa-pencil-alt"></i></button>
                                    <button class="delete-employee-btn text-red-500 px-1" data-id="${emp.id}"><i class="fas fa-trash-alt"></i></button>
                                </div>
                            </div>
                        </div>`;
                    item.querySelector('.edit-employee-btn').addEventListener('click', () => handleEditEmployee(emp));
                    item.querySelector('.delete-employee-btn').addEventListener('click', () => handleDeleteEmployee(emp.id));
                    item.querySelector('.view-financials-btn').addEventListener('click', () => openEmployeeFinancials(emp));
                    employeeList.appendChild(item);
                });
            }
            async function handleEmployeeFormSubmit(e) {
                e.preventDefault();
                const id = document.getElementById('employee-id').value;
                const employeeData = {
                    name: document.getElementById('employee-name').value,
                    role: document.getElementById('employee-role').value,
                    contractType: document.getElementById('employee-contract-type').value,
                    salary: parseLocaleNumber(document.getElementById('employee-salary').value),
                    hireDate: document.getElementById('employee-hire-date').value,
                    contact: document.getElementById('employee-contact').value,
                    observations: document.getElementById('employee-observations').value,
                    status: document.getElementById('employee-status').value,
                };
                if (!employeeData.name || !employeeData.role || !employeeData.hireDate) {
                    showToast('Preencha os campos obrigatórios.');
                    return;
                }
                try {
                    if (id) {
                        await updateDoc(doc(employeesCollectionRef, id), employeeData);
                        showToast('Funcionário atualizado!');
                    } else {
                        await addDoc(employeesCollectionRef, employeeData);
                        showToast('Funcionário adicionado!');
                    }
                    resetEmployeeForm();
                } catch (error) {
                    console.error("Erro ao guardar funcionário:", error);
                    showToast('Erro ao guardar.');
                }
            }
            function handleEditEmployee(emp) {
                employeeFormTitle.textContent = `Editar: ${emp.name}`;
                document.getElementById('employee-id').value = emp.id;
                document.getElementById('employee-name').value = emp.name;
                document.getElementById('employee-role').value = emp.role;
                document.getElementById('employee-contract-type').value = emp.contractType;
                document.getElementById('employee-salary').value = (emp.salary || '').toString().replace('.', ',');
                document.getElementById('employee-hire-date').value = emp.hireDate;
                document.getElementById('employee-contact').value = emp.contact;
                document.getElementById('employee-observations').value = emp.observations || '';
                document.getElementById('employee-status').value = emp.status;
                cancelEmployeeEditBtn.classList.remove('hidden');
            }
            function handleDeleteEmployee(id) { showConfirm('Confirmar Exclusão', 'Tem a certeza que quer apagar este funcionário e todo o seu histórico financeiro?', async () => { try { await deleteDoc(doc(employeesCollectionRef, id)); showToast('Funcionário apagado!'); } catch (error) { console.error("Erro ao apagar funcionário:", error); showToast('Erro ao apagar.'); } }); }

            // --- NEW: Employee Financials ---
            async function openEmployeeFinancials(employee) {
                const financialsRef = collection(db, `users/${userId}/funcionarios/${employee.id}/financials`);
                const q = query(financialsRef);

                let financialsHTML = '<p class="text-gray-500">A carregar histórico...</p>';
                employeeFinancialModal.innerHTML = `
                    <div class="modal bg-white rounded-lg shadow-2xl w-11/12 md:max-w-2xl mx-auto p-6 relative">
                        <h2 class="text-2xl font-bold mb-4 text-center">Financeiro: ${employee.name}</h2>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <h3 class="text-lg font-semibold mb-2 border-b pb-2">Novo Lançamento</h3>
                                <form id="employee-financial-form" class="space-y-3">
                                    <div><label class="block text-sm">Tipo</label><select id="financial-type" class="mt-1 w-full p-2 border rounded-md"><option value="adiantamento">Adiantamento</option><option value="passagem">Passagem</option><option value="alimentacao">Alimentação</option><option value="salario">Pagamento de Salário</option><option value="outros">Outros</option></select></div>
                                    <div><label class="block text-sm">Valor (R$)</label><input type="text" id="financial-amount" required class="calc-input mt-1 w-full p-2 border rounded-md"></div>
                                    <div><label class="block text-sm">Data</label><input type="date" id="financial-date" required class="mt-1 w-full p-2 border rounded-md"></div>
                                    <button type="submit" class="w-full bg-green-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-green-700">Lançar Despesa</button>
                                </form>
                            </div>
                            <div>
                                <h3 class="text-lg font-semibold mb-2 border-b pb-2">Histórico de Pagamentos</h3>
                                <div id="financial-history-list" class="space-y-2 max-h-64 overflow-y-auto pr-2">${financialsHTML}</div>
                            </div>
                        </div>
                        <button class="close-modal-btn absolute top-4 right-4 text-gray-400 hover:text-gray-600"><i class="fas fa-times fa-lg"></i></button>
                    </div>`;
                employeeFinancialModal.style.display = 'flex';
                employeeFinancialModal.querySelector('.close-modal-btn').addEventListener('click', () => employeeFinancialModal.style.display = 'none');

                onSnapshot(q, (snapshot) => {
                    const historyList = document.getElementById('financial-history-list');
                    if (snapshot.empty) { historyList.innerHTML = '<p class="text-gray-500">Nenhum lançamento encontrado.</p>'; return; }
                    let docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    docs.sort((a, b) => new Date(b.date) - new Date(a.date));
                    historyList.innerHTML = docs.map(data => {
                        return `<div class="bg-gray-100 p-2 rounded-md text-sm"><div class="flex justify-between"><span>${new Date(data.date + 'T00:00:00').toLocaleDateString('pt-BR')} - <span class="capitalize">${data.type}</span></span><strong class="text-red-600">${formatCurrency(data.amount)}</strong></div></div>`;
                    }).join('');
                });

                document.getElementById('employee-financial-form').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const financialData = {
                        type: document.getElementById('financial-type').value,
                        amount: parseLocaleNumber(document.getElementById('financial-amount').value),
                        date: document.getElementById('financial-date').value,
                    };
                    if (!financialData.amount || !financialData.date) { showToast('Preencha valor e data.'); return; }

                    try {
                        const batch = writeBatch(db);
                        // Add to employee's subcollection
                        const financialDocRef = doc(collection(db, `users/${userId}/funcionarios/${employee.id}/financials`));
                        batch.set(financialDocRef, financialData);
                        // Add to main cashbook
                        const transactionDocRef = doc(collection(db, `users/${userId}/transacoes`));
                        const description = `Pagamento (${financialData.type}) para ${employee.name}`;
                        batch.set(transactionDocRef, { description: description, amount: financialData.amount, type: 'despesa', category: 'Recursos Humanos', date: financialData.date, relatedEmployeeId: employee.id });
                        await batch.commit();
                        showToast('Lançamento financeiro adicionado!');
                        e.target.reset();
                    } catch (error) { console.error("Erro ao lançar despesa:", error); showToast('Erro ao guardar.'); }
                });
            }

            // --- FULLY REVAMPED ANIMAL MANAGEMENT ---
            function openAnimalDashboard() { animalDashboardModal.style.display = 'flex'; }
            function closeAnimalDashboard() {
                animalDashboardModal.style.display = 'none';
                animalPrompt.classList.remove('hidden');
                animalManagementContentWrapper.classList.add('hidden');
                document.querySelectorAll('.animal-type-btn').forEach(b => b.classList.remove('active'));
                currentAnimalType = null;
            }
            function openAnimalSubModal(content) { animalSubModal.innerHTML = content; animalSubModal.style.display = 'flex'; }
            function closeAnimalSubModal() { animalSubModal.style.display = 'none'; }

            function switchAnimalTab(tab) {
                document.querySelectorAll('.animal-tab-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.tab === tab);
                });
                renderAnimalTab(tab);
            }

            function renderAnimalTab(tab) {
                const content = document.getElementById('animal-management-content');
                document.querySelectorAll('.animal-tab-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.tab === tab);
                });

                switch (tab) {
                    case 'herd':
                        renderAnimalHerdTab(currentAnimalType);
                        break;
                    case 'production':
                        renderAnimalProductionTab(currentAnimalType);
                        break;
                    case 'feeding':
                        renderAnimalFeedingTab(currentAnimalType);
                        break;
                    case 'financials':
                        renderAnimalFinancialsTab(currentAnimalType);
                        break;
                    case 'medication':
                        renderAnimalMedicationTab(currentAnimalType);
                        break;
                }
            }

            function renderAnimalHerdTab(type) {
                const animalsOfType = allAnimals.filter(a => a.animalType === type && a.status !== 'Vendido');

                const typeNames = { cattle: 'Bovino', chickens: 'Ave', pigs: 'Suíno', goats: 'Caprino', sheep: 'Ovino', fish: 'Peixe', equine: 'Equino', others: 'Outro' };
                const typeName = typeNames[type] || 'Animal';

                const listHTML = animalsOfType.map(animal => {
                    const purchaseDate = animal.dob ? new Date(animal.dob + 'T00:00:00') : new Date();

                    return `
                        <div class="animal-item bg-white p-4 rounded-lg border border-gray-200 shadow-sm mb-4">
                            <div class="flex justify-between items-start mb-3">
                                <div class="flex-1">
                                    <h4 class="font-semibold text-lg text-gray-800">${animal.subtype || typeName} - ${animal.name}</h4>
                                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 text-sm text-gray-600">
                                        <p><strong>Raça:</strong> ${animal.breed}</p>
                                        <p><strong>Quantidade:</strong> ${animal.quantity}</p>
                                        <p><strong>Compra:</strong> ${purchaseDate.toLocaleDateString('pt-BR')}</p>
                                    </div>
                                </div>
                                <div class="flex flex-col items-end gap-2 ml-4">
                                    <button onclick="openAnimalImageUpload('${animal.id}')" 
                                            class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg transition-colors flex items-center gap-2">
                                        <i class="fas fa-camera"></i>
                                        <span class="hidden sm:inline">Adicionar Foto</span>
                                    </button>
                                    <button class="delete-animal-btn text-red-500" data-id="${animal.id}" title="Excluir"><i class="fas fa-trash-alt"></i></button>
                                </div>
                            </div>
                            
                            <!-- Galeria de Fotos do Animal -->
                            <div class="border-t border-gray-200 pt-3">
                                <div class="flex items-center gap-2 mb-3">
                                    <i class="fas fa-images text-gray-600"></i>
                                    <span class="font-medium text-gray-700">Galeria do Animal</span>
                                </div>
                                <div id="gallery-${animal.id}" class="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                                    <!-- Fotos serão carregadas aqui -->
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');

                animalManagementContent.innerHTML = `
                    <h3 class="text-lg font-semibold mb-4 border-b pb-2">Meu Plantel de ${typeName}s</h3>
                    <button id="add-animal-purchase-btn" class="w-full mb-4 bg-green-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-green-700 flex items-center justify-center gap-2"><i class="fas fa-plus"></i> Registrar Nova Compra de ${typeName}</button>
                    <div class="space-y-0 max-h-[60vh] overflow-y-auto pr-2">${listHTML || `<p class="text-gray-500 text-center p-4">Nenhum ${typeName.toLowerCase()} registado.</p>`}</div>
                `;

                animalManagementContent.querySelector('#add-animal-purchase-btn').addEventListener('click', () => openAddAnimalModal(currentAnimalType));
                animalManagementContent.querySelectorAll('.delete-animal-btn').forEach(btn => btn.addEventListener('click', (e) => handleDeleteAnimal(e.currentTarget.dataset.id)));

                // Carregar galerias para cada animal
                animalsOfType.forEach(animal => {
                    if (typeof renderGallery === 'function') {
                        renderGallery(animal.id, 'animal');
                    }
                });
            }

            // Função para abrir upload de imagem do animal
            function openAnimalImageUpload(animalId) {
                const input = document.createElement('input');
                input.type = 'file';
                input.multiple = true;
                input.accept = '.jpg,.jpeg,.png';

                input.onchange = async (e) => {
                    const files = Array.from(e.target.files);
                    if (files.length === 0) return;

                    // Abre o modal personalizado e aguarda a observação
                    const observation = await new Promise(resolve => {
                        const modal = document.getElementById('image-observation-modal');
                        const textarea = document.getElementById('image-observation-textarea');
                        const confirmBtn = document.getElementById('image-observation-confirm-btn');
                        const cancelBtn = document.getElementById('image-observation-cancel-btn');

                        textarea.value = ''; // Limpa o campo
                        modal.style.display = 'flex';

                        confirmBtn.onclick = () => {
                            modal.style.display = 'none';
                            resolve(textarea.value);
                        };

                        cancelBtn.onclick = () => {
                            modal.style.display = 'none';
                            resolve(null); // Retorna null se o usuário cancelar
                        };
                    });

                    // Se o usuário não cancelou (observação não é null)
                    if (observation !== null) {
                        for (const file of files) {
                            try {
                                if (typeof uploadImage === 'function') {
                                    await uploadImage(file, animalId, 'animal', observation || 'Sem observação');
                                } else {
                                    console.error("uploadImage function is not defined.");
                                    showToast("Funcionalidade de upload de imagem não implementada.");
                                }
                            } catch (error) {
                                console.error('Erro ao fazer upload:', error);
                            }
                        }
                    }
                };
                input.click();
            }

            // --- Function to render the production tab ---
            async function renderAnimalProductionTab(type) {
                const typeNames = { cattle: 'Bovino', chickens: 'Ave', pigs: 'Suíno', goats: 'Caprino', sheep: 'Ovino', fish: 'Peixe', equine: 'Equino' };
                const productionTypes = {
                    cattle: { 'Ganho de Peso (kg)': 'weight_gain', 'Nascimento': 'birth', 'Produção de Leite (L)': 'milk_production' },
                    chickens: { 'Postura de Ovos (un)': 'egg_laying', 'Ganho de Peso (kg)': 'weight_gain' },
                    pigs: { 'Ganho de Peso (kg)': 'weight_gain', 'Nascimento de Leitões': 'birth' },
                    goats: { 'Ganho de Peso (kg)': 'weight_gain', 'Nascimento': 'birth', 'Produção de Leite (L)': 'milk_production' },
                    sheep: { 'Ganho de Peso (kg)': 'weight_gain', 'Nascimento': 'birth' },
                    fish: { 'Ganho de Peso (kg)': 'weight_gain', 'Biometria (g)': 'biometrics' },
                    equine: { 'Evento de Saúde': 'health_event', 'Treinamento': 'training', 'Nascimento': 'birth' }
                };
                const optionsHTML = Object.entries(productionTypes[type] || {}).map(([text, value]) => `<option value="${value}">${text}</option>`).join('');

                const content = `
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div>
                            <h3 class="text-lg font-semibold mb-4 border-b pb-2">Registrar Produção/Evento</h3>
                            <form id="animal-production-form" class="space-y-4 bg-gray-50 p-4 rounded-lg">
                                <div>
                                    <label for="production-type" class="block text-sm font-medium text-gray-700">Tipo de Registo</label>
                                    <select id="production-type" required class="mt-1 block w-full px-3 py-2 border rounded-md">${optionsHTML}</select>
                                </div>
                                <div>
                                    <label for="production-value" class="block text-sm font-medium text-gray-700">Valor / Medida</label>
                                    <input type="text" id="production-value" required class="calc-input mt-1 block w-full px-3 py-2 border rounded-md">
                                </div>
                                <div>
                                    <label for="production-date" class="block text-sm font-medium text-gray-700">Data</label>
                                    <input type="date" id="production-date" required class="mt-1 block w-full px-3 py-2 border rounded-md">
                                </div>
                                 <div>
                                    <label for="production-notes" class="block text-sm font-medium text-gray-700">Observações</label>
                                    <textarea id="production-notes" rows="2" class="mt-1 block w-full px-3 py-2 border rounded-md"></textarea>
                                </div>
                                <button type="submit" class="w-full bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-blue-700">Registrar</button>
                            </form>
                        </div>
                        <div>
                            <h3 class="text-lg font-semibold mb-4 border-b pb-2">Histórico de Produção (${typeNames[type] || ''})</h3>
                            <div id="production-history-list" class="space-y-2 max-h-[60vh] overflow-y-auto pr-2">A carregar...</div>
                        </div>
                    </div>
                `;
                animalManagementContent.innerHTML = content;
                document.getElementById('animal-production-form').addEventListener('submit', handleProductionLogSubmit);
                loadProductionHistory(type);
            }

            async function handleProductionLogSubmit(e) {
                e.preventDefault();
                const productionData = {
                    animalType: currentAnimalType,
                    type: document.getElementById('production-type').value,
                    value: document.getElementById('production-value').value,
                    date: document.getElementById('production-date').value,
                    notes: document.getElementById('production-notes').value,
                    timestamp: serverTimestamp()
                };

                if (!productionData.type || !productionData.value || !productionData.date) {
                    showToast('Preencha todos os campos obrigatórios.');
                    return;
                }

                try {
                    await addDoc(animalProductionCollectionRef, productionData);
                    showToast('Registo de produção adicionado!');
                    e.target.reset();
                    loadProductionHistory(currentAnimalType);
                } catch (error) {
                    console.error("Erro ao registrar produção:", error);
                    showToast('Erro ao guardar o registo.');
                }
            }

            // Função para traduzir tipos de produção para português
            function translateProductionType(type) {
                const translations = {
                    'weight_gain': 'Ganho de Peso',
                    'birth': 'Nascimento',
                    'milk_production': 'Produção de Leite',
                    'egg_laying': 'Postura de Ovos',
                    'biometrics': 'Biometria',
                    'health_event': 'Evento de Saúde',
                    'training': 'Treinamento'
                };
                return translations[type] || type;
            }

            async function loadProductionHistory(animalType) {
                const historyListEl = document.getElementById('production-history-list');
                const q = query(animalProductionCollectionRef, where("animalType", "==", animalType));
                try {
                    const querySnapshot = await getDocs(q);
                    if (querySnapshot.empty) {
                        historyListEl.innerHTML = '<p class="text-gray-500 text-center p-4">Nenhum registo de produção encontrado.</p>';
                        return;
                    }
                    let history = querySnapshot.docs.map(doc => doc.data());
                    history.sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis());

                    historyListEl.innerHTML = history.map(data => `
                        <div class="bg-white p-2 rounded-md shadow-sm text-sm">
                            <p class="font-semibold">${translateProductionType(data.type || '')}: <strong class="text-blue-700">${data.value}</strong></p>
                            <p class="text-xs text-gray-500">${new Date(data.date + 'T00:00:00').toLocaleDateString('pt-BR')}</p>
                            ${data.notes ? `<p class="text-xs text-gray-600 mt-1"><em>Obs: ${data.notes}</em></p>` : ''}
                        </div>
                    `).join('');
                } catch (error) {
                    console.error("Error loading production history:", error);
                    historyListEl.innerHTML = '<p class="text-red-500 text-center p-4">Erro ao carregar histórico.</p>';
                }
            }

            function renderAnimalFeedingTab(type) {
                const availableFeeds = allSupplies.filter(s => s.category === 'Ração' && s.remaining > 0);
                const feedOptions = availableFeeds.map(f => `<option value="${f.id}" data-unit="${f.unit}">${f.name} (${f.remaining.toFixed(2)} ${f.unit} disp.)</option>`).join('');

                const content = `
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div>
                            <h3 class="text-lg font-semibold mb-4 border-b pb-2">Registrar Consumo de Ração</h3>
                            <form id="animal-feeding-form" class="space-y-4 bg-gray-50 p-4 rounded-lg">
                                <div>
                                    <label for="feed-select" class="block text-sm font-medium text-gray-700">Ração (do Estoque)</label>
                                    <select id="feed-select" required class="mt-1 block w-full px-3 py-2 border rounded-md">
                                        <option value="">Selecione a ração</option>
                                        ${feedOptions}
                                    </select>
                                </div>
                                <div>
                                    <label for="feed-quantity" class="block text-sm font-medium text-gray-700">Quantidade Consumida</label>
                                    <div class="flex items-center">
                                        <input type="text" id="feed-quantity" required class="calc-input mt-1 block w-full px-3 py-2 border rounded-l-md">
                                        <span id="feed-unit" class="inline-flex items-center px-3 mt-1 text-sm text-gray-500 border border-l-0 border-gray-300 rounded-r-md bg-gray-200 h-10">--</span>
                                    </div>
                                </div>
                                <div>
                                    <label for="feed-date" class="block text-sm font-medium text-gray-700">Data</label>
                                    <input type="date" id="feed-date" required class="mt-1 block w-full px-3 py-2 border rounded-md">
                                </div>
                                <button type="submit" class="w-full bg-green-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-green-700 flex items-center justify-center gap-2">
                                    <i class="fas fa-save"></i> Registrar Consumo
                                </button>
                            </form>
                        </div>
                        <div>
                            <h3 class="text-lg font-semibold mb-4 border-b pb-2">Histórico de Alimentação (${type})</h3>
                            <div id="feeding-history-list" class="space-y-2 max-h-[60vh] overflow-y-auto pr-2">A carregar...</div>
                        </div>
                    </div>
                `;
                animalManagementContent.innerHTML = content;

                const feedSelect = document.getElementById('feed-select');
                const feedUnitSpan = document.getElementById('feed-unit');
                feedSelect.addEventListener('change', (e) => {
                    const selectedOption = e.target.options[e.target.selectedIndex];
                    feedUnitSpan.textContent = selectedOption.dataset.unit || '--';
                });
                document.getElementById('animal-feeding-form').addEventListener('submit', handleFeedLogSubmit);

                loadFeedingHistory(type);
            }

            async function loadFeedingHistory(animalType) {
                const historyListEl = document.getElementById('feeding-history-list');
                const q = query(animalFinancialsCollectionRef, where("animalType", "==", animalType), where("category", "==", "Alimentação"));

                try {
                    const querySnapshot = await getDocs(q);
                    if (querySnapshot.empty) {
                        historyListEl.innerHTML = '<p class="text-gray-500 text-center p-4">Nenhum registo de alimentação encontrado.</p>';
                        return;
                    }

                    let history = querySnapshot.docs.map(doc => doc.data());
                    history.sort((a, b) => new Date(b.date) - new Date(a.date));

                    historyListEl.innerHTML = history.map(data => {
                        return `
                            <div class="bg-white p-2 rounded-md shadow-sm text-sm">
                                <div class="flex justify-between items-center">
                                    <div>
                                        <p class="font-semibold">${data.description}</p>
                                        <p class="text-xs text-gray-500">${new Date(data.date + 'T00:00:00').toLocaleDateString('pt-BR')}</p>
                                    </div>
                                    <strong class="text-red-600">${formatCurrency(data.amount)}</strong>
                                </div>
                            </div>
                        `;
                    }).join('');
                } catch (error) {
                    console.error("Error loading feeding history: ", error);
                    historyListEl.innerHTML = '<p class="text-red-500 text-center p-4">Erro ao carregar histórico.</p>';
                }
            }

            async function renderAnimalMedicationTab(type) {
                const content = `
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div>
                            <h3 class="text-lg font-semibold mb-4 border-b pb-2">Registrar Medicação</h3>
                            <form id="animal-medication-form" class="space-y-4 bg-gray-50 p-4 rounded-lg">
                                <div>
                                    <label for="medication-select" class="block text-sm font-medium text-gray-700">Medicamento (do Estoque)</label>
                                    <select id="medication-select" required class="mt-1 block w-full px-3 py-2 border rounded-md">
                                        <option value="">Selecione um medicamento</option>
                                    </select>
                                </div>
                                
                                <!-- Nova seção para seleção de animais específicos -->
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-2">Selecionar Animais para Medicação</label>
                                    <div id="animal-selection-container" class="max-h-32 overflow-y-auto border rounded-md p-2 bg-white">
                                        <p class="text-gray-500 text-sm">Carregando animais...</p>
                                    </div>
                                    <div class="mt-2 text-sm text-gray-600">
                                        <span id="selected-animals-count">0</span> animal(is) selecionado(s)
                                    </div>
                                </div>
                                
                                <div>
                                    <label for="medication-quantity-per-animal" class="block text-sm font-medium text-gray-700">Quantidade por Animal</label>
                                    <div class="flex items-center">
                                        <input type="text" id="medication-quantity-per-animal" required class="calc-input mt-1 block w-full px-3 py-2 border rounded-l-md">
                                        <span id="medication-unit" class="inline-flex items-center px-3 mt-1 text-sm text-gray-500 border border-l-0 border-gray-300 rounded-r-md bg-gray-50 h-10">--</span>
                                    </div>
                                    <div class="mt-1 text-sm text-gray-600">
                                        Total necessário: <span id="total-quantity-needed">0</span> <span id="total-unit">--</span>
                                    </div>
                                </div>
                                
                                <div>
                                    <label for="medication-date" class="block text-sm font-medium text-gray-700">Data da Aplicação</label>
                                    <input type="date" id="medication-date" required class="mt-1 block w-full px-3 py-2 border rounded-md">
                                </div>
                                <div>
                                    <label for="medication-notes" class="block text-sm font-medium text-gray-700">Observações/Posologia</label>
                                    <textarea id="medication-notes" rows="2" class="mt-1 block w-full px-3 py-2 border rounded-md" placeholder="Ex: Dose, via de aplicação, período de carência"></textarea>
                                </div>
                                <div>
                                    <label for="next-application" class="block text-sm font-medium text-gray-700">Próxima Aplicação</label>
                                    <input type="date" id="next-application" class="mt-1 block w-full px-3 py-2 border rounded-md">
                                </div>
                                <div class="bg-gray-100 p-3 rounded-md text-center">
                                    <p class="text-sm text-gray-600">Custo Calculado da Aplicação</p>
                                    <p id="medication-cost" class="text-lg font-bold text-green-600">R$ 0,00</p>
                                </div>
                                <button type="submit" class="w-full bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-blue-700">Registrar Medicação</button>
                            </form>
                        </div>
                        <div>
                            <h3 class="text-lg font-semibold mb-4 border-b pb-2">Histórico de Medicações</h3>
                            <div id="medication-history-list" class="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
                                <p class="text-gray-500 text-center p-4">Carregando histórico...</p>
                            </div>
                        </div>
                    </div>
                `;
                animalManagementContent.innerHTML = content;

                const medicationSelect = document.getElementById('medication-select');
                const medicationUnitSpan = document.getElementById('medication-unit');
                const medicationQuantityInput = document.getElementById('medication-quantity-per-animal');
                const medicationCostEl = document.getElementById('medication-cost');
                const animalSelectionContainer = document.getElementById('animal-selection-container');
                const selectedAnimalsCountEl = document.getElementById('selected-animals-count');
                const totalQuantityNeededEl = document.getElementById('total-quantity-needed');
                const totalUnitEl = document.getElementById('total-unit');

                // CORREÇÃO: Aguardar carregamento completo dos dados antes de filtrar
                await new Promise(resolve => {
                    if (allSupplies && allSupplies.length >= 0) {
                        resolve();
                    } else {
                        const checkData = setInterval(() => {
                            if (allSupplies && allSupplies.length >= 0) {
                                clearInterval(checkData);
                                resolve();
                            }
                        }, 100);
                    }
                });

                // Carregar medicamentos do estoque - FILTRO CORRIGIDO
                const medications = allSupplies.filter(s => {
                    const isMedication = s.category === 'Medicamento' || s.category === 'Medicamentos' ||
                        s.category === 'Vacina' || s.category === 'Vacinas' ||
                        s.category === 'Vermífugo' || s.category === 'Vermífugos';
                    return isMedication && s.remaining > 0;
                });

                console.log('Medicamentos encontrados:', medications); // Debug

                if (medications.length === 0) {
                    // Verificar se existem medicamentos sem estoque
                    const allMedications = allSupplies.filter(s => {
                        return s.category === 'Medicamento' || s.category === 'Medicamentos' ||
                            s.category === 'Vacina' || s.category === 'Vacinas' ||
                            s.category === 'Vermífugo' || s.category === 'Vermífugos';
                    });

                    if (allMedications.length > 0) {
                        medicationSelect.innerHTML = '<option value="">Medicamentos em estoque esgotado - Reponha o estoque</option>';
                    } else {
                        medicationSelect.innerHTML = '<option value="">Adicione medicamentos ao estoque primeiro</option>';
                    }
                } else {
                    medicationSelect.innerHTML = '<option value="">Selecione um medicamento</option>';
                    medications.forEach(med => {
                        const option = document.createElement('option');
                        option.value = med.id;
                        const stockStatus = `${med.remaining.toFixed(2)} ${med.unit} disponíveis`;
                        option.textContent = `${med.name} (${stockStatus})`;
                        option.dataset.unit = med.unit;
                        option.dataset.cost = med.cost;
                        option.dataset.quantity = med.quantity;
                        option.dataset.remaining = med.remaining;
                        medicationSelect.appendChild(option);
                    });
                }

                // Carregar animais do tipo atual
                const animalsOfType = allAnimals.filter(a => a.animalType === type && a.status !== 'Vendido');

                if (animalsOfType.length === 0) {
                    animalSelectionContainer.innerHTML = '<p class="text-gray-500 text-sm">Nenhum animal encontrado para este tipo.</p>';
                } else {
                    animalSelectionContainer.innerHTML = animalsOfType.map(animal => `
                        <label class="flex items-center space-x-2 p-1 hover:bg-gray-50 rounded">
                            <input type="checkbox" class="animal-checkbox" value="${animal.id}" 
                                   data-name="${animal.name}" data-quantity="${animal.quantity || 1}">
                            <span class="text-sm">${animal.name} (${animal.subtype || type}) - Qtd: ${animal.quantity || 1}</span>
                        </label>
                    `).join('');
                }

                // Event listeners
                medicationSelect.addEventListener('change', (e) => {
                    const selectedOption = e.target.options[e.target.selectedIndex];
                    const unit = selectedOption.dataset.unit || '--';
                    medicationUnitSpan.textContent = unit;
                    totalUnitEl.textContent = unit;
                    calculateMedicationCost();
                });

                medicationQuantityInput.addEventListener('input', calculateMedicationCost);

                // Event listener para checkboxes de animais
                animalSelectionContainer.addEventListener('change', (e) => {
                    if (e.target.classList.contains('animal-checkbox')) {
                        updateSelectedAnimalsCount();
                        calculateMedicationCost();
                    }
                });

                function updateSelectedAnimalsCount() {
                    const selectedCheckboxes = animalSelectionContainer.querySelectorAll('.animal-checkbox:checked');
                    const totalAnimals = Array.from(selectedCheckboxes).reduce((sum, cb) => {
                        return sum + parseInt(cb.dataset.quantity || 1);
                    }, 0);
                    selectedAnimalsCountEl.textContent = totalAnimals;

                    // Atualizar quantidade total necessária
                    const quantityPerAnimal = parseLocaleNumber(medicationQuantityInput.value || '0');
                    const totalNeeded = quantityPerAnimal * totalAnimals;
                    totalQuantityNeededEl.textContent = totalNeeded.toFixed(2);
                }

                function calculateMedicationCost() {
                    const selectedOption = medicationSelect.options[medicationSelect.selectedIndex];
                    const selectedCheckboxes = animalSelectionContainer.querySelectorAll('.animal-checkbox:checked');

                    if (selectedOption && selectedOption.dataset.cost && selectedOption.dataset.quantity && selectedCheckboxes.length > 0) {
                        const totalCost = parseFloat(selectedOption.dataset.cost);
                        const totalQuantity = parseFloat(selectedOption.dataset.quantity);
                        const quantityPerAnimal = parseLocaleNumber(medicationQuantityInput.value || '0');
                        const totalAnimals = Array.from(selectedCheckboxes).reduce((sum, cb) => {
                            return sum + parseInt(cb.dataset.quantity || 1);
                        }, 0);
                        const totalQuantityNeeded = quantityPerAnimal * totalAnimals;

                        if (totalQuantity > 0 && totalQuantityNeeded > 0) {
                            const cost = (totalCost / totalQuantity) * totalQuantityNeeded;
                            medicationCostEl.textContent = formatCurrency(cost);
                            totalQuantityNeededEl.textContent = totalQuantityNeeded.toFixed(2);
                            return;
                        }
                    }
                    medicationCostEl.textContent = 'R$ 0,00';
                    totalQuantityNeededEl.textContent = '0';
                }

                document.getElementById('animal-medication-form').addEventListener('submit', handleMedicationSubmit);

                // Carregar histórico de medicações - FUNÇÃO CORRIGIDA
                const renderMedicationHistory = async () => {
                    const historyContainer = document.getElementById('medication-history-list');

                    try {
                        console.log('Carregando histórico para tipo:', type); // Debug

                        const q = query(
                            animalFinancialsCollectionRef,
                            where("animalType", "==", type),
                            where("category", "==", "Medicação")
                        );

                        const querySnapshot = await getDocs(q);
                        console.log('Documentos encontrados:', querySnapshot.size); // Debug

                        if (querySnapshot.empty) {
                            historyContainer.innerHTML = '<p class="text-gray-500 text-center p-4">Nenhum registro de medicação encontrado.</p>';
                            return;
                        }

                        let medications = [];
                        querySnapshot.forEach(doc => {
                            const data = doc.data();
                            medications.push({ id: doc.id, ...data });
                        });

                        // Ordenar por data (mais recente primeiro)
                        medications.sort((a, b) => new Date(b.date) - new Date(a.date));

                        historyContainer.innerHTML = '';

                        medications.forEach(med => {
                            const historyItem = document.createElement('div');
                            historyItem.className = 'bg-white p-3 rounded-md shadow-sm border';

                            const formattedDate = new Date(med.date + 'T00:00:00').toLocaleDateString('pt-BR');
                            const formattedNextDate = med.nextApplication ?
                                new Date(med.nextApplication + 'T00:00:00').toLocaleDateString('pt-BR') : 'Não agendada';

                            historyItem.innerHTML = `
                                <div class="flex justify-between items-start">
                                    <div class="flex-1">
                                        <p class="font-semibold text-gray-800">${med.description}</p>
                                        <p class="text-sm text-gray-600">Data: ${formattedDate}</p>
                                        ${med.selectedAnimals ? `<p class="text-sm text-gray-600">Animais: ${med.selectedAnimals}</p>` : ''}
                                        ${med.quantityPerAnimal ? `<p class="text-sm text-gray-600">Quantidade por animal: ${med.quantityPerAnimal}</p>` : ''}
                                        ${med.totalAnimals ? `<p class="text-sm text-gray-600">Total de animais: ${med.totalAnimals}</p>` : ''}
                                        <p class="text-sm text-gray-600">Próxima aplicação: ${formattedNextDate}</p>
                                        ${med.notes ? `<p class="text-sm mt-1 italic text-gray-500">${med.notes}</p>` : ''}
                                    </div>
                                    <span class="text-red-600 font-semibold">${formatCurrency(med.amount)}</span>
                                </div>
                            `;

                            historyContainer.appendChild(historyItem);
                        });

                    } catch (error) {
                        console.error('Erro ao carregar histórico de medicações:', error);
                        historyContainer.innerHTML = '<p class="text-red-500 text-center p-4">Erro ao carregar histórico. Verifique a conexão.</p>';
                    }
                };

                // Chamar a função para renderizar o histórico
                renderMedicationHistory();
            }

            async function loadMedicationHistory(animalType) {
                const historyListEl = document.getElementById('medication-history-list');
                const q = query(animalFinancialsCollectionRef, where("animalType", "==", animalType), where("category", "==", "Medicação"));

                try {
                    const querySnapshot = await getDocs(q);
                    if (querySnapshot.empty) {
                        historyListEl.innerHTML = '<p class="text-gray-500 text-center p-4">Nenhum registro de medicação encontrado.</p>';
                        return;
                    }

                    let history = querySnapshot.docs.map(doc => doc.data());
                    history.sort((a, b) => new Date(b.date) - new Date(a.date));

                    historyListEl.innerHTML = history.map(data => {
                        const nextApp = data.nextApplication ?
                            `<p class="text-xs mt-1 ${new Date(data.nextApplication) < new Date() ? 'text-red-500' : 'text-blue-500'}">Próxima aplicação: ${new Date(data.nextApplication + 'T00:00:00').toLocaleDateString('pt-BR')}</p>` : '';

                        return `
                            <div class="bg-white p-3 rounded-md shadow-sm">
                                <div class="flex justify-between items-start">
                                    <div>
                                        <p class="font-semibold">${data.description}</p>
                                        <p class="text-xs text-gray-500">Data: ${new Date(data.date + 'T00:00:00').toLocaleDateString('pt-BR')}</p>
                                        ${nextApp}
                                        ${data.notes ? `<p class="text-xs italic mt-1">${data.notes}</p>` : ''}
                                    </div>
                                    <strong class="text-red-600">${formatCurrency(data.amount)}</strong>
                                </div>
                            </div>
                        `;
                    }).join('');
                } catch (error) {
                    console.error("Error loading medication history: ", error);
                    historyListEl.innerHTML = '<p class="text-red-500 text-center p-4">Erro ao carregar histórico.</p>';
                }
            }

            async function handleMedicationSubmit(e) {
                e.preventDefault();
                const form = e.target;
                const medicationId = form.querySelector('#medication-select').value;

                // Validação extra: verificar se o medicamento ainda existe no estoque
                const medication = allSupplies.find(s => s.id === medicationId);
                if (!medication) {
                    showToast('Erro: Medicamento não encontrado no estoque. Atualize a página e tente novamente.');
                    return;
                }

                if (medication.remaining <= 0) {
                    showToast('Erro: Medicamento sem estoque disponível.');
                    return;
                }

                const quantityPerAnimal = parseLocaleNumber(form.querySelector('#medication-quantity-per-animal').value);
                const date = form.querySelector('#medication-date').value;
                const notes = form.querySelector('#medication-notes').value;
                const nextApplication = form.querySelector('#next-application').value;

                // Obter animais selecionados
                const selectedCheckboxes = form.querySelectorAll('.animal-checkbox:checked');

                if (!medicationId || !quantityPerAnimal || quantityPerAnimal <= 0 || !date || selectedCheckboxes.length === 0) {
                    showToast('Por favor, preencha todos os campos obrigatórios e selecione pelo menos um animal.');
                    return;
                }

                // Calcular quantidade total necessária
                const totalAnimals = Array.from(selectedCheckboxes).reduce((sum, cb) => sum + parseInt(cb.dataset.quantity), 0);
                const totalQuantityNeeded = quantityPerAnimal * totalAnimals;

                if (totalQuantityNeeded > medication.remaining) {
                    showToast(`Erro: Estoque insuficiente. Necessário: ${totalQuantityNeeded.toFixed(2)} ${medication.unit}. Disponível: ${medication.remaining.toFixed(2)} ${medication.unit}.`);
                    return;
                }

                const costPerUnit = medication.quantity > 0 ? medication.cost / medication.quantity : 0;
                const expenseAmount = costPerUnit * totalQuantityNeeded;

                // Criar lista de animais selecionados para registro
                const selectedAnimalsInfo = Array.from(selectedCheckboxes).map(cb => `${cb.dataset.name} (${cb.dataset.quantity})`).join(', ');
                const selectedAnimalIds = Array.from(selectedCheckboxes).map(cb => cb.value);

                const medicationDocRef = doc(suppliesCollectionRef, medicationId);

                try {
                    await runTransaction(db, async (transaction) => {
                        const medicationDoc = await transaction.get(medicationDocRef);
                        if (!medicationDoc.exists()) {
                            throw new Error("Medicamento não encontrado no estoque.");
                        }

                        const newRemaining = medicationDoc.data().remaining - totalQuantityNeeded;
                        if (newRemaining < 0) {
                            throw new Error("Estoque insuficiente durante a transação.");
                        }

                        // 1. Update stock
                        transaction.update(medicationDocRef, { remaining: newRemaining });

                        // 2. Add to general cashbook
                        const generalTransactionRef = doc(collection(db, `users/${userId}/transacoes`));
                        const generalTransactionData = {
                            description: `Aplicação de ${medication.name} para ${totalAnimals} ${currentAnimalType}(s): ${selectedAnimalsInfo}`,
                            amount: expenseAmount,
                            type: 'despesa',
                            category: 'Medicação Animal',
                            date: date,
                            relatedAnimalType: currentAnimalType,
                            relatedSupplyId: medicationId,
                            selectedAnimals: selectedAnimalsInfo,
                            selectedAnimalIds: selectedAnimalIds
                        };
                        transaction.set(generalTransactionRef, generalTransactionData);

                        // 3. Add to animal-specific financials
                        const animalFinancialsDocRef = doc(animalFinancialsCollectionRef);
                        const animalFinancialData = {
                            description: `Medicação: ${medication.name} (${totalQuantityNeeded.toFixed(2)} ${medication.unit} total)`,
                            amount: expenseAmount,
                            type: 'despesa',
                            category: 'Medicação',
                            date: date,
                            animalType: currentAnimalType,
                            relatedSupplyId: medicationId,
                            notes: notes,
                            nextApplication: nextApplication || null,
                            selectedAnimals: selectedAnimalsInfo,
                            selectedAnimalIds: selectedAnimalIds,
                            quantityPerAnimal: quantityPerAnimal,
                            totalAnimals: totalAnimals
                        };
                        transaction.set(animalFinancialsDocRef, animalFinancialData);

                        // 4. If there's a next application date, add to scheduled applications with specific animals
                        if (nextApplication) {
                            const scheduledAppRef = doc(collection(db, `users/${userId}/aplicacoesAgendadas`));
                            const scheduledAppData = {
                                title: `Aplicação de ${medication.name}`,
                                date: nextApplication,
                                type: 'medication',
                                animalType: currentAnimalType,
                                selectedAnimals: selectedAnimalsInfo,
                                selectedAnimalIds: selectedAnimalIds,
                                medicationId: medicationId,
                                quantityPerAnimal: quantityPerAnimal,
                                unit: medication.unit || 'mL',
                                notes: notes,
                                status: 'pending',
                                createdAt: serverTimestamp()
                            };
                            transaction.set(scheduledAppRef, scheduledAppData);
                        }
                    });

                    showToast(`Medicação aplicada com sucesso em ${totalAnimals} animal(is)!`);
                    form.reset();
                    document.getElementById('medication-unit').textContent = '--';
                    document.getElementById('medication-cost').textContent = 'R$ 0,00';
                    document.getElementById('selected-animals-count').textContent = '0';
                    document.getElementById('total-quantity-needed').textContent = '0';
                    renderAnimalTab('medication');

                } catch (error) {
                    console.error("Erro ao registrar aplicação de medicamento:", error);
                    showToast(`Erro: ${error.message}`);
                }
            }

            async function renderAnimalFinancialsTab(type) {
                const content = `
                    <div id="animal-financials-content">
                        <div class="text-center p-8"><i class="fas fa-spinner fa-spin fa-2x text-blue-500"></i><p class="mt-2">A calcular finanças...</p></div>
                    </div>
                `;
                animalManagementContent.innerHTML = content;

                const q = query(animalFinancialsCollectionRef, where("animalType", "==", type));

                try {
                    const querySnapshot = await getDocs(q);
                    let transactions = querySnapshot.docs.map(doc => doc.data());

                    transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

                    const totalRevenue = transactions.filter(t => t.type === 'receita').reduce((sum, t) => sum + t.amount, 0);
                    const totalExpense = transactions.filter(t => t.type === 'despesa').reduce((sum, t) => sum + t.amount, 0);
                    const balance = totalRevenue - totalExpense;

                    const transactionListHTML = transactions.length > 0 ? transactions.map(t => {
                        const isRevenue = t.type === 'receita';
                        return `
                            <div class="bg-gray-50 p-3 rounded-lg flex justify-between items-center">
                                <div>
                                    <p class="font-semibold">${t.description} <span class="text-xs text-gray-500 font-normal">(${t.category})</span></p>
                                    <p class="text-xs text-gray-500">${new Date(t.date + 'T00:00:00').toLocaleDateString('pt-BR')}</p>
                                </div>
                                <strong class="${isRevenue ? 'text-green-600' : 'text-red-600'}">${isRevenue ? '+' : '-'} ${formatCurrency(t.amount)}</strong>
                            </div>
                        `;
                    }).join('') : '<p class="text-gray-500 text-center p-4">Nenhuma transação financeira para este grupo.</p>';

                    const finalContent = `
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                            <div class="bg-green-100 p-4 rounded-lg text-center"><p class="text-sm text-green-800">Receita Total</p><p class="text-2xl font-bold text-green-800">${formatCurrency(totalRevenue)}</p></div>
                            <div class="bg-red-100 p-4 rounded-lg text-center"><p class="text-sm text-red-800">Despesa Total</p><p class="text-2xl font-bold text-red-800">${formatCurrency(totalExpense)}</p></div>
                            <div class="bg-blue-100 p-4 rounded-lg text-center"><p class="text-sm text-blue-800">Saldo</p><p class="text-2xl font-bold ${balance >= 0 ? 'text-blue-800' : 'text-red-800'}">${formatCurrency(balance)}</p></div>
                        </div>
                        <h3 class="text-lg font-semibold mb-4 border-b pb-2">Extrato Financeiro (${type})</h3>
                        <div class="space-y-2 max-h-[50vh] overflow-y-auto pr-2">${transactionListHTML}</div>
                    `;
                    document.getElementById('animal-financials-content').innerHTML = finalContent;
                } catch (error) {
                    console.error("Error loading animal financials: ", error);
                    document.getElementById('animal-financials-content').innerHTML = '<p class="text-red-500 text-center p-4">Erro ao carregar dados financeiros.</p>';
                }
            }

            async function handleFeedLogSubmit(e) {
                e.preventDefault();
                const form = e.target;
                const feedSupplyId = form.querySelector('#feed-select').value;
                const quantityConsumed = parseLocaleNumber(form.querySelector('#feed-quantity').value);
                const date = form.querySelector('#feed-date').value;

                if (!feedSupplyId || !quantityConsumed || quantityConsumed <= 0 || !date) {
                    showToast('Por favor, preencha todos os campos corretamente.');
                    return;
                }

                const supply = allSupplies.find(s => s.id === feedSupplyId);
                if (!supply) {
                    showToast('Erro: Ração não encontrada no estoque.');
                    return;
                }

                if (quantityConsumed > supply.remaining) {
                    showToast(`Erro: Estoque insuficiente. Apenas ${supply.remaining.toFixed(2)} ${supply.unit} disponíveis.`);
                    return;
                }

                const costPerUnit = supply.quantity > 0 ? supply.cost / supply.quantity : 0;
                const expenseAmount = costPerUnit * quantityConsumed;

                const supplyDocRef = doc(suppliesCollectionRef, feedSupplyId);

                try {
                    await runTransaction(db, async (transaction) => {
                        const supplyDoc = await transaction.get(supplyDocRef);
                        if (!supplyDoc.exists()) {
                            throw new Error("Ração não encontrada no estoque.");
                        }

                        const newRemaining = supplyDoc.data().remaining - quantityConsumed;
                        if (newRemaining < 0) {
                            throw new Error("Estoque insuficiente durante a transação.");
                        }

                        // 1. Update stock
                        transaction.update(supplyDocRef, { remaining: newRemaining });

                        // 2. Add to general cashbook
                        const generalTransactionRef = doc(collection(db, `users/${userId}/transacoes`));
                        const generalTransactionData = {
                            description: `Consumo de ração (${supply.name}) para ${currentAnimalType}`,
                            amount: expenseAmount,
                            type: 'despesa',
                            category: 'Alimentação Animal',
                            date: date,
                            relatedAnimalType: currentAnimalType,
                            relatedSupplyId: feedSupplyId
                        };
                        transaction.set(generalTransactionRef, generalTransactionData);

                        // 3. Add to animal-specific financials
                        const animalFinancialsDocRef = doc(animalFinancialsCollectionRef);
                        const animalFinancialData = {
                            description: `Consumo: ${supply.name} (${quantityConsumed.toFixed(2)} ${supply.unit})`,
                            amount: expenseAmount,
                            type: 'despesa',
                            category: 'Alimentação',
                            date: date,
                            animalType: currentAnimalType,
                            relatedSupplyId: feedSupplyId
                        };
                        transaction.set(animalFinancialsDocRef, animalFinancialData);
                    });

                    showToast('Consumo de ração registado com sucesso!');
                    form.reset();
                    document.getElementById('feed-unit').textContent = '--';
                    renderAnimalTab('feeding');

                } catch (error) {
                    console.error("Erro ao registrar consumo de ração:", error);
                    showToast(`Erro: ${error.message}`);
                }
            }

            function handleDeleteAnimal(id) { showConfirm('Confirmar Exclusão', 'Tem a certeza que quer apagar este animal/lote?', async () => { try { await deleteDoc(doc(animalsCollectionRef, id)); showToast('Animal apagado!'); } catch (error) { console.error("Erro ao apagar animal:", error); showToast('Erro ao apagar.'); } }); }

            // --- UNIFIED: Animal Purchase Logic ---
            function openAddAnimalModal(type = '') {
                // Ocultar o modal de gestor de animais
                animalDashboardModal.classList.add('modal-hidden');

                // Prevenir scroll do body
                document.body.classList.add('modal-open');

                addAnimalForm.reset();
                const typeSelect = document.getElementById('add-animal-type');
                typeSelect.value = type;
                typeSelect.disabled = !!type; // Disable if a type is passed from the manager
                updateAnimalSubtypeOptions();
                addAnimalModal.style.display = 'flex';
            }

            function closeAddAnimalModal() {
                addAnimalModal.style.display = 'none';

                // Restaurar o modal de gestor de animais
                animalDashboardModal.classList.remove('modal-hidden');

                // Restaurar scroll do body
                document.body.classList.remove('modal-open');
            }
            function updateAnimalSubtypeOptions() {
                const type = document.getElementById('add-animal-type').value;
                const container = document.getElementById('add-animal-subtype-container');
                const select = document.getElementById('add-animal-subtype');
                const subtypes = {
                    cattle: { 'Bezerro(a)': 'Bezerro(a)', 'Novilha': 'Novilha', 'Garrote': 'Garrote', 'Vaca': 'Vaca', 'Touro': 'Touro', 'Outros': 'Outros' },
                    chickens: { 'Pintinho': 'Pintinho', 'Frango': 'Frango', 'Galinha Poedeira': 'Galinha Poedeira', 'Galinha Caipira': 'Galinha Caipira', 'Outros': 'Outros' },
                    pigs: { 'Leitão': 'Leitão', 'Porco de Engorda': 'Porco de Engorda', 'Matriz': 'Matriz', 'Reprodutor': 'Reprodutor', 'Outros': 'Outros' },
                    goats: { 'Cabrito(a)': 'Cabrito(a)', 'Bode': 'Bode', 'Cabra': 'Cabra', 'Outros': 'Outros' },
                    sheep: { 'Cordeiro(a)': 'Cordeiro(a)', 'Ovelha': 'Ovelha', 'Carneiro': 'Carneiro', 'Outros': 'Outros' },
                    fish: { 'Alevino': 'Alevino', 'Juvenil': 'Juvenil', 'Matriz': 'Matriz', 'Outros': 'Outros' },
                    equine: { 'Potro(a)': 'Potro(a)', 'Égua': 'Égua', 'Garanhão': 'Garanhão', 'Outros': 'Outros' }
                };

                if (subtypes[type]) {
                    select.innerHTML = Object.entries(subtypes[type]).map(([value, text]) => `<option value="${value}">${text}</option>`).join('');
                    container.classList.remove('hidden');
                } else {
                    container.classList.add('hidden');
                }
            }
            async function handleAddAnimalSubmit(e) {
                e.preventDefault();
                const type = document.getElementById('add-animal-type').value;
                const subtype = document.getElementById('add-animal-subtype').value;
                const name = document.getElementById('add-animal-name').value;
                const breed = document.getElementById('add-animal-breed').value;
                const quantity = Number(document.getElementById('add-animal-quantity').value);
                const cost = parseLocaleNumber(document.getElementById('add-animal-cost').value);
                const date = document.getElementById('add-animal-date').value;

                if (!type || !name || !quantity || quantity <= 0 || !cost || cost <= 0 || !date) {
                    showToast('Preencha todos os campos obrigatórios com valores válidos.');
                    return;
                }

                const batch = writeBatch(db);

                // 1. Create animal entry
                const animalDocRef = doc(collection(db, `users/${userId}/animais`));
                batch.set(animalDocRef, {
                    animalType: type,
                    subtype: subtype || null,
                    breed: breed || 'SRD',
                    name: name,
                    quantity: quantity,
                    status: 'Ativo',
                    dob: date, // Using purchase date as acquisition date
                });

                // 2. Create cashbook transaction
                const transactionDocRef = doc(collection(db, `users/${userId}/transacoes`));
                batch.set(transactionDocRef, {
                    description: `Compra de animal: ${name}`,
                    amount: cost,
                    type: 'despesa',
                    category: 'Compra de Animais',
                    date: date,
                    relatedAnimalType: type
                });

                // 3. Create animal financial transaction
                const animalFinancialsRef = doc(animalFinancialsCollectionRef);
                batch.set(animalFinancialsRef, {
                    description: `Compra de ${quantity} ${subtype || type} (${name})`,
                    amount: cost,
                    type: 'despesa',
                    category: 'Aquisição',
                    date: date,
                    animalType: type
                });

                try {
                    await batch.commit();
                    showToast('Compra de animal registada com sucesso!');
                    closeAddAnimalModal();
                    if (suppliesModal.style.display === 'flex') {
                        closeSuppliesModal();
                    }
                    if (animalDashboardModal.style.display === 'flex') {
                        currentAnimalType = type;
                        document.querySelector(`.animal-type-btn[data-type="${type}"]`).classList.add('active');
                        animalPrompt.classList.add('hidden');
                        animalManagementContentWrapper.classList.remove('hidden');
                        switchAnimalTab('herd');
                    }
                } catch (error) {
                    console.error("Erro ao registrar compra de animal:", error);
                    showToast('Erro ao registrar a compra.');
                }
            }

            // --- NEW: SALES MANAGEMENT ---
            function openSalesModal() {
                salesModal.style.display = 'flex';
                saleForm.classList.add('hidden');
                document.getElementById('sale-prompt').classList.remove('hidden');
                document.querySelectorAll('.sale-type-btn').forEach(b => b.classList.remove('active'));
                saleForm.reset();
            }

            function closeSalesModal() {
                salesModal.style.display = 'none';
            }

            function switchSaleType(type) {
                document.querySelectorAll('.sale-type-btn').forEach(b => b.classList.remove('active'));
                document.querySelector(`.sale-type-btn[data-type="${type}"]`).classList.add('active');

                saleForm.reset();
                saleForm.classList.remove('hidden');
                document.getElementById('sale-prompt').classList.add('hidden');
                document.getElementById('sale-type').value = type;

                const allFields = ['sale-harvest-fields', 'sale-animal-fields', 'sale-product-fields', 'sale-other-fields'];
                allFields.forEach(id => document.getElementById(id).classList.add('hidden'));

                const allSelects = ['sale-harvest-select', 'sale-animal-select', 'sale-product-select', 'sale-description'];
                allSelects.forEach(id => document.getElementById(id).required = false);

                if (type === 'harvest') {
                    document.getElementById('sale-harvest-fields').classList.remove('hidden');
                    document.getElementById('sale-harvest-select').required = true;
                    populateHarvestForSale();
                } else if (type === 'live_animal' || type === 'slaughtered_animal') {
                    document.getElementById('sale-animal-fields').classList.remove('hidden');
                    document.getElementById('sale-animal-select').required = true;
                    populateAnimalsForSale();
                } else if (type === 'animal_product') {
                    document.getElementById('sale-product-fields').classList.remove('hidden');
                    document.getElementById('sale-product-select').required = true;
                    populateProductsForSale();
                } else { // other
                    document.getElementById('sale-other-fields').classList.remove('hidden');
                    document.getElementById('sale-description').required = true;
                }
            }

            function populateHarvestForSale() {
                const select = document.getElementById('sale-harvest-select');
                select.innerHTML = '<option value="">Selecione uma colheita</option>';
                const availableHarvests = allPlantings.filter(p => p.finalYieldQuantity || p.finalYield);

                if (availableHarvests.length === 0) {
                    select.innerHTML = '<option value="">Nenhuma colheita finalizada</option>';
                    return;
                }

                availableHarvests.forEach(p => {
                    const totalSold = (p.salesHistory || []).reduce((sum, sale) => sum + parseLocaleNumber(String(sale.quantity)), 0);
                    
                    // Suporte para ambos os formatos (novo e antigo)
                    let totalYield, unit;
                    if (p.finalYieldQuantity && p.finalYieldUnit) {
                        totalYield = p.finalYieldQuantity;
                        unit = p.finalYieldUnit;
                    } else if (p.finalYield) {
                        const [yieldStr] = (p.finalYield || '0').split(' ');
                        totalYield = parseLocaleNumber(yieldStr);
                        unit = 'un'; // Unidade padrão para dados antigos
                    }
                    
                    const remaining = totalYield - totalSold;

                    if (remaining > 0) {
                        const option = document.createElement('option');
                        option.value = p.id;
                        option.textContent = `${p.cropName} - ${p.variety || 'N/A'}`;
                        option.dataset.unit = unit;
                        select.appendChild(option);
                    }
                });
                updateHarvestSaleInfo();
            }

            function updateHarvestSaleInfo() {
                const select = document.getElementById('sale-harvest-select');
                const infoDiv = document.getElementById('harvest-yield-info');
                const plantingId = select.value;

                if (!plantingId) {
                    infoDiv.textContent = 'Selecione uma colheita';
                    return;
                }

                const planting = allPlantings.find(p => p.id === plantingId);
                const totalSold = (planting.salesHistory || []).reduce((sum, sale) => sum + parseLocaleNumber(String(sale.quantity)), 0);
                const [totalYield, unit] = (planting.finalYield || '0').split(' ');
                const remaining = parseLocaleNumber(totalYield) - totalSold;

                infoDiv.innerHTML = `Produção Total: <strong>${totalYield} ${unit || ''}</strong>. Disponível para venda: <strong>${remaining.toFixed(2)} ${unit || ''}</strong>`;
            }

            function populateAnimalsForSale() {
                const select = document.getElementById('sale-animal-select');
                select.innerHTML = '<option value="">Selecione um animal/lote</option>';
                const availableAnimals = allAnimals.filter(a => a.status !== 'Vendido');

                if (availableAnimals.length === 0) {
                    select.innerHTML = '<option value="">Nenhum animal disponível</option>';
                    return;
                }

                availableAnimals.forEach(a => {
                    const option = document.createElement('option');
                    option.value = a.id;
                    option.textContent = `${a.name} (${a.subtype || a.animalType})`;
                    select.appendChild(option);
                });
            }

            function populateProductsForSale() {
                const select = document.getElementById('sale-product-select');
                select.innerHTML = '<option value="">Selecione um produto</option>';
                const products = [
                    { value: 'eggs', text: 'Ovos (unidade)' },
                    { value: 'milk', text: 'Leite (litro)' },
                    { value: 'cattle_calf', text: 'Bezerro(a)' },
                    { value: 'pigs_piglet', text: 'Leitão' },
                    { value: 'goats_kid', text: 'Cabrito(a)' },
                    { value: 'sheep_lamb', text: 'Cordeiro(a)' },
                ];
                products.forEach(p => {
                    const option = document.createElement('option');
                    option.value = p.value;
                    option.textContent = p.text;
                    select.appendChild(option);
                });
            }

            async function handleSaleFormSubmit(e) {
                e.preventDefault();
                const type = document.getElementById('sale-type').value;
                const quantity = parseLocaleNumber(document.getElementById('sale-quantity').value);
                const price = parseLocaleNumber(document.getElementById('sale-price').value);
                const date = document.getElementById('sale-date').value;
                const notes = document.getElementById('sale-notes').value;

                if (!type || !quantity || quantity <= 0 || !price || price <= 0 || !date) {
                    showToast('Preencha todos os campos obrigatórios com valores válidos.');
                    return;
                }

                const batch = writeBatch(db);
                let description = '';
                let category = '';
                let animalTypeForFinancials = null;

                if (type === 'harvest') {
                    const plantingId = document.getElementById('sale-harvest-select').value;
                    if (!plantingId) { showToast('Selecione uma colheita para vender.'); return; }

                    const planting = allPlantings.find(p => p.id === plantingId);
                    const sourceDocRef = doc(plantingsCollectionRef, plantingId);
                    
                    // Obter a unidade da colheita
                    const unit = planting.finalYieldUnit || document.getElementById('sale-quantity-unit-display').textContent;

                    const totalSold = (planting.salesHistory || []).reduce((sum, sale) => sum + parseLocaleNumber(String(sale.quantity)), 0);
                    
                    // Suporte para ambos os formatos
                    let totalYield;
                    if (planting.finalYieldQuantity) {
                        totalYield = planting.finalYieldQuantity;
                    } else if (planting.finalYield) {
                        const [yieldStr] = (planting.finalYield || '0').split(' ');
                        totalYield = parseLocaleNumber(yieldStr);
                    }
                    
                    const remaining = totalYield - totalSold;
                    if (quantity > remaining) {
                        showToast(`Quantidade disponível: ${remaining} ${unit}`);
                        return;
                    }

                    const newSale = {
                        quantity: quantity,
                        unit: unit, // Salvar a unidade
                        price: price,
                        date: date,
                        notes: notes
                    };
                    
                    const updatedSalesHistory = [...(planting.salesHistory || []), newSale];
                    batch.update(sourceDocRef, { salesHistory: updatedSalesHistory });
                    
                    description = `Venda de ${planting.cropName} - ${quantity} ${unit}`;
                    category = 'Vendas de Colheitas';
                } else if (type === 'live_animal' || type === 'slaughtered_animal') {
                    const animalId = document.getElementById('sale-animal-select').value;
                    if (!animalId) { showToast('Selecione um animal para vender.'); return; }

                    const animal = allAnimals.find(a => a.id === animalId);
                    const sourceDocRef = doc(animalsCollectionRef, animalId);
                    animalTypeForFinancials = animal.animalType;

                    if (quantity > animal.quantity) {
                        showToast(`Quantidade de venda excede o disponível no lote (${animal.quantity}).`);
                        return;
                    }

                    const remainingQuantity = animal.quantity - quantity;
                    if (remainingQuantity > 0) {
                        batch.update(sourceDocRef, { quantity: remainingQuantity });
                    } else {
                        batch.update(sourceDocRef, { status: 'Vendido' });
                    }

                    description = type === 'live_animal' ? `Venda de animal vivo: ${animal.name}` : `Venda de animal abatido: ${animal.name}`;
                    category = 'Venda de Animais';
                } else if (type === 'animal_product') {
                    const productType = document.getElementById('sale-product-select').value;
                    if (!productType) { showToast('Selecione um produto animal para vender.'); return; }

                    const productMap = {
                        eggs: { desc: `Venda de ${quantity} ovos`, cat: 'Venda de Ovos', animalType: 'chickens' },
                        milk: { desc: `Venda de ${quantity}L de leite`, cat: 'Venda de Leite', animalType: 'cattle' },
                        cattle_calf: { desc: `Venda de ${quantity} bezerro(s)`, cat: 'Venda de Animais', animalType: 'cattle' },
                        pigs_piglet: { desc: `Venda de ${quantity} leitão(ões)`, cat: 'Venda de Animais', animalType: 'pigs' },
                        goats_kid: { desc: `Venda de ${quantity} cabrito(s)`, cat: 'Venda de Animais', animalType: 'goats' },
                        sheep_lamb: { desc: `Venda de ${quantity} cordeiro(s)`, cat: 'Venda de Animais', animalType: 'sheep' },
                    };
                    description = productMap[productType].desc;
                    category = productMap[productType].cat;
                    animalTypeForFinancials = productMap[productType].animalType;
                } else if (type === 'other') {
                    description = document.getElementById('sale-description').value;
                    if (!description) { showToast('Forneça uma descrição para a venda.'); return; }
                    category = 'Outras Vendas';
                }

                // Add revenue to general cashbook
                const transactionRef = doc(transactionsCollectionRef);
                batch.set(transactionRef, { description, category, amount: price, type: 'receita', date, notes });

                // Add revenue to animal-specific financials if applicable
                if (animalTypeForFinancials) {
                    const animalFinancialsRef = doc(animalFinancialsCollectionRef);
                    batch.set(animalFinancialsRef, {
                        description,
                        amount: price,
                        type: 'receita',
                        category: 'Venda',
                        date,
                        animalType: animalTypeForFinancials
                    });
                }

                try {
                    await batch.commit();
                    showToast('Venda registada com sucesso!');
                    closeSalesModal();
                } catch (error) {
                    console.error("Erro ao registrar venda:", error);
                    showToast('Ocorreu um erro ao registrar a venda.');
                }
            }

            // --- AUTHENTICATION EVENT LISTENERS ---
            // Navegação entre formulários
            document.getElementById('show-register').addEventListener('click', showRegisterForm);
            document.getElementById('show-login').addEventListener('click', showLoginForm);
            document.getElementById('forgot-password-btn').addEventListener('click', showForgotPasswordForm);
            document.getElementById('back-to-login').addEventListener('click', showLoginForm);

            // Submissão dos formulários
            document.getElementById('login-form-element').addEventListener('submit', handleLogin);
            document.getElementById('register-form-element').addEventListener('submit', handleRegister);
            document.getElementById('forgot-password-form-element').addEventListener('submit', handleForgotPassword);

            // Logout
            document.getElementById('logout-btn').addEventListener('click', handleLogout);

            // Chamar a função na inicialização
            displayDailyTip();

            // Atualizar à meia-noite
            setInterval(() => {
                const now = new Date();
                if (now.getHours() === 0 && now.getMinutes() === 0) {
                    displayDailyTip();
                }
            }, 60000); // Verificar a cada minuto

            // Start the application
            main();
        });

// Premium button functionality
document.addEventListener('DOMContentLoaded', function() {
    const premiumBtn = document.getElementById('premium-btn');
    if (premiumBtn) {
        premiumBtn.addEventListener('click', function() {
            window.location.href = 'premium.html';
        });
    }

    const propertyBtn = document.getElementById('manage-property-btn');
    if (propertyBtn) {
        propertyBtn.addEventListener('click', function() {
            window.location.href = 'propriedade.html';
        });
    }
});