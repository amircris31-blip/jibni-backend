const express = require('express');
const stripe = require('stripe')('sk_test_51T933ZPtCjzYKlcDtMJ3W8CVgJjD5eAikiZnQIOcgZPtRxfW2gMkK9bBrfaSHZ7ib2PgWa3lWqfVlOp7PbFC0hec00GhZBsPJf');
const cors = require('cors');
const https = require('https');
const app = express();

// CORS ouvert pour jibni.fr
app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','Accept'] }));
app.options('*', cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

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
    res.json({ valid: true, brand: pm.card?.brand, last4: pm.card?.last4, expMonth: pm.card?.exp_month, expYear: pm.card?.exp_year });
  } catch(e) { res.status(400).json({ valid: false, error: e.message }); }
});

// Assistant IA avec https natif (compatible Node 14+)
function callAnthropic(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01'
      }
    }, (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

app.post('/api/chat', async (req, res) => {
  try {
    const { messages, system } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ reply: 'Erreur.' });
    if (!process.env.ANTHROPIC_API_KEY) return res.json({ reply: 'Configurez la cle API. Appelez le 07 82 86 55 25.' });

    const data = await callAnthropic({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: system || 'Tu es l assistant Jibni VTC Marseille. Reponds en francais, concis. Tarifs: Aeroport 55 euros, Aix 65, Nice 260 berline/360 van, Toulon 120, Avignon 150, Lyon 380. Van 8 places. Tel: 07 82 86 55 25.',
      messages: messages.slice(-6).map(m => ({ role: m.role, content: String(m.content).slice(0,500) }))
    });

    const reply = data.content?.[0]?.text || 'Erreur de reponse.';
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
