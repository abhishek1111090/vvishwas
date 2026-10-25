<?php
// data.php — SOS events, location points and recordings. Every route needs
// a signed-in user and only ever reads or changes that user's rows.
declare(strict_types=1);

const BACKUP_MAX_BYTES = 8 * 1024 * 1024; // contacts can carry small photos
const TRIGGERS = ['button', 'tripleTap', 'voice', 'siri', 'watch', 'safetyTimer'];
const FILE_TYPES = [
    'audio' => ['audio/mp4' => 'm4a', 'audio/m4a' => 'm4a', 'audio/x-m4a' => 'm4a', 'audio/aac' => 'aac'],
    'video' => ['video/mp4' => 'mp4', 'video/quicktime' => 'mov'],
    'photo' => ['image/jpeg' => 'jpg'],
];

function public_event(array $e): array
{
    return [
        'id' => $e['id'], 'clientId' => $e['client_id'], 'triggerSource' => $e['trigger_source'], 'status' => $e['status'],
        'startedAt' => iso($e['started_at']), 'endedAt' => iso($e['ended_at']), 'receivedAt' => iso($e['received_at']),
        'contacts' => json_decode((string) ($e['contacts'] ?? '[]'), true) ?? [],
        'alertSummary' => isset($e['alert_summary']) ? json_decode((string) $e['alert_summary'], true) : null,
    ];
}

function public_recording(array $r, ?string $clientId = null): array
{
    return [
        'id' => $r['id'], 'kind' => $r['kind'], 'part' => (int) $r['part'], 'contentType' => $r['content_type'],
        'sizeBytes' => (int) $r['size_bytes'], 'sha256' => $r['sha256'], 'sosClientId' => $clientId ?? ($r['client_id'] ?? null),
        'createdAt' => iso($r['created_at']),
    ];
}

function event_for(App $app, array $user, mixed $clientId): array
{
    $ev = $app->one('SELECT * FROM sos_events WHERE user_id = ? AND client_id = ?', [$user['id'], str_in($clientId, 100)]);
    if (!$ev) throw new HttpError(404, 'NOT_FOUND', 'Unknown SOS event.');
    return $ev;
}

function insert_location(App $app, string $eventId, array $loc): void
{
    $lat = $loc['latitude'] ?? null;
    $lon = $loc['longitude'] ?? null;
    $acc = $loc['accuracy'] ?? null;
    if (!is_numeric($lat) || !is_numeric($lon) || $lat < -90 || $lat > 90 || $lon < -180 || $lon > 180) {
        throw new HttpError(400, 'BAD_LOCATION', 'Invalid coordinates.');
    }
    if ($acc !== null && (!is_numeric($acc) || $acc < 0 || $acc > 100000)) throw new HttpError(400, 'BAD_LOCATION', 'Invalid accuracy.');
    $at = client_time($loc['timestamp'] ?? ($loc['recordedAt'] ?? null)) ?? now_iso();
    $app->q('INSERT INTO sos_locations (id, event_id, latitude, longitude, accuracy_m, recorded_at, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [uuid4(), $eventId, (float) $lat, (float) $lon, $acc === null ? null : (float) $acc, $at, now_iso()]);
}

function storage_dir(App $app): string
{
    $dir = (string) ($app->cfg['storage_dir'] ?? '');
    if ($dir === '') throw new HttpError(503, 'NO_STORAGE', 'Recording storage is not configured.');
    if (!is_dir($dir . '/.partial') && !@mkdir($dir . '/.partial', 0700, true)) {
        throw new HttpError(503, 'NO_STORAGE', 'Recording storage folder is not writable.');
    }
    return $dir;
}

function route_data(App $app, string $method, string $path): ?array
{
    // ── SOS ──────────────────────────────────────────────────────────────
    if ($path === '/sos' && $method === 'POST') {
        $user = require_user($app);
        $b = read_json();
        $clientId = str_in($b['clientId'] ?? null, 100);
        if ($clientId === '') throw new HttpError(400, 'BAD_CLIENT_ID', 'clientId is required.');
        // The emergency link's token (see share.php): only its hash is stored.
        $share = $b['shareToken'] ?? null;
        if ($share !== null && (!is_string($share) || !preg_match(SHARE_TOKEN_RE, $share))) throw new HttpError(400, 'BAD_SHARE_TOKEN', 'Invalid share token.');
        $shareHash = $share === null ? null : token_hash($share);
        $existing = $app->one('SELECT * FROM sos_events WHERE user_id = ? AND client_id = ?', [$user['id'], $clientId]);
        if ($existing) {
            if ($shareHash !== null && $existing['share_token_hash'] === null) {
                $app->q('UPDATE sos_events SET share_token_hash = ? WHERE id = ?', [$shareHash, $existing['id']]);
            }
            return [200, ['event' => public_event($existing), 'duplicate' => true]];
        }

        $trigger = in_array($b['triggerSource'] ?? null, TRIGGERS, true) ? $b['triggerSource'] : 'button';
        $started = client_time($b['startedAt'] ?? null) ?? now_iso();
        $contacts = array_map(fn ($c) => [
            'contactId' => str_in($c['id'] ?? null, 64), 'name' => str_in($c['name'] ?? null, 80), 'phoneMasked' => mask_phone($c['phoneNumber'] ?? ''),
        ], array_slice(is_array($b['contacts'] ?? null) ? $b['contacts'] : [], 0, 20));
        try {
            $now = now_iso();
            $app->q('INSERT INTO sos_events (id, user_id, client_id, trigger_source, status, started_at, received_at, updated_at, contacts, share_token_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [uuid4(), $user['id'], $clientId, $trigger, 'active', $started, $now, $now, json_encode($contacts, JSON_UNESCAPED_UNICODE), $shareHash]);
        } catch (PDOException $e) {
            if (!$app->isConflict($e)) throw $e; // a concurrent retry created it first
        }
        $ev = $app->one('SELECT * FROM sos_events WHERE user_id = ? AND client_id = ?', [$user['id'], $clientId]);
        if (is_array($b['location'] ?? null)) insert_location($app, $ev['id'], $b['location']);
        return [201, ['event' => public_event($ev)]];
    }

    if ($path === '/sos' && $method === 'GET') {
        $user = require_user($app);
        $rows = $app->q('SELECT * FROM sos_events WHERE user_id = ? ORDER BY started_at DESC LIMIT 50', [$user['id']]);
        return [200, ['events' => array_map('public_event', $rows)]];
    }

    if ($method === 'PATCH' && preg_match('#^/sos/([^/]{1,100})$#', $path, $m)) {
        $user = require_user($app);
        $ev = event_for($app, $user, rawurldecode($m[1]));
        $b = read_json();
        $status = in_array($b['status'] ?? null, ['active', 'resolved', 'cancelled'], true) ? $b['status'] : $ev['status'];
        $ended = array_key_exists('endedAt', $b) ? client_time($b['endedAt']) : iso($ev['ended_at']);
        $summary = array_key_exists('alertSummary', $b) ? mb_substr(json_encode($b['alertSummary'], JSON_UNESCAPED_UNICODE), 0, 20000) : ($ev['alert_summary'] ?? null);
        $app->q('UPDATE sos_events SET status = ?, ended_at = ?, alert_summary = ?, updated_at = ? WHERE id = ?', [$status, $ended, $summary, now_iso(), $ev['id']]);
        return [200, ['event' => public_event($app->one('SELECT * FROM sos_events WHERE id = ?', [$ev['id']]))]];
    }

    if ($path === '/location' && $method === 'POST') {
        $user = require_user($app);
        $b = read_json();
        insert_location($app, event_for($app, $user, $b['sosClientId'] ?? null)['id'], $b);
        return [201, ['ok' => true]];
    }

    // ── app data backup (contacts, settings): one JSON document per user ───
    if ($path === '/backup' && $method === 'POST') { // replaces the whole document (POST: some hosts block PUT)
        $user = require_user($app);
        $b = read_json(BACKUP_MAX_BYTES);
        $doc = [];
        if (isset($b['contacts'])) {
            if (!is_array($b['contacts']) || count($b['contacts']) > 200) throw new HttpError(400, 'BAD_BACKUP', 'contacts must be a list (at most 200).');
            $doc['contacts'] = array_values($b['contacts']);
        }
        if (isset($b['settings'])) {
            if (!is_array($b['settings'])) throw new HttpError(400, 'BAD_BACKUP', 'settings must be an object.');
            $doc['settings'] = $b['settings'];
        }
        $json = json_encode($doc, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $now = now_iso();
        $app->tx(function () use ($app, $user, $json, $now) {
            $app->q('DELETE FROM user_backups WHERE user_id = ?', [$user['id']]);
            $app->q('INSERT INTO user_backups (user_id, data, updated_at) VALUES (?, ?, ?)', [$user['id'], $json, $now]);
        });
        return [200, ['updatedAt' => $now]];
    }

    if ($path === '/backup' && $method === 'GET') {
        $user = require_user($app);
        $row = $app->one('SELECT data, updated_at FROM user_backups WHERE user_id = ?', [$user['id']]);
        return [200, ['backup' => $row ? json_decode((string) $row['data'], true) : null, 'updatedAt' => $row ? iso($row['updated_at']) : null]];
    }

    // ── recordings ───────────────────────────────────────────────────────
    if ($path === '/recordings' && $method === 'POST') {
        $user = require_user($app);
        $dir = storage_dir($app);
        $kind = (string) ($_GET['kind'] ?? '');
        $part = filter_var($_GET['part'] ?? 1, FILTER_VALIDATE_INT);
        $type = strtolower(trim(explode(';', (string) ($_SERVER['CONTENT_TYPE'] ?? ''))[0]));
        if (!isset(FILE_TYPES[$kind])) throw new HttpError(400, 'BAD_KIND', 'kind must be audio, video or photo.');
        if ($part === false || $part < 1 || $part > 9999) throw new HttpError(400, 'BAD_PART', 'part must be 1–9999.');
        $ext = FILE_TYPES[$kind][$type] ?? null;
        if ($ext === null) throw new HttpError(415, 'BAD_TYPE', "A $kind upload can't be " . ($type ?: 'untyped') . '.');
        $max = (int) ($app->cfg['max_upload_mb'] ?? 200) * 1024 * 1024;
        if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > $max) throw new HttpError(413, 'TOO_LARGE', 'File too large.');
        $ev = isset($_GET['sosClientId']) ? event_for($app, $user, $_GET['sosClientId']) : null;

        $uploadKey = $user['id'] . '/' . ($ev['id'] ?? 'none') . "/$kind/$part";
        $already = $app->one('SELECT * FROM recordings WHERE upload_key = ?', [$uploadKey]);

        // Chunked upload (?offset=&total=): big files arrive in pieces small enough for slow
        // links and proxy time limits; an interrupted upload resumes where the server stopped.
        if (isset($_GET['offset']) || isset($_GET['total'])) {
            if ($already && (int) $already['size_bytes'] === (int) ($_GET['total'] ?? -1)) {
                return [200, ['recording' => public_recording($already, $ev['client_id'] ?? null), 'duplicate' => true]];
            }
            if ($already) {
                // A cut-short copy (a server before chunk support kept only the first piece): replace it.
                $app->q('DELETE FROM recordings WHERE id = ?', [$already['id']]);
                @unlink("$dir/" . $already['storage_key']);
            }
            return upload_chunk($app, $dir, $user, $ev, $kind, $part, $type, $ext, $uploadKey, $max);
        }
        if ($already) return [200, ['recording' => public_recording($already, $ev['client_id'] ?? null), 'duplicate' => true]];

        $id = uuid4();
        $partial = "$dir/.partial/$id.upload";
        $in = fopen('php://input', 'rb');
        $out = fopen($partial, 'wb');
        if (!$in || !$out) throw new HttpError(503, 'NO_STORAGE', 'Could not store the file.');
        $ctx = hash_init('sha256');
        $size = 0;
        while (!feof($in)) {
            $chunk = fread($in, 1 << 16);
            if ($chunk === false) break;
            $size += strlen($chunk);
            if ($size > $max) {
                fclose($out);
                @unlink($partial);
                throw new HttpError(413, 'TOO_LARGE', 'File too large.');
            }
            hash_update($ctx, $chunk);
            fwrite($out, $chunk);
        }
        fclose($out);
        $declared = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
        if ($size === 0 || ($declared > 0 && $size !== $declared)) {
            @unlink($partial);
            throw new HttpError(400, $size === 0 ? 'EMPTY' : 'UPLOAD_INTERRUPTED', $size === 0 ? 'Empty file.' : 'The upload was interrupted. Try again.');
        }
        $key = $user['id'] . "/$id.$ext";
        if (!is_dir("$dir/" . $user['id'])) mkdir("$dir/" . $user['id'], 0700, true);
        rename($partial, "$dir/$key");
        try {
            $app->q('INSERT INTO recordings (id, user_id, event_id, kind, part, upload_key, content_type, size_bytes, sha256, storage_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$id, $user['id'], $ev['id'] ?? null, $kind, $part, $uploadKey, $type, $size, hash_final($ctx), $key, now_iso()]);
        } catch (PDOException $e) {
            @unlink("$dir/$key");
            if ($app->isConflict($e)) {
                return [200, ['recording' => public_recording($app->one('SELECT * FROM recordings WHERE upload_key = ?', [$uploadKey]), $ev['client_id'] ?? null), 'duplicate' => true]];
            }
            throw $e;
        }
        return [201, ['recording' => public_recording($app->one('SELECT * FROM recordings WHERE id = ?', [$id]), $ev['client_id'] ?? null)]];
    }

    if ($path === '/recordings' && $method === 'GET') {
        $user = require_user($app);
        $clientId = $_GET['sosClientId'] ?? null;
        $rows = $clientId !== null
            ? $app->q('SELECT r.*, e.client_id FROM recordings r LEFT JOIN sos_events e ON e.id = r.event_id WHERE r.user_id = ? AND e.client_id = ? ORDER BY r.created_at', [$user['id'], (string) $clientId])
            : $app->q('SELECT r.*, e.client_id FROM recordings r LEFT JOIN sos_events e ON e.id = r.event_id WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 200', [$user['id']]);
        return [200, ['recordings' => array_map(fn ($r) => public_recording($r), $rows)]];
    }

    if (preg_match('#^/recordings/([0-9a-fA-F-]{36})(/file)?$#', $path, $m) && in_array($method, ['GET', 'DELETE'], true)) {
        $user = require_user($app);
        $row = $app->one('SELECT * FROM recordings WHERE id = ? AND user_id = ?', [strtolower($m[1]), $user['id']]);
        if (!$row) throw new HttpError(404, 'NOT_FOUND', 'Recording not found.'); // same answer for "not yours"
        $file = storage_dir($app) . '/' . $row['storage_key'];

        if ($method === 'DELETE' && empty($m[2])) {
            $app->q('DELETE FROM recordings WHERE id = ? AND user_id = ?', [$row['id'], $user['id']]);
            @unlink($file);
            return [204, null];
        }
        if ($method === 'GET' && !empty($m[2])) {
            if (!is_file($file)) throw new HttpError(410, 'GONE', 'The file is no longer on the server.');
            stream_file($file, (string) $row['content_type'], 'private, no-store');
            return ['stream', null];
        }
    }
    return null;
}

/**
 * One piece of a chunked upload. Pieces must arrive in order: a piece that
 * doesn't start where the server's copy ends is not written, and the reply
 * says how many bytes the server has, so the phone continues from there.
 * 202 {received} until the last piece; then the file is stored like a
 * one-shot upload and 201 {recording} is returned.
 */
function upload_chunk(App $app, string $dir, array $user, ?array $ev, string $kind, int $part, string $type, string $ext, string $uploadKey, int $max): array
{
    $offset = filter_var($_GET['offset'] ?? null, FILTER_VALIDATE_INT);
    $total = filter_var($_GET['total'] ?? null, FILTER_VALIDATE_INT);
    if ($offset === false || $total === false || $offset < 0 || $total < 1 || $offset >= $total) throw new HttpError(400, 'BAD_CHUNK', 'offset/total are invalid.');
    if ($total > $max) throw new HttpError(413, 'TOO_LARGE', 'File too large.');
    $partial = "$dir/.partial/" . hash('sha256', $uploadKey) . '.chunks';
    clearstatcache(true, $partial);
    $have = is_file($partial) ? filesize($partial) : 0;
    if ($have > $total) { @unlink($partial); $have = 0; } // a different file with the same key: start over
    if ($offset !== $have) return [202, ['received' => $have, 'total' => $total]];

    $in = fopen('php://input', 'rb');
    $out = fopen($partial, 'ab');
    if (!$in || !$out || !flock($out, LOCK_EX)) throw new HttpError(503, 'NO_STORAGE', 'Could not store the file.');
    clearstatcache(true, $partial);
    if (filesize($partial) !== $offset) { // another request appended meanwhile
        fclose($out);
        return [202, ['received' => filesize($partial), 'total' => $total]];
    }
    $size = $offset;
    while (!feof($in)) {
        $chunk = fread($in, 1 << 16);
        if ($chunk === false || $chunk === '') break;
        if ($size + strlen($chunk) > $total) {
            ftruncate($out, $offset);
            fclose($out);
            throw new HttpError(400, 'BAD_CHUNK', 'More data than the declared total.');
        }
        fwrite($out, $chunk);
        $size += strlen($chunk);
    }
    fflush($out);
    flock($out, LOCK_UN);
    fclose($out);
    if ($size < $total) return [202, ['received' => $size, 'total' => $total]];

    $id = uuid4();
    $key = $user['id'] . "/$id.$ext";
    if (!is_dir("$dir/" . $user['id'])) mkdir("$dir/" . $user['id'], 0700, true);
    $sha = hash_file('sha256', $partial);
    rename($partial, "$dir/$key");
    try {
        $app->q('INSERT INTO recordings (id, user_id, event_id, kind, part, upload_key, content_type, size_bytes, sha256, storage_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$id, $user['id'], $ev['id'] ?? null, $kind, $part, $uploadKey, $type, $total, $sha, $key, now_iso()]);
    } catch (PDOException $e) {
        @unlink("$dir/$key");
        if ($app->isConflict($e)) {
            return [200, ['recording' => public_recording($app->one('SELECT * FROM recordings WHERE upload_key = ?', [$uploadKey]), $ev['client_id'] ?? null), 'duplicate' => true]];
        }
        throw $e;
    }
    return [201, ['recording' => public_recording($app->one('SELECT * FROM recordings WHERE id = ?', [$id]), $ev['client_id'] ?? null)]];
}

/** Stream a file with single-range support (video players seek with Range). */
function stream_file(string $file, string $type, string $cache): void
{
    $total = filesize($file);
    header("Content-Type: $type");
    header('Accept-Ranges: bytes');
    header("Cache-Control: $cache");
    header('X-Content-Type-Options: nosniff');
    $start = 0;
    $end = $total - 1;
    if (preg_match('/^bytes=(\d*)-(\d*)$/', header_value('Range'), $r) && ($r[1] !== '' || $r[2] !== '')) {
        $start = $r[1] !== '' ? (int) $r[1] : max(0, $total - (int) $r[2]);
        $end = ($r[1] !== '' && $r[2] !== '') ? min((int) $r[2], $total - 1) : $total - 1;
        if ($start > $end) {
            http_response_code(416);
            header("Content-Range: bytes */$total");
            return;
        }
        http_response_code(206);
        header("Content-Range: bytes $start-$end/$total");
    } else {
        http_response_code(200);
    }
    header('Content-Length: ' . ($end - $start + 1));
    $fh = fopen($file, 'rb');
    fseek($fh, $start);
    $left = $end - $start + 1;
    while ($left > 0 && !feof($fh)) {
        $chunk = fread($fh, min(1 << 16, $left));
        echo $chunk;
        $left -= strlen($chunk);
    }
    fclose($fh);
}
