require('dotenv').config();
const admin = require('firebase-admin');

// ── Firebase ──────────────────────────────────────────────────
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
      })
    });
  } catch (e) {
    console.error('[Journal] Firebase non initialise:', e.message);
  }
}

const JOURNAL_COLLECTION = 'journal';
const DELETE_ROLES = ['admin', 'directeur'];
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'jibni-admin-2025';
const DIRECTEUR_PASSWORD = process.env.DIRECTEUR_PASSWORD || null;
const SENSITIVE_KEYS = /pass|secret|token|key|card|cvc|iban/i;

function db() {
  return admin.firestore();
}

// ── Identification de l'auteur d'une action ───────────────────
// Ordre : mot de passe admin, mot de passe directeur, token Firebase
// (role lu dans les custom claims puis dans admins/{uid}).
async function resolveActor(req) {
  const pwd = req.headers['x-admin-password'];
  if (pwd && pwd === ADMIN_PASSWORD) {
    return { role: 'admin', id: 'admin-password', via: 'password' };
  }

  const dirPwd = req.headers['x-directeur-password'];
  if (DIRECTEUR_PASSWORD && dirPwd && dirPwd === DIRECTEUR_PASSWORD) {
    return { role: 'directeur', id: 'directeur-password', via: 'password' };
  }

  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const decoded = await admin.auth().verifyIdToken(auth.slice(7));
      let role = decoded.role || null;
      if (!role) {
        const snap = await db().collection('admins').doc(decoded.uid).get();
        if (snap.exists) role = snap.data().role || 'admin';
      }
      return { role: role || 'user', id: decoded.uid, email: decoded.email || null, via: 'firebase' };
    } catch (e) {
      return { role: 'anonymous', id: null, via: 'invalid-token' };
    }
  }

  const b = req.body || {};
  const declaredId = b.userId || b.driverId || b.passagerId || null;
  return { role: 'anonymous', id: null, declaredId, via: 'none' };
}

// ── Écriture dans le journal ──────────────────────────────────
function sanitize(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.length > 500 ? value.slice(0, 500) + '…' : value;
  if (typeof value !== 'object') return value;
  if (depth > 3) return '[...]';
  if (Array.isArray(value)) return value.slice(0, 20).map(v => sanitize(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEYS.test(k) ? '[masque]' : sanitize(v, depth + 1);
  }
  return out;
}

async function logAction(entry) {
  const doc = sanitize({ ...entry, createdAt: new Date().toISOString() });
  try {
    await db().collection(JOURNAL_COLLECTION).add(doc);
  } catch (e) {
    // Le journal ne doit jamais faire échouer la requête
    console.error('[Journal] Ecriture impossible:', e.message, JSON.stringify(doc));
  }
}

// Middleware global : chaque requête est journalisée une fois la réponse envoyée.
// Les routes peuvent enrichir l'entrée via req.auditDetails (ex. objet supprimé).
function auditMiddleware(req, res, next) {
  if (req.method === 'OPTIONS' || req.path === '/health') return next();

  resolveActor(req)
    .catch(() => ({ role: 'anonymous', id: null, via: 'error' }))
    .then(actor => {
      req.actor = actor;
      res.on('finish', () => {
        logAction({
          action: `${req.method} ${req.route ? req.baseUrl + req.route.path : req.path}`,
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          success: res.statusCode < 400,
          actor,
          ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || null,
          userAgent: req.headers['user-agent'] || null,
          params: req.params,
          body: req.method === 'GET' ? null : req.body,
          details: req.auditDetails || null
        });
      });
      next();
    });
}

// ── Contrôle des rôles ────────────────────────────────────────
function requireRole(...roles) {
  return (req, res, next) => {
    if (req.actor && roles.includes(req.actor.role)) return next();
    return res.status(403).json({ error: `Action reservee a : ${roles.join(', ')}` });
  };
}

// Aucune suppression possible sauf pour l'administrateur ou le directeur
function deleteGuard(req, res, next) {
  if (req.method !== 'DELETE') return next();
  return requireRole(...DELETE_ROLES)(req, res, next);
}

// ── Lecture du journal ────────────────────────────────────────
async function listJournal({ limit = 100, before, role, method, actorId } = {}) {
  let q = db().collection(JOURNAL_COLLECTION).orderBy('createdAt', 'desc');
  if (before) q = q.where('createdAt', '<', before);
  const max = Math.min(parseInt(limit, 10) || 100, 500);
  const snap = await q.limit(max).get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(e => (!role || e.actor?.role === role)
      && (!method || e.method === method.toUpperCase())
      && (!actorId || e.actor?.id === actorId));
}

module.exports = { auditMiddleware, requireRole, deleteGuard, logAction, listJournal, DELETE_ROLES };
