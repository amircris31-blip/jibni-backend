const express = require('express');

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const https = require('https');
const { loadPromos, savePromos, validateCode } = require('./promos');
const { notifyNewReservation } = require('./notifications');
const { formatPrice, COUNTRY_CURRENCY } = require('./currency');
const mypay = require('./payments/mypay');
const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'x-admin-password']
}));
app.options('*', cors());
app.use(express.json());

// ── Health ────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status: 'ok',
  groq: process.env.GROQ_API_KEY ? 'present' : 'MISSING',
  resend: process.env.RESEND_API_KEY ? 'present' : 'MISSING',
  twilio: process.env.TWILIO_ACCOUNT_SID ? 'present' : 'MISSING',
  notify_secret: process.env.NOTIFY_SECRET ? 'present' : 'MISSING'
}));

// ── Stripe ────────────────────────────────────────────────────
app.post('/create-setup-intent', async (req, res) => {
  try {
    const customer = await stripe.customers.create({ email: req.body.email || 'passager@jibni.fr', metadata: { userId: req.body.userId || '' } });
    const setupIntent = await stripe.setupIntents.create({ customer: customer.id, payment_method_types: ['card'] });
    res.json({ clientSecret: setupIntent.client_secret, customerId: customer.id });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.post('/verify-payment-method', async (req, res) => {
  try {
    const { paymentMethodId, customerId } = req.body;
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    res.json({ valid: true, brand: pm.card?.brand, last4: pm.card?.last4 });
  } catch(e) { res.status(400).json({ valid: false, error: e.message }); }
});

// ── Groq ──────────────────────────────────────────────────────
function callGroq(messages, system) {
  return new Promise((resolve, reject) => {
    const allMessages = [{ role: 'system', content: system }, ...messages];
    const payload = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: allMessages,
      max_tokens: 500,
      temperature: 0.7
    });
    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': 'Bearer ' + process.env.GROQ_API_KEY
      }
    }, (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => {
        console.log('Groq status:', resp.statusCode);
        console.log('Groq response:', data.substring(0, 300));
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Parse error: ' + data.substring(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const JIBNI_SYSTEM = `Tu es l'assistant intelligent de Jibni, service VTC premium a Marseille.
Tu reponds de facon intelligente, empathique et professionnelle — comme un vrai assistant de qualite.
Tu peux repondre a toutes les questions generales (conseils Marseille, meteo, tourisme, etc.) mais ton contexte principal est Jibni.

INFOS JIBNI:
- Service VTC premium, disponible 24h/24 7j/7
- Vehicule: Mercedes Vito, jusqu'a 8 passagers
- Tel: 07 82 86 55 25 | contact@jibni.fr | jibni.fr
- Zone: Marseille et toute la region PACA

TARIFS FIXES:
- Aeroport Marseille (Marignane) <-> Marseille: 55 euros
- Aix-en-Provence <-> Marseille: 65 euros
- Marseille -> Nice: 260 euros berline / 360 euros van
- Marseille <-> Toulon: 120 euros
- Marseille <-> Avignon: 150 euros
- Marseille <-> Montpellier: 220 euros
- Marseille <-> Lyon: 380 euros
- Van 8 places: a partir de 60 euros
- Standard: 1.80 euro/km, minimum 25 euros
- Jibni Tour (circuit touristique 2h): 350 euros

REGLES:
- Reponds en francais sauf si l utilisateur parle une autre langue
- Pour les reservations, invite a appeler le 07 82 86 55 25 ou visiter jibni.fr
- Sois chaleureux, precis et professionnel
- Si besoin d un chauffeur, renvoie vers jibni.fr section Rejoindre`;

app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ reply: 'Messages invalides.' });
    }
    if (!process.env.GROQ_API_KEY) {
      return res.json({ reply: 'Pour toute question, appelez le 07 82 86 55 25 ou visitez jibni.fr' });
    }

    const cleanMessages = messages.slice(-8).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: String(m.content).slice(0, 1000)
    }));

    const data = await callGroq(cleanMessages, JIBNI_SYSTEM);

    if (data.error) {
      console.error('Groq error:', JSON.stringify(data.error));
      return res.json({ reply: 'Erreur temporaire. Appelez le 07 82 86 55 25.' });
    }

    const reply = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : 'Je suis desole, une erreur est survenue.';

    res.json({ reply });

  } catch(e) {
    console.error('Chat error:', e.message);
    res.status(500).json({ reply: 'Erreur technique. Appelez le 07 82 86 55 25.' });
  }
});

// ── Dispatch ──────────────────────────────────────────────────
app.post('/dispatch-course', async (req, res) => {
  try {
    const { courseId, courseData } = req.body;
    const { dispatchCourse } = require('./dispatch');
    dispatchCourse(courseId, courseData);
    res.json({ dispatching: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// ── Notification chauffeur (nouvelle course immédiate) ────────
app.post('/notify-driver', async (req, res) => {
  try {
    const { pushToken, courseId, origin, destination, vehicleType, price, currency } = req.body;
    if (!pushToken) return res.status(400).json({ error: 'pushToken manquant' });
    // price arrive déjà formaté par l'app ("12.50 €" / "1 250 DA") ; sinon on le formate
    const prix = typeof price === 'number' ? formatPrice(price, currency) : price;
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: pushToken,
        sound: 'default',
        title: '🚕 Nouvelle course !',
        body: `De: ${origin}\nVers: ${destination}\n${vehicleType || ''} · ${prix || ''}`,
        data: { type: 'new_course', courseId },
        priority: 'high',
      })
    });
    res.json({ sent: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Moyens de paiement par pays ───────────────────────────────
// France : carte (Stripe) · Algérie : espèces + MyPay (CIB / Edahabia)
const PAYMENT_METHODS = { FR: ['card'], DZ: ['cash', 'mypay'] };

app.get('/api/payment-methods', (req, res) => {
  const country = PAYMENT_METHODS[req.query.country] ? req.query.country : 'FR';
  res.json({
    country,
    currency: COUNTRY_CURRENCY[country],
    methods: PAYMENT_METHODS[country],
    available: { card: country === 'FR', cash: country === 'DZ', mypay: country === 'DZ' && mypay.isConfigured() },
  });
});

app.post('/api/mypay/checkout', async (req, res) => {
  const { courseId, amount, currency } = req.body || {};
  if (!mypay.isConfigured()) return res.status(503).json({ error: 'MyPay pas encore disponible, paiement en espèces au chauffeur.' });
  if (!courseId || !amount || currency !== 'DZD') return res.status(400).json({ error: 'courseId, amount et currency=DZD requis' });
  try {
    const checkout = await mypay.createCheckout({ courseId, amount, currency });
    res.json(checkout);
  } catch(e) { res.status(502).json({ error: e.message }); }
});

// ── Codes Promo ───────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'jibni-admin-2025';

function adminAuth(req, res, next) {
  const pwd = req.headers['x-admin-password'];
  if (!pwd || pwd !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Non autorise' });
  }
  next();
}

// GET public : valider un code
app.get('/api/promo/validate', (req, res) => {
  const code = (req.query.code || '').trim();
  if (!code) return res.status(400).json({ valid: false, error: 'Code manquant' });

  const promo = validateCode(code);
  if (promo) {
    res.json({ valid: true, code: promo.code, discount: promo.discount, description: promo.description || '' });
  } else {
    res.status(404).json({ valid: false, error: 'Code invalide ou expire' });
  }
});

// GET admin : lister tous les codes
app.get('/api/admin/promos', adminAuth, (req, res) => {
  res.json(loadPromos());
});

// POST admin : créer un code
app.post('/api/admin/promos', adminAuth, (req, res) => {
  const { code, discount, description, expiresAt } = req.body;
  if (!code || !discount) return res.status(400).json({ error: 'Code et reduction requis' });

  const promos = loadPromos();
  const normalized = code.toUpperCase().replace(/\s+/g, '');

  if (promos.find(p => p.code === normalized)) {
    return res.status(409).json({ error: 'Ce code existe deja' });
  }

  const promo = {
    id: Date.now().toString(),
    code: normalized,
    discount: parseInt(discount, 10),
    description: description || '',
    expiresAt: expiresAt || null,
    active: true,
    createdAt: new Date().toISOString()
  };

  promos.push(promo);
  savePromos(promos);
  res.status(201).json(promo);
});

// PUT admin : modifier un code
app.put('/api/admin/promos/:id', adminAuth, (req, res) => {
  const promos = loadPromos();
  const idx = promos.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Code introuvable' });

  promos[idx] = {
    ...promos[idx],
    ...(req.body.code ? { code: req.body.code.toUpperCase().replace(/\s+/g, '') } : {}),
    ...(req.body.discount !== undefined ? { discount: parseInt(req.body.discount, 10) } : {}),
    ...(req.body.description !== undefined ? { description: req.body.description } : {}),
    ...(req.body.expiresAt !== undefined ? { expiresAt: req.body.expiresAt } : {}),
    ...(req.body.active !== undefined ? { active: req.body.active } : {})
  };

  savePromos(promos);
  res.json(promos[idx]);
});

// DELETE admin : supprimer un code
app.delete('/api/admin/promos/:id', adminAuth, (req, res) => {
  const promos = loadPromos();
  const filtered = promos.filter(p => p.id !== req.params.id);
  if (filtered.length === promos.length) return res.status(404).json({ error: 'Code introuvable' });
  savePromos(filtered);
  res.json({ success: true });
});

// ── Notifications Auto ────────────────────────────────────────
app.post('/api/notify', async (req, res) => {
  try {
    const secret = req.headers['x-notify-secret'] || req.body.secret;
    if (secret !== process.env.NOTIFY_SECRET) {
      return res.status(403).json({ error: 'Non autorise' });
    }
    const data = req.body;
    if (!data.nom || !data.date) {
      return res.status(400).json({ error: 'Champs requis manquants (nom, date)' });
    }
    if (!data.id) data.id = 'JBN-' + Date.now().toString(36).toUpperCase();
    const results = await notifyNewReservation(data);
    res.json({ success: true, results });
  } catch(e) {
    console.error('[Notify] Erreur:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/notify/test', async (req, res) => {
  try {
    const secret = req.headers['x-notify-secret'] || req.body.secret;
    if (secret !== process.env.NOTIFY_SECRET) {
      return res.status(403).json({ error: 'Non autorise' });
    }
    const testData = {
      id: 'TEST-001',
      nom: 'Test Client',
      email: req.body.email || process.env.ADMIN_EMAIL,
      telephone: req.body.telephone || process.env.ADMIN_PHONE,
      date: new Date().toLocaleDateString('fr-FR'),
      heure: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      depart: 'Aeroport Marseille-Provence',
      arrivee: 'Vieux-Port, Marseille',
      passagers: '2',
      prix: '55 euros',
      lang: req.body.lang || 'fr',
      promoCode: '',
      promoDiscount: ''
    };
    const results = await notifyNewReservation(testData);
    res.json({ success: true, test: true, results });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/notify/status', (req, res) => {
  res.json({
    resend: !!process.env.RESEND_API_KEY,
    twilio_sms: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_PHONE),
    twilio_whatsapp: !!process.env.TWILIO_WHATSAPP,
    admin_phone: process.env.ADMIN_PHONE || 'non configure',
    admin_email: process.env.ADMIN_EMAIL || 'non configure'
  });
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Jibni Backend port', PORT));

// Notifier admin nouveau chauffeur
app.post('/notify-admin', async (req, res) => {
  try {
    const { type, driverId, driverName, email } = req.body;
    
    // Récupérer les admins depuis Firestore
    const { initializeApp, getApps, cert } = require('firebase-admin/app');
    const { getFirestore } = require('firebase-admin/firestore');
    
    const db = getFirestore();
    const adminsSnap = await db.collection('admins').get();
    
    for(const admin of adminsSnap.docs) {
      const adminData = admin.data();
      if(adminData.pushToken) {
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: adminData.pushToken,
            sound: 'default',
            title: '👤 Nouveau chauffeur !',
            body: `${driverName} vient de s'inscrire. À valider.`,
            data: { type: 'new_driver', driverId },
            priority: 'high',
          })
        });
      }
    }
    
    res.json({ sent: true });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

// Envoyer email via Nodemailer
const nodemailer = require('nodemailer');

app.post('/send-email', async (req, res) => {
  try {
    const { to, subject, body, driverName } = req.body;
    
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'support@jibni.fr',
        pass: process.env.EMAIL_PASSWORD
      }
    });

    await transporter.sendMail({
      from: '"Jibni Support" <support@jibni.fr>',
      to,
      subject,
      html: `
        <div style="font-family:Arial;max-width:600px;margin:auto;background:#0a0a0f;color:#fff;padding:30px;border-radius:16px">
          <h1 style="color:#f0c040">jibni</h1>
          <p>Bonjour ${driverName},</p>
          <p>${body}</p>
          <hr style="border-color:#252840;margin:20px 0"/>
          <p style="color:#55607a;font-size:12px">Jibni - Service VTC Marseille</p>
        </div>
      `
    });
    res.json({ sent: true });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── ENDPOINT ACCEPT COURSE PLANIFIÉE ────────────────────────────────────────
app.post('/accept-scheduled', async (req, res) => {
  try {
    const { courseId, driverId, driverNom, driverPhone, driverPlaque, driverPushToken } = req.body;
    const { getFirestore } = require('firebase-admin/firestore');
    const db = getFirestore();

    // Vérifier que la course est encore disponible
    const courseRef = db.collection('courses').doc(courseId);
    const courseSnap = await courseRef.get();
    const course = courseSnap.data();

    if (!course) return res.status(404).json({ error: 'Course introuvable' });
    if (course.status !== 'dispatched_scheduled') {
      return res.json({ success: false, message: 'Course déjà prise par un autre chauffeur' });
    }

    // Assigner au chauffeur
    await courseRef.update({
      status: 'accepted_scheduled',
      chauffeurId: driverId,
      chauffeurNom: driverNom,
      chauffeurPhone: driverPhone,
      chauffeurPlaque: driverPlaque,
      chauffeurPushToken: driverPushToken,
      acceptedAt: new Date(),
      updatedAt: new Date()
    });

    // Notifier le passager
    if (course.passagerPushToken) {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: course.passagerPushToken,
          title: '✅ Chauffeur assigné !',
          body: `${driverNom} prendra en charge votre course planifiée le ${course.scheduledDate} à ${course.scheduledTime}`,
          data: { type: 'scheduled_accepted', courseId },
          priority: 'high',
        })
      });
    }

    res.json({ success: true });
  } catch(e) {
    console.log('accept-scheduled error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── ENDPOINT REFUS COURSE PLANIFIÉE ─────────────────────────────────────────
app.post('/refuse-scheduled', async (req, res) => {
  try {
    const { courseId } = req.body;
    const { getFirestore } = require('firebase-admin/firestore');
    const db = getFirestore();
    const { dispatchScheduledCourse } = require('./dispatch');

    const courseSnap = await db.collection('courses').doc(courseId).get();
    const course = courseSnap.data();

    // Remettre en pending et re-dispatcher
    await db.collection('courses').doc(courseId).update({
      status: 'dispatched_scheduled',
      chauffeurId: null,
      chauffeurNom: null,
      updatedAt: new Date()
    });

    // Re-dispatcher vers d'autres chauffeurs
    await dispatchScheduledCourse(courseId, course);

    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
