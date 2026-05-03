// notifications.js — Système de messagerie automatique Jibni
// Déclenché à chaque nouvelle réservation Firebase
// Services : Resend (email), Twilio (SMS + WhatsApp)

const https = require('https');

// ─── CONFIG ───
const CFG = {
  resendKey:    process.env.RESEND_API_KEY    || '',
  twilioSid:    process.env.TWILIO_ACCOUNT_SID || '',
  twilioToken:  process.env.TWILIO_AUTH_TOKEN  || '',
  twilioPhone:  process.env.TWILIO_PHONE       || '',  // ex: +33757xxxxxx
  twilioWA:     process.env.TWILIO_WHATSAPP    || '',  // ex: +14155238886 (sandbox) ou ton numéro WhatsApp Business
  emailFrom:    process.env.EMAIL_FROM         || 'Jibni VTC <contact@jibni.fr>',
  adminPhone:   process.env.ADMIN_PHONE        || '+33782865525',
  adminEmail:   process.env.ADMIN_EMAIL        || 'contact@jibni.fr',
};

// ─── HELPERS HTTP ───
function httpPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const opts = {
      hostname, path, method: 'POST',
      headers: { 'Content-Length': Buffer.byteLength(payload), ...headers }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── EMAIL VIA RESEND ───
async function sendEmail(to, subject, html) {
  if (!CFG.resendKey) { console.warn('[Notif] RESEND_API_KEY manquante'); return null; }
  try {
    const res = await httpPost('api.resend.com', '/emails', {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + CFG.resendKey
    }, { from: CFG.emailFrom, to, subject, html });
    console.log('[Email]', to, '→', res.status);
    return res;
  } catch(e) { console.error('[Email] Erreur:', e.message); return null; }
}

// ─── SMS VIA TWILIO ───
async function sendSMS(to, body) {
  if (!CFG.twilioSid || !CFG.twilioToken) { console.warn('[Notif] TWILIO non configuré'); return null; }
  try {
    const auth = Buffer.from(CFG.twilioSid + ':' + CFG.twilioToken).toString('base64');
    const formBody = `To=${encodeURIComponent(to)}&From=${encodeURIComponent(CFG.twilioPhone)}&Body=${encodeURIComponent(body)}`;
    const res = await httpPost('api.twilio.com', `/2010-04-01/Accounts/${CFG.twilioSid}/Messages.json`, {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + auth
    }, formBody);
    console.log('[SMS]', to, '→', res.status);
    return res;
  } catch(e) { console.error('[SMS] Erreur:', e.message); return null; }
}

// ─── WHATSAPP VIA TWILIO ───
async function sendWhatsApp(to, body) {
  if (!CFG.twilioSid || !CFG.twilioToken || !CFG.twilioWA) { console.warn('[Notif] TWILIO_WHATSAPP non configuré'); return null; }
  try {
    const auth = Buffer.from(CFG.twilioSid + ':' + CFG.twilioToken).toString('base64');
    const waTo = 'whatsapp:' + to;
    const waFrom = 'whatsapp:' + CFG.twilioWA;
    const formBody = `To=${encodeURIComponent(waTo)}&From=${encodeURIComponent(waFrom)}&Body=${encodeURIComponent(body)}`;
    const res = await httpPost('api.twilio.com', `/2010-04-01/Accounts/${CFG.twilioSid}/Messages.json`, {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + auth
    }, formBody);
    console.log('[WhatsApp]', to, '→', res.status);
    return res;
  } catch(e) { console.error('[WhatsApp] Erreur:', e.message); return null; }
}

// ─── TEMPLATES MULTILINGUES ───
const TEMPLATES = {
  confirmation: {
    fr: {
      subject: '✅ Réservation Jibni confirmée — #{id}',
      sms: 'Jibni VTC : Votre réservation #{id} est confirmée !\n📅 {date} à {heure}\n📍 {depart} → {arrivee}\n💰 {prix}\nContact : 07 82 86 55 25',
      whatsapp: '✅ *Réservation Jibni confirmée*\n\n📋 Réf : #{id}\n📅 {date} à {heure}\n📍 {depart} → {arrivee}\n👤 {nom}\n💰 Tarif : {prix}{promo}\n\nVotre chauffeur vous contactera avant la prise en charge.\n\n📞 07 82 86 55 25\n🌐 jibni.fr',
      email: `
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#f5f5f5;border-radius:12px;overflow:hidden">
          <div style="background:linear-gradient(135deg,#1a1a2e,#0a0a0a);padding:32px;text-align:center">
            <h1 style="color:#d4af37;font-size:28px;margin:0;letter-spacing:2px">JIBNI</h1>
            <p style="color:#888;margin:8px 0 0;font-size:13px;letter-spacing:3px">VTC PREMIUM MARSEILLE</p>
          </div>
          <div style="padding:32px">
            <h2 style="color:#d4af37;font-size:20px;margin:0 0 24px">Réservation confirmée ✅</h2>
            <table style="width:100%;border-collapse:collapse;color:#ccc;font-size:15px">
              <tr><td style="padding:10px 0;color:#888">Référence</td><td style="padding:10px 0;text-align:right;color:#d4af37;font-weight:600">#{id}</td></tr>
              <tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Date</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222">{date} à {heure}</td></tr>
              <tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Départ</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222">{depart}</td></tr>
              <tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Arrivée</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222">{arrivee}</td></tr>
              <tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Passagers</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222">{passagers}</td></tr>
              <tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Tarif estimé</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222;color:#d4af37;font-size:18px;font-weight:700">{prix}</td></tr>
              {promoRow}
            </table>
            <div style="margin:32px 0;padding:20px;background:#111;border-radius:8px;border-left:3px solid #d4af37">
              <p style="margin:0;color:#ccc;font-size:14px">Votre chauffeur vous contactera avant la prise en charge pour confirmer les détails.</p>
            </div>
            <div style="text-align:center;margin-top:24px">
              <a href="tel:+33782865525" style="display:inline-block;background:#d4af37;color:#0a0a0a;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px">📞 Nous appeler</a>
            </div>
          </div>
          <div style="padding:20px 32px;background:#050505;text-align:center;color:#555;font-size:12px">
            <p style="margin:0">Jibni VTC Marseille — Service premium 24h/24</p>
            <p style="margin:8px 0 0"><a href="https://jibni.fr" style="color:#d4af37;text-decoration:none">jibni.fr</a> • 07 82 86 55 25</p>
          </div>
        </div>`
    },
    en: {
      subject: '✅ Jibni Booking Confirmed — #{id}',
      sms: 'Jibni VTC: Your booking #{id} is confirmed!\n📅 {date} at {heure}\n📍 {depart} → {arrivee}\n💰 {prix}\nContact: +33 7 82 86 55 25',
      whatsapp: '✅ *Jibni Booking Confirmed*\n\n📋 Ref: #{id}\n📅 {date} at {heure}\n📍 {depart} → {arrivee}\n👤 {nom}\n💰 Fare: {prix}{promo}\n\nYour driver will contact you before pickup.\n\n📞 +33 7 82 86 55 25\n🌐 jibni.fr',
      email: `
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#f5f5f5;border-radius:12px;overflow:hidden">
          <div style="background:linear-gradient(135deg,#1a1a2e,#0a0a0a);padding:32px;text-align:center">
            <h1 style="color:#d4af37;font-size:28px;margin:0;letter-spacing:2px">JIBNI</h1>
            <p style="color:#888;margin:8px 0 0;font-size:13px;letter-spacing:3px">PREMIUM CHAUFFEUR MARSEILLE</p>
          </div>
          <div style="padding:32px">
            <h2 style="color:#d4af37;font-size:20px;margin:0 0 24px">Booking Confirmed ✅</h2>
            <table style="width:100%;border-collapse:collapse;color:#ccc;font-size:15px">
              <tr><td style="padding:10px 0;color:#888">Reference</td><td style="padding:10px 0;text-align:right;color:#d4af37;font-weight:600">#{id}</td></tr>
              <tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Date</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222">{date} at {heure}</td></tr>
              <tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Pickup</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222">{depart}</td></tr>
              <tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Drop-off</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222">{arrivee}</td></tr>
              <tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Passengers</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222">{passagers}</td></tr>
              <tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Estimated fare</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222;color:#d4af37;font-size:18px;font-weight:700">{prix}</td></tr>
              {promoRow}
            </table>
            <div style="margin:32px 0;padding:20px;background:#111;border-radius:8px;border-left:3px solid #d4af37">
              <p style="margin:0;color:#ccc;font-size:14px">Your driver will contact you before pickup to confirm details.</p>
            </div>
            <div style="text-align:center;margin-top:24px">
              <a href="tel:+33782865525" style="display:inline-block;background:#d4af37;color:#0a0a0a;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px">📞 Call us</a>
            </div>
          </div>
          <div style="padding:20px 32px;background:#050505;text-align:center;color:#555;font-size:12px">
            <p style="margin:0">Jibni VTC Marseille — Premium service 24/7</p>
            <p style="margin:8px 0 0"><a href="https://jibni.fr" style="color:#d4af37;text-decoration:none">jibni.fr</a> • +33 7 82 86 55 25</p>
          </div>
        </div>`
    },
    es: {
      subject: '✅ Reserva Jibni confirmada — #{id}',
      sms: 'Jibni VTC: Su reserva #{id} confirmada!\n📅 {date} a las {heure}\n📍 {depart} → {arrivee}\n💰 {prix}\nContacto: +33 7 82 86 55 25',
      whatsapp: '✅ *Reserva Jibni Confirmada*\n\n📋 Ref: #{id}\n📅 {date} a las {heure}\n📍 {depart} → {arrivee}\n👤 {nom}\n💰 Tarifa: {prix}{promo}\n\nSu chofer le contactará antes de la recogida.\n\n📞 +33 7 82 86 55 25\n🌐 jibni.fr',
      email: `<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#f5f5f5;border-radius:12px;overflow:hidden"><div style="background:linear-gradient(135deg,#1a1a2e,#0a0a0a);padding:32px;text-align:center"><h1 style="color:#d4af37;font-size:28px;margin:0;letter-spacing:2px">JIBNI</h1><p style="color:#888;margin:8px 0 0;font-size:13px;letter-spacing:3px">VTC PREMIUM MARSELLA</p></div><div style="padding:32px"><h2 style="color:#d4af37;font-size:20px;margin:0 0 24px">Reserva Confirmada ✅</h2><table style="width:100%;border-collapse:collapse;color:#ccc;font-size:15px"><tr><td style="padding:10px 0;color:#888">Referencia</td><td style="padding:10px 0;text-align:right;color:#d4af37;font-weight:600">#{id}</td></tr><tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Fecha</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222">{date} a las {heure}</td></tr><tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Recogida</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222">{depart}</td></tr><tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Destino</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222">{arrivee}</td></tr><tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Pasajeros</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222">{passagers}</td></tr><tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Tarifa estimada</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222;color:#d4af37;font-size:18px;font-weight:700">{prix}</td></tr>{promoRow}</table><div style="margin:32px 0;padding:20px;background:#111;border-radius:8px;border-left:3px solid #d4af37"><p style="margin:0;color:#ccc;font-size:14px">Su chofer le contactará antes de la recogida para confirmar los detalles.</p></div><div style="text-align:center;margin-top:24px"><a href="tel:+33782865525" style="display:inline-block;background:#d4af37;color:#0a0a0a;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px">📞 Llamar</a></div></div><div style="padding:20px 32px;background:#050505;text-align:center;color:#555;font-size:12px"><p style="margin:0">Jibni VTC Marsella — Servicio premium 24/7</p><p style="margin:8px 0 0"><a href="https://jibni.fr" style="color:#d4af37;text-decoration:none">jibni.fr</a> • +33 7 82 86 55 25</p></div></div>`
    },
    it: {
      subject: '✅ Prenotazione Jibni confermata — #{id}',
      sms: 'Jibni VTC: Prenotazione #{id} confermata!\n📅 {date} alle {heure}\n📍 {depart} → {arrivee}\n💰 {prix}\nContatto: +33 7 82 86 55 25',
      whatsapp: '✅ *Prenotazione Jibni Confermata*\n\n📋 Rif: #{id}\n📅 {date} alle {heure}\n📍 {depart} → {arrivee}\n👤 {nom}\n💰 Tariffa: {prix}{promo}\n\nIl vostro autista vi contatterà prima del ritiro.\n\n📞 +33 7 82 86 55 25\n🌐 jibni.fr',
      email: `<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#f5f5f5;border-radius:12px;overflow:hidden"><div style="background:linear-gradient(135deg,#1a1a2e,#0a0a0a);padding:32px;text-align:center"><h1 style="color:#d4af37;font-size:28px;margin:0;letter-spacing:2px">JIBNI</h1><p style="color:#888;margin:8px 0 0;font-size:13px;letter-spacing:3px">VTC PREMIUM MARSIGLIA</p></div><div style="padding:32px"><h2 style="color:#d4af37;font-size:20px;margin:0 0 24px">Prenotazione Confermata ✅</h2><table style="width:100%;border-collapse:collapse;color:#ccc;font-size:15px"><tr><td style="padding:10px 0;color:#888">Riferimento</td><td style="padding:10px 0;text-align:right;color:#d4af37;font-weight:600">#{id}</td></tr><tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Data</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222">{date} alle {heure}</td></tr><tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Partenza</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222">{depart}</td></tr><tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Arrivo</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222">{arrivee}</td></tr><tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Passeggeri</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222">{passagers}</td></tr><tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Tariffa stimata</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222;color:#d4af37;font-size:18px;font-weight:700">{prix}</td></tr>{promoRow}</table><div style="margin:32px 0;padding:20px;background:#111;border-radius:8px;border-left:3px solid #d4af37"><p style="margin:0;color:#ccc;font-size:14px">Il vostro autista vi contatterà prima del ritiro per confermare i dettagli.</p></div><div style="text-align:center;margin-top:24px"><a href="tel:+33782865525" style="display:inline-block;background:#d4af37;color:#0a0a0a;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px">📞 Chiama</a></div></div><div style="padding:20px 32px;background:#050505;text-align:center;color:#555;font-size:12px"><p style="margin:0">Jibni VTC Marsiglia — Servizio premium 24/7</p><p style="margin:8px 0 0"><a href="https://jibni.fr" style="color:#d4af37;text-decoration:none">jibni.fr</a> • +33 7 82 86 55 25</p></div></div>`
    },
    ru: {
      subject: '✅ Бронирование Jibni подтверждено — #{id}',
      sms: 'Jibni VTC: Бронирование #{id} подтверждено!\n📅 {date} в {heure}\n📍 {depart} → {arrivee}\n💰 {prix}\nКонтакт: +33 7 82 86 55 25',
      whatsapp: '✅ *Бронирование Jibni Подтверждено*\n\n📋 Реф: #{id}\n📅 {date} в {heure}\n📍 {depart} → {arrivee}\n👤 {nom}\n💰 Тариф: {prix}{promo}\n\nВаш водитель свяжется с вами перед подачей.\n\n📞 +33 7 82 86 55 25\n🌐 jibni.fr',
      email: `<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#f5f5f5;border-radius:12px;overflow:hidden"><div style="background:linear-gradient(135deg,#1a1a2e,#0a0a0a);padding:32px;text-align:center"><h1 style="color:#d4af37;font-size:28px;margin:0;letter-spacing:2px">JIBNI</h1><p style="color:#888;margin:8px 0 0;font-size:13px;letter-spacing:3px">VTC ПРЕМИУМ МАРСЕЛЬ</p></div><div style="padding:32px"><h2 style="color:#d4af37;font-size:20px;margin:0 0 24px">Бронирование Подтверждено ✅</h2><table style="width:100%;border-collapse:collapse;color:#ccc;font-size:15px"><tr><td style="padding:10px 0;color:#888">Номер</td><td style="padding:10px 0;text-align:right;color:#d4af37;font-weight:600">#{id}</td></tr><tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Дата</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222">{date} в {heure}</td></tr><tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Отправление</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222">{depart}</td></tr><tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Прибытие</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222">{arrivee}</td></tr><tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Пассажиры</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222">{passagers}</td></tr><tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Тариф</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222;color:#d4af37;font-size:18px;font-weight:700">{prix}</td></tr>{promoRow}</table><div style="margin:32px 0;padding:20px;background:#111;border-radius:8px;border-left:3px solid #d4af37"><p style="margin:0;color:#ccc;font-size:14px">Ваш водитель свяжется с вами перед подачей для подтверждения деталей.</p></div><div style="text-align:center;margin-top:24px"><a href="tel:+33782865525" style="display:inline-block;background:#d4af37;color:#0a0a0a;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px">📞 Позвонить</a></div></div><div style="padding:20px 32px;background:#050505;text-align:center;color:#555;font-size:12px"><p style="margin:0">Jibni VTC Марсель — Премиум сервис 24/7</p><p style="margin:8px 0 0"><a href="https://jibni.fr" style="color:#d4af37;text-decoration:none">jibni.fr</a> • +33 7 82 86 55 25</p></div></div>`
    }
  },
  driver: {
    sms: '🚗 NOUVELLE COURSE #{id}\n📅 {date} à {heure}\n📍 {depart} → {arrivee}\n👤 {nom} — {passagers} pers.\n📞 {telephone}\n💰 {prix}',
    email_subject: '🚗 Nouvelle course #{id} — {date}',
    email: `
      <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#f5f5f5;border-radius:12px;overflow:hidden">
        <div style="background:#d4af37;padding:16px 32px;text-align:center">
          <h1 style="color:#0a0a0a;font-size:20px;margin:0">🚗 NOUVELLE COURSE</h1>
        </div>
        <div style="padding:32px">
          <table style="width:100%;border-collapse:collapse;color:#ccc;font-size:15px">
            <tr><td style="padding:10px 0;color:#888">Référence</td><td style="padding:10px 0;text-align:right;color:#d4af37;font-weight:600">#{id}</td></tr>
            <tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Date</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222">{date} à {heure}</td></tr>
            <tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Départ</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222">{depart}</td></tr>
            <tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Arrivée</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222">{arrivee}</td></tr>
            <tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Client</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222">{nom}</td></tr>
            <tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Téléphone</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222"><a href="tel:{telephone}" style="color:#d4af37">{telephone}</a></td></tr>
            <tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Passagers</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222">{passagers}</td></tr>
            <tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Tarif</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222;color:#d4af37;font-size:18px;font-weight:700">{prix}</td></tr>
          </table>
          {notesBlock}
        </div>
      </div>`
  }
};

// ─── TEMPLATE FILL ───
function fillTemplate(tpl, data) {
  if (!tpl) return '';
  let out = tpl;
  const promoRow = data.promoCode
    ? `<tr><td style="padding:10px 0;color:#888;border-top:1px solid #222">Code promo</td><td style="padding:10px 0;text-align:right;border-top:1px solid #222;color:#4ade80">${data.promoCode} (-${data.promoDiscount || 0}%)</td></tr>`
    : '';
  const promoText = data.promoCode
    ? `\n🏷️ Code : ${data.promoCode} (-${data.promoDiscount || 0}%)`
    : '';
  const notesBlock = data.notes
    ? `<div style="margin-top:20px;padding:16px;background:#111;border-radius:8px"><p style="margin:0;color:#888;font-size:13px">📝 ${data.notes}</p></div>`
    : '';
  const replacements = {
    '{id}': data.id || '—',
    '{date}': data.date || '—',
    '{heure}': data.heure || '—',
    '{depart}': data.depart || '—',
    '{arrivee}': data.arrivee || '—',
    '{nom}': data.nom || '—',
    '{passagers}': data.passagers || '—',
    '{telephone}': data.telephone || '—',
    '{prix}': data.prix || '—',
    '{promo}': promoText,
    '{promoRow}': promoRow,
    '{notesBlock}': notesBlock,
  };
  for (const [k, v] of Object.entries(replacements)) {
    out = out.split(k).join(v);
  }
  return out;
}

// ─── DETECT LANGUAGE ───
function detectLang(data) {
  const lang = (data.lang || data.langue || 'fr').toLowerCase().slice(0, 2);
  return ['fr', 'en', 'es', 'it', 'ru'].includes(lang) ? lang : 'fr';
}

// ─── MAIN: ENVOYER TOUTES LES NOTIFS ───
async function notifyNewReservation(data) {
  const lang = detectLang(data);
  const tpl = TEMPLATES.confirmation[lang] || TEMPLATES.confirmation.fr;
  const results = { email: null, sms: null, whatsapp: null, driver_sms: null, driver_email: null };

  console.log(`[Notif] Nouvelle résa #${data.id} — lang=${lang} — ${data.nom}`);

  // 1. EMAIL CLIENT
  if (data.email) {
    const subject = fillTemplate(tpl.subject, data);
    const html = fillTemplate(tpl.email, data);
    results.email = await sendEmail(data.email, subject, html);
  }

  // 2. SMS CLIENT
  if (data.telephone) {
    const phone = normalizePhone(data.telephone);
    if (phone) {
      const body = fillTemplate(tpl.sms, data);
      results.sms = await sendSMS(phone, body);
    }
  }

  // 3. WHATSAPP CLIENT
  if (data.telephone) {
    const phone = normalizePhone(data.telephone);
    if (phone) {
      const body = fillTemplate(tpl.whatsapp, data);
      results.whatsapp = await sendWhatsApp(phone, body);
    }
  }

  // 4. NOTIF CHAUFFEUR (SMS + Email)
  const driverPhone = data.driverPhone || CFG.adminPhone;
  const driverEmail = data.driverEmail || CFG.adminEmail;

  if (driverPhone) {
    const body = fillTemplate(TEMPLATES.driver.sms, data);
    results.driver_sms = await sendSMS(driverPhone, body);
  }

  if (driverEmail) {
    const subject = fillTemplate(TEMPLATES.driver.email_subject, data);
    const html = fillTemplate(TEMPLATES.driver.email, data);
    results.driver_email = await sendEmail(driverEmail, subject, html);
  }

  // 5. NOTIF ADMIN (toi) — toujours
  if (CFG.adminPhone && CFG.adminPhone !== driverPhone) {
    await sendSMS(CFG.adminPhone, fillTemplate(TEMPLATES.driver.sms, data));
  }

  console.log('[Notif] Résultats:', JSON.stringify(results, null, 2));
  return results;
}

// ─── NORMALISE PHONE → E.164 ───
function normalizePhone(phone) {
  if (!phone) return null;
  let p = phone.replace(/[\s.\-()]/g, '');
  // France: 06/07 → +33
  if (p.match(/^0[67]/)) p = '+33' + p.slice(1);
  // Déjà international
  if (!p.startsWith('+')) p = '+' + p;
  // Vérification basique
  if (p.length < 10 || p.length > 16) return null;
  return p;
}

module.exports = { notifyNewReservation, sendEmail, sendSMS, sendWhatsApp };
