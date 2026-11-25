/* TRUST NET — front-end (vanilla JS, aucune dépendance) */
const API = '';
let config = { whatsapp_number: '', d17_number: '', flouci_number: '' };
let plans = [], operators = {};
let selectedOp = 'tt', selectedPlan = null, selectedPay = 'd17';
let promo = { code: '', discount: 0 };
let user = null, token = localStorage.getItem('tr_token') || '';
let lang = localStorage.getItem('tr_lang') || 'fr';
let compareIds = JSON.parse(localStorage.getItem('tr_compare') || '[]');
let filterOpValue = '';

const OP_NAMES = { tt: 'Tunisie Télécom', ooredoo: 'Ooredoo', orange: 'Orange' };
const OP_COLORS = { tt: '#2563EB', ooredoo: '#E30613', orange: '#FF7900' };

const I18N = {
  fr: { nav_catalogue: 'Forfaits', nav_recharge: 'Recharge rapide', nav_track: 'Suivi commande', nav_dashboard: 'Mon espace',
    hero_title: 'Rechargez votre mobile en 30 secondes, au meilleur prix gros.',
    hero_sub: 'TRUST NET — plateforme wholesale de recharge mobile en Tunisie. Tous les forfaits internet et crédits des 3 opérateurs — Tunisie Télécom, Ooredoo et Orange — avec vos tarifs Niveau 1 ou Niveau 2, en dinars. Paiement D17, Flouci ou avec votre solde client.',
    step1: 'Opérateur + forfait', step2: 'Votre numéro tunisien', step3: 'D17, Flouci ou solde',
    wizard_title: '⚡ Recharge rapide', wizard_sub: 'Aucun compte nécessaire. Créez un compte pour payer avec votre solde et suivre vos recharges.',
    lbl_plan: 'Forfait', lbl_phone: 'Numéro à recharger (Tunisie)', lbl_pay: 'Moyen de paiement', lbl_ref: 'Référence de paiement (obligatoire)',
    lbl_total: 'Total à payer', cat_title: '📱 Tous les forfaits', cat_sub: 'Internet et crédit — prix en dinars tunisiens (DT), TTC.',
    track_title: 'Suivre ma commande' },
  ar: { nav_catalogue: 'الباقات', nav_recharge: 'تعبئة سريعة', nav_track: 'تتبع الطلب', nav_dashboard: 'حسابي',
    hero_title: 'عبّي رصيدك في 30 ثانية، بأفضل أسعار الجملة.',
    hero_sub: 'TRUST NET — منصة الجملة لتعبئة الهاتف في تونس. جميع باقات الإنترنت والرصيد للمشغلين الثلاثة — تونس تيليكوم، أوريدو وأورانج — بأسعار المستوى 1 أو المستوى 2، بالدينار. الدفع عبر D17 أو Flouci أو برصيدك.',
    step1: 'المشغل + الباقة', step2: 'رقمك التونسي', step3: 'D17 أو Flouci أو الرصيد',
    wizard_title: '⚡ تعبئة سريعة', wizard_sub: 'لا حاجة لحساب. أنشئ حسابًا للدفع برصيدك وتتبع تعبئاتك.',
    lbl_plan: 'الباقة', lbl_phone: 'الرقم المراد تعبئته (تونس)', lbl_pay: 'طريقة الدفع', lbl_ref: 'مرجع الدفع (إجباري)',
    lbl_total: 'المجموع', cat_title: '📱 جميع الباقات', cat_sub: 'إنترنت ورصيد — الأسعار بالدينار التونسي (د.ت)، شامل الأداءات.',
    track_title: 'تتبع طلبي' },
};

function t(key) { return (I18N[lang] && I18N[lang][key]) || I18N.fr[key] || key; }
function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.getElementById('lang-btn').textContent = lang === 'ar' ? 'Français' : 'عربي';
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  localStorage.setItem('tr_lang', lang);
}
function toggleLang() { lang = lang === 'fr' ? 'ar' : 'fr'; applyLang(); renderPlans(); }

function toast(msg, isErr) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(el._t); el._t = setTimeout(() => el.className = '', 4000);
}
function fmt(n) { return (Math.round(n * 1000) / 1000).toString().replace('.', ',') + ' DT'; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function authHeaders() { return token ? { Authorization: 'Bearer ' + token } : {}; }
async function api(path, opts = {}) {
  const r = await fetch(API + path, { headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(opts.headers || {}) }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Erreur serveur');
  return data;
}
function waLink(msg) {
  const num = (config.whatsapp_number || '').replace(/\D/g, '');
  return num ? `https://wa.me/${num}?text=${encodeURIComponent(msg)}` : '#';
}
function validityLabel(days) {
  if (!days) return lang === 'ar' ? 'رصيد فوري' : 'Crédit immédiat';
  return days === 1 ? (lang === 'ar' ? 'يوم واحد' : '1 jour') : `${days} ${lang === 'ar' ? 'يوم' : 'jours'}`;
}

// ---------------- Config + plans ----------------
async function loadConfig() {
  try { config = await api('/api/config'); } catch {}
  const wa = document.getElementById('wa-float');
  if (config.whatsapp_number && config.whatsapp_number !== '216XXXXXXXX') {
    wa.href = waLink('Bonjour TRUST NET, j\'ai besoin d\'aide.'); wa.classList.remove('hidden');
    document.getElementById('footer-wa').href = wa.href;
  }
  if (config.announcement_fr) document.getElementById('announcement').textContent = lang === 'ar' ? (config.announcement_ar || config.announcement_fr) : config.announcement_fr;
  updatePayInfo();
  loadOperators();
}

async function loadPlans() {
  const q = document.getElementById('search-input').value.trim();
  const type = document.getElementById('filter-type').value;
  const max = document.getElementById('filter-max').value;
  const sort = document.getElementById('sort-select').value;
  const params = new URLSearchParams();
  if (filterOpValue) params.set('operator', filterOpValue);
  if (type) params.set('type', type);
  if (q) params.set('q', q);
  if (max) params.set('max', max);
  if (sort) params.set('sort', sort);
  try {
    const data = await api('/api/plans?' + params);
    operators = data.operators; plans = data.plans;
    renderPlans(); renderPlanSelect();
  } catch (e) { document.getElementById('plans-grid').innerHTML = '<p class="muted">Impossible de charger les forfaits.</p>'; }
}

function planName(p) { return lang === 'ar' ? (p.name_ar || p.name_fr) : p.name_fr; }
function perGo(p) {
  if (!p.data_mb) return '';
  const v = (p.price_per_gb !== undefined && p.price_per_gb !== null) ? p.price_per_gb : Math.round((p.price / (p.data_mb / 1024)) * 100) / 100;
  return v.toString().replace('.', ',') + ' DT / Go';
}
// Statut des opérateurs (bannière publique — statut manuel admin, jamais live)
async function loadOperators() {
  try {
    const d = await api('/api/operators');
    const bad = d.operators.filter(o => o.status !== 'available');
    const banner = document.getElementById('op-banner');
    if (bad.length) {
      banner.classList.remove('hidden');
      banner.innerHTML = bad.map(o => `⚠️ <b>${esc(OP_NAMES[o.operator] || o.operator)}</b> : ${esc(o.message || (o.status === 'maintenance' ? 'En maintenance' : 'Temporairement indisponible'))}`).join(' &nbsp;•&nbsp; ');
    } else banner.classList.add('hidden');
  } catch {}
}

function renderPlans() {
  const grid = document.getElementById('plans-grid');
  if (!plans.length) { grid.innerHTML = '<p class="muted">Aucun forfait ne correspond à votre recherche.</p>'; return; }
  grid.innerHTML = plans.map(p => `
    <article class="plan">
      ${p.badge ? `<span class="badge ${p.badge === 'Promo' ? 'promo' : ''}">${esc(p.badge)}</span>` : ''}
      <div class="op"><img src="${esc(p.image || '/images/' + p.operator + '.svg')}" alt="${esc(OP_NAMES[p.operator])}"><span class="dot" style="background:${OP_COLORS[p.operator]}"></span>${esc(OP_NAMES[p.operator])} • ${esc(p.type)}</div>
      <h3>${esc(planName(p))}</h3>
      <div class="data">${esc(p.data_label)}</div>
      <div class="meta">⏱ ${validityLabel(p.validity_days)}${p.data_mb ? ` • <span class="per-go">${perGo(p)}</span>` : ''}</div>
      ${p.operator_status && p.operator_status !== 'available' ? `<div class="op-status warn">⚠️ ${p.operator_status === 'maintenance' ? 'Opérateur en maintenance' : 'Opérateur temporairement indisponible'}</div>` : ''}
      ${user && user.pricing_level ? `<div class="meta level-note">Votre prix — Niveau ${user.pricing_level}</div>` : ''}
      <div class="price">${p.old_price ? `<span class="old-price">${fmt(p.old_price)}</span>` : ''}${fmt(p.price)} <small>TTC</small></div>
      <div class="actions">
        <button class="btn" onclick="quickBuy(${p.id})">Recharger</button>
        <button class="icon-btn ${compareIds.includes(p.id) ? 'on' : ''}" title="Comparer" onclick="toggleCompare(${p.id})">⚖️</button>
        <button class="icon-btn" title="Favori" onclick="addFavorite(${p.id})">⭐</button>
      </div>
    </article>`).join('');
  document.getElementById('compare-count').textContent = compareIds.length;
}

function renderPlanSelect() {
  const sel = document.getElementById('plan-select');
  const list = plans.filter(p => p.operator === selectedOp);
  const keep = selectedPlan && list.some(p => p.id === selectedPlan.id) ? selectedPlan.id : (list[0] && list[0].id);
  sel.innerHTML = list.map(p => `<option value="${p.id}" ${p.id === keep ? 'selected' : ''}>${esc(planName(p))} — ${esc(p.data_label)} — ${fmt(p.price)}</option>`).join('');
  selectedPlan = list.find(p => p.id === keep) || list[0] || null;
  updateSummary();
}

function filterOp(op) {
  filterOpValue = op;
  document.querySelectorAll('#op-pills .pill').forEach(b => b.classList.toggle('active', b.dataset.op === op));
  loadPlans();
}
function selectOperator(op) {
  selectedOp = op;
  document.querySelectorAll('#op-tabs .op-tab').forEach(b => b.classList.toggle('active', b.dataset.op === op));
  renderPlanSelect();
}
function onPlanChange() {
  const id = Number(document.getElementById('plan-select').value);
  selectedPlan = plans.find(p => p.id === id) || null;
  updateSummary();
}
function updateSummary() {
  const el = document.getElementById('plan-summary');
  if (!selectedPlan) { el.textContent = ''; document.getElementById('total-price').textContent = '—'; return; }
  el.textContent = `${OP_NAMES[selectedPlan.operator]} • ${selectedPlan.type} • ${validityLabel(selectedPlan.validity_days)}${selectedPlan.data_mb ? ' • ' + perGo(selectedPlan) : ''}`;
  const total = Math.max(0, selectedPlan.price - promo.discount);
  document.getElementById('old-price').textContent = promo.discount ? fmt(selectedPlan.price) : '';
  document.getElementById('total-price').textContent = fmt(total);
}
function quickBuy(id) {
  const p = plans.find(x => x.id === id);
  if (!p) return;
  selectOperator(p.operator);
  document.getElementById('plan-select').value = String(id);
  onPlanChange();
  document.getElementById('recharge').scrollIntoView({ behavior: 'smooth' });
  document.getElementById('phone-input').focus();
}

// ---------------- Paiement ----------------
function selectPay(m) {
  selectedPay = m;
  document.querySelectorAll('#pay-methods .pay').forEach(b => b.classList.toggle('active', b.dataset.pay === m));
  document.getElementById('ref-wrap').classList.toggle('hidden', !(m === 'd17' || m === 'flouci'));
  updatePayInfo();
}
function updatePayInfo() {
  const el = document.getElementById('pay-info');
  const total = selectedPlan ? Math.max(0, selectedPlan.price - promo.discount) : 0;
  if (selectedPay === 'd17') el.innerHTML = `💳 <b>D17 (La Poste)</b> — envoyez <b>${fmt(total)}</b> au numéro <b>${esc(config.d17_number || '—')}</b>, puis indiquez la référence de transaction ci-dessous.`;
  else if (selectedPay === 'flouci') el.innerHTML = `💳 <b>Flouci</b> — payez <b>${fmt(total)}</b> au numéro <b>${esc(config.flouci_number || '—')}</b>, puis indiquez la référence de transaction ci-dessous.`;
  else if (selectedPay === 'wallet') el.innerHTML = user
    ? `👛 <b>Paiement par solde</b> — votre solde : <b>${fmt(user.balance)}</b>. Le montant sera débité immédiatement et la recharge traitée en priorité.`
    : `👛 <b>Paiement par solde</b> — connectez-vous à votre compte client (validé par l'admin) pour utiliser votre solde.`;
  else el.innerHTML = `🤝 <b>Paiement manuel</b> — commandez maintenant, puis finalisez avec nous sur <a href="${waLink('Bonjour, je veux payer ma recharge manuellement.')}" target="_blank">WhatsApp</a>.`;
}

async function applyPromo() {
  const code = document.getElementById('promo-input').value.trim();
  const msg = document.getElementById('promo-msg');
  if (!code || !selectedPlan) { msg.textContent = ''; promo = { code: '', discount: 0 }; updateSummary(); return; }
  try {
    const r = await api('/api/orders/promo-check', { method: 'POST', body: JSON.stringify({ code, price: selectedPlan.price }) });
    promo = { code: r.code, discount: r.discount };
    msg.textContent = `✅ Code ${r.code} appliqué : -${fmt(r.discount)}`; msg.style.color = 'green';
  } catch (e) { promo = { code: '', discount: 0 }; msg.textContent = '❌ ' + e.message; msg.style.color = 'red'; }
  updateSummary();
}

async function submitOrder() {
  if (!selectedPlan) return toast('Choisissez un forfait.', true);
  const phone = document.getElementById('phone-input').value.trim();
  if (!/^[259]\d{7}$/.test(phone.replace(/[\s+]/g, '').replace(/^216/, ''))) return toast('Numéro tunisien invalide (8 chiffres, commence par 2, 5 ou 9).', true);
  const scheduled = document.getElementById('schedule-input').value;
  try {
    const r = await api('/api/orders', { method: 'POST', body: JSON.stringify({
      plan_id: selectedPlan.id, phone, payment_method: selectedPay,
      payment_ref: document.getElementById('ref-input').value.trim(),
      promo_code: promo.code, scheduled_for: scheduled || undefined,
    }) });
    showReceipt(r.order, r.whatsapp_number);
    promo = { code: '', discount: 0 }; document.getElementById('promo-input').value = '';
    document.getElementById('ref-input').value = '';
    if (user) { await refreshMe(); }
    toast('Commande créée : ' + r.order.code);
  } catch (e) { toast(e.message, true); }
}

function showReceipt(o, wa) {
  const waUrl = wa ? `https://wa.me/${wa.replace(/\D/g, '')}?text=${encodeURIComponent('Bonjour, ma commande ' + o.code + ' — ' + o.plan_name + ' pour le ' + o.phone + '.')}` : '#';
  openGeneric('🧾 Reçu — ' + o.code, `
    <div class="receipt">
      <div><span>Forfait</span><b>${esc(o.plan_name)} (${esc(o.data_label)})</b></div>
      <div><span>Opérateur</span><b>${esc(OP_NAMES[o.operator] || o.operator)}</b></div>
      <div><span>Numéro rechargé</span><b>${esc(o.phone)}</b></div>
      <div><span>Paiement</span><b>${esc(o.payment_method.toUpperCase())}${o.payment_ref ? ' — réf ' + esc(o.payment_ref) : ''}</b></div>
      ${o.discount ? `<div><span>Remise promo</span><b>-${fmt(o.discount)}</b></div>` : ''}
      <div><span>Total</span><b>${fmt(o.total)}</b></div>
      <div><span>Statut</span><b><span class="status ${o.status}">${o.status}</span></b></div>
      ${o.scheduled_for ? `<div><span>Programmée le</span><b>${esc(new Date(o.scheduled_for).toLocaleString('fr-FR'))}</b></div>` : ''}
    </div>
    <p class="small muted" style="margin-top:10px">Gardez ce code : <b>${o.code}</b> — suivez votre commande dans « Suivi commande ».</p>
    <p><a class="btn" href="${waUrl}" target="_blank">💬 Confirmer sur WhatsApp</a></p>`);
}

// ---------------- Suivi ----------------
async function trackOrder() {
  const code = document.getElementById('track-code').value.trim().toUpperCase();
  const box = document.getElementById('track-result');
  if (!code) return;
  try {
    const { order: o } = await api('/api/orders/track/' + encodeURIComponent(code));
    box.innerHTML = `<div class="receipt">
      <div><span>Code</span><b>${esc(o.code)}</b></div>
      <div><span>Forfait</span><b>${esc(o.plan_name)} — ${esc(o.data_label)}</b></div>
      <div><span>Numéro</span><b>${esc(o.phone)}</b></div>
      <div><span>Total</span><b>${fmt(o.total)}</b></div>
      <div><span>Statut</span><b><span class="status ${o.status}">${o.status}</span></b></div>
      <div><span>Créée le</span><b>${esc(new Date(o.created_at).toLocaleString('fr-FR'))}</b></div>
    </div>`;
  } catch (e) { box.innerHTML = `<p style="color:red">${esc(e.message)}</p>`; }
}

// ---------------- Comparateur ----------------
function toggleCompare(id) {
  compareIds = compareIds.includes(id) ? compareIds.filter(x => x !== id) : [...compareIds, id].slice(0, 4);
  localStorage.setItem('tr_compare', JSON.stringify(compareIds));
  renderPlans();
}
async function openCompare() {
  if (!compareIds.length) return toast('Sélectionnez au moins un forfait avec ⚖️.', true);
  try {
    const cmp = await api('/api/plans/compare?ids=' + compareIds.join(','));
    const list = cmp.plans;
    const warnHtml = cmp.validity_mismatch ? `<p class="compare-warn">⚠️ ${esc(cmp.warning || 'Ces forfaits n\'ont pas la même durée de validité — ils ne sont pas directement comparables.')}</p>` : '';
    const rows = [
      ['Opérateur', p => OP_NAMES[p.operator]], ['Forfait', p => planName(p)], ['Type', p => p.type],
      ['Data', p => p.data_label], ['Validité', p => validityLabel(p.validity_days)],
      ['Prix / Go', p => p.data_mb ? perGo(p) : '—'], ['Prix', p => fmt(p.price)],
    ];
    openGeneric('⚖️ Comparateur de forfaits', `${warnHtml}<div class="table-wrap"><table class="compare-table"><tr><td></td>${list.map(p => `<td><img src="${esc(p.image)}" style="width:34px;border-radius:8px"><br><b>${esc(planName(p))}</b></td>`).join('')}</tr>
      ${rows.map(([label, fn]) => `<tr><td>${label}</td>${list.map(p => `<td>${esc(fn(p))}</td>`).join('')}</tr>`).join('')}
      <tr><td></td>${list.map(p => `<td><button class="btn small" onclick="closeGeneric();quickBuy(${p.id})">Recharger</button></td>`).join('')}</tr></table></div>`);
  } catch (e) { toast(e.message, true); }
}

// ---------------- Auth ----------------
let authMode = 'login';
function openAuth() { document.getElementById('auth-modal').classList.add('open'); }
function closeAuth(e) { if (e) e.preventDefault(); document.getElementById('auth-modal').classList.remove('open'); }
function toggleAuthMode(e) {
  e.preventDefault();
  authMode = authMode === 'login' ? 'register' : 'login';
  document.getElementById('auth-title').textContent = authMode === 'login' ? 'Connexion' : 'Créer un compte';
  document.getElementById('auth-submit').textContent = authMode === 'login' ? 'Se connecter' : 'Créer mon compte';
  document.getElementById('register-fields').classList.toggle('hidden', authMode === 'login');
  document.getElementById('pending-note').textContent = authMode === 'register'
    ? '⚠️ Votre compte devra être approuvé par l\'administrateur avant votre première connexion.'
    : '';
  e.target.textContent = authMode === 'login' ? 'Pas encore de compte ? Créer un compte' : 'Déjà un compte ? Se connecter';
}
async function submitAuth() {
  const msg = document.getElementById('auth-msg');
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-pass').value;
  try {
    if (authMode === 'register') {
      const r = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({
        name: document.getElementById('reg-name').value.trim(),
        phone: document.getElementById('reg-phone').value.trim(), email, password }) });
      msg.style.color = 'green'; msg.textContent = '✅ ' + r.message;
      toast('Inscription envoyée — en attente de validation admin.');
    } else {
      const r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      token = r.token; user = r.user; localStorage.setItem('tr_token', token);
      closeAuth(); syncAuthUI(); showDashboard();
      toast('Bienvenue, ' + user.name + ' !');
    }
  } catch (e) { msg.style.color = 'red'; msg.textContent = '❌ ' + e.message; }
}
async function refreshMe() {
  try { const r = await api('/api/auth/me'); user = r.user; syncAuthUI(); } catch { user = null; token = ''; localStorage.removeItem('tr_token'); syncAuthUI(); }
}
function logout() {
  token = ''; user = null; localStorage.removeItem('tr_token');
  syncAuthUI();
  document.getElementById('dashboard-section').classList.add('hidden');
  document.getElementById('admin-section').classList.add('hidden');
  toast('Déconnecté.');
}
function syncAuthUI() {
  document.getElementById('auth-btn').classList.toggle('hidden', !!user);
  document.getElementById('logout-btn').classList.toggle('hidden', !user);
  document.getElementById('nav-dashboard').classList.toggle('hidden', !user || user.role !== 'client');
  document.getElementById('nav-admin').classList.toggle('hidden', !user || user.role !== 'admin');
  document.getElementById('auth-btn').textContent = user ? user.name : 'Connexion';
  if (user) {
    document.getElementById('wallet-hint').textContent = fmt(user.balance);
    const lvl = document.getElementById('dash-level');
    if (lvl) lvl.textContent = user.role === 'admin' ? 'Administrateur' : ('Niveau ' + (user.pricing_level || 1));
  }
  updatePayInfo();
}

// ---------------- Espace client ----------------
async function showDashboard() {
  if (!user) return openAuth();
  if (user.role === 'admin') return showAdmin();
  document.getElementById('dashboard-section').classList.remove('hidden');
  document.getElementById('dashboard-section').scrollIntoView({ behavior: 'smooth' });
  loadDash('orders');
}
async function loadDash(tab) {
  const box = document.getElementById('dash-content');
  try {
    if (tab === 'orders') {
      const qs = new URLSearchParams();
      if (window._dashStatus) qs.set('status', window._dashStatus);
      if (window._dashQ) qs.set('q', window._dashQ);
      const { orders } = await api('/api/orders/mine' + (qs.toString() ? '?' + qs : ''));
      const { balance } = await api('/api/wallet');
      document.getElementById('dash-balance').textContent = fmt(balance);
      document.getElementById('dash-user').textContent = user.name + ' • ' + user.email + ' • Niveau ' + (user.pricing_level || 1);
      const filters = `<div class="toolbar" style="margin-bottom:10px">
        <select id="dash-status" onchange="window._dashStatus=this.value;loadDash('orders')" style="width:auto"><option value="">Tous statuts</option>${['Pending', 'Processing', 'Completed', 'Cancelled', 'Scheduled'].map(s => `<option ${window._dashStatus === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <input id="dash-q" placeholder="Rechercher (code, numéro, forfait)…" value="${esc(window._dashQ || '')}" oninput="window._dashQ=this.value;clearTimeout(window._dqT);window._dqT=setTimeout(()=>loadDash('orders'),400)" style="flex:1">
        <a class="btn small soft" href="/api/orders/mine/export" onclick="event.preventDefault();exportMyOrders()">⬇ Excel (CSV)</a></div>`;
      box.innerHTML = filters + (orders.length ? `<table><tr><th>Code</th><th>Forfait</th><th>Numéro</th><th>Total</th><th>Statut</th><th>Date</th><th></th></tr>
        ${orders.map(o => `<tr><td><b>${esc(o.code)}</b></td><td>${esc(o.plan_name)}<br><span class="muted small">${esc(o.data_label)}</span></td><td>${esc(o.phone)}</td><td>${fmt(o.total)}</td><td><span class="status ${o.status}">${o.status}</span></td><td class="small">${esc(new Date(o.created_at).toLocaleDateString('fr-FR'))}</td><td><button class="btn small soft" onclick="repeatOrder(${o.id})">↻ Répéter</button></td></tr>`).join('')}</table>`
        : '<p class="muted">Aucune recharge pour le moment. Lancez votre première recharge rapide ci-dessus !</p>');
    } else if (tab === 'wallet') {
      const { balance, transactions } = await api('/api/wallet');
      document.getElementById('dash-balance').textContent = fmt(balance);
      box.innerHTML = transactions.length ? `<table><tr><th>Date</th><th>Type</th><th>Motif</th><th>Montant</th><th>Statut</th></tr>
        ${transactions.map(w => `<tr><td class="small">${esc(new Date(w.created_at).toLocaleString('fr-FR'))}</td><td>${esc(w.kind)}</td><td>${esc(w.reason)}</td><td style="color:${w.amount >= 0 ? 'green' : 'red'};font-weight:700">${w.amount >= 0 ? '+' : ''}${fmt(w.amount)}</td><td>${esc(w.status)}</td></tr>`).join('')}</table>`
        : '<p class="muted">Aucun mouvement de solde.</p>';
    } else if (tab === 'favs') {
      const { favorites } = await api('/api/orders/favorites');
      box.innerHTML = favorites.length ? `<table><tr><th>Forfait</th><th>Numéro</th><th>Prix</th><th></th></tr>
        ${favorites.map(f => `<tr><td>${esc(f.plan_name)} — ${esc(f.data_label)}</td><td>${esc(f.phone || '—')}</td><td>${fmt(f.price)}</td><td><button class="btn small" onclick="quickBuy(${f.plan_id})">Recharger</button> <button class="btn small soft" onclick="delFav(${f.id})">✕</button></td></tr>`).join('')}</table>`
        : '<p class="muted">Aucun favori. Cliquez sur ⭐ sur un forfait pour l\'enregistrer.</p>';
    } else if (tab === 'notifs') {
      const { notifications, unread } = await api('/api/notifications/mine');
      const nc = document.getElementById('notif-count');
      if (nc) { nc.textContent = unread; nc.classList.toggle('hidden', !unread); }
      box.innerHTML = notifications.length ? notifications.map(n => `<p style="${n.read ? 'opacity:.65' : ''}">🔔 <b>${esc(n.kind)}</b> ${n.ref ? '— ' + esc(n.ref) : ''} — ${esc(n.message)} <span class="muted small">${esc(new Date(n.created_at).toLocaleString('fr-FR'))}</span> ${n.read ? '' : `<button class="btn small soft" onclick="markNotifRead(${n.id})">Lu</button>`}</p>`).join('') + `<p><button class="btn small soft" onclick="markAllNotifRead()">Tout marquer comme lu</button></p>`
        : '<p class="muted">Aucune notification.</p>';
    } else if (tab === 'tickets') {
      const { tickets } = await api('/api/tickets/mine');
      box.innerHTML = `<div style="margin-bottom:14px">
        <label>Sujet</label><input id="tk-subject" placeholder="Ex. Commande non activée">
        <label>Message</label><textarea id="tk-message" rows="3" placeholder="Décrivez votre problème…"></textarea>
        <label>Code de commande (optionnel)</label><input id="tk-code" placeholder="TR-XXXXXX">
        <button class="btn" style="margin-top:10px" onclick="createTicket()">🎫 Envoyer le ticket</button></div>
        <div id="tk-msg" class="small"></div>
        ${tickets.length ? `<table><tr><th>#</th><th>Sujet</th><th>Statut</th><th>Réponse</th><th>Date</th></tr>
        ${tickets.map(tk => `<tr><td>${tk.id}</td><td><b>${esc(tk.subject)}</b><br><span class="muted small">${esc(tk.message)}</span></td><td><span class="status ${tk.status === 'closed' ? 'Completed' : tk.status === 'answered' ? 'Processing' : 'Pending'}">${tk.status}</span></td><td>${esc(tk.admin_reply || '—')}</td><td class="small">${esc(new Date(tk.created_at).toLocaleString('fr-FR'))}</td></tr>`).join('')}</table>`
        : '<p class="muted">Aucun ticket pour le moment.</p>'}`;
    }
  } catch (e) { box.innerHTML = `<p style="color:red">${esc(e.message)}</p>`; }
}
function dashTab(tab, btn) {
  document.querySelectorAll('#dashboard-section .tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active'); loadDash(tab);
}
async function repeatOrder(id) {
  try { const r = await api('/api/orders/' + id + '/repeat', { method: 'POST' }); toast(r.message + ' Code : ' + r.code); loadDash('orders'); }
  catch (e) { toast(e.message, true); }
}
async function exportMyOrders() {
  try {
    const r = await fetch('/api/orders/mine/export', { headers: authHeaders() });
    if (!r.ok) throw new Error('Export impossible.');
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'trust-net-mes-commandes.csv'; a.click();
    toast('Export Excel (CSV) téléchargé.');
  } catch (e) { toast(e.message, true); }
}
async function markNotifRead(id) { try { await api('/api/notifications/' + id + '/read', { method: 'POST' }); loadDash('notifs'); } catch (e) { toast(e.message, true); } }
async function markAllNotifRead() { try { await api('/api/notifications/read-all', { method: 'POST' }); loadDash('notifs'); } catch (e) { toast(e.message, true); } }
async function createTicket() {
  const msg = document.getElementById('tk-msg');
  try {
    const r = await api('/api/tickets', { method: 'POST', body: JSON.stringify({
      subject: document.getElementById('tk-subject').value.trim(),
      message: document.getElementById('tk-message').value.trim(),
      order_code: document.getElementById('tk-code').value.trim() }) });
    msg.style.color = 'green'; msg.textContent = '✅ ' + r.message;
    setTimeout(() => loadDash('tickets'), 600);
  } catch (e) { msg.style.color = 'red'; msg.textContent = '❌ ' + e.message; }
}
// Commande groupée (bulk)
function openBulk() {
  if (!user) return openAuth();
  const sel = document.getElementById('bulk-plan');
  sel.innerHTML = plans.map(p => `<option value="${p.id}">${esc(planName(p))} — ${esc(p.data_label)} — ${fmt(p.price)}</option>`).join('');
  document.getElementById('bulk-pay').onchange = e => document.getElementById('bulk-ref-wrap').classList.toggle('hidden', !(e.target.value === 'd17' || e.target.value === 'flouci'));
  document.getElementById('bulk-modal').classList.add('open');
}
function closeBulk(e) { if (e) e.preventDefault(); document.getElementById('bulk-modal').classList.remove('open'); }
async function submitBulk() {
  const msg = document.getElementById('bulk-msg');
  const phones = document.getElementById('bulk-phones').value.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
  if (!phones.length) { msg.style.color = 'red'; msg.textContent = '❌ Entrez au moins un numéro.'; return; }
  try {
    const r = await api('/api/orders/bulk', { method: 'POST', body: JSON.stringify({
      plan_id: Number(document.getElementById('bulk-plan').value), phones,
      payment_method: document.getElementById('bulk-pay').value,
      payment_ref: document.getElementById('bulk-ref').value.trim() }) });
    msg.style.color = 'green';
    msg.innerHTML = `✅ Groupe ${esc(r.bulk_group_id)} — ${r.succeeded} réussie(s), ${r.failed} en échec, total ${fmt(r.total)}.<br>` +
      r.results.map(x => x.ok ? `• ${esc(x.phone)} → <b>${esc(x.code)}</b>` : `• ${esc(x.phone)} → ❌ ${esc(x.error)}`).join('<br>');
    await refreshMe(); loadDash('orders');
  } catch (e) { msg.style.color = 'red'; msg.textContent = '❌ ' + e.message; }
}
async function addFavorite(planId) {
  if (!user) return openAuth();
  try { await api('/api/orders/favorites', { method: 'POST', body: JSON.stringify({ plan_id: planId }) }); toast('⭐ Ajouté aux favoris.'); }
  catch (e) { toast(e.message, true); }
}
async function delFav(id) { try { await api('/api/orders/favorites/' + id, { method: 'DELETE' }); loadDash('favs'); } catch (e) { toast(e.message, true); } }

// Recharge de solde
function openTopup() {
  document.getElementById('topup-info').innerHTML = `💳 D17 : <b>${esc(config.d17_number || '—')}</b> • Flouci : <b>${esc(config.flouci_number || '—')}</b>`;
  document.getElementById('topup-modal').classList.add('open');
}
function closeTopup(e) { if (e) e.preventDefault(); document.getElementById('topup-modal').classList.remove('open'); }
async function submitTopup() {
  const msg = document.getElementById('topup-msg');
  try {
    const r = await api('/api/wallet/topup-request', { method: 'POST', body: JSON.stringify({
      amount: Number(document.getElementById('topup-amount').value),
      payment_method: document.getElementById('topup-pay').value,
      payment_ref: document.getElementById('topup-ref').value.trim() }) });
    msg.style.color = 'green'; msg.textContent = '✅ ' + r.message;
    setTimeout(() => { closeTopup(); loadDash('wallet'); }, 1200);
  } catch (e) { msg.style.color = 'red'; msg.textContent = '❌ ' + e.message; }
}

// ---------------- Admin ----------------
async function showAdmin() {
  if (!user || user.role !== 'admin') return toast('Accès administrateur requis.', true);
  document.getElementById('admin-section').classList.remove('hidden');
  document.getElementById('admin-section').scrollIntoView({ behavior: 'smooth' });
  loadAdminStats(); adminTab('pending', document.querySelector('#admin-tabs .tab'));
}
async function loadAdminStats() {
  try {
    const s = await api('/api/admin/stats');
    document.getElementById('admin-stats').innerHTML = `
      <div class="stat"><b>${fmt(s.today.s)}</b><span>Ventes aujourd'hui (${s.today.c} commandes)</span></div>
      <div class="stat"><b>${fmt(s.total.s)}</b><span>Ventes totales (${s.total.c} commandes)</span></div>
      <div class="stat"><b>${s.pendingUsers}</b><span>Comptes en attente ⏳</span></div>
      <div class="stat"><b>${s.clients}</b><span>Clients approuvés</span></div>
      <div class="stat"><b>${fmt(s.totalBalance)}</b><span>Solde total clients</span></div>
      <div class="stat"><b>${s.pendingOrders}</b><span>Commandes en attente</span></div>
      <div class="stat"><b>${s.pendingTopups}</b><span>Recharges solde à valider</span></div>`;
  } catch (e) { document.getElementById('admin-stats').innerHTML = `<p style="color:red">${esc(e.message)}</p>`; }
}
function adminTab(tab, btn) {
  document.querySelectorAll('#admin-tabs .tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadAdmin(tab);
}
async function loadAdmin(tab) {
  const box = document.getElementById('admin-content');
  box.innerHTML = 'Chargement…';
  try {
    if (tab === 'pending') {
      const { users } = await api('/api/admin/users?status=pending');
      box.innerHTML = users.length ? `<table><tr><th>Nom</th><th>Téléphone</th><th>Email</th><th>Inscription</th><th>Actions</th></tr>
        ${users.map(u => `<tr><td><b>${esc(u.name)}</b></td><td>${esc(u.phone)}</td><td>${esc(u.email)}</td><td class="small">${esc(new Date(u.created_at).toLocaleString('fr-FR'))}</td>
        <td><button class="btn small green" onclick="approveUser(${u.id})">✅ Approuver</button> <button class="btn small danger" onclick="rejectUser(${u.id})">✕ Refuser</button></td></tr>`).join('')}</table>`
        : '<p class="muted">✅ Aucun compte en attente.</p>';
    } else if (tab === 'topups') {
      const { topups } = await api('/api/admin/topups');
      box.innerHTML = topups.length ? `<table><tr><th>Client</th><th>Montant</th><th>Motif / référence</th><th>Date</th><th>Actions</th></tr>
        ${topups.map(w => `<tr><td><b>${esc(w.user_name)}</b><br><span class="muted small">${esc(w.email)} • ${esc(w.phone)}</span></td><td><b>${fmt(w.amount)}</b></td><td>${esc(w.reason)}</td><td class="small">${esc(new Date(w.created_at).toLocaleString('fr-FR'))}</td>
        <td><button class="btn small green" onclick="confirmTopup(${w.id})">✅ Créditer</button> <button class="btn small danger" onclick="rejectTopup(${w.id})">✕ Refuser</button></td></tr>`).join('')}</table>`
        : '<p class="muted">Aucune demande de recharge de solde en attente.</p>';
    } else if (tab === 'orders') {
      const { orders } = await api('/api/admin/orders');
      box.innerHTML = orders.length ? `<table><tr><th>Code</th><th>Client / N°</th><th>Forfait</th><th>Paiement</th><th>Total</th><th>Statut</th><th>Action</th></tr>
        ${orders.map(o => `<tr><td><b>${esc(o.code)}</b><br><span class="muted small">${esc(new Date(o.created_at).toLocaleString('fr-FR'))}</span></td>
        <td>${esc(o.user_name || 'Invité')}<br><b>${esc(o.phone)}</b></td><td>${esc(o.plan_name)}<br><span class="muted small">${esc(o.operator)}</span></td>
        <td>${esc(o.payment_method)}${o.payment_ref ? '<br><span class="muted small">réf ' + esc(o.payment_ref) + '</span>' : ''}</td>
        <td>${fmt(o.total)}</td><td><span class="status ${o.status}">${o.status}</span></td>
        <td><select onchange="setOrderStatus(${o.id},this.value)"><option value="">Changer…</option>${['Pending', 'Processing', 'Completed', 'Cancelled'].map(s => `<option ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td></tr>`).join('')}</table>`
        : '<p class="muted">Aucune commande.</p>';
    } else if (tab === 'clients') {
      const { users } = await api('/api/admin/users');
      box.innerHTML = users.length ? `<table><tr><th>Client</th><th>Téléphone</th><th>Statut</th><th>Niveau tarifaire</th><th>Solde</th><th>Créditer / Débiter</th></tr>
        ${users.map(u => `<tr><td><b>${esc(u.name)}</b><br><span class="muted small">${esc(u.email)}</span></td><td>${esc(u.phone)}</td><td><span class="status ${u.status}">${u.status}</span></td>
        <td><select onchange="setLevel(${u.id},this.value)"><option value="1" ${u.pricing_level === 1 ? 'selected' : ''}>Niveau 1</option><option value="2" ${u.pricing_level === 2 ? 'selected' : ''}>Niveau 2</option></select></td>
        <td><b>${fmt(u.balance)}</b></td>
        <td><input id="bal-${u.id}" type="number" step="0.5" placeholder="+/- montant" style="width:110px"> <input id="why-${u.id}" placeholder="Motif" style="width:130px"> <button class="btn small" onclick="adjustBalance(${u.id})">Valider</button> <button class="btn small soft" onclick="viewWallet(${u.id},'${esc(u.name)}')">Historique</button></td></tr>`).join('')}</table>`
        : '<p class="muted">Aucun client.</p>';
    } else if (tab === 'plans') {
      const { plans: all } = await api('/api/admin/plans');
      box.innerHTML = `<p><button class="btn small" onclick="planForm()">＋ Nouveau forfait</button></p>
        <div id="plan-form"></div>
        <table><tr><th>Opérateur</th><th>Forfait</th><th>Data</th><th>Validité</th><th>Prix public</th><th>Niveau 1</th><th>Niveau 2</th><th>Coût</th><th>Actif</th><th></th></tr>
        ${all.map(p => `<tr><td>${esc(OP_NAMES[p.operator])}</td><td><b>${esc(p.name_fr)}</b><br><span class="muted small">${esc(p.type)}</span></td><td>${esc(p.data_label)}</td><td>${p.validity_days} j</td>
        <td><input id="price-${p.id}" type="number" step="0.1" value="${p.price}" style="width:80px"> DT</td><td>${fmt(p.price_level1 ?? p.price)}</td><td>${fmt(p.price_level2 ?? p.price)}</td><td>${fmt(p.cost_price ?? p.price)}</td><td>${p.active ? '✅' : '❌'}</td>
        <td><button class="btn small" onclick="savePrice(${p.id})">💾 Prix</button> <button class="btn small soft" onclick="planForm(${p.id})">✏️</button> <button class="btn small danger" onclick="disablePlan(${p.id})">Désactiver</button></td></tr>`).join('')}</table>`;
    } else if (tab === 'pricing') {
      const { plans: all } = await api('/api/admin/pricing');
      const { history } = await api('/api/admin/pricing/history');
      const { groups } = await api('/api/admin/pricing/compare');
      box.innerHTML = `<h3>💲 Gestion des tarifs — Niveau 1 / Niveau 2</h3>
        <p class="muted small">Modifiez les deux prix indépendamment. Chaque changement est enregistré dans l'historique (date, admin, ancien / nouveau prix). Les clients ne voient que leur propre niveau.</p>
        <table><tr><th>Forfait</th><th>Opérateur</th><th>Data</th><th>Validité</th><th>Niveau 1 (DT)</th><th>Niveau 2 (DT)</th><th>Coût (DT)</th><th></th></tr>
        ${all.map(p => `<tr><td><b>${esc(p.name_fr)}</b></td><td>${esc(OP_NAMES[p.operator])}</td><td>${esc(p.data_label)}</td><td>${p.validity_days} j</td>
        <td><input id="l1-${p.id}" type="number" step="0.01" value="${p.price_level1 ?? p.price}" style="width:90px"></td>
        <td><input id="l2-${p.id}" type="number" step="0.01" value="${p.price_level2 ?? p.price}" style="width:90px"></td>
        <td><input id="cost-${p.id}" type="number" step="0.01" value="${p.cost_price ?? p.price}" style="width:90px"></td>
        <td><button class="btn small" onclick="saveLevels(${p.id})">💾 Enregistrer</button></td></tr>`).join('')}</table>
        <h3 style="margin-top:20px">⚖️ Comparaison entre opérateurs (même data + même validité)</h3>
        ${groups.filter(g => g.plans.length > 1).map(g => `<p><b>${esc(g.plans[0].data_label)} — ${g.validity_days} jours</b></p><table><tr><th>Opérateur</th><th>Forfait</th><th>Niveau 1</th><th>Niveau 2</th><th>Prix / Go (L1)</th><th>Prix / Go (L2)</th></tr>
        ${g.plans.map(p => `<tr><td>${esc(OP_NAMES[p.operator])}</td><td>${esc(p.name_fr)}</td><td>${fmt(p.price_level1)}</td><td>${fmt(p.price_level2)}</td><td>${p.price_per_gb_l1} DT</td><td>${p.price_per_gb_l2} DT</td></tr>`).join('')}</table>`).join('') || '<p class="muted">Aucun groupe comparable.</p>'}
        <h3 style="margin-top:20px">🕘 Historique des prix (derniers changements)</h3>
        ${history.length ? `<table><tr><th>Date</th><th>Forfait</th><th>Admin</th><th>Niveau 1</th><th>Niveau 2</th><th>Motif</th></tr>
        ${history.slice(0, 20).map(h => `<tr><td class="small">${esc(new Date(h.created_at).toLocaleString('fr-FR'))}</td><td>${esc(h.plan_name || ('#' + h.plan_id))}</td><td>${esc(h.admin_name || '—')}</td><td>${h.old_level1} → <b>${h.new_level1}</b> DT</td><td>${h.old_level2} → <b>${h.new_level2}</b> DT</td><td>${esc(h.reason || '')}</td></tr>`).join('')}</table>` : '<p class="muted">Aucun changement de prix enregistré.</p>'}`;
    } else if (tab === 'operators') {
      const { operators } = await api('/api/admin/operators');
      box.innerHTML = `<h3>📡 Disponibilité des opérateurs</h3>
        <p class="muted small">Statut géré manuellement par l'administrateur. TRUST NET n'affiche jamais un statut « en ligne » automatique sans information fiable — les commandes sont traitées manuellement.</p>
        <table><tr><th>Opérateur</th><th>Statut</th><th>Message affiché aux clients</th><th></th></tr>
        ${operators.map(o => `<tr><td><b>${esc(OP_NAMES[o.operator])}</b></td>
        <td><select id="op-status-${o.operator}"><option value="available" ${o.status === 'available' ? 'selected' : ''}>✅ Disponible</option><option value="unavailable" ${o.status === 'unavailable' ? 'selected' : ''}>⛔ Temporairement indisponible</option><option value="maintenance" ${o.status === 'maintenance' ? 'selected' : ''}>🛠️ En maintenance</option></select></td>
        <td><input id="op-msg-${o.operator}" value="${esc(o.message || '')}" style="width:100%"></td>
        <td><button class="btn small" onclick="saveOperator('${o.operator}')">💾 Enregistrer</button></td></tr>`).join('')}</table>`;
    } else if (tab === 'reports') {
      const from = document.getElementById('rep-from')?.value || '';
      const to = document.getElementById('rep-to')?.value || '';
      const qs = new URLSearchParams(); if (from) qs.set('from', from); if (to) qs.set('to', to);
      const r = await api('/api/admin/reports' + (qs.toString() ? '?' + qs : ''));
      box.innerHTML = `<h3>📊 Rapports &amp; analytics</h3>
        <div class="toolbar"><label style="margin:0">Du <input type="date" id="rep-from" value="${from}" onchange="loadAdmin('reports')" style="width:auto"></label>
        <label style="margin:0">Au <input type="date" id="rep-to" value="${to}" onchange="loadAdmin('reports')" style="width:auto"></label>
        <a class="btn small soft" href="/api/admin/orders/export" onclick="event.preventDefault();exportAdminOrders()">⬇ Export commandes (CSV)</a></div>
        <div class="stats">
          <div class="stat"><b>${fmt(r.total_sales.s)}</b><span>Ventes totales (${r.total_sales.c} commandes)</span></div>
          <div class="stat"><b>${fmt(r.total_sales.profit)}</b><span>Profit total estimé</span></div>
          <div class="stat"><b>${r.successful}</b><span>Commandes réussies (Completed)</span></div>
          <div class="stat"><b>${r.failed}</b><span>Commandes annulées</span></div>
        </div>
        <h3>Ventes par opérateur</h3><table><tr><th>Opérateur</th><th>Commandes</th><th>Ventes</th></tr>${r.orders_by_operator.map(x => `<tr><td>${esc(OP_NAMES[x.operator] || x.operator)}</td><td>${x.c}</td><td>${fmt(x.s)}</td></tr>`).join('')}</table>
        <h3 style="margin-top:16px">Niveau 1 vs Niveau 2</h3><table><tr><th>Niveau</th><th>Commandes</th><th>Ventes</th></tr>${r.level1_vs_level2.map(x => `<tr><td>${x.level_at_order ? 'Niveau ' + x.level_at_order : 'Invité / ancien'}</td><td>${x.c}</td><td>${fmt(x.s)}</td></tr>`).join('')}</table>
        <h3 style="margin-top:16px">Revenu par jour</h3><table><tr><th>Date</th><th>Commandes</th><th>Revenu</th></tr>${r.revenue_by_date.map(x => `<tr><td>${x.d}</td><td>${x.c}</td><td>${fmt(x.s)}</td></tr>`).join('') || '<tr><td colspan="3">Aucune vente sur la période.</td></tr>'}</table>
        <h3 style="margin-top:16px">Profit par jour</h3><table><tr><th>Date</th><th>Profit</th></tr>${r.profit_by_date.map(x => `<tr><td>${x.d}</td><td>${fmt(x.profit)}</td></tr>`).join('')}</table>
        <h3 style="margin-top:16px">Top clients</h3><table><tr><th>Client</th><th>Niveau</th><th>Commandes</th><th>Total dépensé</th><th>Dernière commande</th></tr>${r.customer_activity.slice(0, 10).map(x => `<tr><td>${esc(x.name || 'Invité')}</td><td>${x.pricing_level ? 'Niveau ' + x.pricing_level : '—'}</td><td>${x.orders}</td><td>${fmt(x.spent)}</td><td class="small">${x.last_order ? esc(new Date(x.last_order).toLocaleString('fr-FR')) : '—'}</td></tr>`).join('')}</table>
        <h3 style="margin-top:16px">Activité clients</h3><table><tr><th>Client</th><th>Solde</th><th>Commandes</th><th>Dépensé</th></tr>${r.customer_activity.slice(0, 15).map(x => `<tr><td>${esc(x.name)}</td><td>${fmt(x.balance)}</td><td>${x.orders}</td><td>${fmt(x.spent)}</td></tr>`).join('')}</table>`;
    } else if (tab === 'tickets') {
      const { tickets } = await api('/api/admin/tickets');
      box.innerHTML = tickets.length ? `<table><tr><th>#</th><th>Client</th><th>Sujet</th><th>Statut</th><th>Réponse</th><th></th></tr>
        ${tickets.map(tk => `<tr><td>${tk.id}</td><td><b>${esc(tk.user_name)}</b><br><span class="muted small">${esc(tk.email || '')} • ${esc(tk.phone || '')}</span></td>
        <td><b>${esc(tk.subject)}</b><br><span class="muted small">${esc(tk.message)}</span>${tk.order_code ? `<br><span class="muted small">Commande : ${esc(tk.order_code)}</span>` : ''}</td>
        <td><select id="tk-status-${tk.id}"><option value="open" ${tk.status === 'open' ? 'selected' : ''}>Ouvert</option><option value="answered" ${tk.status === 'answered' ? 'selected' : ''}>Répondu</option><option value="closed" ${tk.status === 'closed' ? 'selected' : ''}>Fermé</option></select></td>
        <td><input id="tk-reply-${tk.id}" value="${esc(tk.admin_reply || '')}" placeholder="Réponse au client" style="width:180px"></td>
        <td><button class="btn small" onclick="saveTicket(${tk.id})">💾 Répondre</button></td></tr>`).join('')}</table>`
        : '<p class="muted">Aucun ticket support.</p>';
    } else if (tab === 'promos') {
      const { promos } = await api('/api/admin/promos');
      box.innerHTML = `<p><input id="promo-code" placeholder="CODE" style="width:140px"> <input id="promo-pct" type="number" placeholder="% remise" style="width:110px"> <input id="promo-max" type="number" placeholder="Max DT" style="width:100px"> <button class="btn small" onclick="createPromo()">＋ Créer</button></p>
        <table><tr><th>Code</th><th>Remise</th><th>Max</th><th>Description</th><th>Actif</th><th></th></tr>
        ${promos.map(p => `<tr><td><b>${esc(p.code)}</b></td><td>${p.percent}%</td><td>${fmt(p.max_discount)}</td><td>${esc(p.description_fr)}</td><td>${p.active ? '✅' : '❌'}</td><td><button class="btn small soft" onclick="togglePromo(${p.id})">Activer / Désactiver</button></td></tr>`).join('')}</table>`;
    } else if (tab === 'settings') {
      const { settings } = await api('/api/admin/settings');
      box.innerHTML = `<label>Numéro WhatsApp (format international, ex. 21655123456)</label><input id="set-wa" value="${esc(settings.whatsapp_number || '')}">
        <label>Numéro D17</label><input id="set-d17" value="${esc(settings.d17_number || '')}">
        <label>Numéro Flouci</label><input id="set-flouci" value="${esc(settings.flouci_number || '')}">
        <label>Montant minimum de recharge de solde (DT)</label><input id="set-min" type="number" value="${esc(settings.min_topup || '5')}">
        <label>Annonce (français)</label><input id="set-ann-fr" value="${esc(settings.announcement_fr || '')}">
        <label>Annonce (arabe)</label><input id="set-ann-ar" value="${esc(settings.announcement_ar || '')}">
        <button class="btn" style="margin-top:12px" onclick="saveSettings()">💾 Enregistrer les paramètres</button>`;
    }
  } catch (e) { box.innerHTML = `<p style="color:red">${esc(e.message)}</p>`; }
}
async function approveUser(id) { try { const r = await api('/api/admin/users/' + id + '/approve', { method: 'POST' }); toast(r.message); loadAdminStats(); loadAdmin('pending'); } catch (e) { toast(e.message, true); } }
async function setLevel(id, level) {
  try { const r = await api('/api/admin/users/' + id + '/level', { method: 'PUT', body: JSON.stringify({ pricing_level: Number(level) }) }); toast(r.message); loadAdmin('clients'); }
  catch (e) { toast(e.message, true); loadAdmin('clients'); }
}
async function saveLevels(id) {
  try {
    const all = await api('/api/admin/plans');
    const p = all.plans.find(x => x.id === id);
    await api('/api/admin/plans/' + id, { method: 'PUT', body: JSON.stringify({ ...p,
      price_level1: Number(document.getElementById('l1-' + id).value),
      price_level2: Number(document.getElementById('l2-' + id).value),
      cost_price: Number(document.getElementById('cost-' + id).value),
      reason: 'Modification via Gestion des tarifs' }) });
    toast('Tarifs Niveau 1 / Niveau 2 enregistrés.'); loadAdmin('pricing'); loadPlans();
  } catch (e) { toast(e.message, true); }
}
async function saveOperator(op) {
  try {
    const r = await api('/api/admin/operators/' + op, { method: 'PUT', body: JSON.stringify({
      status: document.getElementById('op-status-' + op).value,
      message: document.getElementById('op-msg-' + op).value.trim() }) });
    toast(r.message); loadAdmin('operators'); loadOperators(); loadPlans();
  } catch (e) { toast(e.message, true); }
}
async function saveTicket(id) {
  try {
    await api('/api/admin/tickets/' + id, { method: 'PUT', body: JSON.stringify({
      status: document.getElementById('tk-status-' + id).value,
      admin_reply: document.getElementById('tk-reply-' + id).value.trim() }) });
    toast('Ticket mis à jour.'); loadAdmin('tickets');
  } catch (e) { toast(e.message, true); }
}
async function exportAdminOrders() {
  try {
    const r = await fetch('/api/admin/orders/export', { headers: authHeaders() });
    if (!r.ok) throw new Error('Export impossible.');
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'trust-net-commandes.csv'; a.click();
    toast('Export Excel (CSV) téléchargé.');
  } catch (e) { toast(e.message, true); }
}
async function rejectUser(id) { if (!confirm('Refuser ce compte ?')) return; try { const r = await api('/api/admin/users/' + id + '/reject', { method: 'POST' }); toast(r.message); loadAdminStats(); loadAdmin('pending'); } catch (e) { toast(e.message, true); } }
async function confirmTopup(id) { try { const r = await api('/api/admin/topups/' + id + '/confirm', { method: 'POST' }); toast(r.message); loadAdminStats(); loadAdmin('topups'); } catch (e) { toast(e.message, true); } }
async function rejectTopup(id) { if (!confirm('Refuser cette demande de recharge ?')) return; try { const r = await api('/api/admin/topups/' + id + '/reject', { method: 'POST' }); toast(r.message); loadAdmin('topups'); } catch (e) { toast(e.message, true); } }
async function adjustBalance(id) {
  const amount = Number(document.getElementById('bal-' + id).value);
  const reason = document.getElementById('why-' + id).value.trim();
  try { const r = await api('/api/admin/users/' + id + '/balance', { method: 'POST', body: JSON.stringify({ amount, reason }) }); toast(r.message); loadAdminStats(); loadAdmin('clients'); }
  catch (e) { toast(e.message, true); }
}
async function viewWallet(id, name) {
  try {
    const { user: u, transactions } = await api('/api/admin/users/' + id + '/wallet');
    openGeneric('👛 Solde — ' + name + ' : ' + fmt(u.balance), transactions.length
      ? `<table><tr><th>Date</th><th>Type</th><th>Motif</th><th>Montant</th><th>Admin</th></tr>${transactions.map(w => `<tr><td class="small">${esc(new Date(w.created_at).toLocaleString('fr-FR'))}</td><td>${esc(w.kind)}</td><td>${esc(w.reason)}</td><td style="color:${w.amount >= 0 ? 'green' : 'red'};font-weight:700">${w.amount >= 0 ? '+' : ''}${fmt(w.amount)}</td><td>${esc(w.admin_name || '—')}</td></tr>`).join('')}</table>`
      : '<p class="muted">Aucun mouvement.</p>');
  } catch (e) { toast(e.message, true); }
}
async function setOrderStatus(id, status) {
  if (!status) return;
  try { const r = await api('/api/admin/orders/' + id + '/status', { method: 'POST', body: JSON.stringify({ status }) }); toast(r.message); loadAdminStats(); loadAdmin('orders'); }
  catch (e) { toast(e.message, true); }
}
async function savePrice(id) {
  const price = Number(document.getElementById('price-' + id).value);
  try {
    const all = await api('/api/admin/plans');
    const p = all.plans.find(x => x.id === id);
    await api('/api/admin/plans/' + id, { method: 'PUT', body: JSON.stringify({ ...p, price }) });
    toast('Prix mis à jour : ' + fmt(price)); loadPlans();
  } catch (e) { toast(e.message, true); }
}
async function disablePlan(id) { if (!confirm('Désactiver ce forfait ?')) return; try { await api('/api/admin/plans/' + id, { method: 'DELETE' }); toast('Forfait désactivé.'); loadAdmin('plans'); loadPlans(); } catch (e) { toast(e.message, true); } }
async function planForm(id) {
  const box = document.getElementById('plan-form');
  let p = null;
  if (id) { try { const all = await api('/api/admin/plans'); p = all.plans.find(x => x.id === id); } catch {} }
  box.innerHTML = `<div style="background:var(--surface-muted);border-radius:12px;padding:14px;margin-bottom:12px">
    <b>${id ? 'Modifier le forfait #' + id : 'Nouveau forfait'}</b>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
      <select id="pf-op"><option value="tt" ${p?.operator === 'tt' ? 'selected' : ''}>Tunisie Télécom</option><option value="ooredoo" ${p?.operator === 'ooredoo' ? 'selected' : ''}>Ooredoo</option><option value="orange" ${p?.operator === 'orange' ? 'selected' : ''}>Orange</option></select>
      <select id="pf-type"><option ${p?.type === 'Internet' ? 'selected' : ''}>Internet</option><option ${p?.type === 'Crédit' ? 'selected' : ''}>Crédit</option><option ${p?.type === 'Mixte' ? 'selected' : ''}>Mixte</option></select>
      <input id="pf-name" placeholder="Nom (FR)" value="${esc(p?.name_fr || '')}"><input id="pf-name-ar" placeholder="Nom (AR)" value="${esc(p?.name_ar || '')}">
      <input id="pf-data" placeholder="Data (ex. 25 Go)" value="${esc(p?.data_label || '')}"><input id="pf-mb" type="number" placeholder="Data en Mo (ex. 25600)" value="${p?.data_mb ?? ''}">
      <input id="pf-valid" type="number" placeholder="Validité (jours)" value="${p?.validity_days ?? ''}"><input id="pf-price" type="number" step="0.1" placeholder="Prix public DT" value="${p?.price ?? ''}">
      <input id="pf-l1" type="number" step="0.01" placeholder="Prix Niveau 1 DT" value="${p?.price_level1 ?? ''}"><input id="pf-l2" type="number" step="0.01" placeholder="Prix Niveau 2 DT" value="${p?.price_level2 ?? ''}">
      <input id="pf-cost" type="number" step="0.01" placeholder="Coût (DT)" value="${p?.cost_price ?? ''}"><input id="pf-badge" placeholder="Badge (ex. Plus vendu)" value="${esc(p?.badge || '')}">
      <input id="pf-old" type="number" step="0.1" placeholder="Ancien prix (promo)" value="${p?.old_price ?? ''}">
    </div>
    <button class="btn small" style="margin-top:10px" onclick="savePlan(${id || 0})">💾 Enregistrer</button></div>`;
}
async function savePlan(id) {
  const body = {
    operator: document.getElementById('pf-op').value, type: document.getElementById('pf-type').value,
    name_fr: document.getElementById('pf-name').value.trim(), name_ar: document.getElementById('pf-name-ar').value.trim(),
    data_label: document.getElementById('pf-data').value.trim(), data_mb: Number(document.getElementById('pf-mb').value) || 0,
    validity_days: Number(document.getElementById('pf-valid').value) || 0, price: Number(document.getElementById('pf-price').value),
    price_level1: Number(document.getElementById('pf-l1').value) || Number(document.getElementById('pf-price').value),
    price_level2: Number(document.getElementById('pf-l2').value) || Math.round(Number(document.getElementById('pf-price').value) * 1.08 * 100) / 100,
    cost_price: Number(document.getElementById('pf-cost').value) || Number(document.getElementById('pf-price').value),
    badge: document.getElementById('pf-badge').value.trim(), old_price: Number(document.getElementById('pf-old').value) || null,
    image: '/images/' + document.getElementById('pf-op').value + '.svg', featured: 0, active: 1,
  };
  try {
    if (id) await api('/api/admin/plans/' + id, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/api/admin/plans', { method: 'POST', body: JSON.stringify(body) });
    toast('Forfait enregistré.'); loadAdmin('plans'); loadPlans();
  } catch (e) { toast(e.message, true); }
}
async function createPromo() {
  try {
    await api('/api/admin/promos', { method: 'POST', body: JSON.stringify({
      code: document.getElementById('promo-code').value.trim(),
      percent: Number(document.getElementById('promo-pct').value),
      max_discount: Number(document.getElementById('promo-max').value) || 0 }) });
    toast('Code promo créé.'); loadAdmin('promos');
  } catch (e) { toast(e.message, true); }
}
async function togglePromo(id) { try { await api('/api/admin/promos/' + id + '/toggle', { method: 'POST' }); loadAdmin('promos'); } catch (e) { toast(e.message, true); } }
async function saveSettings() {
  try {
    await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({
      whatsapp_number: document.getElementById('set-wa').value.trim(),
      d17_number: document.getElementById('set-d17').value.trim(),
      flouci_number: document.getElementById('set-flouci').value.trim(),
      min_topup: document.getElementById('set-min').value,
      announcement_fr: document.getElementById('set-ann-fr').value.trim(),
      announcement_ar: document.getElementById('set-ann-ar').value.trim() }) });
    toast('Paramètres enregistrés.'); loadConfig();
  } catch (e) { toast(e.message, true); }
}

// ---------------- Modales génériques ----------------
function openGeneric(title, html) {
  document.getElementById('generic-title').textContent = title;
  document.getElementById('generic-body').innerHTML = html;
  document.getElementById('generic-modal').classList.add('open');
}
function closeGeneric(e) { if (e) e.preventDefault(); document.getElementById('generic-modal').classList.remove('open'); }

// ---------------- Init ----------------
document.addEventListener('DOMContentLoaded', async () => {
  applyLang();
  await loadConfig();
  await loadPlans();
  if (token) { await refreshMe(); }
  syncAuthUI();
  document.querySelectorAll('.modal-back').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); }));
});
