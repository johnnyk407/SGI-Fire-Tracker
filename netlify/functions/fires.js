// Fetches active wildfires from NIFC, then cross-references each against
// InciWeb's accessible incident table to find a real, working "Go to Incident" URL.
// Falls back to a search link if no confident match is found.

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/\bfire\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function parseInciWebTable(html) {
  // The accessible-view page renders incidents as table rows with links like:
  // <a href="/incident-information/xxxxx-yyyy-fire">Incident Name</a>
  const map = {};
  const linkRegex = /<a[^>]+href="(\/incident-information\/[^"]+)"[^>]*>([^<]+)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1];
    const text = match[2].trim();
    const key = normalize(text);
    if (key) {
      map[key] = url;
    }
  }
  return map;
}

async function fetchInciWebMap() {
  try {
    const res = await fetch('https://inciweb.wildfire.gov/accessible-view');
    if (!res.ok) return {};
    const html = await res.text();
    return parseInciWebTable(html);
  } catch (e) {
    return {};
  }
}

function findBestMatch(fireName, inciwebMap) {
  const normFire = normalize(fireName);
  if (!normFire) return null;

  // Exact normalized match first
  if (inciwebMap[normFire]) return inciwebMap[normFire];

  // Substring match (either direction) as fallback
  for (const key in inciwebMap) {
    if (key.includes(normFire) || normFire.includes(key)) {
      // Avoid trivial matches on very short names
      if (normFire.length >= 4 && key.length >= 4) {
        return inciwebMap[key];
      }
    }
  }
  return null;
}

exports.handler = async function() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const dateStr = sevenDaysAgo.toISOString().slice(0, 19).replace('T', ' ');
  const where = `IncidentTypeCategory='WF' AND ICS209ReportDateTime>timestamp '${dateStr}'`;
  const nifcUrl = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query?where=' + encodeURIComponent(where) + '&outFields=*&f=geojson';

  try {
    const [nifcRes, inciwebMap] = await Promise.all([
      fetch(nifcUrl),
      fetchInciWebMap()
    ]);

    const nifcData = await nifcRes.json();

    if (nifcData.features) {
      nifcData.features.forEach(function(f) {
        const name = f.properties && f.properties.IncidentName;
        const matchedUrl = findBestMatch(name, inciwebMap);
        if (matchedUrl) {
          f.properties.InciWebUrl = 'https://inciweb.wildfire.gov' + matchedUrl;
        } else {
          f.properties.InciWebUrl = null;
        }
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
