import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(cors());

// === Static frontend (index.html) ===
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

// Safety: altijd index.html teruggeven op "/"
app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

const PORT = process.env.PORT || 10000;
const WDQS = "https://query.wikidata.org/sparql";

// === Simple in-memory cache ===
const cache = new Map(); // key -> { ts, data }
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;

function getCache(key) {
  const v = cache.get(key);
  if (!v) return null;
  if (Date.now() - v.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return v.data;
}

function setCache(key, data) {
  cache.set(key, { ts: Date.now(), data });
}

function qidFromUri(uri) {
  const m = /\/(Q\d+)$/.exec(String(uri || ""));
  return m ? m[1] : "";
}

function parseWktPoint(wkt) {
  const m = /Point\(([-\d.]+)\s+([-\d.]+)\)/.exec(String(wkt || ""));
  if (!m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function commonsImageUrl(fileUriOrName, width = 560) {
  const u = String(fileUriOrName || "");
  if (!u) return "";
  if (u.includes("Special:FilePath/")) return `${u}?width=${encodeURIComponent(width)}`;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(u)}?width=${encodeURIComponent(width)}`;
}

async function wdqsQuery(sparql) {
  const body = new URLSearchParams({ query: sparql });

  // WDQS is gevoelig voor “anonieme scripts”; User-Agent helpt vaak
  const res = await fetch(WDQS, {
    method: "POST",
    headers: {
      "Accept": "application/sparql-results+json",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": "wikidata-server.onrender.com (school project) - contact: none"
    },
    body
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`WDQS fout: ${res.status} ${res.statusText} ${text.slice(0, 200)}`);
  }
  return res.json();
}

// === API ===
app.get("/api/health", (req, res) => res.json({ ok: true }));

// Landinfo via ISO-numeric (zoals "528" voor Nederland)
app.get("/api/country/:iso3", async (req, res) => {
  const iso3 = String(req.params.iso3 || "").trim().padStart(3, "0");
  const key = `country:${iso3}`;

  const cached = getCache(key);
  if (cached) return res.json(cached);

  try {
    const sparql = `
      SELECT ?country ?capitalLabel ?continentLabel ?population WHERE {
        ?country wdt:P299 "${iso3}" .
        OPTIONAL { ?country wdt:P36 ?capital . }
        OPTIONAL { ?country wdt:P30 ?continent . }
        OPTIONAL { ?country wdt:P1082 ?population . }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "nl,en". }
      }
      LIMIT 1
    `;

    const data = await wdqsQuery(sparql);
    const b = (data?.results?.bindings || [])[0] || {};
    const uri = b.country?.value || "";
    const countryQid = qidFromUri(uri);

    const out = {
      iso3,
      countryQid,
      wikidataUrl: uri || (countryQid ? `https://www.wikidata.org/wiki/${countryQid}` : ""),
      meta: {
        capital: b.capitalLabel?.value || "—",
        continent: b.continentLabel?.value || "—",
        population: b.population?.value || ""
      }
    };

    setCache(key, out);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Plekken in land via ISO-numeric
app.get("/api/places/:iso3", async (req, res) => {
  const iso3 = String(req.params.iso3 || "").trim().padStart(3, "0");
  const limit = Math.max(1, Math.min(60, Number(req.query.limit || 30)));
  const minSitelinks = Math.max(0, Number(req.query.minSitelinks || 0));
  const key = `places:${iso3}:limit=${limit}:minSitelinks=${minSitelinks}`;

  const cached = getCache(key);
  if (cached) return res.json(cached);

  try {
    const sparql = `
      SELECT ?place ?placeLabel ?placeDescription ?coord ?image ?sitelinks WHERE {
        ?country wdt:P299 "${iso3}" .

        ?place wdt:P625 ?coord .
        ?place wdt:P17 ?country .

        FILTER NOT EXISTS { ?place wdt:P31 wd:Q4167836 }   # Wikimedia disambiguation
        FILTER NOT EXISTS { ?place wdt:P31 wd:Q13406463 }  # Wikimedia list article

        OPTIONAL { ?place wdt:P18 ?image . }
        OPTIONAL { ?place wikibase:sitelinks ?sitelinks . }

        ${minSitelinks > 0 ? `FILTER(COALESCE(?sitelinks, 0) >= ${minSitelinks})` : ""}

        SERVICE wikibase:label { bd:serviceParam wikibase:language "nl,en". }
      }
      ORDER BY DESC(COALESCE(?sitelinks, 0))
      LIMIT ${limit}
    `;

    const data = await wdqsQuery(sparql);
    const rows = data?.results?.bindings || [];

    const seen = new Set();
    const places = [];

    for (const r of rows) {
      const placeUri = r.place?.value || "";
      const qid = qidFromUri(placeUri);
      if (!qid || seen.has(qid)) continue;

      const p = parseWktPoint(r.coord?.value);
      if (!p) continue;

      seen.add(qid);

      places.push({
        qid,
        label: r.placeLabel?.value || qid,
        desc: r.placeDescription?.value || "",
        lat: p.lat,
        lng: p.lon,
        image: r.image?.value ? commonsImageUrl(r.image.value, 560) : "",
        sitelinks: r.sitelinks?.value ? Number(r.sitelinks.value) : 0,
        wikidataUrl: placeUri
      });
    }

    setCache(key, places);
    res.json(places);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Detailinfo voor 1 plek (voor je detail-card)
app.get("/api/place/:qid", async (req, res) => {
  const qid = String(req.params.qid || "").trim();
  if (!/^Q\d+$/.test(qid)) return res.status(400).json({ error: "Ongeldige QID" });

  const key = `place:${qid}`;
  const cached = getCache(key);
  if (cached) return res.json(cached);

  try {
    const sparql = `
      SELECT
        (GROUP_CONCAT(DISTINCT ?typeLabel; separator=", ") AS ?types)
        (SAMPLE(?website) AS ?website)
        (SAMPLE(?inception) AS ?inception)
        (SAMPLE(?population) AS ?population)
        (SAMPLE(?area) AS ?area)
        (SAMPLE(?countryLabel) AS ?countryLabel)
        (SAMPLE(?adminLabel) AS ?adminLabel)
        (SAMPLE(?image) AS ?image)
      WHERE {
        BIND(wd:${qid} AS ?place)
        OPTIONAL { ?place wdt:P31 ?type . }
        OPTIONAL { ?place wdt:P856 ?website . }
        OPTIONAL { ?place wdt:P571 ?inception . }
        OPTIONAL { ?place wdt:P1082 ?population . }
        OPTIONAL { ?place wdt:P2046 ?area . }
        OPTIONAL { ?place wdt:P17 ?country . }
        OPTIONAL { ?place wdt:P131 ?admin . }
        OPTIONAL { ?place wdt:P18 ?image . }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "nl,en". }
      }
    `;

    const data = await wdqsQuery(sparql);
    const b = (data?.results?.bindings || [])[0] || {};
    const img = b.image?.value ? commonsImageUrl(b.image.value, 760) : "";

    const out = {
      types: b.types?.value || "",
      website: b.website?.value || "",
      inception: b.inception?.value || "",
      population: b.population?.value || "",
      area: b.area?.value || "",
      country: b.countryLabel?.value || "",
      admin: b.adminLabel?.value || "",
      image: img
    };

    setCache(key, out);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.listen(PORT, () => {
  console.log(`Server gestart op port ${PORT}`);
});
