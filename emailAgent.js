const { ImapFlow } = require("imapflow");
const nodemailer = require("nodemailer");
const Anthropic = require("@anthropic-ai/sdk").default;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Configuration IMAP/SMTP depuis les variables d'environnement
function getImapConfig() {
  return {
    host: process.env.IMAP_HOST || "imap.gmail.com",
    port: parseInt(process.env.IMAP_PORT || "993"),
    secure: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    logger: false,
  };
}

function getSmtpConfig() {
  return {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  };
}

// --- Fonctions IMAP ---

async function lireMails({ dossier = "INBOX", limite = 10, nonLusSeulement = true } = {}) {
  const client = new ImapFlow(getImapConfig());
  await client.connect();
  const mails = [];
  try {
    await client.mailboxOpen(dossier);
    const critere = nonLusSeulement ? { seen: false } : { all: true };
    const uids = await client.search(critere);
    const uidsRecents = uids.slice(-limite);

    for await (const msg of client.fetch(uidsRecents, {
      uid: true, flags: true, envelope: true, bodyStructure: true,
      bodyParts: ["TEXT"],
    })) {
      const textPart = msg.bodyParts?.get("TEXT");
      const corps = textPart ? Buffer.from(textPart).toString("utf8").slice(0, 2000) : "";
      mails.push({
        uid: msg.uid,
        de: msg.envelope?.from?.[0]?.address || "",
        sujet: msg.envelope?.subject || "(sans sujet)",
        date: msg.envelope?.date?.toISOString() || "",
        corps: corps.replace(/\r\n/g, "\n").trim(),
        lu: msg.flags?.has("\\Seen") || false,
      });
    }
  } finally {
    await client.logout();
  }
  return mails;
}

async function deplacerMail({ uid, dossierCible }) {
  const client = new ImapFlow(getImapConfig());
  await client.connect();
  try {
    await client.mailboxOpen("INBOX");
    await client.messageMove(uid, dossierCible, { uid: true });
    return { succes: true, message: `Mail ${uid} deplace vers ${dossierCible}` };
  } finally {
    await client.logout();
  }
}

async function marquerLu({ uid }) {
  const client = new ImapFlow(getImapConfig());
  await client.connect();
  try {
    await client.mailboxOpen("INBOX");
    await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
    return { succes: true };
  } finally {
    await client.logout();
  }
}

async function listerDossiers() {
  const client = new ImapFlow(getImapConfig());
  await client.connect();
  try {
    const dossiers = await client.list();
    return dossiers.map(d => ({ nom: d.name, path: d.path }));
  } finally {
    await client.logout();
  }
}

async function creerDossier({ nom }) {
  const client = new ImapFlow(getImapConfig());
  await client.connect();
  try {
    await client.mailboxCreate(nom);
    return { succes: true, message: `Dossier "${nom}" cree` };
  } finally {
    await client.logout();
  }
}

async function envoyerMail({ a, sujet, corps, replyTo }) {
  const transporter = nodemailer.createTransport(getSmtpConfig());
  const info = await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: a,
    subject: sujet,
    text: corps,
    ...(replyTo ? { inReplyTo: replyTo, references: replyTo } : {}),
  });
  return { succes: true, messageId: info.messageId };
}

// --- Définition des outils Claude ---

const OUTILS_EMAIL = [
  {
    name: "lire_mails",
    description: "Lit les emails depuis la boîte mail. Retourne les emails non lus par défaut.",
    input_schema: {
      type: "object",
      properties: {
        dossier: { type: "string", description: "Dossier à lire (ex: INBOX, Sent, Spam). Défaut: INBOX" },
        limite: { type: "integer", description: "Nombre maximum d'emails à retourner. Défaut: 10" },
        nonLusSeulement: { type: "boolean", description: "Si true, retourne seulement les non lus. Défaut: true" },
      },
      required: [],
    },
  },
  {
    name: "envoyer_reponse",
    description: "Envoie un email ou une réponse à un email.",
    input_schema: {
      type: "object",
      properties: {
        a: { type: "string", description: "Adresse email du destinataire" },
        sujet: { type: "string", description: "Sujet de l'email" },
        corps: { type: "string", description: "Corps du message en texte plain" },
        replyTo: { type: "string", description: "Message-ID de l'email auquel on répond (optionnel)" },
      },
      required: ["a", "sujet", "corps"],
    },
  },
  {
    name: "deplacer_mail",
    description: "Déplace un email vers un dossier pour organiser la boîte mail.",
    input_schema: {
      type: "object",
      properties: {
        uid: { type: "number", description: "UID de l'email à déplacer" },
        dossierCible: { type: "string", description: "Nom du dossier de destination (ex: Factures, Urgent, Archives)" },
      },
      required: ["uid", "dossierCible"],
    },
  },
  {
    name: "marquer_lu",
    description: "Marque un email comme lu.",
    input_schema: {
      type: "object",
      properties: {
        uid: { type: "number", description: "UID de l'email à marquer comme lu" },
      },
      required: ["uid"],
    },
  },
  {
    name: "lister_dossiers",
    description: "Liste tous les dossiers disponibles dans la boîte mail.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "creer_dossier",
    description: "Crée un nouveau dossier dans la boîte mail pour organiser les emails.",
    input_schema: {
      type: "object",
      properties: {
        nom: { type: "string", description: "Nom du dossier à créer (ex: Factures, Clients, Urgent)" },
      },
      required: ["nom"],
    },
  },
];

// --- Exécution des outils ---

async function executerOutil(nom, input) {
  switch (nom) {
    case "lire_mails":       return await lireMails(input);
    case "envoyer_reponse":  return await envoyerMail(input);
    case "deplacer_mail":    return await deplacerMail(input);
    case "marquer_lu":       return await marquerLu(input);
    case "lister_dossiers":  return await listerDossiers();
    case "creer_dossier":    return await creerDossier(input);
    default:                 return { erreur: "Outil inconnu: " + nom };
  }
}

// --- Boucle agentique principale ---

const SYSTEM_EMAIL = `Tu es un assistant email intelligent pour l'application Jibni.
Tu gères et organises la boîte mail de l'utilisateur de façon autonome.

Tes capacités :
- Lire les emails non lus
- Répondre aux emails au nom de l'utilisateur
- Organiser les emails dans des dossiers thématiques (Factures, Urgent, Clients, Archives, Spam, etc.)
- Créer des dossiers si nécessaire
- Marquer les emails comme lus après traitement

Quand tu organises la boîte mail :
1. Liste d'abord les dossiers existants
2. Lis les emails non lus
3. Analyse chaque email et déplace-le dans le dossier approprié
4. Crée les dossiers manquants si besoin
5. Marque les emails traités comme lus

Réponds toujours en français et sois proactif dans l'organisation.`;

async function runEmailAgent(message, history = []) {
  const messages = [...history, { role: "user", content: message }];

  let response = await anthropic.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system: SYSTEM_EMAIL,
    tools: OUTILS_EMAIL,
    messages,
  });

  while (response.stop_reason === "tool_use") {
    const toolUseBlocks = response.content.filter(b => b.type === "tool_use");
    messages.push({ role: "assistant", content: response.content });

    const toolResults = [];
    for (const toolUse of toolUseBlocks) {
      let resultat;
      try {
        resultat = await executerOutil(toolUse.name, toolUse.input);
      } catch (e) {
        resultat = { erreur: e.message };
      }
      console.log(`[EmailAgent] Outil: ${toolUse.name}`, JSON.stringify(toolUse.input));
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: JSON.stringify(resultat),
      });
    }

    messages.push({ role: "user", content: toolResults });

    response = await anthropic.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: SYSTEM_EMAIL,
      tools: OUTILS_EMAIL,
      messages,
    });
  }

  const textBlock = response.content.find(b => b.type === "text");
  const reply = textBlock ? textBlock.text : "";
  messages.push({ role: "assistant", content: response.content });

  const cleanHistory = messages
    .map(m => ({
      role: m.role,
      content: Array.isArray(m.content)
        ? m.content.filter(b => b.type === "text").map(b => b.text).join("")
        : m.content,
    }))
    .filter(m => m.content);

  return { reply, history: cleanHistory };
}

module.exports = { runEmailAgent };
