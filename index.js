const express = require('express');
const stripe = require('stripe')('sk_test_51T933ZPtCjzYKlcDtMJ3W8CVgJjD5eAikiZnQIOcgZPtRxfW2gMkK9bBrfaSHZ7ib2PgWa3lWqfVlOp7PbFC0hec00GhZBsPJf');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Créer un SetupIntent pour valider une carte
app.post('/create-setup-intent', async (req, res) => {
  try {
    const customer = await stripe.customers.create({
      email: req.body.email || 'passager@jibni.fr',
      metadata: { userId: req.body.userId || '' }
    });
    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ['card'],
    });
    res.json({ clientSecret: setupIntent.client_secret, customerId: customer.id });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

// Vérifier si une carte est valide
app.post('/verify-payment-method', async (req, res) => {
  try {
    const { paymentMethodId, customerId } = req.body;
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    res.json({
      valid: true,
      brand: pm.card?.brand,
      last4: pm.card?.last4,
      expMonth: pm.card?.exp_month,
      expYear: pm.card?.exp_year,
    });
  } catch(e) {
    res.status(400).json({ valid: false, error: e.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));


// ── ASSISTANT JIBNI IA (Claude API) ──
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, system } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages requis' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: system || 'Tu es l assistant virtuel de Jibni VTC Marseille. Reponds en francais, concis et professionnel.',
        messages: messages.slice(-6).map(function(m) {
          return { role: m.role, content: String(m.content).slice(0, 500) };
        })
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: data.error.message });
    }

    const reply = data.content && data.content[0] ? data.content[0].text : 'Desolee, une erreur est survenue.';
    res.json({ reply });

  } catch(e) {
    console.error('Chat error:', e);
    res.status(500).json({ reply: 'Appelez le 07 82 86 55 25 pour assistance.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Jibni Backend running on port', PORT));

const { dispatchCourse } = require('./dispatch');

// Endpoint dispatch course
app.post('/dispatch-course', async (req, res) => {
  try {
    const { courseId, courseData } = req.body;
    dispatchCourse(courseId, courseData);
    res.json({ dispatching: true });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});
