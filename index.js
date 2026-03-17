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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Jibni Backend running on port', PORT));
