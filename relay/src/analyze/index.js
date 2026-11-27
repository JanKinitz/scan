// Scan-App: Weiterleitung an GitHub Models.
// - Nur für die in ALLOWED_USERS eingetragenen Microsoft-Konten (geprüft über das OneDrive-Token der App)
// - Der GitHub-Token liegt nur hier in den Anwendungseinstellungen (GITHUB_TOKEN), nie auf dem Handy
// - Es wird nichts gespeichert und kein Dokumenttext protokolliert
const MODELS = ['openai/gpt-4o-mini', 'openai/gpt-4.1-mini', 'openai/gpt-4.1-nano'];

module.exports = async function (context, req) {
  const send = (status, body) => { context.res = { status, headers: { 'Content-Type': 'application/json' }, body }; };
  try {
    const auth = req.headers['authorization'] || '';
    if (!/^Bearer\s+\S+/.test(auth)) return send(401, { error: 'Anmeldung fehlt' });

    const me = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,userPrincipalName,mail', { headers: { Authorization: auth } });
    if (!me.ok) return send(401, { error: 'Microsoft-Anmeldung ungültig oder abgelaufen' });
    const u = await me.json();
    const who = [u.id, u.userPrincipalName, u.mail].filter(Boolean).map(s => String(s).toLowerCase());
    const allowed = String(process.env.ALLOWED_USERS || '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
    if (!allowed.some(a => who.includes(a))) {
      return send(403, { error: `Konto nicht freigegeben. In der Azure-Funktion unter ALLOWED_USERS eintragen: ${u.userPrincipalName || u.mail || u.id}` });
    }
    if (!process.env.GITHUB_TOKEN) return send(500, { error: 'GITHUB_TOKEN ist in der Azure-Funktion nicht eingetragen' });

    const b = req.body || {};
    const messages = Array.isArray(b.messages) ? b.messages.slice(0, 4).map(m => ({ role: m.role === 'system' ? 'system' : 'user', content: String(m.content || '').slice(0, 8000) })) : null;
    if (!messages || !messages.length) return send(400, { error: 'Keine Nachricht' });
    const model = MODELS.includes(b.model) ? b.model : MODELS[0];

    const r = await fetch('https://models.github.ai/inference/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 200, response_format: { type: 'json_object' } })
    });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 300) }; }
    if (!r.ok) return send(r.status, { error: (data.error && (data.error.message || data.error)) || ('GitHub Models: HTTP ' + r.status) });
    return send(200, { content: data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '', model });
  } catch (e) {
    return send(500, { error: String(e && e.message || e) });
  }
};
