// Scan-App: aufgelaufene Azure-Kosten der Ressourcengruppe und Zahl der KI-Anfragen.
// Liest nur – Rollen der verwalteten Identität: „Cost Management Reader“ und „Monitoring Reader“ auf der Ressourcengruppe.
const { msiToken, checkUser, sender } = require('../lib/common');
const SINCE = '2026-11-27'; // Einrichtung der KI
let cache = null; // { at, body }

const ymd = d => d.toISOString().slice(0, 10);

module.exports = async function (context, req) {
  const send = sender(context);
  try {
    const denied = await checkUser(req);
    if (denied) return send(denied[0], { error: denied[1] });
    if (cache && Date.now() - cache.at < 30 * 60 * 1000) return send(200, { ...cache.body, cached: true });

    const sub = String(process.env.WEBSITE_OWNER_NAME || '').split('+')[0];
    const rg = process.env.WEBSITE_RESOURCE_GROUP;
    const oaiName = (String(process.env.AOAI_ENDPOINT || '').match(/^https:\/\/([^.]+)\./) || [])[1];
    if (!sub || !rg || !oaiName) return send(500, { error: 'Abonnement, Ressourcengruppe oder AOAI_ENDPOINT nicht ermittelbar' });
    const rgId = `/subscriptions/${sub}/resourceGroups/${rg}`;
    const token = await msiToken('https://management.azure.com/');
    const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

    const now = new Date();
    const from = new Date(Math.max(Date.parse(SINCE + 'T00:00:00Z'), now - 360 * 864e5));

    // 1) Kosten pro Tag (Abrechnung, 8–24 h verzögert)
    const cr = await fetch(`https://management.azure.com${rgId}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ type: 'ActualCost', timeframe: 'Custom', timePeriod: { from: from.toISOString(), to: now.toISOString() },
        dataset: { granularity: 'Daily', aggregation: { totalCost: { name: 'Cost', function: 'Sum' } } } })
    });
    const cj = await cr.json().catch(() => ({}));
    // Neues Abo: Die Kostenverwaltung kennt es in den ersten 1–2 Tagen noch nicht (404) – dann nur die Anfragen zählen
    const costPending = cr.status === 404 || /GetAzureSubscriptionsById/i.test(JSON.stringify(cj));
    if (!cr.ok && !costPending) return send(502, { error: 'Kostenabfrage: ' + ((cj.error && cj.error.message) || ('HTTP ' + cr.status)) });
    const cols = (cj.properties && cj.properties.columns || []).map(c => c.name);
    const iC = cols.indexOf('Cost'), iD = cols.indexOf('UsageDate'), iCur = cols.indexOf('Currency');
    const days = (cj.properties && cj.properties.rows || []).map(r => ({ d: String(r[iD]).replace(/^(\d{4})(\d{2})(\d{2}).*/, '$1-$2-$3'), c: Number(r[iC]) || 0 }));
    const currency = (cj.properties && cj.properties.rows || [])[0]?.[iCur] || 'EUR';
    const lastCostDay = days.map(x => x.d).sort().pop() || null;

    // 2) KI-Anfragen pro Tag (Azure Monitor, nahezu in Echtzeit)
    const oaiId = `${rgId}/providers/Microsoft.CognitiveServices/accounts/${oaiName}`;
    const span = `${from.toISOString()}/${now.toISOString()}`;
    const mr = await fetch(`https://management.azure.com${oaiId}/providers/Microsoft.Insights/metrics?api-version=2023-10-01&metricnames=AzureOpenAIRequests&aggregation=Total&interval=P1D&timespan=${encodeURIComponent(span)}`, { headers: H });
    const mj = await mr.json().catch(() => ({}));
    if (!mr.ok) return send(502, { error: 'Nutzungsabfrage: ' + ((mj.error && mj.error.message) || ('HTTP ' + mr.status)) });
    const req_ = [];
    for (const v of mj.value || []) for (const ts of v.timeseries || []) for (const p of ts.data || []) if (p.total) req_.push({ d: String(p.timeStamp).slice(0, 10), n: p.total });

    const month = ymd(now).slice(0, 7);
    const sum = (arr, key, f) => arr.filter(f).reduce((a, x) => a + x[key], 0);
    const upTo = d => !lastCostDay || d <= lastCostDay; // Anfragen nur bis zum letzten abgerechneten Tag zählen, damit der Schnitt stimmt
    const body = {
      currency, lastCostDay, costPending, since: ymd(from),
      month: { cost: sum(days, 'c', x => x.d.startsWith(month)), requests: sum(req_, 'n', x => x.d.startsWith(month)), billedRequests: sum(req_, 'n', x => x.d.startsWith(month) && upTo(x.d)) },
      total: { cost: sum(days, 'c', () => true), requests: sum(req_, 'n', () => true), billedRequests: sum(req_, 'n', x => upTo(x.d)) }
    };
    if (!costPending) cache = { at: Date.now(), body };
    return send(200, body);
  } catch (e) {
    return send(500, { error: String(e && e.message || e) });
  }
};
