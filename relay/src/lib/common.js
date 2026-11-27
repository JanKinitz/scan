// Gemeinsame Bausteine der Scan-Funktionen: Kontoprüfung und Anmeldung per verwalteter Identität
const tokens = {};

async function msiToken(resource) {
  const t = tokens[resource];
  if (t && t.exp - 300 > Date.now() / 1000) return t.token;
  const ep = process.env.IDENTITY_ENDPOINT, hdr = process.env.IDENTITY_HEADER;
  if (!ep || !hdr) throw new Error('Verwaltete Identität der Azure-Funktion ist nicht eingeschaltet');
  const r = await fetch(`${ep}?resource=${encodeURIComponent(resource)}&api-version=2019-08-01`, { headers: { 'X-IDENTITY-HEADER': hdr } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('Kein Zugriffstoken für ' + resource + ' (' + r.status + ')');
  tokens[resource] = { token: j.access_token, exp: Number(j.expires_on) || (Date.now() / 1000 + 600) };
  return j.access_token;
}

// Prüft das OneDrive-Token der App. Gibt null zurück, wenn alles passt, sonst [status, fehlertext].
async function checkUser(req) {
  const auth = req.headers['authorization'] || '';
  if (!/^Bearer\s+\S+/.test(auth)) return [401, 'Anmeldung fehlt'];
  const me = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,userPrincipalName,mail', { headers: { Authorization: auth } });
  if (!me.ok) return [401, 'Microsoft-Anmeldung ungültig oder abgelaufen'];
  const u = await me.json();
  const who = [u.id, u.userPrincipalName, u.mail].filter(Boolean).map(s => String(s).toLowerCase());
  const allowed = String(process.env.ALLOWED_USERS || '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
  if (!allowed.some(a => who.includes(a))) return [403, `Konto nicht freigegeben. In der Azure-Funktion unter ALLOWED_USERS eintragen: ${u.userPrincipalName || u.mail || u.id}`];
  return null;
}

const sender = context => (status, body) => { context.res = { status, headers: { 'Content-Type': 'application/json' }, body }; };

module.exports = { msiToken, checkUser, sender };
