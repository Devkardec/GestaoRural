// propriedade.js - Módulo de dados da propriedade com Firebase integrado

// Importações do Firebase (versão 11.6.1 para consistência)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Configuração do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAtwYV-toZBKbSwg2PE4AhTsJ47AaPKD4Q",
  authDomain: "agrocultiveapps.firebaseapp.com",
  projectId: "agrocultiveapps",
  storageBucket: "agrocultiveapps.appspot.com",
  messagingSenderId: "1095510209034",
  appId: "1:1095510209034:web:9dac124513d1eb584a25f3"
};

// Inicialização do Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Seleciona elementos do DOM
const propertyForm = document.getElementById('property-form');
const loadingContainer = document.getElementById('loading-indicator');

console.log('[DEBUG] Script propriedade.js iniciado.');
console.log('[DEBUG] Elementos DOM encontrados:', {
    propertyForm: !!propertyForm,
    loadingContainer: !!loadingContainer
});

// Função principal de inicialização
async function initializePropertyModule() {
    try {
        console.log('[DEBUG] Inicializando módulo de propriedade...');
        console.log('[DEBUG] Configurando listener de autenticação...');
        
        // Verificação de autenticação
        onAuthStateChanged(auth, async (user) => {
            console.log('[DEBUG] onAuthStateChanged disparado.');
            
            if (user) {
                // O usuário está logado
                console.log('[DEBUG] Usuário está LOGADO. UID:', user.uid);
                
                // Carrega o logo salvo
                await loadAndDisplayLogo(user.uid);
                
                // Mostra o formulário e esconde o loading
                if (loadingContainer) {
                    loadingContainer.style.display = 'none';
                }
                if (propertyForm) {
                    propertyForm.style.display = 'block';
                }
                
                console.log('[DEBUG] Tentando buscar dados do Firestore...');
                
                try {
                    // CAMINHO CORRIGIDO: users/${user.uid}/propriedade_info/dados
                    const docRef = doc(db, "users", user.uid, "propriedade_info", "dados");
                    const docSnap = await getDoc(docRef);
                    
                    if (docSnap.exists()) {
                        console.log('[DEBUG] Documento encontrado no Firestore:', docSnap.data());
                        const data = docSnap.data();
                        
                        // Preenche o formulário com os dados encontrados
                        const fields = {
                            'property-name': data.name || '',
                            'property-doc': data.doc || '',
                            'property-address': data.address || '',
                            'property-city': data.city || '',
                            'property-phone': data.phone || '',
                            'property-email': data.email || ''
                        };
                        
                        Object.entries(fields).forEach(([fieldId, value]) => {
                            const element = document.getElementById(fieldId);
                            if (element) {
                                element.value = value;
                                console.log(`[DEBUG] Campo ${fieldId} preenchido com:`, value);
                            }
                        });
                        
                    } else {
                        console.log('[DEBUG] Nenhum documento encontrado para este usuário. Formulário em branco pronto para ser preenchido.');
                    }
                } catch (firestoreError) {
                    console.error('[DEBUG] Erro ao buscar dados do Firestore:', firestoreError);
                    showToast('Erro ao carregar dados da propriedade.', 'error');
                }
                
            } else {
                // O usuário não está logado
                console.error('[DEBUG] ERRO: Usuário NÃO está logado.');
                if (loadingContainer) {
                    loadingContainer.innerHTML = '<div class="text-center"><h2 class="text-xl font-bold text-red-600 mb-4">Erro de Autenticação</h2><p class="text-gray-600">Você precisa estar logado para acessar esta página.</p><a href="index.html" class="mt-4 inline-block bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 transition-colors">Voltar ao Login</a></div>';
                }
            }
        });
        
        // Configura o listener do formulário
        if (propertyForm) {
            propertyForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const user = auth.currentUser;
                console.log('[DEBUG] Tentativa de salvar dados. Usuário atual:', user?.uid);
                
                if (user) {
                    try {
                        console.log('[DEBUG] Coletando dados do formulário...');
                        
                        const dataToSave = {
                            name: document.getElementById('property-name')?.value || '',
                            doc: document.getElementById('property-doc')?.value || '',
                            address: document.getElementById('property-address')?.value || '',
                            city: document.getElementById('property-city')?.value || '',
                            phone: document.getElementById('property-phone')?.value || '',
                            email: document.getElementById('property-email')?.value || '',
                            updatedAt: new Date().toISOString()
                        };
                        
                        console.log('[DEBUG] Dados a serem salvos:', dataToSave);
                        
                        // Mostra loading no botão
                        const saveBtn = document.getElementById('save-btn');
                        const saveBtnText = saveBtn?.querySelector('.save-btn-text');
                        const saveBtnSpinner = saveBtn?.querySelector('.save-btn-spinner');
                        
                        if (saveBtnText) saveBtnText.textContent = 'Salvando...';
                        if (saveBtnSpinner) saveBtnSpinner.classList.remove('hidden');
                        if (saveBtn) saveBtn.disabled = true;
                        
                        // CAMINHO CORRIGIDO: users/${user.uid}/propriedade_info/dados
                        await setDoc(doc(db, "users", user.uid, "propriedade_info", "dados"), dataToSave, { merge: true });
                        
                        console.log('[DEBUG] Dados salvos com sucesso!');
                        showToast('Dados salvos com sucesso!', 'success');
                        
                    } catch (saveError) {
                        console.error('[DEBUG] Erro ao salvar dados:', saveError);
                        showToast('Erro ao salvar dados. Tente novamente.', 'error');
                    } finally {
                        // Restaura o botão
                        const saveBtn = document.getElementById('save-btn');
                        const saveBtnText = saveBtn?.querySelector('.save-btn-text');
                        const saveBtnSpinner = saveBtn?.querySelector('.save-btn-spinner');
                        
                        if (saveBtnText) saveBtnText.textContent = 'Salvar Informações';
                        if (saveBtnSpinner) saveBtnSpinner.classList.add('hidden');
                        if (saveBtn) saveBtn.disabled = false;
                    }
                } else {
                    console.error('[DEBUG] ERRO: Tentativa de salvar dados sem usuário logado.');
                    showToast('Erro: Você não está logado!', 'error');
                }
            });
        }
        
    } catch (error) {
        console.error('[DEBUG] Erro na inicialização do módulo:', error);
        if (loadingContainer) {
            loadingContainer.innerHTML = '<div class="text-center"><h2 class="text-xl font-bold text-red-600 mb-4">Erro de Inicialização</h2><p class="text-gray-600">Erro ao carregar o módulo de propriedade.</p></div>';
        }
    }
}

// Função para mostrar toast notifications
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');
    
    if (toast && toastMessage) {
        toastMessage.textContent = message;
        
        // Define a cor baseada no tipo
        toast.className = `fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg transform transition-transform duration-300 z-50 ${
            type === 'error' ? 'bg-red-600' : 'bg-green-600'
        } text-white`;
        
        // Mostra o toast
        toast.style.transform = 'translateX(0)';
        
        // Esconde após 3 segundos
        setTimeout(() => {
            toast.style.transform = 'translateX(100%)';
        }, 3000);
    }
    
    console.log(`[DEBUG] Toast ${type}:`, message);
}

// Configura preview de logo
function setupLogoPreview() {
    const logoUpload = document.getElementById('logo-upload');
    const logoPreview = document.getElementById('logo-preview');
    
    if (logoUpload && logoPreview) {
        logoUpload.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                const user = auth.currentUser;
                if (user) {
                    try {
                        // Preview imediato
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            logoPreview.innerHTML = `<img src="${e.target.result}" alt="Logo Preview" class="w-full h-full object-cover rounded-lg">`;
                        };
                        reader.readAsDataURL(file);
                        
                        // Salvamento persistente
                        await uploadImage(file, user.uid, 'property_logo');
                        showToast('Logo salvo com sucesso!', 'success');
                        
                        // Recarrega para garantir exibição do DB
                        await loadAndDisplayLogo(user.uid);
                    } catch (error) {
                        console.error("Erro ao salvar o logo:", error);
                        showToast('Falha ao salvar o logo.', 'error');
                    }
                } else {
                    showToast('Erro: Usuário não está logado!', 'error');
                }
            }
        });
    }
}

// Inicializa o módulo quando o DOM estiver pronto
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initializePropertyModule();
        setupLogoPreview();
    });
} else {
    initializePropertyModule();
    setupLogoPreview();
}

console.log('[DEBUG] Script propriedade.js carregado completamente.');


// === FUNÇÕES DE MANIPULAÇÃO DE IMAGEM ===

// Inicializar IndexedDB
function initializeIndexedDB() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            console.warn('IndexedDB não está disponível neste navegador');
            resolve(null);
            return;
        }
        
        const request = indexedDB.open('AgroCultiveDB', 2);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
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
            resolve(null);
        };
    });
}

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

        // Criar uma cópia limpa do objeto
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

        // Salvar no IndexedDB
        await saveToIndexedDB(cleanImageData);

        showToast('Imagem adicionada com sucesso!');
        return cleanImageData.id;

    } catch (error) {
        console.error('Erro no upload:', error);
        showToast('Erro ao processar imagem.', 'error');
        throw error;
    }
}

// Carrega e exibe o logo salvo do IndexedDB
async function loadAndDisplayLogo(userId) {
    try {
        const logos = await getFromIndexedDB(userId, 'property_logo');
        const logoPreview = document.getElementById('logo-preview');
        
        if (logos && logos.length > 0 && logoPreview) {
            const logo = logos[0];
            logoPreview.innerHTML = `<img src="${logo.data}" alt="Logo da Propriedade" class="w-full h-full object-cover rounded-lg">`;
            console.log('[DEBUG] Logo carregado do IndexedDB');
        } else if (logoPreview) {
            logoPreview.innerHTML = '<div class="flex items-center justify-center h-full text-gray-400"><span>Pré-visualização do logo</span></div>';
            console.log('[DEBUG] Nenhum logo encontrado no IndexedDB');
        }
    } catch (error) {
        console.error('[DEBUG] Erro ao carregar logo:', error);
    }
}

// === FIM DAS FUNÇÕES DE MANIPULAÇÃO DE IMAGEM ===