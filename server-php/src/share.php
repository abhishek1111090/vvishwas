<?php
// share.php — the emergency link texted to contacts.
//
// The app makes a random 256-bit token for each SOS and puts
// <api>/share/<token> in the alert. The server stores only its SHA-256 on
// that one sos_events row, so a link opens exactly one person's one
// emergency: its location points and the recordings uploaded for it —
// never their other SOS events, account or contacts. Nobody needs to sign
// in; holding the link is the permission. It stops working `share_days`
// (default 7) after the SOS ends.
declare(strict_types=1);

const SHARE_TOKEN_RE = '/^[A-Za-z0-9_-]{32,128}$/';

/** The shared event for a token (with the owner's name), or null if unknown/expired. */
function shared_event(App $app, string $token): ?array
{
    if (!preg_match(SHARE_TOKEN_RE, $token)) return null;
    $ev = $app->one('SELECT e.*, u.full_name FROM sos_events e JOIN users u ON u.id = e.user_id WHERE e.share_token_hash = ?', [token_hash($token)]);
    if (!$ev) return null;
    $from = strtotime((string) ($ev['ended_at'] ?? $ev['started_at']));
    $days = (int) ($app->cfg['share_days'] ?? 7);
    return ($from !== false && time() > $from + $days * 86400) ? null : $ev;
}

function share_data(App $app, array $ev): array
{
    $locs = $app->q('SELECT latitude, longitude, accuracy_m, recorded_at FROM sos_locations WHERE event_id = ? ORDER BY recorded_at', [$ev['id']]);
    $recs = $app->q('SELECT id, kind, part, content_type, size_bytes, created_at FROM recordings WHERE event_id = ? AND user_id = ? ORDER BY kind, part', [$ev['id'], $ev['user_id']]);
    return [
        'name' => $ev['full_name'],
        'status' => $ev['status'],
        'startedAt' => iso($ev['started_at']),
        'endedAt' => iso($ev['ended_at']),
        'locations' => array_map(fn ($l) => [
            'latitude' => (float) $l['latitude'], 'longitude' => (float) $l['longitude'],
            'accuracy' => $l['accuracy_m'] === null ? null : (float) $l['accuracy_m'], 'recordedAt' => iso($l['recorded_at']),
        ], $locs),
        'recordings' => array_map(fn ($r) => [
            'id' => $r['id'], 'kind' => $r['kind'], 'part' => (int) $r['part'], 'contentType' => $r['content_type'],
            'sizeBytes' => (int) $r['size_bytes'], 'createdAt' => iso($r['created_at']),
        ], $recs),
    ];
}

/** Headers for every share response: never cached, indexed, framed or leaked via Referer. */
function share_headers(): void
{
    header('Cache-Control: no-store');
    header('Referrer-Policy: no-referrer');
    header('X-Robots-Tag: noindex, nofollow');
    header('X-Frame-Options: DENY');
}

function route_share(App $app, string $method, string $path, string $ip): ?array
{
    if ($method !== 'GET' || !preg_match('#^/share/([A-Za-z0-9_-]{1,200})(/data|/r/([0-9a-fA-F-]{36}))?$#', $path, $m)) return null;
    share_headers();
    $isFile = !empty($m[3]);
    // Tokens are 256-bit, so this only stops scripted hammering, not guessing.
    if (!$isFile && $app->rateLimited("share:$ip", 300, 600)) throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Try again in a few minutes.');
    $ev = shared_event($app, $m[1]);

    if ($isFile) {
        if (!$ev) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
        $row = $app->one('SELECT * FROM recordings WHERE id = ? AND event_id = ? AND user_id = ?', [strtolower($m[3]), $ev['id'], $ev['user_id']]);
        if (!$row) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
        $file = storage_dir($app) . '/' . $row['storage_key'];
        if (!is_file($file)) throw new HttpError(410, 'GONE', 'The file is no longer on the server.');
        stream_file($file, (string) $row['content_type'], 'private, no-store');
        return ['stream', null];
    }
    if (($m[2] ?? '') === '/data') {
        if (!$ev) throw new HttpError(404, 'NOT_FOUND', 'This emergency link is not available.');
        return [200, share_data($app, $ev)];
    }
    if (!$ev) {
        http_response_code(404);
        return ['html', share_page_html(null)];
    }
    return ['html', share_page_html(share_data($app, $ev))];
}

/** The page contacts see. Data is embedded as JSON and rendered with textContent only. */
function share_page_html(?array $data): string
{
    $nonce = base64_encode(random_bytes(16));
    header("Content-Security-Policy: default-src 'none'; script-src 'nonce-$nonce'; style-src 'nonce-$nonce'; img-src 'self'; media-src 'self'; connect-src 'self'; frame-src https://www.openstreetmap.org; base-uri 'none'; form-action 'none'");
    $json = json_encode($data, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    return <<<HTML
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>VISHWAS emergency</title>
<style nonce="$nonce">
:root{--bg:#EEF6E6;--card:#fff;--ink:#0B0B0B;--muted:#555;--red:#FF2E3A;--green:#2E9E3F;--line:#dfe6d6}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:720px;margin:0 auto;padding:16px}h1{font-size:24px;margin:8px 0 4px}h2{font-size:17px;margin:0 0 10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px;margin:14px 0}
.pill{display:inline-block;border-radius:999px;padding:3px 12px;font-size:13px;font-weight:600;color:#fff;background:var(--red)}
.pill.ended{background:var(--green)}.muted{color:var(--muted);font-size:14px}
iframe{width:100%;height:300px;border:0;border-radius:12px;background:#ddd}
a.btn{display:inline-block;margin:10px 10px 0 0;padding:10px 16px;border-radius:999px;background:var(--ink);color:#fff;text-decoration:none;font-weight:600;font-size:14px}
video,audio,img{width:100%;border-radius:12px;margin-top:6px;background:#000}audio{background:none}
.item{margin:12px 0}.item b{font-size:14px}
</style></head><body><main>
<p class="muted">VISHWAS · shared emergency details</p>
<div id="app"></div>
<p class="muted">This private link was sent by the person in this emergency. Don't forward it. If they are in danger, call 112.</p>
</main>
<script nonce="$nonce">
const data = $json;
const app = document.getElementById('app');
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); kids.forEach((k) => n.append(k)); return n; };
const when = (s) => s ? new Date(s).toLocaleString() : '';
const size = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const KIND = { video: 'Video', audio: 'Audio', photo: 'Photo' };
function render(d) {
  app.replaceChildren();
  if (!d) {
    app.append(el('div', { className: 'card' }, el('h1', { textContent: 'Link not available' }),
      el('p', { textContent: "This emergency link has expired, or the phone hasn't reached the server yet. If it was just sent, try again in a minute." })));
    return;
  }
  const active = d.status === 'active';
  app.append(el('h1', { textContent: (d.name || 'Someone') + (active ? ' needs help' : "'s emergency") }));
  app.append(el('span', { className: 'pill' + (active ? '' : ' ended'), textContent: active ? 'SOS active' : 'SOS ended' }));
  app.append(el('p', { className: 'muted', textContent: 'Started ' + when(d.startedAt) + (d.endedAt ? ' · ended ' + when(d.endedAt) : '') }));

  const loc = d.locations[d.locations.length - 1];
  const where = el('div', { className: 'card' }, el('h2', { textContent: 'Location' }));
  if (loc) {
    const lat = loc.latitude, lon = loc.longitude, pad = 0.005;
    where.append(el('iframe', { title: 'Map', loading: 'lazy', referrerPolicy: 'no-referrer',
      src: 'https://www.openstreetmap.org/export/embed.html?bbox=' + [lon - pad, lat - pad, lon + pad, lat + pad].join('%2C') + '&layer=mapnik&marker=' + lat + '%2C' + lon }));
    where.append(el('p', { className: 'muted', textContent: lat.toFixed(6) + ', ' + lon.toFixed(6) + (loc.accuracy != null ? ' · ±' + Math.round(loc.accuracy) + ' m' : '') + ' · ' + when(loc.recordedAt) + (d.locations.length > 1 ? ' · ' + d.locations.length + ' points shared' : '') }));
    where.append(el('a', { className: 'btn', href: 'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lon, target: '_blank', rel: 'noopener noreferrer', textContent: 'Open in Google Maps' }));
    where.append(el('a', { className: 'btn', href: 'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lon + '#map=18/' + lat + '/' + lon, target: '_blank', rel: 'noopener noreferrer', textContent: 'OpenStreetMap' }));
  } else {
    where.append(el('p', { textContent: 'No location has reached the server yet.' }));
  }
  app.append(where);

  const recs = el('div', { className: 'card' }, el('h2', { textContent: 'Recordings' }));
  if (d.recordings.length === 0) {
    recs.append(el('p', { textContent: active ? 'Video and audio are being recorded. They appear here after the SOS ends and the phone uploads them.' : 'No recordings have been uploaded yet. The phone uploads them when it has a connection.' }));
  }
  for (const r of d.recordings) {
    const src = location.pathname.replace(/\/$/, '') + '/r/' + r.id;
    const label = (KIND[r.kind] || r.kind) + (r.kind === 'video' && r.part > 1000 ? ' (front camera ' + (r.part - 1000) + ')' : ' ' + r.part);
    const media = r.kind === 'photo' ? el('img', { src, alt: label }) : el(r.kind === 'video' ? 'video' : 'audio', { src, controls: true, preload: 'metadata', playsInline: true });
    recs.append(el('div', { className: 'item' }, el('b', { textContent: label }), el('span', { className: 'muted', textContent: ' · ' + size(r.sizeBytes) + ' · ' + when(r.createdAt) }), media));
  }
  app.append(recs);
}
render(data);
// Keep the page current while new locations / recordings arrive; never re-render under a playing video.
let last = JSON.stringify(data);
setInterval(async () => {
  if (!data || document.hidden || [...document.querySelectorAll('video,audio')].some((m) => !m.paused)) return;
  try {
    const res = await fetch(location.pathname.replace(/\/$/, '') + '/data', { cache: 'no-store' });
    if (!res.ok) return;
    const next = await res.json();
    const s = JSON.stringify(next);
    if (s !== last) { last = s; render(next); }
  } catch {}
}, 20000);
</script></body></html>
HTML;
}
