// Paiement en ligne MyPay (cartes CIB / Edahabia) pour l'Algérie.
// À COMPLÉTER : l'API MyPay n'est pas encore intégrée (documentation et
// identifiants marchand requis). Tant que isConfigured() renvoie false,
// l'app passager affiche MyPay « Bientôt disponible » et propose les espèces.

function isConfigured() {
  // Remplacer par la vérification des identifiants une fois l'API branchée,
  // ex. return Boolean(process.env.MYPAY_API_KEY && process.env.MYPAY_SECRET);
  return false;
}

// Doit renvoyer { checkoutUrl, paymentId } : page de paiement où rediriger le passager
async function createCheckout({ courseId, amount, currency }) {
  throw new Error('MyPay pas encore disponible');
}

module.exports = { isConfigured, createCheckout };
