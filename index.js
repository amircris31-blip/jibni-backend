const express = require('express');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const https = require('https');
const app = express();

app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','Accept'] }));
app.options('*', cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({
  status: 'ok',
  groq: process.env.GROQ_API_KEY ? 'present' : 'MISSING'
}));

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

// Appel Groq API (100% gratuit, ultra rapide)
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

app.post('/dispatch-course', async (req, res) => {
  try {
    const { courseId, courseData } = req.body;
    const { dispatchCourse } = require('./dispatch');
    dispatchCourse(courseId, courseData);
    res.json({ dispatching: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Jibni Backend port', PORT));
