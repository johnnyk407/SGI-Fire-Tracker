// Fetches active wildfires from NIFC, then cross-references each against
// InciWeb's accessible incident table to find a real, working "Go to Incident" URL.

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/\bfire\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function parseInciWebTable(html) {
  const map = {};
  // Broader regex: allow any attributes before href, allow nested tags/whitespace in link text
  const linkRegex = /<a[^>]*href="(\/incident-information\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  let count = 0;
  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1];
    // Strip any nested HTML tags from the link text, collapse whitespace
    const text = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const key = normalize(text);
    if (key) {
      map[key] = url;
      count++;
    }
  }
  return { map: map, count: count, htmlLength: html.length };
}

async function fetchInciWebMap() {
  try {
    const res = await fetch('https://inciweb.wildfire.gov/accessible-view', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) return { map: {}, count: 0, status: res.status, htmlLength: 0 };
    const html = await res.text();
    const result = parseInciWebTable(html);
    result.status = res.status;
    return result;
  } catch (e) {
    return { map: {}, count: 0, error: e.message, htmlLength: 0 };
  }
}

function findBestMatch(fireName, inciwebMap) {
  const normFire = normalize(fireName);
  if (!normFire) return null;
  if (inciwebMap[normFire]) return inciwebMap[normFire];
  for (const key in inciwebMap) {
    if (key.includes(normFire) || normFire.includes(key)) {
      if (normFire.length >= 4 && key.length >= 4) {
        return inciwebMap[key];
      }
    }
  }
  return null;
}

exports.handler = async function(event) {
  // Debug mode: ?debug=1 returns raw diagnostic info instead of fire data
  const isDebug = event.queryStringParameters && event.queryStringParameters.debug;

  const inciwebResult = await fetchInciWebMap();

  if (isDebug) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        inciwebStatus: inciwebResult.status,
        inciwebHtmlLength: inciwebResult.htmlLength,
        inciwebLinksFound: inciwebResult.count,
        inciwebError: inciwebResult.error || null,
        sampleKeys: Object.keys(inciwebResult.map).slice(0, 20),
        sampleEntries: Object.entries(inciwebResult.map).slice(0, 10)
      })
    };
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const dateStr = sevenDaysAgo.toISOString().slice(0, 19).replace('T', ' ');
  const where = `IncidentTypeCategory='WF' AND ICS209ReportDateTime>timestamp '${dateStr}'`;
  const nifcUrl = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query?where=' + encodeURIComponent(where) + '&outFields=*&f=geojson';

  try {
    const nifcRes = await fetch(nifcUrl);
    const nifcData = await nifcRes.json();

    if (nifcData.features) {
      nifcData.features.forEach(function(f) {
        const name = f.properties && f.properties.IncidentName;
        const matchedUrl = findBestMatch(name, inciwebResult.map);
        f.properties.InciWebUrl = matchedUrl ? 'https://inciweb.wildfire.gov' + matchedUrl : null;
      });
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300'
      },
      body: JSON.stringify(nifcData)
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
