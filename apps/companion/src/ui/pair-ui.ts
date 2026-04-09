/**
 * Renders an HTML page showing a QR code for cross-device pairing.
 * The QR payload is: spark://pair?t=<token>&k=<base64url-key>
 * Uses an inline QR generator (qrcode.js CDN) so there's no npm dependency.
 */

import { currentGrokApiKey } from "../config.js";
import { getOrCreateMemoryKey } from "../cloud-memory.js";

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export async function renderPairPage(): Promise<string> {
  const token = currentGrokApiKey();
  if (!token) {
    return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;background:#111;color:#eee">
      <h2>Kein Token vorhanden</h2>
      <p>Spark muss erst eingerichtet sein (Onboarding abschliessen), bevor du ein Geraet koppeln kannst.</p>
    </body></html>`;
  }

  const key = getOrCreateMemoryKey();
  const keyB64 = toBase64Url(key);
  const payload = `spark://pair?t=${encodeURIComponent(token)}&k=${keyB64}`;

  // Also trigger migration so cloud has latest memory
  try {
    const { migrateLocalMemoryToCloud } = await import("../cloud-memory.js");
    await migrateLocalMemoryToCloud(token);
  } catch { /* best-effort */ }

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spark – Geraet koppeln</title>
<style>
  body { margin:0; min-height:100vh; display:flex; flex-direction:column; align-items:center;
         justify-content:center; font-family:-apple-system,sans-serif; background:#0d1117; color:#e6edf3; }
  .card { background:#161b22; border-radius:16px; padding:40px; max-width:400px; text-align:center; }
  h1 { font-size:22px; margin:0 0 12px; color:#64FFDA; }
  p { font-size:14px; color:#8b949e; line-height:1.6; margin:0 0 24px; }
  #qr { margin:0 auto; }
  .hint { font-size:12px; color:#484f58; margin-top:20px; }
</style>
</head>
<body>
<div class="card">
  <h1>Geraet koppeln</h1>
  <p>Scanne diesen QR-Code mit der Spark-App auf deinem Handy.<br>
     Token + Schluessel werden direkt uebertragen.</p>
  <div id="qr"></div>
  <p class="hint">Der Code ist nur in deinem lokalen Netzwerk sichtbar.</p>
</div>
<script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js"></script>
<script>
  var qr = qrcode(0, 'M');
  qr.addData(${JSON.stringify(payload)});
  qr.make();
  document.getElementById('qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 4 });
  // Make SVG white on dark
  var svg = document.querySelector('#qr svg');
  if (svg) {
    svg.querySelectorAll('rect').forEach(function(r) {
      if (r.getAttribute('fill') === '#000000') r.setAttribute('fill', '#e6edf3');
      else if (r.getAttribute('fill') === '#ffffff') r.setAttribute('fill', '#161b22');
    });
  }
</script>
</body>
</html>`;
}
