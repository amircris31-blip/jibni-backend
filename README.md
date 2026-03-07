# Jibni Backend - SIV

## Déploiement gratuit sur Railway

1. Créez un compte sur https://railway.app
2. Cliquez "New Project" → "Deploy from GitHub"
3. Uploadez ce dossier ou connectez votre GitHub
4. Railway détecte automatiquement Node.js et déploie

## Variables d'environnement (optionnel)
- `SIV_API_KEY` : Votre clé API apiplaques.fr
- `ADMIN_KEY` : Clé secrète pour ajouter des plaques (défaut: jibni2024)
- `PORT` : Port du serveur (Railway le définit automatiquement)

## URL après déploiement
Railway vous donne une URL comme :
https://jibni-backend-production.up.railway.app

## Endpoints
- GET /plaque/HH-183-VB → Cherche la plaque
- POST /plaque/add → Ajoute une plaque manuellement
- GET / → Status du serveur

## Ajouter une plaque manuellement
```bash
curl -X POST https://votre-url/plaque/add \
  -H "Content-Type: application/json" \
  -d '{"plate":"HH-183-VB","brand":"Toyota","model":"Corolla","year":"2021","color":"Blanc","seats":5,"adminKey":"jibni2024"}'
```
