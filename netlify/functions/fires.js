exports.handler = async function() {
  // Active wildfires: WF type, with an ICS-209 status report filed in the last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const dateStr = sevenDaysAgo.toISOString().slice(0, 19).replace('T', ' ');

  const where = `IncidentTypeCategory='WF' AND ICS209ReportDateTime>timestamp '${dateStr}'`;
  const url = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query?where=' + encodeURIComponent(where) + '&outFields=*&f=geojson';

  try {
    const response = await fetch(url);
    const data = await response.text();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300'
      },
      body: data
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
