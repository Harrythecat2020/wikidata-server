import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server gestart op port ${PORT}`));


// Welke landen je ondersteunt
const countryMap = {
AF: "Q889",
  AL: "Q222",
  DZ: "Q262",
  AD: "Q228",
  AO: "Q916",
  AG: "Q781",
  AR: "Q414",
  AM: "Q399",
  AU: "Q408",
  AT: "Q40",
  AZ: "Q227",
  BH: "Q398",
  BD: "Q902",
  BB: "Q244",
  BY: "Q184",
  BE: "Q31",
  BZ: "Q242",
  BJ: "Q962",
  BT: "Q917",
  BO: "Q750",
  BA: "Q225",
  BW: "Q963",
  BR: "Q155",
  BN: "Q921",
  BG: "Q219",
  BF: "Q965",
  BI: "Q967",
  KH: "Q424",
  CM: "Q1009",
  CA: "Q16",
  CV: "Q1011",
  CF: "Q929",
  TD: "Q657",
  CL: "Q298",
  CO: "Q739",
  KM: "Q970",
  CR: "Q800",
  HR: "Q224",
  CU: "Q241",
  CY: "Q229",
  CZ: "Q213",
  CD: "Q974",
  DJ: "Q977",
  DM: "Q784",
  DO: "Q786",
  EC: "Q736",
  EG: "Q79",
  SV: "Q792",
  GQ: "Q983",
  ER: "Q986",
  EE: "Q191",
  SZ: "Q1050",
  ET: "Q115",
  FM: "Q702",
  FJ: "Q712",
  FI: "Q33",
  FR: "Q142",
  GA: "Q1000",
  GE: "Q230",
  DE: "Q183",
  GH: "Q117",
  GR: "Q41",
  GD: "Q769",
  GT: "Q774",
  GN: "Q1006",
  GW: "Q1007",
  GY: "Q734",
  HT: "Q790",
  HN: "Q783",
  HU: "Q28",
  IS: "Q189",
  IN: "Q668",
  ID: "Q252",
  IR: "Q794",
  IQ: "Q796",
  IE: "Q27",
  IL: "Q801",
  IT: "Q38",
  JM: "Q766",
  JP: "Q17",
  JO: "Q810",
  KZ: "Q232",
  KE: "Q114",
  KI: "Q710",
  KW: "Q817",
  KG: "Q813",
  LA: "Q819",
  LV: "Q211",
  LB: "Q822",
  LS: "Q1013",
  LR: "Q1014",
  LY: "Q1016",
  LI: "Q347",
  LT: "Q37",
  LU: "Q32",
  MG: "Q1019",
  MW: "Q1020",
  MY: "Q833",
  MV: "Q826",
  ML: "Q912",
  MT: "Q233",
  MH: "Q709",
  MR: "Q1025",
  MU: "Q1027",
  MX: "Q96",
  MD: "Q217",
  MC: "Q235",
  MN: "Q711",
  ME: "Q236",
  MA: "Q1028",
  MZ: "Q1029",
  MM: "Q836",
  NA: "Q1030",
  NR: "Q697",
  NP: "Q837",
  NL: "Q55",
  NZ: "Q664",
  NI: "Q811",
  NE: "Q1032",
  NG: "Q1033",
  KP: "Q423",
  MK: "Q221",
  NO: "Q20",
  OM: "Q842",
  PK: "Q843",
  PW: "Q695",
  PA: "Q804",
  PG: "Q691",
  PY: "Q733",
  PE: "Q419",
  PH: "Q928",
  PL: "Q36",
  PT: "Q45",
  QA: "Q846",
  CG: "Q971",
  RO: "Q218",
  RU: "Q159",
  RW: "Q1037",
  KN: "Q763",
  LC: "Q760",
  VC: "Q757",
  WS: "Q683",
  SM: "Q238",
  SA: "Q851",
  SN: "Q1041",
  RS: "Q403",
  SC: "Q1042",
  SL: "Q1044",
  SG: "Q334",
  SK: "Q214",
  SI: "Q215",
  SB: "Q685",
  SO: "Q1045",
  ZA: "Q258",
  KR: "Q884",
  SS: "Q958",
  ES: "Q29",
  LK: "Q854",
  SD: "Q1049",
  SR: "Q730",
  SE: "Q34",
  CH: "Q39",
  SY: "Q858",
  ST: "Q1039",
  TW: "Q865",
  TJ: "Q863",
  TZ: "Q924",
  TH: "Q869",
  TL: "Q574",
  TG: "Q945",
  TO: "Q678",
  TT: "Q754",
  TN: "Q948",
  TR: "Q43",
  TM: "Q874",
  TV: "Q672",
  UG: "Q1036",
  UA: "Q212",
  AE: "Q878",
  GB: "Q145",
  US: "Q30",
  UY: "Q77",
  UZ: "Q265",
  VU: "Q686",
  VA: "Q237",
  VE: "Q717",
  VN: "Q881",
  YE: "Q805",
  ZM: "Q953",
  ZW: "Q954"
};

// Simpel geheugen (cache)
const cache = {};
const CACHE_TIME = 1000 * 60 * 60 * 24;

app.get("/api/places/:country", async (req, res) => {
  const code = req.params.country.toUpperCase();
  const qid = countryMap[code];

  if (!qid) {
    return res.json([]);
  }

  // Check of we het al hebben
  if (cache[code] && Date.now() - cache[code].time < CACHE_TIME) {
    return res.json(cache[code].data);
  }

  // Wikidata ophalen
  const query = `
  SELECT ?place ?placeLabel WHERE {
    ?place wdt:P17 wd:${qid};
           wdt:P31/wdt:P279* wd:Q570116.
    SERVICE wikibase:label { bd:serviceParam wikibase:language "nl,en". }
  }
  LIMIT 10
  `;

  const response = await fetch("https://query.wikidata.org/sparql", {
    method: "POST",
    headers: {
      "Content-Type": "application/sparql-query",
      "Accept": "application/json"
    },
    body: query
  });

  const json = await response.json();

  const data = json.results.bindings.map(x => x.placeLabel.value);

  cache[code] = { data, time: Date.now() };

  res.json(data);
});

app.listen(PORT, () => {
  console.log("Server gestart");
});

