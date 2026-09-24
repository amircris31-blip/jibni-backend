// Devises par pays : France → EUR (€), Algérie → DZD (DA)
const CURRENCIES = {
  EUR: { symbol: '€', decimals: 2 },
  DZD: { symbol: 'DA', decimals: 0 },
};
const COUNTRY_CURRENCY = { FR: 'EUR', DZ: 'DZD' };

function courseCurrency(course = {}) {
  return course.currency || COUNTRY_CURRENCY[course.country] || 'EUR';
}

// 12.5 → "12.50 €" ; 1250 (DZD) → "1 250 DA"
function formatPrice(amount, currency = 'EUR') {
  const c = CURRENCIES[currency] || CURRENCIES.EUR;
  const n = Number(amount);
  if (amount === null || amount === undefined || amount === '' || isNaN(n)) return String(amount ?? '—');
  let [int, dec] = n.toFixed(c.decimals).split('.');
  if (currency === 'DZD') int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${dec ? `${int}.${dec}` : int} ${c.symbol}`;
}

module.exports = { CURRENCIES, COUNTRY_CURRENCY, courseCurrency, formatPrice };
