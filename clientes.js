// clientes.js - Gestão de clientes e vendas (recibo moderno + clienteNome no livro-caixa + busca + alinhamentos)
//
// Novidades principais:
// 1) Recibo moderno em HTML (modal com card).
// 2) Botão "Copiar" (texto) 100% funcional com fallback.
// 3) Livro-caixa grava nome do cliente: clienteNome + aliases (nomeCliente, cliente, cliente_name, customerName).
// 4) Lista de recibos do cliente com grid (produto | data | total).
// 5) Barra de busca com lupa.
//
// Firebase modular via CDN 11.6.1.

// ---------- Firebase ----------
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  onSnapshot,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  runTransaction,
  getDoc,
  getDocs
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// ---------- Config ----------
const firebaseConfig = {
  apiKey: "AIzaSyAtwYV-toZBKbSwg2PE4AhTsJ47AaPKD4Q",
  authDomain: "agrocultiveapps.firebaseapp.com",
  projectId: "agrocultiveapps",
  storageBucket: "agrocultiveapps.appspot.com",
  messagingSenderId: "1095510209034",
  appId: "1:1095510209034:web:9dac124513d1eb584a25f3"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---------- State ----------
let currentUser = null;
let currentClientId = null;
let isEditMode = false;
let lastSaleData = null;
let allClientDocs = [];
let clientSearchTerm = "";

// ---------- DOM ----------
const loadingIndicator = document.getElementById("loading-indicator");
const clientList = document.getElementById("client-list");
const addClientBtn = document.getElementById("add-client-btn");
const clientModal = document.getElementById("client-modal");
const clientForm = document.getElementById("client-form");
const saleModal = document.getElementById("sale-modal");
const saleForm = document.getElementById("sale-form");
const saleConfirmationModal = document.getElementById("sale-confirmation-modal");

// ---------- Utils ----------
const safeNum = (v, d=0)=> (Number.isFinite(Number(v)) ? Number(v) : d);
const money = (n)=> `R$ ${safeNum(n,0).toFixed(2).replace(".", ",")}`;
const parseBR = (s)=>{
  if (s === 0 || s === "0") return 0;
  if (!s) return 0;
  const x = String(s).trim().replace(/\./g,"").replace(",", ".");
  const n = parseFloat(x);
  return Number.isFinite(n) ? n : 0;
};
const esc = (t)=> String(t ?? "")
  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const computeTotal = ({price, unitPrice, quantity, amount}) => {
  if (Number.isFinite(Number(amount))) return Number(amount);
  const p = safeNum(unitPrice ?? price, 0);
  const q = safeNum(quantity, 0);
  return p * q;
};
function showToast(message, type="success"){
  const toast = document.getElementById("toast");
  const msg = document.getElementById("toast-message");
  if (toast && msg){
    msg.textContent = message;
    toast.className = `fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg transform transition-transform duration-300 z-50 ${type==="error"?"bg-red-600":"bg-green-600"} text-white`;
    toast.style.transform = "translateX(0)";
    setTimeout(()=> toast.style.transform = "translateX(100%)", 3000);
  }
  console.log(`[Toast ${type}]`, message);
}
const hideLoading = ()=> loadingIndicator && (loadingIndicator.style.display = "none");
function showAuthError(){
  if (!loadingIndicator) return;
  loadingIndicator.innerHTML = `
    <div class="text-center">
      <h2 class="text-xl font-bold text-red-600 mb-4">Erro de Autenticação</h2>
      <p class="text-gray-600">Você precisa estar logado para acessar esta página.</p>
      <a href="index.html" class="mt-4 inline-block bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 transition-colors">
        Voltar ao Login
      </a>
    </div>`;
}

// ---------- Init ----------
function initializeClientsModule(){
  onAuthStateChanged(auth, (user)=>{
    if (user){
      currentUser = user;
      hideLoading();
      ensureClientSearchBar();
      setupEvents();
      listenClients();
    } else {
      showAuthError();
    }
  });
}
if (document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", initializeClientsModule);
}else initializeClientsModule();

// ---------- Search bar ----------
function ensureClientSearchBar(){
  if (!clientList || document.getElementById("client-search-container")) return;
  const el = document.createElement("div");
  el.id = "client-search-container";
  el.className = "flex items-center gap-2 mb-4 bg-white rounded-xl shadow px-3 py-2 border border-gray-200";
  el.innerHTML = `
    <i class="fas fa-search text-gray-500"></i>
    <input id="client-search-input" type="text" placeholder="Buscar cliente pelo nome..." class="flex-1 outline-none text-sm placeholder-gray-400">
    <button id="client-search-clear" class="text-xs text-gray-500 hover:text-gray-700">Limpar</button>`;
  clientList.parentElement.insertBefore(el, clientList);
  const input = el.querySelector("#client-search-input");
  const clear = el.querySelector("#client-search-clear");
  input.addEventListener("input", ()=>{
    clientSearchTerm = input.value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu,"");
    renderClientsFiltered();
  });
  clear.addEventListener("click", ()=>{
    input.value=""; clientSearchTerm=""; renderClientsFiltered();
  });
}

// ---------- Snapshot de clientes ----------
let unsubscribeClients = null;
function listenClients(){
  const ref = collection(db, "users", currentUser.uid, "clientes");
  unsubscribeClients = onSnapshot(ref, (snap)=>{
    allClientDocs = snap.docs;
    renderClientsFiltered();
  }, (err)=>{
    console.error(err);
    showToast("Erro ao carregar clientes","error");
  });
}
function renderClientsFiltered(){
  if (!clientSearchTerm) return renderClients(allClientDocs);
  const norm = (s)=> String(s||"").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu,"");
  const filtered = allClientDocs.filter(d => norm(d.data().name).includes(clientSearchTerm));
  renderClients(filtered);
}
function renderClients(docs){
  if (!docs || docs.length===0){
    clientList.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-users"></i>
        <h3>Nenhum cliente cadastrado</h3>
        <p>Comece adicionando seu primeiro cliente</p>
      </div>`;
    return;
  }
  clientList.innerHTML = docs.map(d=>{
    const c = d.data();
    const sales = Array.isArray(c.sales)? c.sales : [];
    const total = sales.reduce((s,v)=> s + computeTotal(v), 0);
    return `
      <div class="client-card" data-client-id="${d.id}">
        <div class="client-info">
          <div class="client-details">
            <h3>${esc(c.name||"Sem nome")}</h3>
            ${c.doc ? `<p><i class="fas fa-id-card mr-1"></i> ${esc(c.doc)}</p>` : ""}
            ${c.phone ? `<p><i class="fas fa-phone mr-1"></i> ${esc(c.phone)}</p>` : ""}
            ${c.email ? `<p><i class="fas fa-envelope mr-1"></i> ${esc(c.email)}</p>` : ""}
            <div class="mt-2">
              <span class="status-badge status-active">${sales.length} venda${sales.length!==1?"s":""}</span>
              ${total>0 ? `<span class="status-badge status-active ml-2">${money(total)}</span>` : ""}
            </div>
          </div>
          <div class="client-actions">
            <button class="btn-sale" onclick="openSaleModal('${d.id}', '${esc(c.name).replace(/'/g, "\\'")}')">
              <i class="fas fa-shopping-cart"></i> Venda
            </button>
            <button class="btn-receipt" onclick="viewClientReceipts('${d.id}', '${esc(c.name).replace(/'/g, "\\'")}')">
              <i class="fas fa-receipt"></i> Recibos
            </button>
            <button class="btn-edit" onclick="editClient('${d.id}')">
              <i class="fas fa-edit"></i> Editar
            </button>
            <button class="btn-delete" onclick="deleteClient('${d.id}', '${esc(c.name).replace(/'/g, "\\'")}')">
              <i class="fas fa-trash"></i> Excluir
            </button>
          </div>
        </div>
        ${sales.length? `
          <div class="sales-history">
            <h4><i class="fas fa-history mr-1"></i> Últimas vendas</h4>
            <div class="sales-list">
              ${sales.slice(-3).reverse().map(s=>{
                const totalItem = money(computeTotal(s));
                const dbr = new Date(s.date+"T00:00:00").toLocaleDateString("pt-BR");
                return `
                <div class="sale-item" style="display:grid;grid-template-columns:1fr 120px 120px;gap:8px;align-items:center;">
                  <span>${esc(s.product||s.productName)} (${safeNum(s.quantity,0)}x)</span>
                  <span class="sale-date" style="text-align:center;">${dbr}</span>
                  <span class="sale-amount" style="text-align:right;">${totalItem}</span>
                </div>`;
              }).join("")}
            </div>
          </div>`: ""}
      </div>`;
  }).join("");
}

// ---------- Modal Cliente ----------
function openClientModal(id=null){
  isEditMode = !!id;
  currentClientId = id;
  document.getElementById("client-modal-title").textContent = isEditMode? "Editar Cliente":"Cadastrar Cliente";
  if (isEditMode) loadClientData(id); else clientForm.reset();
  clientModal.classList.remove("hidden");
}
async function loadClientData(id){
  try{
    const snap = await getDoc(doc(db,"users", currentUser.uid, "clientes", id));
    if (snap.exists()){
      const c = snap.data();
      document.getElementById("client-name").value = c.name||"";
      document.getElementById("client-doc").value = c.doc||"";
      document.getElementById("client-phone").value = c.phone||"";
      document.getElementById("client-email").value = c.email||"";
    }
  }catch(e){ console.error(e); showToast("Erro ao carregar cliente","error"); }
}
function closeClientModal(){
  clientModal.classList.add("hidden");
  clientForm.reset(); currentClientId=null; isEditMode=false;
}
async function handleClientSubmit(e){
  e.preventDefault();
  const data = {
    name: document.getElementById("client-name").value.trim(),
    doc: document.getElementById("client-doc").value.trim(),
    phone: document.getElementById("client-phone").value.trim(),
    email: document.getElementById("client-email").value.trim(),
    updatedAt: new Date().toISOString()
  };
  if (!isEditMode){ data.createdAt=new Date().toISOString(); data.sales=[]; }
  try{
    if (isEditMode){
      await updateDoc(doc(db,"users",currentUser.uid,"clientes",currentClientId), data);
      showToast("Cliente atualizado!","success");
    }else{
      await addDoc(collection(db,"users",currentUser.uid,"clientes"), data);
      showToast("Cliente cadastrado!","success");
    }
    closeClientModal();
  }catch(e){ console.error(e); showToast("Erro ao salvar cliente","error"); }
}
window.editClient = (id)=> openClientModal(id);
window.deleteClient = async (id, name)=>{
  if (!confirm(`Excluir cliente "${name}"?`)) return;
  try{
    await deleteDoc(doc(db,"users",currentUser.uid,"clientes",id));
    showToast("Cliente excluído!","success");
  }catch(e){ console.error(e); showToast("Erro ao excluir cliente","error"); }
};

// ---------- Eventos ----------
function setupEvents(){
  addClientBtn?.addEventListener("click", ()=> openClientModal());
  document.getElementById("close-client-modal")?.addEventListener("click", closeClientModal);
  document.getElementById("cancel-client-btn")?.addEventListener("click", closeClientModal);
  clientForm?.addEventListener("submit", handleClientSubmit);

  document.getElementById("close-sale-modal")?.addEventListener("click", closeSaleModal);
  document.getElementById("cancel-sale-btn")?.addEventListener("click", closeSaleModal);
  saleForm?.addEventListener("submit", handleSaleSubmit);

  document.getElementById("close-confirmation-modal")?.addEventListener("click", closeSaleConfirmationModal);
  document.getElementById("send-whatsapp-receipt")?.addEventListener("click", sendWhatsAppReceipt);
  document.getElementById("send-email-receipt")?.addEventListener("click", sendEmailReceipt);

  document.getElementById("sale-price")?.addEventListener("input", (e)=>{
    let v = e.target.value.replace(/\D/g,"");
    v = (Number(v)/100).toFixed(2);
    e.target.value = v.replace(".", ",");
  });

  const saleDate = document.getElementById("sale-date");
  if (saleDate) saleDate.value = new Date().toISOString().split("T")[0];
}

// ---------- Vendas ----------
window.openSaleModal = openSaleModal;
async function openSaleModal(clientId, clientName){
  currentClientId = clientId;
  document.getElementById("sale-modal-title").textContent = `Nova Venda para ${clientName}`;
  await loadAvailableProducts();
  saleForm.reset();
  document.getElementById("sale-date").value = new Date().toISOString().split("T")[0];
  saleModal.classList.remove("hidden");
}
function closeSaleModal(){ saleModal.classList.add("hidden"); saleForm.reset(); }

async function loadAvailableProducts(){
  try{
    const ref = collection(db,"users",currentUser.uid,"insumos");
    const snap = await getDocs(ref);
    const select = document.getElementById("sale-product-select");
    select.innerHTML = `<option value="">Selecione um produto...</option>`;
    snap.docs.forEach(d=>{
      const p = d.data();
      if (safeNum(p.remaining,0) > 0){
        select.innerHTML += `<option value="${d.id}" data-name="${esc(p.name)}" data-remaining="${p.remaining}">${esc(p.name)} (Disponível: ${p.remaining})</option>`;
      }
    });
    if (select.children.length===1) select.innerHTML = `<option value="">Nenhum produto disponível</option>`;
  }catch(e){ console.error(e); showToast("Erro ao carregar produtos","error"); }
}

async function handleSaleSubmit(e){
  e.preventDefault();
  const select = document.getElementById("sale-product-select");
  const opt = select.options[select.selectedIndex];
  if (!opt?.value) return showToast("Selecione um produto","error");

  const sale = {
    productId: opt.value,
    productName: opt.dataset.name,
    quantity: safeNum(document.getElementById("sale-quantity").value, 0),
    unitPrice: parseBR(document.getElementById("sale-price").value),
    date: document.getElementById("sale-date").value,
    timestamp: new Date().toISOString()
  };
  const total = computeTotal(sale);

  try{
    await runTransaction(db, async (t)=>{
      const productRef = doc(db,"users",currentUser.uid,"insumos", sale.productId);
      const clientRef  = doc(db,"users",currentUser.uid,"clientes", currentClientId);

      const prodSnap = await t.get(productRef);
      const cliSnap  = await t.get(clientRef);
      if (!prodSnap.exists()) throw new Error("Produto não encontrado");
      if (!cliSnap.exists()) throw new Error("Cliente não encontrado");

      const stock = safeNum(prodSnap.data().remaining, 0);
      if (stock < sale.quantity) throw new Error(`Estoque insuficiente. Disponível: ${stock}`);

      const clienteNome = cliSnap.data().name || "";
      const vendas = Array.isArray(cliSnap.data().sales) ? cliSnap.data().sales : [];

      // Nova venda (cliente.sales)
      const newSale = {
        product: sale.productName,
        quantity: sale.quantity,
        unitPrice: sale.unitPrice,
        amount: total,
        date: sale.date,
        timestamp: sale.timestamp
      };
      t.update(productRef, { remaining: stock - sale.quantity });

      // Livro-caixa (transacoes) com nome do cliente + aliases
      const txRef = doc(collection(db, `users/${currentUser.uid}/transacoes`));
      t.set(txRef, {
        description: `Venda: ${sale.productName} (${sale.quantity}x)`,
        amount: total,
        date: sale.date,
        type: "receita",
        category: "vendas",
        clienteId: currentClientId,
        clienteNome: clienteNome,
        nomeCliente: clienteNome,
        cliente: clienteNome,
        cliente_name: clienteNome,
        customerName: clienteNome,
        createdAt: new Date().toISOString()
      });

      t.update(clientRef, { sales: [...vendas, newSale] });
    });

    lastSaleData = { ...sale, amount: total, clientId: currentClientId };
    closeSaleModal();
    showSaleConfirmation();
    showToast("Venda registrada com sucesso!","success");
  }catch(e){
    console.error(e);
    showToast("Erro ao registrar venda: " + e.message, "error");
  }
}

// ---------- Confirmação pós-venda ----------
function showSaleConfirmation(){ saleConfirmationModal.classList.remove("hidden"); }
function closeSaleConfirmationModal(){ saleConfirmationModal.classList.add("hidden"); }

async function generateReceiptFromData({ clientId, productName, product, quantity, unitPrice, price, amount, date }){
  const propDoc = await getDoc(doc(db,"users",currentUser.uid,"propriedade_info","dados"));
  const prop = propDoc.exists()? propDoc.data() : {};
  const cliDoc = await getDoc(doc(db,"users",currentUser.uid,"clientes", clientId));
  const cli = cliDoc.data();
  const total = computeTotal({ price: unitPrice ?? price, quantity, amount });
  const nomeProd = productName || product || "-";
  const dataVenda = new Date(date + "T00:00:00").toLocaleDateString("pt-BR");
  return `
🌱 RECIBO DE COMPRA - AGROCULTIVE 🌱

📋 DADOS DO VENDEDOR:
Nome: ${prop.name || "Não informado"}
CPF/CNPJ: ${prop.doc || "Não informado"}
Telefone: ${prop.phone || "Não informado"}
Email: ${prop.email || "Não informado"}

👤 DADOS DO CLIENTE:
Nome: ${cli.name}
${cli.doc ? `CPF/CNPJ: ${cli.doc}\n` : ""}Telefone: ${cli.phone || "-"}
${cli.email ? `Email: ${cli.email}` : ""}

🛒 DETALHES DA COMPRA:
Produto: ${nomeProd}
Quantidade: ${quantity}
Data: ${dataVenda}

💰 VALOR TOTAL: ${money(total)}

📅 Recibo gerado em: ${new Date().toLocaleString("pt-BR")}

✅ Obrigado pela preferência!`.trim();
}

// Envio rápido (confirmação)
async function generateReceipt(){ if (!lastSaleData) throw new Error("Sem dados da venda"); return generateReceiptFromData(lastSaleData); }
async function sendWhatsAppReceipt(){
  try{
    const receipt = await generateReceipt();
    const c = await getDoc(doc(db,"users",currentUser.uid,"clientes", lastSaleData.clientId));
    const phone = (c.data().phone || "").replace(/\D/g,"");
    if (!phone) return showToast("Telefone do cliente inválido","error");
    window.open(`https://wa.me/55${phone}?text=${encodeURIComponent(receipt)}`,"_blank");
    closeSaleConfirmationModal();
  }catch(e){ console.error(e); showToast("Erro ao enviar WhatsApp","error"); }
}
async function sendEmailReceipt(){
  try{
    const receipt = await generateReceipt();
    const c = await getDoc(doc(db,"users",currentUser.uid,"clientes", lastSaleData.clientId));
    const email = (c.data().email || "").trim();
    if (!email) return showToast("Cliente não possui email","error");
    const url = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Recibo de Compra - AgroCultive")}&body=${encodeURIComponent(receipt)}`;
    window.open(url, "_blank");
    closeSaleConfirmationModal();
  }catch(e){ console.error(e); showToast("Erro ao enviar Email","error"); }
}

// ---------- Recibos (histórico) ----------
window.viewClientReceipts = async function (clientId, clientName){
  try{
    const snap = await getDoc(doc(db,"users",currentUser.uid,"clientes", clientId));
    if (!snap.exists()) return showToast("Cliente não encontrado","error");
    const c = snap.data();
    const sales = Array.isArray(c.sales)? c.sales : [];
    if (sales.length === 0) return showToast("Este cliente não possui vendas","error");

    const modal = document.createElement("div");
    modal.id = "receipts-modal";
    modal.className = "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50";
    modal.innerHTML = `
      <div class="bg-white rounded-xl shadow-2xl p-6 w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-semibold text-gray-800"><i class="fas fa-receipt text-blue-600 mr-2"></i> Recibos de ${esc(clientName)}</h2>
          <button onclick="closeReceiptsModal()" class="text-gray-500 hover:text-gray-700"><i class="fas fa-times fa-lg"></i></button>
        </div>
        <div class="space-y-4">
          ${sales.map((s,i)=>{
            const total = money(computeTotal(s));
            const dbr = new Date(s.date+"T00:00:00").toLocaleDateString("pt-BR");
            return `
            <div class="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
              <div style="display:grid;grid-template-columns:1fr 120px 120px;gap:8px;align-items:center;">
                <div>
                  <h3 class="font-medium text-gray-800">${esc(s.product || s.productName)}</h3>
                  <p class="text-sm text-gray-600">Quantidade: ${safeNum(s.quantity,0)}</p>
                </div>
                <div class="text-sm text-gray-600" style="text-align:center;">${dbr}</div>
                <div class="text-right text-lg font-bold text-green-600">${total}</div>
              </div>
              <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                <button onclick="regenerateReceipt('${clientId}', ${i})" class="bg-blue-600 text-white py-2 px-3 rounded-lg hover:bg-blue-700 transition-colors text-sm">
                  <i class="fas fa-eye mr-1"></i> Ver recibo
                </button>
                <button onclick="sendReceiptWhatsApp('${clientId}', ${i})" class="bg-green-600 text-white py-2 px-3 rounded-lg hover:bg-green-700 transition-colors text-sm">
                  <i class="fab fa-whatsapp mr-1"></i> WhatsApp
                </button>
                <button onclick="sendReceiptEmail('${clientId}', ${i})" class="bg-gray-700 text-white py-2 px-3 rounded-lg hover:bg-gray-800 transition-colors text-sm">
                  <i class="fas fa-envelope mr-1"></i> Email
                </button>
                <button onclick="deleteReceipt('${clientId}', ${i})" class="bg-red-600 text-white py-2 px-3 rounded-lg hover:bg-red-700 transition-colors text-sm">
                  <i class="fas fa-trash mr-1"></i> Excluir
                </button>
              </div>
            </div>`;
          }).join("")}
        </div>
      </div>`;
    document.body.appendChild(modal);
  }catch(e){ console.error(e); showToast("Erro ao abrir recibos","error"); }
};
window.closeReceiptsModal = ()=> document.getElementById("receipts-modal")?.remove();

// Visualização (moderna) do recibo
window.regenerateReceipt = async function (clientId, saleIndex){
  try{
    const snap = await getDoc(doc(db,"users",currentUser.uid,"clientes", clientId));
    const c = snap.data();
    const s = c.sales[saleIndex];
    const propDoc = await getDoc(doc(db,"users",currentUser.uid,"propriedade_info","dados"));
    const prop = propDoc.exists()? propDoc.data() : {};
    const total = computeTotal(s);
    openModernReceiptModal({
      receiptId: `REC-${Date.now().toString().slice(-6)}`,
      issueAt: new Date().toLocaleString("pt-BR"),
      seller: { name: prop.name||"-", doc: prop.doc||"-", phone: prop.phone||"-", email: prop.email||"-" },
      client: { name: c.name||"-", doc: c.doc||"-", phone: c.phone||"-", email: c.email||"-" },
      sale: { product: s.product||s.productName||"-", quantity: safeNum(s.quantity,0), date: new Date(s.date+"T00:00:00").toLocaleDateString("pt-BR"), total }
    });
  }catch(e){ console.error(e); showToast("Erro ao gerar recibo","error"); }
};

// Modal de recibo moderno (HTML estilizado)
function openModernReceiptModal(data){
  const modal = document.createElement("div");
  modal.className = "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50";
  modal.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden">
      <div class="bg-gradient-to-r from-green-600 to-green-500 text-white p-5 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="bg-white bg-opacity-20 rounded-xl p-2"><i class="fas fa-seedling text-2xl"></i></div>
          <div>
            <h3 class="text-lg font-semibold">Recibo de Venda</h3>
            <p class="text-xs opacity-90">#${esc(data.receiptId)} • Emitido em ${esc(data.issueAt)}</p>
          </div>
        </div>
        <button class="text-white/90 hover:text-white" onclick="this.closest('.fixed').remove()"><i class="fas fa-times text-xl"></i></button>
      </div>

      <div class="p-6 space-y-5">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="border rounded-xl p-4">
            <h4 class="font-semibold text-gray-800 mb-2"><i class="fas fa-store mr-2 text-green-600"></i>Vendedor</h4>
            <p class="text-sm text-gray-700"><strong>${esc(data.seller.name)}</strong></p>
            <p class="text-xs text-gray-600">CPF/CNPJ: ${esc(data.seller.doc)}</p>
            <p class="text-xs text-gray-600">Tel: ${esc(data.seller.phone)}</p>
            <p class="text-xs text-gray-600">Email: ${esc(data.seller.email)}</p>
          </div>
          <div class="border rounded-xl p-4">
            <h4 class="font-semibold text-gray-800 mb-2"><i class="fas fa-user mr-2 text-green-600"></i>Cliente</h4>
            <p class="text-sm text-gray-700"><strong>${esc(data.client.name)}</strong></p>
            <p class="text-xs text-gray-600">CPF/CNPJ: ${esc(data.client.doc)}</p>
            <p class="text-xs text-gray-600">Tel: ${esc(data.client.phone)}</p>
            <p class="text-xs text-gray-600">Email: ${esc(data.client.email)}</p>
          </div>
        </div>

        <div class="border rounded-xl overflow-hidden">
          <div class="bg-gray-50 px-4 py-2 text-xs text-gray-600">Detalhes</div>
          <div class="p-4" style="display:grid;grid-template-columns:1fr 120px 120px;gap:8px;align-items:center;">
            <div class="text-gray-800">${esc(data.sale.product)}</div>
            <div class="text-gray-600 text-center text-sm">${esc(String(data.sale.quantity))} un.</div>
            <div class="text-right font-semibold text-green-600">${money(data.sale.total)}</div>
          </div>
        </div>

        <div class="flex items-center justify-between">
          <span class="text-sm text-gray-600">Data da venda: ${esc(data.sale.date)}</span>
          <span class="text-xl font-extrabold text-green-700">${money(data.sale.total)}</span>
        </div>

        <div class="flex gap-2 pt-2 border-t">
          <button onclick="copyModernReceiptText()" class="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors"><i class="fas fa-copy mr-2"></i>Copiar</button>
          <button onclick="window.print()" class="flex-1 bg-gray-800 text-white py-2 px-4 rounded-lg hover:bg-black transition-colors"><i class="fas fa-print mr-2"></i>Imprimir</button>
        </div>

        <pre id="modern-receipt-text" class="hidden whitespace-pre-wrap text-xs"></pre>
      </div>
    </div>`;

  document.body.appendChild(modal);

  // Preenche o texto (oculto) para copiar
  const text = [
    "RECIBO DE COMPRA - AGROCULTIVE",
    "",
    `Vendedor: ${data.seller.name} | Doc: ${data.seller.doc} | Tel: ${data.seller.phone} | Email: ${data.seller.email}`,
    `Cliente: ${data.client.name} | Doc: ${data.client.doc} | Tel: ${data.client.phone} | Email: ${data.client.email}`,
    "",
    `Produto: ${data.sale.product}`,
    `Quantidade: ${data.sale.quantity}`,
    `Data: ${data.sale.date}`,
    `VALOR TOTAL: ${money(data.sale.total)}`,
    "",
    `#${data.receiptId} • Emitido em ${data.issueAt}`
  ].join("\n");
  modal.querySelector("#modern-receipt-text").textContent = text;
}
window.copyModernReceiptText = function (){
  const el = document.getElementById("modern-receipt-text");
  const text = el?.textContent || "";
  if (navigator.clipboard?.writeText){
    navigator.clipboard.writeText(text).then(()=> showToast("Recibo copiado!","success"), ()=> fallbackCopy(text));
  } else fallbackCopy(text);
};
function fallbackCopy(text){
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position="fixed"; ta.style.opacity="0"; document.body.appendChild(ta);
  ta.select();
  try{ document.execCommand("copy"); showToast("Recibo copiado!","success"); }catch{ showToast("Não foi possível copiar","error"); }
  finally{ document.body.removeChild(ta); }
}

// ---------- Reenvio (histórico) ----------
window.sendReceiptWhatsApp = async function (clientId, saleIndex){
  try{
    const snap = await getDoc(doc(db,"users",currentUser.uid,"clientes", clientId));
    const c = snap.data();
    const s = c.sales[saleIndex];
    const receipt = await generateReceiptFromData({
      clientId,
      productName: s.product || s.productName,
      quantity: s.quantity,
      unitPrice: s.unitPrice ?? s.price,
      amount: s.amount,
      date: s.date
    });
    const phone = (c.phone || "").replace(/\D/g,"");
    if (!phone) return showToast("Telefone inválido","error");
    window.open(`https://wa.me/55${phone}?text=${encodeURIComponent(receipt)}`,"_blank");
  }catch(e){ console.error(e); showToast("Erro ao enviar WhatsApp","error"); }
};
window.sendReceiptEmail = async function (clientId, saleIndex){
  try{
    const snap = await getDoc(doc(db,"users",currentUser.uid,"clientes", clientId));
    const c = snap.data();
    const s = c.sales[saleIndex];
    const receipt = await generateReceiptFromData({
      clientId,
      productName: s.product || s.productName,
      quantity: s.quantity,
      unitPrice: s.unitPrice ?? s.price,
      amount: s.amount,
      date: s.date
    });
    const email = (c.email || "").trim();
    if (!email) return showToast("Cliente sem email","error");
    const url = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Recibo de Compra - AgroCultive")}&body=${encodeURIComponent(receipt)}`;
    window.open(url,"_blank");
  }catch(e){ console.error(e); showToast("Erro ao enviar Email","error"); }
};
window.deleteReceipt = async function (clientId, saleIndex){
  if (!confirm("Excluir este recibo/venda do histórico do cliente?")) return;
  try{
    await runTransaction(db, async (t)=>{
      const ref = doc(db,"users",currentUser.uid,"clientes", clientId);
      const snap = await t.get(ref);
      if (!snap.exists()) throw new Error("Cliente não encontrado");
      const data = snap.data();
      const sales = Array.isArray(data.sales)? data.sales : [];
      const newSales = sales.filter((_,i)=> i !== saleIndex);
      t.update(ref, { sales: newSales });
    });
    showToast("Recibo removido","success");
    closeReceiptsModal();
    const c = await getDoc(doc(db,"users",currentUser.uid,"clientes", clientId));
    viewClientReceipts(clientId, c.data().name || "Cliente");
  }catch(e){ console.error(e); showToast("Erro ao excluir recibo","error"); }
};

// ---------- Helpers externos para integração com "Vender Produção" ----------
// Se o fluxo de "vender produção" criar transações diretamente, pode chamar:
window.__saveCashbookWithClient = async function ({ description, amount, date, type="receita", category="vendas", clientId }){
  // Busca nome do cliente e grava nos campos esperados pelo Livro-Caixa.
  const cliSnap = await getDoc(doc(db,"users",currentUser.uid,"clientes", clientId));
  const clienteNome = cliSnap.exists() ? (cliSnap.data().name || "") : "";
  await addDoc(collection(db, `users/${currentUser.uid}/transacoes`), {
    description, amount, date, type, category,
    clienteId: clientId,
    clienteNome, nomeCliente: clienteNome, cliente: clienteNome, cliente_name: clienteNome, customerName: clienteNome,
    createdAt: new Date().toISOString()
  });
  showToast("Transação salva com cliente no Livro-Caixa","success");
};

console.log("[clientes.js] carregado com recibo moderno e integrações.");
