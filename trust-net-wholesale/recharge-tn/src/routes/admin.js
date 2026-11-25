// Admin : stats, validation des comptes, gestion des soldes, commandes,
// forfaits, codes promo, paramètres.
// TRUST NET wholesale : niveaux de prix L1/L2, historique des prix,
// opérateurs, rapports, tickets, transactions wallet, fournisseurs.
const express = require('express');
const { getDb, addNotification } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { listProviders } = require('../provider');
const { _ordersCsv } = require('./orders');

const router = express.Router();
router.use(requireAuth, requireAdmin);

function recordPriceChange(db, planId, adminId, oldP, newP, reason) {
  if (oldP.price_level1 === newP.price_level1 && oldP.price_level2 === newP.price_level2) return;
  db.prepare(`INSERT INTO price_history (plan_id,admin_id,old_level1,new_level1,old_level2,new_level2,reason)
    VALUES (?,?,?,?,?,?,?)`).run(planId, adminId,
    oldP.price_level1 ?? null, newP.price_level1 ?? null,
    oldP.price_level2 ?? null, newP.price_level2 ?? null, String(reason || '').slice(0, 200));
}

// --- Tableau de bord ---
router.get('/stats', (req, res) => {
  const db = getDb();
  const today = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders WHERE date(created_at) = date('now') AND status != 'Cancelled'`).get();
  const total = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders WHERE status != 'Cancelled'`).get();
  const pendingUsers = db.prepare(`SELECT COUNT(*) c FROM users WHERE role='client' AND status='pending'`).get().c;
  const clients = db.prepare(`SELECT COUNT(*) c FROM users WHERE role='client' AND status='approved'`).get().c;
  const totalBalance = db.prepare(`SELECT COALESCE(SUM(balance),0) s FROM users WHERE role='client'`).get().s;
  const pendingOrders = db.prepare(`SELECT COUNT(*) c FROM orders WHERE status IN ('Pending','Scheduled')`).get().c;
  const pendingTopups = db.prepare(`SELECT COUNT(*) c FROM wallet_tx WHERE kind='top_up' AND status='Pending'`).get().c;
  const byOperator = db.prepare(`SELECT p.operator, COUNT(*) c, COALESCE(SUM(o.total),0) s
    FROM orders o JOIN plans p ON p.id=o.plan_id WHERE o.status != 'Cancelled' GROUP BY p.operator`).all();
  const byStatus = db.prepare(`SELECT status, COUNT(*) c FROM orders GROUP BY status`).all();
  const level1 = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders WHERE level_at_order = 1 AND status != 'Cancelled'`).get();
  const level2 = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders WHERE level_at_order = 2 AND status != 'Cancelled'`).get();
  res.json({ today, total, pendingUsers, clients, totalBalance, pendingOrders, pendingTopups, byOperator, byStatus, level1, level2 });
});

// --- Comptes clients en attente / gestion ---
router.get('/users', (req, res) => {
  const { status } = req.query;
  const db = getDb();
  let sql = `SELECT id,name,phone,email,role,status,balance,pricing_level,created_at FROM users WHERE role='client'`;
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC';
  res.json({ users: db.prepare(sql).all(...params) });
});

router.post('/users/:id/approve', (req, res) => {
  const db = getDb();
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(req.params.id, 'client');
  if (!u) return res.status(404).json({ error: 'Client introuvable.' });
  if (u.status === 'approved') return res.status(400).json({ error: 'Compte déjà approuvé.' });
  db.prepare("UPDATE users SET status='approved' WHERE id=?").run(u.id);
  addNotification(db, u.id, 'account', '', 'Votre compte TRUST NET a été approuvé. Vous pouvez maintenant vous connecter et commander.');
  res.json({ message: `${u.name} approuvé. Il peut maintenant se connecter.` });
});

router.post('/users/:id/reject', (req, res) => {
  const db = getDb();
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(req.params.id, 'client');
  if (!u) return res.status(404).json({ error: 'Client introuvable.' });
  db.prepare("UPDATE users SET status='rejected' WHERE id=?").run(u.id);
  res.json({ message: `${u.name} refusé.` });
});

// Niveau tarifaire d'un client (1 ou 2) — n'affecte JAMAIS les commandes passées.
router.put('/users/:id/level', (req, res) => {
  const level = Number((req.body || {}).pricing_level);
  if (level !== 1 && level !== 2) return res.status(400).json({ error: 'Niveau invalide : 1 ou 2.' });
  const db = getDb();
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(req.params.id, 'client');
  if (!u) return res.status(404).json({ error: 'Client introuvable.' });
  db.prepare('UPDATE users SET pricing_level = ? WHERE id = ?').run(level, u.id);
  addNotification(db, u.id, 'account', '', `Votre niveau tarifaire TRUST NET est désormais Niveau ${level}. Vos prochaines commandes utiliseront les prix du Niveau ${level}. Vos anciennes commandes gardent leurs prix d'origine.`);
  res.json({ message: `${u.name} est maintenant Niveau ${level}.`, pricing_level: level });
});

// --- Soldes : créditer / débiter un client (avec motif + historique) ---
router.post('/users/:id/balance', (req, res) => {
  const { amount, reason } = req.body || {};
  const amt = Number(amount);
  if (!amt || amt === 0) return res.status(400).json({ error: 'Montant invalide (positif pour créditer, négatif pour débiter).' });
  if (!String(reason || '').trim()) return res.status(400).json({ error: 'Motif obligatoire (traçabilité).' });
  const db = getDb();
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(req.params.id, 'client');
  if (!u) return res.status(404).json({ error: 'Client introuvable.' });
  if (amt < 0 && u.balance + amt < 0) return res.status(400).json({ error: `Solde insuffisant : ${u.balance} DT.` });
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amt, u.id);
    db.prepare(`INSERT INTO wallet_tx (user_id,amount,kind,reason,admin_id,status) VALUES (?,?,?,?,?,?)`)
      .run(u.id, amt, amt > 0 ? 'credit' : 'debit', String(reason).trim(), req.user.id, 'Completed');
    db.exec('COMMIT');
  } catch { db.exec('ROLLBACK'); return res.status(500).json({ error: 'Erreur.' }); }
  const fresh = db.prepare('SELECT balance FROM users WHERE id = ?').get(u.id);
  addNotification(db, u.id, 'wallet', '', `Votre solde TRUST NET a été ${amt > 0 ? 'crédité' : 'débité'} de ${Math.abs(amt)} DT (${String(reason).trim()}). Nouveau solde : ${fresh.balance} DT.`);
  res.json({ message: `Solde ${amt > 0 ? 'crédité' : 'débité'} de ${Math.abs(amt)} DT. Nouveau solde : ${fresh.balance} DT.`, balance: fresh.balance });
});

// Demandes de recharge de solde en attente + confirmation / refus
router.get('/topups', (req, res) => {
  const rows = getDb().prepare(`SELECT w.*, u.name AS user_name, u.email, u.phone FROM wallet_tx w
    JOIN users u ON u.id = w.user_id WHERE w.kind='top_up' AND w.status='Pending' ORDER BY w.created_at DESC`).all();
  res.json({ topups: rows });
});
router.post('/topups/:id/confirm', (req, res) => {
  const db = getDb();
  const tx = db.prepare("SELECT * FROM wallet_tx WHERE id = ? AND kind='top_up' AND status='Pending'").get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Demande introuvable ou déjà traitée.' });
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(tx.amount, tx.user_id);
    db.prepare("UPDATE wallet_tx SET status='Completed', admin_id=? WHERE id=?").run(req.user.id, tx.id);
    db.exec('COMMIT');
  } catch { db.exec('ROLLBACK'); return res.status(500).json({ error: 'Erreur.' }); }
  const fresh = db.prepare('SELECT balance FROM users WHERE id = ?').get(tx.user_id);
  addNotification(db, tx.user_id, 'wallet', '', `Votre demande de recharge de solde de ${tx.amount} DT a été confirmée. Nouveau solde : ${fresh.balance} DT.`);
  res.json({ message: `Solde crédité de ${tx.amount} DT.` });
});
router.post('/topups/:id/reject', (req, res) => {
  getDb().prepare("UPDATE wallet_tx SET status='Cancelled', admin_id=? WHERE id=? AND kind='top_up' AND status='Pending'")
    .run(req.user.id, req.params.id);
  res.json({ message: 'Demande de recharge refusée.' });
});

// Historique solde d'un client
router.get('/users/:id/wallet', (req, res) => {
  const db = getDb();
  const u = db.prepare('SELECT id,name,balance FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Client introuvable.' });
  const tx = db.prepare(`SELECT w.*, a.name AS admin_name FROM wallet_tx w LEFT JOIN users a ON a.id=w.admin_id
    WHERE w.user_id = ? ORDER BY w.created_at DESC LIMIT 100`).all(u.id);
  res.json({ user: u, transactions: tx });
});

// --- Transactions wallet (toutes) ---
router.get('/wallet/transactions', (req, res) => {
  const { user_id, kind, from, to } = req.query;
  const db = getDb();
  let sql = `SELECT w.*, u.name AS user_name, u.email, a.name AS admin_name FROM wallet_tx w
    JOIN users u ON u.id = w.user_id LEFT JOIN users a ON a.id = w.admin_id WHERE 1=1`;
  const params = [];
  if (user_id) { sql += ' AND w.user_id = ?'; params.push(Number(user_id)); }
  if (kind) { sql += ' AND w.kind = ?'; params.push(kind); }
  if (from) { sql += ' AND date(w.created_at) >= ?'; params.push(from); }
  if (to) { sql += ' AND date(w.created_at) <= ?'; params.push(to); }
  sql += ' ORDER BY w.created_at DESC LIMIT 300';
  res.json({ transactions: db.prepare(sql).all(...params) });
});

// --- Commandes ---
router.get('/orders', (req, res) => {
  const { status, q, operator, from, to } = req.query;
  const db = getDb();
  let sql = `SELECT o.*, p.name_fr AS plan_name, p.operator, u.name AS user_name, u.email, u.pricing_level
    FROM orders o JOIN plans p ON p.id=o.plan_id LEFT JOIN users u ON u.id=o.user_id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND o.status = ?'; params.push(status); }
  if (operator) { sql += ' AND p.operator = ?'; params.push(operator); }
  if (q) { sql += ' AND (o.code LIKE ? OR o.phone LIKE ? OR u.name LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (from) { sql += ' AND date(o.created_at) >= ?'; params.push(from); }
  if (to) { sql += ' AND date(o.created_at) <= ?'; params.push(to); }
  sql += ' ORDER BY o.created_at DESC LIMIT 200';
  res.json({ orders: db.prepare(sql).all(...params) });
});
router.get('/orders/export', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT o.*, p.name_fr AS plan_name, p.operator
    FROM orders o JOIN plans p ON p.id=o.plan_id ORDER BY o.created_at DESC LIMIT 1000`).all();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="trust-net-commandes.csv"');
  res.send(_ordersCsv(rows));
});
router.post('/orders/:id/status', (req, res) => {
  const { status, note } = req.body || {};
  const STATUSES = ['Pending', 'Processing', 'Completed', 'Cancelled', 'Scheduled'];
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Statut invalide.' });
  const db = getDb();
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Commande introuvable.' });
  if (status === 'Cancelled' && o.status !== 'Cancelled' && o.payment_method === 'wallet' && o.user_id) {
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(o.total, o.user_id);
      db.prepare(`INSERT INTO wallet_tx (user_id,amount,kind,reason,order_id,admin_id,status) VALUES (?,?,?,?,?,?,?)`)
        .run(o.user_id, o.total, 'credit', `Remboursement commande annulée ${o.code}`, o.id, req.user.id, 'Completed');
      db.prepare("UPDATE orders SET status=?, note=?, updated_at=datetime('now') WHERE id=?").run(status, String(note || o.note || ''), o.id);
      db.exec('COMMIT');
    } catch { db.exec('ROLLBACK'); return res.status(500).json({ error: 'Erreur.' }); }
    addNotification(db, o.user_id, 'order', o.code, `Commande ${o.code} annulée — ${o.total} DT remboursés sur votre solde.`);
    return res.json({ message: `Commande annulée — ${o.total} DT remboursés sur le solde du client.` });
  }
  db.prepare("UPDATE orders SET status=?, note=?, updated_at=datetime('now') WHERE id=?").run(status, String(note || o.note || ''), o.id);
  if (o.user_id) addNotification(db, o.user_id, 'order', o.code, `Votre commande ${o.code} est maintenant : ${status}.`);
  res.json({ message: `Commande ${o.code} -> ${status}.` });
});

// --- Forfaits (CRUD admin) ---
router.get('/plans', (req, res) => {
  res.json({ plans: getDb().prepare('SELECT * FROM plans ORDER BY sort_order ASC').all() });
});
router.post('/plans', (req, res) => {
  const { operator, type, name_fr, name_ar, data_label, data_mb, validity_days, price, old_price, badge, image, featured, price_level1, price_level2, cost_price } = req.body || {};
  if (!['tt', 'ooredoo', 'orange'].includes(operator)) return res.status(400).json({ error: 'Opérateur invalide.' });
  if (!name_fr || price === undefined || Number(price) < 0) return res.status(400).json({ error: 'Nom et prix obligatoires.' });
  const db = getDb();
  const l1 = price_level1 !== undefined && price_level1 !== null && price_level1 !== '' ? Number(price_level1) : Number(price);
  const l2 = price_level2 !== undefined && price_level2 !== null && price_level2 !== '' ? Number(price_level2) : Math.round(Number(price) * 1.08 * 100) / 100;
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order),0) m FROM plans').get().m;
  const r = db.prepare(`INSERT INTO plans (operator,type,name_fr,name_ar,data_label,data_mb,validity_days,price,old_price,badge,image,featured,sort_order,price_level1,price_level2,cost_price)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(operator, type || 'Internet', name_fr, name_ar || name_fr, data_label || '', Number(data_mb) || 0,
    Number(validity_days) || 0, Number(price), old_price ? Number(old_price) : null, badge || '', image || `/images/${operator}.svg`, featured ? 1 : 0, maxSort + 1,
    l1, l2, cost_price !== undefined && cost_price !== null && cost_price !== '' ? Number(cost_price) : Number(price));
  res.status(201).json({ message: 'Forfait ajouté.', id: r.lastInsertRowid });
});
router.put('/plans/:id', (req, res) => {
  const { operator, type, name_fr, name_ar, data_label, data_mb, validity_days, price, old_price, badge, image, featured, active, price_level1, price_level2, cost_price, reason } = req.body || {};
  const db = getDb();
  const old = db.prepare('SELECT * FROM plans WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Forfait introuvable.' });
  // Édition rapide du prix public : L1 = prix, L2 = +8% (sauf si L1/L2 fournis).
  let l1 = old.price_level1, l2 = old.price_level2;
  if (price_level1 !== undefined && price_level1 !== null && price_level1 !== '') l1 = Number(price_level1);
  else if (price !== undefined && Number(price) !== Number(old.price)) l1 = Number(price);
  if (price_level2 !== undefined && price_level2 !== null && price_level2 !== '') l2 = Number(price_level2);
  else if (price !== undefined && Number(price) !== Number(old.price)) l2 = Math.round(Number(price) * 1.08 * 100) / 100;
  const next = {
    operator: operator || old.operator, type: type || old.type,
    name_fr: name_fr ?? old.name_fr, name_ar: name_ar ?? old.name_ar,
    data_label: data_label ?? old.data_label, data_mb: data_mb !== undefined ? Number(data_mb) : old.data_mb,
    validity_days: validity_days !== undefined ? Number(validity_days) : old.validity_days,
    price: price !== undefined ? Number(price) : old.price,
    old_price: old_price !== undefined ? (old_price ? Number(old_price) : null) : old.old_price,
    badge: badge ?? old.badge, image: image || old.image,
    featured: featured !== undefined ? (featured ? 1 : 0) : old.featured,
    active: active !== undefined ? (active ? 1 : 0) : old.active,
    price_level1: l1, price_level2: l2,
    cost_price: cost_price !== undefined && cost_price !== null && cost_price !== '' ? Number(cost_price) : old.cost_price,
  };
  recordPriceChange(db, old.id, req.user.id, old, next, reason);
  db.prepare(`UPDATE plans SET operator=?,type=?,name_fr=?,name_ar=?,data_label=?,data_mb=?,validity_days=?,price=?,old_price=?,badge=?,image=?,featured=?,active=?,price_level1=?,price_level2=?,cost_price=? WHERE id=?`)
    .run(next.operator, next.type, next.name_fr, next.name_ar, next.data_label, next.data_mb, next.validity_days, next.price,
      next.old_price, next.badge, next.image, next.featured, next.active, next.price_level1, next.price_level2, next.cost_price, req.params.id);
  res.json({ message: 'Forfait mis à jour.' });
});
router.delete('/plans/:id', (req, res) => {
  getDb().prepare('UPDATE plans SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ message: 'Forfait désactivé (conservé pour l\'historique des commandes).' });
});

// --- Gestion des tarifs (Pricing Management) ---
router.get('/pricing', (req, res) => {
  res.json({ plans: getDb().prepare('SELECT * FROM plans ORDER BY operator, data_mb ASC').all() });
});
router.get('/pricing/history', (req, res) => {
  const { plan_id } = req.query;
  const db = getDb();
  let sql = `SELECT h.*, p.name_fr AS plan_name, u.name AS admin_name, u.email AS admin_email
    FROM price_history h LEFT JOIN plans p ON p.id = h.plan_id LEFT JOIN users u ON u.id = h.admin_id WHERE 1=1`;
  const params = [];
  if (plan_id) { sql += ' AND h.plan_id = ?'; params.push(Number(plan_id)); }
  sql += ' ORDER BY h.created_at DESC, h.id DESC LIMIT 200';
  res.json({ history: db.prepare(sql).all(...params) });
});
router.get('/pricing/compare', (req, res) => {
  const rows = getDb().prepare(`SELECT id,operator,type,name_fr,data_label,data_mb,validity_days,price,price_level1,price_level2,cost_price,active
    FROM plans WHERE type = 'Internet' AND active = 1 ORDER BY data_mb ASC, validity_days ASC, operator ASC`).all();
  const groups = {};
  for (const p of rows) {
    const key = `${p.data_mb}MB/${p.validity_days}j`;
    if (!groups[key]) groups[key] = { data_mb: p.data_mb, validity_days: p.validity_days, plans: [] };
    const go = p.data_mb / 1024;
    groups[key].plans.push({
      ...p,
      price_per_gb_l1: go ? Math.round((p.price_level1 / go) * 1000) / 1000 : null,
      price_per_gb_l2: go ? Math.round((p.price_level2 / go) * 1000) / 1000 : null,
    });
  }
  res.json({ groups: Object.values(groups) });
});

// --- Opérateurs : disponibilité (statut manuel admin, jamais un statut live) ---
router.get('/operators', (req, res) => {
  res.json({ operators: getDb().prepare('SELECT * FROM operator_status ORDER BY operator').all() });
});
router.put('/operators/:operator', (req, res) => {
  const { status, message } = req.body || {};
  const op = req.params.operator;
  if (!['tt', 'ooredoo', 'orange'].includes(op)) return res.status(400).json({ error: 'Opérateur invalide.' });
  if (!['available', 'unavailable', 'maintenance'].includes(status)) {
    return res.status(400).json({ error: 'Statut invalide : available, unavailable ou maintenance.' });
  }
  const db = getDb();
  db.prepare(`INSERT INTO operator_status (operator,status,message,updated_by,updated_at,source) VALUES (?,?,?,? ,datetime('now'),'admin')
    ON CONFLICT(operator) DO UPDATE SET status=excluded.status, message=excluded.message, updated_by=excluded.updated_by, updated_at=datetime('now')`)
    .run(op, status, String(message || '').slice(0, 300), req.user.id);
  const names = { tt: 'Tunisie Télécom', ooredoo: 'Ooredoo', orange: 'Orange' };
  const label = { available: 'disponible', unavailable: 'temporairement indisponible', maintenance: 'en maintenance' }[status];
  const clients = db.prepare("SELECT id FROM users WHERE role='client' AND status='approved'").all();
  for (const c of clients) {
    addNotification(db, c.id, 'operator', op, `${names[op]} est maintenant ${label} sur TRUST NET. ${String(message || '')}`);
  }
  res.json({ message: `${names[op]} : ${label}.` });
});

// --- Rapports & analytics ---
router.get('/reports', (req, res) => {
  const { from, to } = req.query;
  const db = getDb();
  let range = '', params = [];
  if (from) { range += ' AND date(o.created_at) >= ?'; params.push(from); }
  if (to) { range += ' AND date(o.created_at) <= ?'; params.push(to); }
  const base = `FROM orders o JOIN plans p ON p.id = o.plan_id WHERE o.status != 'Cancelled' ${range}`;
  const total_sales = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(o.total),0) s, COALESCE(SUM(o.total - COALESCE(o.cost_total, 0)),0) profit ${base}`).get(...params);
  const orders_by_operator = db.prepare(`SELECT p.operator, COUNT(*) c, COALESCE(SUM(o.total),0) s ${base} GROUP BY p.operator`).all(...params);
  const orders_by_customer = db.prepare(`SELECT o.user_id, u.name, u.email, u.pricing_level, COUNT(*) c, COALESCE(SUM(o.total),0) s
    FROM orders o JOIN plans p ON p.id = o.plan_id LEFT JOIN users u ON u.id = o.user_id
    WHERE o.status != 'Cancelled' ${range} GROUP BY o.user_id, u.name, u.email, u.pricing_level ORDER BY s DESC LIMIT 50`).all(...params);
  const byStatus = db.prepare(`SELECT status, COUNT(*) c FROM orders o WHERE 1=1 ${range.replace(/o\./g, '')} GROUP BY status`).all(...params);
  const successful = byStatus.filter(r => r.status === 'Completed').reduce((a, r) => a + r.c, 0);
  const failed = byStatus.filter(r => r.status === 'Cancelled').reduce((a, r) => a + r.c, 0);
  const revenue_by_date = db.prepare(`SELECT date(o.created_at) d, COUNT(*) c, COALESCE(SUM(o.total),0) s ${base} GROUP BY date(o.created_at) ORDER BY d`).all(...params);
  const profit_by_date = db.prepare(`SELECT date(o.created_at) d, COALESCE(SUM(o.total - COALESCE(o.cost_total, 0)),0) profit ${base} GROUP BY date(o.created_at) ORDER BY d`).all(...params);
  const revenue_by_week = db.prepare(`SELECT strftime('%Y-%W', o.created_at) w, COUNT(*) c, COALESCE(SUM(o.total),0) s ${base} GROUP BY w ORDER BY w`).all(...params);
  const revenue_by_month = db.prepare(`SELECT strftime('%Y-%m', o.created_at) m, COUNT(*) c, COALESCE(SUM(o.total),0) s ${base} GROUP BY m ORDER BY m`).all(...params);
  const customer_activity = db.prepare(`SELECT u.id, u.name, u.email, u.pricing_level, u.balance, COUNT(o.id) orders,
    COALESCE(SUM(o.total),0) spent, MAX(o.created_at) last_order
    FROM users u LEFT JOIN orders o ON o.user_id = u.id AND o.status != 'Cancelled'
    WHERE u.role = 'client' GROUP BY u.id ORDER BY spent DESC`).all();
  const level1_vs_level2 = db.prepare(`SELECT level_at_order, COUNT(*) c, COALESCE(SUM(total),0) s
    FROM orders o WHERE o.status != 'Cancelled' ${range} GROUP BY level_at_order`).all(...params);
  res.json({
    total_sales, orders_by_operator, orders_by_customer,
    successful, failed, by_status: byStatus,
    revenue_by_date, profit_by_date, revenue_by_week, revenue_by_month,
    customer_activity, level1_vs_level2,
  });
});

// --- Tickets support ---
router.get('/tickets', (req, res) => {
  const { status } = req.query;
  const db = getDb();
  let sql = `SELECT t.*, u.name AS user_name, u.email, u.phone FROM tickets t JOIN users u ON u.id = t.user_id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND t.status = ?'; params.push(status); }
  sql += ' ORDER BY t.created_at DESC LIMIT 200';
  res.json({ tickets: db.prepare(sql).all(...params) });
});
router.put('/tickets/:id', (req, res) => {
  const { status, admin_reply } = req.body || {};
  const db = getDb();
  const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket introuvable.' });
  const nextStatus = ['open', 'answered', 'closed'].includes(status) ? status : t.status;
  db.prepare("UPDATE tickets SET status = ?, admin_reply = ?, updated_at = datetime('now') WHERE id = ?")
    .run(nextStatus, String(admin_reply ?? t.admin_reply ?? '').slice(0, 2000), t.id);
  if (admin_reply) addNotification(db, t.user_id, 'ticket', String(t.id), `Réponse TRUST NET à votre ticket « ${t.subject} » : ${String(admin_reply).slice(0, 300)}`);
  res.json({ message: 'Ticket mis à jour.' });
});

// --- Fournisseurs (aucun secret exposé) ---
router.get('/providers', (req, res) => {
  res.json({ providers: listProviders(), note: 'Traitement manuel par défaut. Aucune activation télécom automatique sans compte fournisseur autorisé configuré.' });
});

// --- Codes promo ---
router.get('/promos', (req, res) => {
  res.json({ promos: getDb().prepare('SELECT * FROM promos ORDER BY code').all() });
});
router.post('/promos', (req, res) => {
  const { code, percent, max_discount, description_fr, expires_at } = req.body || {};
  if (!code || percent === undefined) return res.status(400).json({ error: 'Code et pourcentage obligatoires.' });
  try {
    getDb().prepare('INSERT INTO promos (code,percent,max_discount,description_fr,active,expires_at) VALUES (?,?,?,?,1,?)')
      .run(String(code).trim().toUpperCase(), Number(percent), Number(max_discount) || 0, description_fr || '', expires_at || null);
  } catch { return res.status(409).json({ error: 'Ce code existe déjà.' }); }
  res.status(201).json({ message: 'Code promo créé.' });
});
router.post('/promos/:id/toggle', (req, res) => {
  getDb().prepare('UPDATE promos SET active = 1 - active WHERE id = ?').run(req.params.id);
  res.json({ message: 'Code promo activé / désactivé.' });
});

// --- Paramètres (WhatsApp, D17, Flouci, annonce) ---
router.get('/settings', (req, res) => {
  const rows = getDb().prepare('SELECT key,value FROM settings').all();
  res.json({ settings: Object.fromEntries(rows.map(r => [r.key, r.value])) });
});
router.put('/settings', (req, res) => {
  const db = getDb();
  const allowed = ['whatsapp_number', 'd17_number', 'flouci_number', 'site_name', 'min_topup', 'announcement_fr', 'announcement_ar'];
  const up = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  Object.entries(req.body || {}).forEach(([k, v]) => { if (allowed.includes(k)) up.run(k, String(v)); });
  res.json({ message: 'Paramètres enregistrés.' });
});

module.exports = router;
