const fs = require('fs');
const path = require('path');

const PROMOS_FILE = path.join(__dirname, 'promos.json');

function loadPromos() {
  try {
    if (fs.existsSync(PROMOS_FILE)) {
      return JSON.parse(fs.readFileSync(PROMOS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[Promos] Erreur lecture promos.json:', e.message);
  }
  return [];
}

function savePromos(promos) {
  fs.writeFileSync(PROMOS_FILE, JSON.stringify(promos, null, 2), 'utf8');
}

function validateCode(code) {
  const promos = loadPromos();
  const now = new Date();
  return promos.find(p =>
    p.code.toUpperCase() === code.toUpperCase().trim() &&
    p.active &&
    (!p.expiresAt || new Date(p.expiresAt) > now)
  ) || null;
}

module.exports = { loadPromos, savePromos, validateCode };
