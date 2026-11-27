/* Bildverarbeitung (OpenCV) im Hintergrund-Thread – die Oberfläche bleibt dabei bedienbar */
importScripts('https://docs.opencv.org/4.10.0/opencv.js');

const ready = (async () => {
  const t0 = Date.now();
  for (;;) {
    let c = self.cv;
    if (c instanceof Promise) { c = await c; self.cv = c; }
    // Wichtig: nicht das Modul selbst zurückgeben – es ist „thenable“ und würde das Promise endlos auflösen
    if (c && c.Mat) return true;
    if (Date.now() - t0 > 120000) throw new Error('OpenCV startet nicht');
    await new Promise(r => setTimeout(r, 50));
  }
})();
ready.then(() => postMessage({ ready: true }), e => postMessage({ ready: false, err: String(e && e.message || e) }));

function toImageData(m) {
  let r = m;
  if (m.channels() === 1) { r = new cv.Mat(); cv.cvtColor(m, r, cv.COLOR_GRAY2RGBA); }
  else if (m.channels() === 3) { r = new cv.Mat(); cv.cvtColor(m, r, cv.COLOR_RGB2RGBA); }
  const out = new ImageData(new Uint8ClampedArray(r.data), r.cols, r.rows);
  if (r !== m) r.delete();
  return out;
}

/* Größtes konvexes Viereck = Blatt Papier */
function bestQuad(bin, area) {
  const cs = new cv.MatVector(), hi = new cv.Mat();
  let best = null, bestA = 0;
  try {
    cv.findContours(bin, cs, hi, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    for (let i = 0; i < cs.size(); i++) {
      const c = cs.get(i), a = cv.contourArea(c);
      if (a > area * .12 && a < area * .985 && a > bestA) {
        const peri = cv.arcLength(c, true);
        for (const eps of [.02, .035, .05]) {
          const ap = new cv.Mat();
          cv.approxPolyDP(c, ap, eps * peri, true);
          const ok = ap.rows === 4 && cv.isContourConvex(ap);
          if (ok) { best = []; for (let j = 0; j < 4; j++) best.push({ x: ap.data32S[j * 2], y: ap.data32S[j * 2 + 1] }); bestA = a; }
          ap.delete();
          if (ok) break;
        }
      }
      c.delete();
    }
  } finally { cs.delete(); hi.delete(); }
  return best;
}

function detect(img) {
  const mats = [], T = m => (mats.push(m), m);
  try {
    const src = T(cv.matFromImageData(img)), gray = T(new cv.Mat()), blur = T(new cv.Mat());
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    const area = img.width * img.height;
    const strategies = [
      () => { const e = T(new cv.Mat()); cv.Canny(blur, e, 40, 120); cv.dilate(e, e, T(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5)))); return e; },
      () => { const t = T(new cv.Mat()); cv.threshold(blur, t, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU); cv.morphologyEx(t, t, cv.MORPH_CLOSE, T(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(11, 11)))); return t; },
      () => { const e = T(new cv.Mat()); cv.Canny(blur, e, 15, 60); cv.dilate(e, e, T(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7)))); return e; }
    ];
    for (const s of strategies) { const q = bestQuad(s(), area); if (q) return q; }
    return null;
  } finally { mats.forEach(m => { try { m.delete(); } catch {} }); }
}

function warp(img, c, W, H) {
  const [tl, tr, br, bl] = c;
  const src = cv.matFromImageData(img), dst = new cv.Mat(),
    a = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]),
    b = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, W, 0, W, H, 0, H]),
    M = cv.getPerspectiveTransform(a, b);
  try {
    cv.warpPerspective(src, dst, M, new cv.Size(W, H), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());
    return toImageData(dst);
  } finally { [src, dst, a, b, M].forEach(m => m.delete()); }
}

/* Hintergrund schätzen (Text wegdilatieren) und herausdividieren -> Papier wird reinweiß */
function normBg(g) {
  const s = new cv.Mat(), bg = new cv.Mat(), out = new cv.Mat(), k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
  cv.resize(g, s, new cv.Size(0, 0), .25, .25, cv.INTER_AREA);
  cv.dilate(s, s, k);
  cv.medianBlur(s, s, 21);
  cv.resize(s, bg, g.size(), 0, 0, cv.INTER_LINEAR);
  cv.divide(g, bg, out, 255);
  [s, bg, k].forEach(m => m.delete());
  return out;
}

function enhance(img, mode) {
  const src = cv.matFromImageData(img), res = new cv.Mat();
  try {
    if (mode === 'color') {
      const rgb = new cv.Mat(), ch = new cv.MatVector(), nv = new cv.MatVector(), tmp = [];
      cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
      cv.split(rgb, ch);
      for (let i = 0; i < 3; i++) { const c = ch.get(i), n = normBg(c); nv.push_back(n); tmp.push(c, n); }
      cv.merge(nv, res);
      res.convertTo(res, -1, 1.12, -20);
      tmp.forEach(m => m.delete()); [rgb, ch, nv].forEach(m => m.delete());
    } else {
      const g = new cv.Mat();
      cv.cvtColor(src, g, cv.COLOR_RGBA2GRAY);
      const n = normBg(g);
      if (mode === 'gray') n.convertTo(res, -1, 1.3, -60);
      else {
        const t0 = new cv.Mat();
        const t = cv.threshold(n, t0, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
        t0.delete();
        let lo = Math.max(0, t - 50), hi = Math.min(255, t + 18);
        if (hi - lo < 30) lo = hi - 30;
        const a = 255 / (hi - lo);
        n.convertTo(res, -1, a, -lo * a);
      }
      g.delete(); n.delete();
    }
    return toImageData(res);
  } finally { src.delete(); res.delete(); }
}

const OPS = { detect, warp, enhance };
onmessage = async e => {
  const { id, op, args } = e.data;
  try {
    await ready;
    const res = OPS[op](...args);
    postMessage({ id, ok: true, res }, res && res.data ? [res.data.buffer] : []);
  } catch (err) {
    let msg = err && err.message || String(err);
    if (typeof err === 'number' && self.cv && cv.exceptionFromPtr) { try { msg = cv.exceptionFromPtr(err).msg; } catch {} }
    postMessage({ id, ok: false, err: msg });
  }
};
