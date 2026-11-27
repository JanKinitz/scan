// Scan-App: Weiterleitung an Azure OpenAI (eigene Ressource, Region Schweden / EU).
// - Nur für die in ALLOWED_USERS eingetragenen Microsoft-Konten (geprüft über das OneDrive-Token der App)
// - Kein Schlüssel: Die Funktion meldet sich mit ihrer eigenen verwalteten Identität bei Azure OpenAI an
// - Es wird nichts gespeichert und kein Dokumenttext protokolliert
// Anwendungseinstellungen: ALLOWED_USERS, AOAI_ENDPOINT (https://<name>.openai.azure.com), AOAI_DEPLOYMENT

const { msiToken, checkUser, sender } = require('../lib/common');

module.exports = async function (context, req) {
  const send = sender(context);
  try {
    const denied = await checkUser(req);
    if (denied) return send(denied[0], { error: denied[1] });
    const endpoint = String(process.env.AOAI_ENDPOINT || '').replace(/\/+$/, '');
    const deployment = process.env.AOAI_DEPLOYMENT;
    if (!endpoint || !deployment) return send(500, { error: 'AOAI_ENDPOINT oder AOAI_DEPLOYMENT ist in der Azure-Funktion nicht eingetragen' });

    const b = req.body || {};
    const messages = Array.isArray(b.messages) ? b.messages.slice(0, 4).map(m => ({ role: m.role === 'system' ? 'system' : 'user', content: String(m.content || '').slice(0, 8000) })) : null;
    if (!messages || !messages.length) return send(400, { error: 'Keine Nachricht' });

    const token = await msiToken('https://cognitiveservices.azure.com');
    const call = (extra) => fetch(`${endpoint}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: deployment, messages, max_completion_tokens: 300, response_format: { type: 'json_object' }, ...extra })
    });
    let r = await call({ temperature: 0.1 });
    let text = await r.text();
    if (r.status === 400 && /temperature/i.test(text)) { r = await call({}); text = await r.text(); } // Modelle ohne Temperatur-Parameter
    let data; try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 300) }; }
    if (!r.ok) return send(r.status === 401 || r.status === 403 ? 502 : r.status, { error: 'Azure OpenAI: ' + ((data.error && (data.error.message || data.error)) || ('HTTP ' + r.status)) });
    const c = data.choices && data.choices[0];
    const content = c && c.message && c.message.content || '';
    if (!content) {
      const why = (c && c.finish_reason) || (c && c.message && c.message.refusal) || text.slice(0, 200) || 'leer';
      return send(502, { error: 'Azure OpenAI lieferte keinen Text (' + String(why).slice(0, 200) + ')' });
    }
    return send(200, { content, model: data.model || deployment });
  } catch (e) {
    return send(500, { error: String(e && e.message || e) });
  }
};
