<?php
// alerts.php — SOS text to every contact by SMS and/or WhatsApp (Twilio),
// evidence clips on WhatsApp, and Twilio delivery reports. Ported from the
// Node server; state is in the database because PHP keeps nothing between
// requests. One SOS = one set of messages (idempotent on sessionId); each
// contact is sent separately, in parallel, so one failure never stops the rest.
declare(strict_types=1);

const ALERT_PREFIX = '🚨 EMERGENCY ALERT!';
const MEDIA_IN = ['audio/mp4' => 'm4a', 'audio/m4a' => 'm4a', 'audio/x-m4a' => 'm4a', 'audio/aac' => 'aac', 'video/mp4' => 'mp4', 'video/quicktime' => 'mov'];
const MEDIA_OUT = ['m4a' => 'audio/mp4', 'aac' => 'audio/aac', 'mp4' => 'video/mp4', 'mov' => 'video/mp4'];
const RANK = ['failed' => 0, 'sending' => 1, 'sent' => 2, 'delivered' => 3];

function to_e164(mixed $raw, string $cc): ?string
{
    $s = trim((string) $raw);
    $digits = preg_replace('/\D/', '', $s);
    $plus = str_starts_with($s, '+');
    if (!$plus && str_starts_with($digits, '00')) {
        $digits = substr($digits, 2);
        $plus = true;
    }
    if (!$plus && $cc !== '') {
        $cc = preg_replace('/\D/', '', $cc);
        if (str_starts_with($digits, '0')) $digits = substr($digits, 1);
        $digits = (str_starts_with($digits, $cc) && strlen($digits) > 10) ? $digits : $cc . $digits;
        $plus = true;
    }
    $e = '+' . $digits;
    return ($plus && preg_match('/^\+[1-9]\d{6,14}$/', $e)) ? $e : null;
}

function twilio_cfg(App $app): array
{
    $t = $app->cfg['twilio'] ?? [];
    $wa = (string) ($t['whatsapp_from'] ?? '');
    return [
        'ready' => !empty($t['account_sid']) && !empty($t['auth_token']),
        'sms' => !empty($t['account_sid']) && !empty($t['auth_token']) && (!empty($t['from']) || !empty($t['messaging_service_sid'])),
        'whatsapp' => !empty($t['account_sid']) && !empty($t['auth_token']) && $wa !== '',
        'wa_from' => $wa === '' ? '' : (str_starts_with($wa, 'whatsapp:') ? $wa : "whatsapp:$wa"),
    ] + $t;
}

/**
 * Send many Twilio messages in parallel.
 * $jobs: [['to' => '+91…', 'body' => '…', 'whatsapp' => bool, 'media' => ?url], …]
 * → same order: ['ok' => bool, 'sid' => ?, 'status' => ?, 'error' => ?]
 */
function twilio_send_many(App $app, array $jobs): array
{
    $t = twilio_cfg($app);
    $base = rtrim((string) ($app->cfg['twilio_api_base'] ?? 'https://api.twilio.com'), '/');
    $url = $base . '/2010-04-01/Accounts/' . rawurlencode((string) ($t['account_sid'] ?? '')) . '/Messages.json';
    $callback = rtrim((string) ($app->cfg['public_url'] ?? ''), '/');
    $mh = curl_multi_init();
    $handles = [];
    $results = [];
    foreach ($jobs as $i => $job) {
        if ($job['whatsapp'] ? !$t['whatsapp'] : !$t['sms']) {
            $results[$i] = ['ok' => false, 'error' => $job['whatsapp'] ? 'WhatsApp sender not configured' : 'SMS sender not configured'];
            continue;
        }
        $form = ['To' => ($job['whatsapp'] ? 'whatsapp:' : '') . $job['to'], 'Body' => $job['body']];
        if ($job['whatsapp']) $form['From'] = $t['wa_from'];
        elseif (!empty($t['messaging_service_sid'])) $form['MessagingServiceSid'] = $t['messaging_service_sid'];
        else $form['From'] = $t['from'];
        if (!empty($job['media'])) $form['MediaUrl'] = $job['media'];
        if ($callback !== '') $form['StatusCallback'] = "$callback/sms/status";
        $h = curl_init($url);
        curl_setopt_array($h, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => http_build_query($form),
            CURLOPT_USERPWD => $t['account_sid'] . ':' . $t['auth_token'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_CONNECTTIMEOUT => 5,
        ]);
        curl_multi_add_handle($mh, $h);
        $handles[$i] = $h;
    }
    do {
        $status = curl_multi_exec($mh, $running);
        if ($running) curl_multi_select($mh, 1.0);
    } while ($running && $status === CURLM_OK);
    foreach ($handles as $i => $h) {
        $code = curl_getinfo($h, CURLINFO_HTTP_CODE);
        $data = json_decode((string) curl_multi_getcontent($h), true) ?: [];
        if ($code === 0) $results[$i] = ['ok' => false, 'error' => 'Could not reach the SMS provider'];
        elseif ($code >= 400) $results[$i] = ['ok' => false, 'error' => $data['message'] ?? "Twilio error $code"];
        elseif (!empty($data['error_code'])) $results[$i] = ['ok' => false, 'sid' => $data['sid'] ?? null, 'error' => $data['error_message'] ?? 'Twilio error ' . $data['error_code']];
        else $results[$i] = ['ok' => true, 'sid' => $data['sid'], 'status' => map_twilio((string) ($data['status'] ?? 'queued'))];
        curl_multi_remove_handle($mh, $h);
        curl_close($h);
        $job = $jobs[$i];
        $masked = preg_replace('/\d(?=\d{3})/', '•', $job['to']);
        app_log(($job['whatsapp'] ? 'whatsapp' : 'sms') . (!empty($job['media']) ? ' + clip' : '') . " → $masked: " . ($results[$i]['ok'] ? 'accepted' : 'FAILED — ' . $results[$i]['error']));
    }
    curl_multi_close($mh);
    ksort($results);
    return $results;
}

function map_twilio(string $s): string
{
    return match ($s) {
        'delivered' => 'delivered',
        'undelivered', 'failed', 'canceled' => 'failed',
        default => 'sent',
    };
}

function settle(array &$r): void
{
    $best = null;
    foreach (['sms', 'whatsapp'] as $ch) {
        if (!isset($r[$ch])) continue;
        if ($best === null || (RANK[$r[$ch]['status']] ?? 0) > (RANK[$best['status']] ?? -1)) $best = $r[$ch];
    }
    $r['status'] = $best['status'] ?? 'failed';
    $errors = array_filter([$r['sms']['error'] ?? null, $r['whatsapp']['error'] ?? null]);
    $r['error'] = $r['status'] === 'failed' ? (implode(' · ', $errors) ?: 'Not sent') : null;
}

function alert_view(App $app, string $sessionId, array $recipients): array
{
    $t = twilio_cfg($app);
    return [
        'sessionId' => $sessionId,
        'provider' => $t['ready'] ? 'twilio' : 'none',
        'channels' => ['sms' => $t['sms'], 'whatsapp' => $t['whatsapp']],
        'recipients' => array_map(fn ($r) => [
            'contactId' => $r['contactId'], 'name' => $r['name'], 'phoneNumber' => $r['phoneNumber'], 'status' => $r['status'],
            'error' => $r['error'] ?? null, 'updatedAt' => $r['updatedAt'],
            'sms' => isset($r['sms']) ? ['status' => $r['sms']['status'], 'error' => $r['sms']['error'] ?? null] : null,
            'whatsapp' => isset($r['whatsapp']) ? ['status' => $r['whatsapp']['status'], 'error' => $r['whatsapp']['error'] ?? null] : null,
        ], $recipients),
    ];
}

function media_dir(App $app): string
{
    $dir = rtrim((string) ($app->cfg['storage_dir'] ?? ''), '/\\');
    if ($dir === '') throw new HttpError(503, 'NO_STORAGE', 'Storage is not configured.');
    $dir .= '/whatsapp-media';
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    return $dir;
}

function route_alerts(App $app, string $method, string $path, string $ip): ?array
{
    // Media for WhatsApp is fetched by Twilio/contacts without a key; names are 128-bit random.
    if ($method === 'GET' && preg_match('#^/media/([a-f0-9]{32})\.(m4a|aac|mp4|mov)$#', $path, $m)) {
        $file = media_dir($app) . "/{$m[1]}.{$m[2]}";
        if (!is_file($file)) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
        stream_file($file, MEDIA_OUT[$m[2]], 'no-store');
        return ['stream', null];
    }

    if ($method === 'POST' && $path === '/sms/status') {
        $params = $_POST ?: (function () { parse_str((string) file_get_contents('php://input'), $p); return $p; })();
        $t = twilio_cfg($app);
        ksort($params);
        $data = rtrim((string) $app->cfg['public_url'], '/') . '/sms/status';
        foreach ($params as $k => $v) $data .= $k . $v;
        $expected = base64_encode(hash_hmac('sha1', $data, (string) ($t['auth_token'] ?? ''), true));
        if (empty($t['auth_token']) || !hash_equals($expected, header_value('X-Twilio-Signature'))) {
            throw new HttpError(403, 'BAD_SIGNATURE', 'Bad signature.');
        }
        $msg = $app->one('SELECT * FROM alert_messages WHERE sid = ?', [(string) ($params['MessageSid'] ?? '')]);
        if ($msg) {
            $status = map_twilio((string) ($params['MessageStatus'] ?? ''));
            $error = $status === 'failed' ? (!empty($params['ErrorCode']) ? "Not delivered (error {$params['ErrorCode']})" : 'Not delivered') : null;
            $app->tx(function () use ($app, $msg, $status, $error) {
                if ($msg['media_key']) {
                    $row = $app->one('SELECT results FROM alert_media WHERE media_key = ?', [$msg['media_key']]);
                    $results = json_decode((string) ($row['results'] ?? '{}'), true) ?: [];
                    $results[$msg['contact_id']] = ['status' => $status, 'error' => $error];
                    $app->q('UPDATE alert_media SET results = ? WHERE media_key = ?', [json_encode($results), $msg['media_key']]);
                    return;
                }
                $row = $app->one('SELECT recipients FROM alert_sessions WHERE session_id = ?', [$msg['session_id']]);
                $recipients = json_decode((string) ($row['recipients'] ?? '[]'), true) ?: [];
                foreach ($recipients as &$r) {
                    if ($r['contactId'] !== $msg['contact_id']) continue;
                    $r[$msg['channel']] = ['status' => $status, 'error' => $error, 'sid' => $msg['sid']];
                    $r['updatedAt'] = now_iso();
                    settle($r);
                }
                unset($r);
                $app->q('UPDATE alert_sessions SET recipients = ? WHERE session_id = ?', [json_encode($recipients, JSON_UNESCAPED_UNICODE), $msg['session_id']]);
            });
        }
        return [204, null];
    }

    if (!preg_match('#^/alerts(/|$)#', $path)) return null;
    $key = (string) ($app->cfg['app_key'] ?? '');
    if ($key === '' || !hash_equals($key, header_value('X-Vishwas-Key'))) throw new HttpError(401, 'UNAUTHORIZED', 'Missing or wrong app key.');

    if ($method === 'POST' && $path === '/alerts/emergency') {
        $b = read_json();
        $sessionId = str_in($b['sessionId'] ?? null, 100);
        if ($sessionId === '') throw new HttpError(400, 'BAD_SESSION', 'sessionId is required.');
        $existing = $app->one('SELECT * FROM alert_sessions WHERE session_id = ?', [$sessionId]);
        if ($existing) return [200, alert_view($app, $sessionId, json_decode((string) $existing['recipients'], true) ?: []) + ['duplicate' => true]];

        $message = trim((string) ($b['message'] ?? ''));
        if (!str_starts_with($message, ALERT_PREFIX) || mb_strlen($message) > 1200) throw new HttpError(400, 'BAD_MESSAGE', 'Only VISHWAS emergency alerts can be sent.');
        $contacts = is_array($b['contacts'] ?? null) ? $b['contacts'] : [];
        if (!$contacts) throw new HttpError(400, 'NO_CONTACTS', 'No contacts to alert.');
        if (count($contacts) > 10) throw new HttpError(400, 'TOO_MANY', 'At most 10 contacts per alert.');
        if ($app->rateLimited("alert:$ip", 5, 600)) throw new HttpError(429, 'RATE_LIMITED', 'Too many new alerts from this device. Try again shortly.');

        $cc = (string) ($app->cfg['default_country_code'] ?? '');
        $seen = [];
        $recipients = [];
        foreach ($contacts as $c) {
            $e164 = to_e164($c['phoneNumber'] ?? '', $cc);
            $r = ['contactId' => (string) ($c['id'] ?? ''), 'name' => mb_substr((string) ($c['name'] ?? ''), 0, 80), 'phoneNumber' => $e164 ?? (string) ($c['phoneNumber'] ?? ''), 'updatedAt' => now_iso()];
            if (!$e164) $r += ['status' => 'invalidNumber', 'error' => 'Not a valid phone number'];
            elseif (isset($seen[$e164])) $r += ['status' => 'duplicate', 'error' => 'Same number as another contact — texted once'];
            else {
                $seen[$e164] = true;
                $r['status'] = 'sending';
            }
            $recipients[] = $r;
        }
        // Claim the session first, so a concurrent retry can't send a second time.
        try {
            $app->q('INSERT INTO alert_sessions (session_id, created_at, who, recipients) VALUES (?, ?, ?, ?)', [$sessionId, now_iso(), mb_substr((string) ($b['user']['fullName'] ?? ''), 0, 60), json_encode($recipients, JSON_UNESCAPED_UNICODE)]);
        } catch (PDOException $e) {
            if (!$app->isConflict($e)) throw $e;
            $row = $app->one('SELECT recipients FROM alert_sessions WHERE session_id = ?', [$sessionId]);
            return [200, alert_view($app, $sessionId, json_decode((string) $row['recipients'], true) ?: []) + ['duplicate' => true]];
        }

        $t = twilio_cfg($app);
        $jobs = [];
        $map = [];
        foreach ($recipients as $i => $r) {
            if ($r['status'] !== 'sending') continue;
            foreach (['sms' => $t['sms'], 'whatsapp' => $t['whatsapp']] as $ch => $on) {
                if (!$on) continue;
                $jobs[] = ['to' => $r['phoneNumber'], 'body' => $message, 'whatsapp' => $ch === 'whatsapp'];
                $map[] = [$i, $ch];
            }
            if (!$t['sms'] && !$t['whatsapp']) $recipients[$i]['sms'] = ['status' => 'failed', 'error' => 'Messaging is not configured on the server'];
        }
        foreach (twilio_send_many($app, $jobs) as $j => $res) {
            [$i, $ch] = $map[$j];
            $recipients[$i][$ch] = $res['ok'] ? ['status' => $res['status'], 'sid' => $res['sid']] : ['status' => 'failed', 'error' => $res['error']];
            if ($res['ok']) $app->q('INSERT INTO alert_messages (sid, session_id, contact_id, channel) VALUES (?, ?, ?, ?)', [$res['sid'], $sessionId, $recipients[$i]['contactId'], $ch]);
        }
        foreach ($recipients as &$r) {
            if ($r['status'] === 'sending') {
                $r['updatedAt'] = now_iso();
                settle($r);
            }
        }
        unset($r);
        $app->q('UPDATE alert_sessions SET recipients = ? WHERE session_id = ?', [json_encode($recipients, JSON_UNESCAPED_UNICODE), $sessionId]);
        return [200, alert_view($app, $sessionId, $recipients)];
    }

    if ($method === 'POST' && preg_match('#^/alerts/([^/]{1,100})/media$#', $path, $m)) {
        $sessionId = rawurldecode($m[1]);
        $s = $app->one('SELECT * FROM alert_sessions WHERE session_id = ?', [$sessionId]);
        if (!$s) throw new HttpError(404, 'NOT_FOUND', 'Unknown alert.');
        $t = twilio_cfg($app);
        if (!$t['whatsapp']) throw new HttpError(409, 'NO_WHATSAPP', 'WhatsApp is not configured on the server.');
        if (empty($app->cfg['public_url'])) throw new HttpError(409, 'NO_PUBLIC_URL', 'Set public_url so WhatsApp can fetch clips.');
        $kind = (string) ($_GET['kind'] ?? '');
        $part = filter_var($_GET['part'] ?? null, FILTER_VALIDATE_INT);
        if (!in_array($kind, ['audio', 'video'], true) || $part === false || $part < 1 || $part > 999) throw new HttpError(400, 'BAD_MEDIA', 'kind must be audio|video and part 1–999.');
        $ext = MEDIA_IN[strtolower(trim(explode(';', (string) ($_SERVER['CONTENT_TYPE'] ?? ''))[0]))] ?? null;
        if (!$ext) throw new HttpError(415, 'BAD_TYPE', 'Unsupported type.');

        $mediaKey = "$sessionId/$kind/$part";
        $done = $app->one('SELECT * FROM alert_media WHERE media_key = ?', [$mediaKey]);
        if ($done) {
            $results = json_decode((string) $done['results'], true) ?: [];
            return [200, ['sessionId' => $sessionId, 'kind' => $kind, 'part' => $part, 'url' => $done['url'], 'sentTo' => count(array_filter($results, fn ($x) => $x['status'] !== 'failed')), 'results' => $results, 'duplicate' => true]];
        }
        $data = (string) file_get_contents('php://input', false, null, 0, 16 * 1024 * 1024 + 1);
        if ($data === '') throw new HttpError(400, 'EMPTY', 'Empty clip.');
        if (strlen($data) > 16 * 1024 * 1024) throw new HttpError(413, 'TOO_LARGE', 'WhatsApp clips must be 16 MB or less.');
        $name = bin2hex(random_bytes(16)) . ".$ext";
        file_put_contents(media_dir($app) . "/$name", $data);
        $url = rtrim((string) $app->cfg['public_url'], '/') . "/media/$name";
        $who = (string) ($s['who'] ?? '');
        $body = ($kind === 'audio' ? '🎙 SOS audio' : '🎥 SOS video') . " $part" . ($who !== '' ? " from $who" : '') . " — evidence recorded during the emergency. If it doesn't play, open: $url";

        $targets = array_values(array_filter(json_decode((string) $s['recipients'], true) ?: [], fn ($r) => isset($r['whatsapp']) && $r['whatsapp']['status'] !== 'failed'));
        $results = [];
        $sends = twilio_send_many($app, array_map(fn ($r) => ['to' => $r['phoneNumber'], 'body' => $body, 'whatsapp' => true, 'media' => $url], $targets));
        foreach ($sends as $j => $res) {
            $cid = $targets[$j]['contactId'];
            $results[$cid] = $res['ok'] ? ['status' => $res['status']] : ['status' => 'failed', 'error' => $res['error']];
            if ($res['ok']) $app->q('INSERT INTO alert_messages (sid, session_id, contact_id, channel, media_key) VALUES (?, ?, ?, ?, ?)', [$res['sid'], $sessionId, $cid, 'whatsapp', $mediaKey]);
        }
        $app->q('INSERT INTO alert_media (media_key, session_id, file_name, url, results, created_at) VALUES (?, ?, ?, ?, ?, ?)', [$mediaKey, $sessionId, $name, $url, json_encode($results), now_iso()]);
        return [200, ['sessionId' => $sessionId, 'kind' => $kind, 'part' => $part, 'url' => $url, 'sentTo' => count(array_filter($results, fn ($x) => $x['status'] !== 'failed')), 'results' => $results]];
    }

    if ($method === 'GET' && preg_match('#^/alerts/([^/]{1,100})$#', $path, $m)) {
        $s = $app->one('SELECT * FROM alert_sessions WHERE session_id = ?', [rawurldecode($m[1])]);
        if (!$s) throw new HttpError(404, 'NOT_FOUND', 'Unknown alert.');
        return [200, alert_view($app, $s['session_id'], json_decode((string) $s['recipients'], true) ?: [])];
    }
    return null;
}
