
// sales.enhancements.js
import { auth, db } from "./firebase-init.js";
import { collection, onSnapshot, doc, getDoc, addDoc, getDocs, updateDoc } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";

const clientSelect = document.getElementById("sale-client-select");
const paymentSelect = document.getElementById("sale-payment-method");
const saleForm = document.getElementById("sale-form");

let currentUserId = null;

function computeDueDate(dateStr, days){
  try{
    const base = new Date((dateStr||new Date().toISOString().slice(0,10)) + 'T00:00:00');
    if (Number.isFinite(Number(days))) base.setDate(base.getDate() + Number(days));
    return base.toISOString().slice(0,10);
  }catch(_){ return null; }
}


function handlePaymentChange(){
  const method = paymentSelect?.value;
  const block = document.getElementById('aprazo-fields');
  if (!block) return;
  if (method === 'aprazo'){ 
    block.classList.remove('hidden'); 
    // default: compute due based on sale date + days
    const saleDate = document.getElementById('sale-date')?.value || new Date().toISOString().slice(0,10);
    const daysEl = document.getElementById('aprazo-days');
    const dueEl  = document.getElementById('aprazo-duedate');
    const days = parseInt(daysEl?.value || '30', 10);
    const base = new Date(saleDate + 'T00:00:00');
    base.setDate(base.getDate() + (isFinite(days)?days:30));
    if (dueEl) dueEl.value = base.toISOString().slice(0,10);
  } else {
    block.classList.add('hidden');
  }
}
paymentSelect?.addEventListener('change', handlePaymentChange);
document.getElementById('aprazo-days')?.addEventListener('input', handlePaymentChange);
document.getElementById('sale-date')?.addEventListener('change', handlePaymentChange);


// ---- Robust auth/db resolver (works with existing globals from index.inline3.js) ----
let __db = (window.db || db);
let __uid = (window.userId || currentUserId);

async function resolveAuth(){
  if (window.userId && window.db){ __uid = window.userId; __db = window.db; return { uid: __uid, db: __db }; }
  if (currentUserId && db){ __uid = currentUserId; __db = db; return { uid: __uid, db: __db }; }
  return new Promise((resolve)=>{
    const t = setInterval(()=>{
      if (window.userId && window.db){ clearInterval(t); __uid = window.userId; __db = window.db; resolve({ uid: __uid, db: __db }); }
      else if (currentUserId && db){ clearInterval(t); __uid = currentUserId; __db = db; resolve({ uid: __uid, db: __db }); }
    }, 200);
  });
}

// Lazy load clients when the select receives focus or when modal opens
async function loadClientsOnce(){
  await resolveAuth();
  if (!__uid || !__db) return;
  try{
    const ref = collection(__db, 'users', __uid, 'clientes');
    const snap = await getDocs(ref);
    clientsCache = snap.docs.map(d => ({ id: d.id, ...(d.data()||{}) }));
    if (clientSelect){
      clientSelect.innerHTML = '<option value="">Selecione um cliente</option>' +
        clientsCache.map(c => `<option value="${c.id}">${(c.name || 'Cliente').replace(/[<>]/g,'')}</option>`).join('');
    }
  }catch(e){ console.error('[sales.enhancements] Erro ao carregar clientes:', e); }
}

if (clientSelect){
  clientSelect.addEventListener('focus', loadClientsOnce);
}

// Se houver botão para abrir o modal de vendas, recarrega os clientes ao abrir
const addSaleBtn = document.getElementById('add-sale-btn');
if (addSaleBtn){
  addSaleBtn.addEventListener('click', ()=> setTimeout(loadClientsOnce, 200));
}
let clientsCache = [];

// Load clients for selector
onAuthStateChanged(auth, (user) => {
  if (!user) return;
  currentUserId = user.uid;
  const ref = collection(db, "users", user.uid, "clientes");
  onSnapshot(ref, (snap) => {
    clientsCache = snap.docs.map(d => ({ id: d.id, ...(d.data()||{}) }));
    clientSelect.innerHTML = '<option value="">Selecione um cliente</option>' +
      clientsCache.map(c => `<option value="${c.id}">${(c.name || "Cliente").replace(/[<>]/g, "")}</option>`).join('');
  });
});

function getSelectedProductDescription(){
  const typeBtn = document.querySelector('#sale-type-buttons .sale-type-btn.active');
  const type = typeBtn ? typeBtn.dataset.type : 'harvest';
  let name = 'Venda';
  if (type === 'harvest'){
    const sel = document.getElementById('sale-harvest-select');
    if (sel) name = `Venda de Colheita: ${sel.options[sel.selectedIndex]?.text || ''}`;
  } else if (type === 'live_animal'){
    const sel = document.getElementById('sale-animal-select');
    if (sel) name = `Venda de Animal: ${sel.options[sel.selectedIndex]?.text || ''}`;
  } else if (type === 'slaughtered_animal'){
    const sel = document.getElementById('sale-animal-slaughtered-select');
    if (sel) name = `Venda de Animal Abatido: ${sel.options[sel.selectedIndex]?.text || ''}`;
  } else if (type === 'animal_product'){
    const sel = document.getElementById('sale-product-select');
    if (sel) name = `Venda de Produto: ${sel.options[sel.selectedIndex]?.text || ''}`;
  } else {
    const desc = document.getElementById('sale-description');
    name = `Venda: ${(desc?.value || '').trim()}`;
  }
  return name;
}

// After original sale save runs, we also write into transacoes with cliente info (for livro-caixa)
async function saveCashbookWithClientFallback(){
  try{
    const clientId = clientSelect?.value || null;
    const payment = paymentSelect?.value || null;
    const amountStr = (document.getElementById('sale-price')?.value || '0').toString().replace(/\./g,'').replace(',', '.');
    const amount = Number.parseFloat(amountStr) || 0;
    const date = document.getElementById('sale-date')?.value || new Date().toISOString().slice(0,10);
    const description = getSelectedProductDescription();

    let clienteNome = '';
    if (clientId){
      const c = await getDoc(doc(db, 'users', currentUserId || __uid, 'clientes', clientId));
      if (c.exists()) clienteNome = c.data().name || '';
    }

    // Dados base da transação
    const baseData = {
      description,
      amount,
      date,
      type: 'receita',
      category: payment === 'aprazo' ? 'a_receber' : 'vendas',
      clienteId: clientId || null,
      clienteNome: clienteNome || null,
      paymentMethod: payment || null,
      createdAt: new Date().toISOString()
    };

    // A prazo -> inclui dueDate/status
    if (payment === 'aprazo'){
      const dueDate = document.getElementById('aprazo-duedate')?.value || date;
      baseData.dueDate = dueDate;
      baseData.status  = 'pendente';
    }

    // Prefer helper do clientes.js
    if (window.__saveCashbookWithClient){
      await window.__saveCashbookWithClient(baseData);
    } else {
      await addDoc(collection(db, 'users', currentUserId || __uid, 'transacoes'), baseData);
    }
  }catch(e){
    console.error('[sales.enhancements] Falha ao gravar no Livro-Caixa com cliente:', e);
  }
}

// Ask to emit receipt and optionally redirect
async function postSaleFlow(){
  const modal = document.getElementById('sale-finished-modal');
  const link  = document.getElementById('sale-finished-link');
  const btnNo  = document.getElementById('sale-finished-cancel');
  return new Promise((resolve)=>{
    const clientId = clientSelect?.value || '';
    if (link){
      const url = new URL(link.getAttribute('href'), window.location.href);
      if (clientId) url.searchParams.set('clientId', clientId);
      link.setAttribute('href', url.toString());
    }
    const close = (go)=>{ modal.classList.add('hidden'); btnNo.onclick = null; resolve(go); };
    modal.classList.remove('hidden');
    btnNo.onclick  = ()=> close(false);
    link.onclick = ()=> close(true);
  }).then(()=>{});
}

if (saleForm){
  // Attach AFTER existing listeners; run shortly after submit completes.
  saleForm.addEventListener('submit', (ev)=> {
    // Defer our actions to allow original handler to finish
    setTimeout(async ()=>{
      await saveCashbookWithClientFallback();
      await saveSaleIntoClient();
      await postSaleFlow();
    }, 400);
  });
}

console.log('[sales.enhancements] Cliente + Pagamento + Recibo integrados.');



async function saveSaleIntoClient(){
  try{
    const clientId = document.getElementById('sale-client-select')?.value;
    if (!clientId || !__uid || !(__db || db)) return;

    const quantity = Number.parseFloat((document.getElementById('sale-quantity')?.value || '0').replace(',', '.')) || 0;
    const amountStr = (document.getElementById('sale-price')?.value || '0').toString().replace(/\./g,'').replace(',', '.');
    const amount = Number.parseFloat(amountStr) || 0;
    const date = document.getElementById('sale-date')?.value || new Date().toISOString().slice(0,10);
    const description = getSelectedProductDescription();
    const productName = (description
  .replace(/^Venda(?: de)?\s*/,'')
  .replace(/^(Colheita|Animal|Animal abatido|Produto)\s*:\s*/i,'')
  .trim()) || 'Produto';

    const ref = doc(__db || db, 'users', __uid || currentUserId, 'clientes', clientId);

    // Atualiza o array sales do doc do cliente (compatível com sua tela atual)
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const vendas = Array.isArray(snap.data().sales) ? snap.data().sales : [];
    // Evitar duplicidade básica (mesmo produto, total e data)
    const paymentMethod = document.getElementById('sale-payment-method')?.value || 'avista';
    const aprazoDaysVal = paymentMethod==='aprazo' ? parseInt(document.getElementById('aprazo-days')?.value||'0',10) : null;
    const saleDateVal  = document.getElementById('sale-date')?.value || new Date().toISOString().slice(0,10);
    const dueManual    = document.getElementById('aprazo-duedate')?.value || null;
    const dueDateVal   = paymentMethod==='aprazo' ? (dueManual || computeDueDate(saleDateVal, aprazoDaysVal||0)) : null;

    const already = vendas.some(v => (v?.product===productName && Number(v?.amount)===amount && v?.date===date));
    if (already) return;

    const newSale = { product: productName, quantity, unitPrice: quantity ? (amount/quantity) : null, amount, date, paymentMethod, aprazoDays: aprazoDaysVal, dueDate: dueDateVal, timestamp: new Date().toISOString() };
    await updateDoc(ref, { sales: [...vendas, newSale] });

    // (Opcional) log detalhado em subcoleção
    try{
      await addDoc(collection(__db || db, 'users', __uid || currentUserId, 'clientes', clientId, 'sales_log'), newSale);
    }catch(_) {}
  }catch(e){
    console.error('[sales.enhancements] Falha ao salvar venda no cliente:', e);
  }
}
