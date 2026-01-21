# Wikidata Server (API + Frontend)

## Run lokaal
```bash
npm install
npm start
```

Open daarna: http://localhost:10000

## Endpoints
- GET /              -> frontend (public/index.html)
- GET /api/health
- GET /api/country/:iso3
- GET /api/places/:iso3?limit=30
- GET /api/place/:qid
