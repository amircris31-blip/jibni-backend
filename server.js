const express = require("express");
const cors = require("cors");
const app = express();

app.use(cors());
app.use(express.json());

// Base de donnees locale en attendant API SIV payante
const PLATE_DB = {
  "HH-183-VB": { brand:"Toyota", model:"Corolla", year:"2021", color:"Blanc", seats:5 },
  "AA-823-BB": { brand:"Toyota", model:"Corolla", year:"2021", color:"Blanc", seats:5 },
  "AB-123-CD": { brand:"Mercedes-Benz", model:"Classe E", year:"2022", color:"Noir", seats:5 },
  "EF-456-GH": { brand:"Volkswagen", model:"Caravelle", year:"2020", color:"Gris", seats:9 },
  "IJ-789-KL": { brand:"Peugeot", model:"508", year:"2023", color:"Bleu", seats:5 },
  "MN-012-OP": { brand:"BMW", model:"Serie 5", year:"2022", color:"Noir", seats:5 },
};

function formatPlate(raw) {
  const clean = raw.toUpperCase().replace(/[\s\-]/g, "");
  if (clean.length === 7) {
    return clean.slice(0,2) + "-" + clean.slice(2,5) + "-" + clean.slice(5,7);
  }
  return clean;
}

// GET /plaque/:immat
app.get("/plaque/:immat", async (req, res) => {
  const plate = formatPlate(req.params.immat);
  console.log("Recherche plaque:", plate);

  // 1. Chercher dans la base locale
  if (PLATE_DB[plate]) {
    return res.json({ success: true, source: "local", data: PLATE_DB[plate] });
  }

  // 2. Essayer API SIV externe (remplacer par votre cle API)
  try {
    const API_KEY = process.env.SIV_API_KEY || "";
    if (API_KEY) {
      const response = await fetch(`https://api.apiplaques.fr/immatriculation/${plate}`, {
        headers: { "X-Api-Key": API_KEY, "Accept": "application/json" }
      });
      if (response.ok) {
        const json = await response.json();
        const data = {
          brand: json.marque || json.brand || "",
          model: json.modele || json.model || "",
          year: (json.date_mise_en_circulation || json.year || "").toString().slice(0,4),
          color: json.couleur || json.color || "",
          seats: parseInt(json.nombre_places || json.seats || 5),
        };
        // Sauvegarder en cache local
        PLATE_DB[plate] = data;
        return res.json({ success: true, source: "siv", data });
      }
    }
  } catch (e) {
    console.error("SIV API error:", e.message);
  }

  return res.json({ success: false, message: "Plaque non trouvee: " + plate });
});

// POST /plaque/add - Ajouter une plaque manuellement (admin)
app.post("/plaque/add", (req, res) => {
  const { plate, brand, model, year, color, seats, adminKey } = req.body;
  if (adminKey !== (process.env.ADMIN_KEY || "jibni2024")) {
    return res.status(401).json({ error: "Non autorise" });
  }
  const fmt = formatPlate(plate);
  PLATE_DB[fmt] = { brand, model, year, color, seats: parseInt(seats) };
  console.log("Plaque ajoutee:", fmt, PLATE_DB[fmt]);
  res.json({ success: true, plate: fmt });
});

// Health check
app.get("/", (req, res) => res.json({ status: "ok", service: "Jibni SIV Backend" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Jibni backend running on port ${PORT}`));
