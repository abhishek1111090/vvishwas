<?php
// core.php — config, database, migrations, HTTP helpers shared by every route.
declare(strict_types=1);

final class HttpError extends Exception
{
    public function __construct(public int $status, public string $codeName, string $message)
    {
        parent::__construct($message);
    }
}

final class App
{
    public PDO $db;
    public string $driver;

    public function __construct(public array $cfg)
    {
    }

    // ── database ────────────────────────────────────────────────────────────
    public function connect(): void
    {
        $d = $this->cfg['database'];
        $this->db = new PDO($d['dsn'], $d['user'] ?? null, $d['password'] ?? null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_TIMEOUT => 5,
        ]);
        $this->driver = $this->db->getAttribute(PDO::ATTR_DRIVER_NAME);
        if ($this->driver === 'sqlite') {
            $this->db->exec('PRAGMA foreign_keys = ON');
            $this->db->exec('PRAGMA busy_timeout = 5000');
        }
    }

    /** Parameterised query → rows. Values are never interpolated into SQL. */
    public function q(string $sql, array $params = []): array
    {
        $st = $this->db->prepare($sql);
        $st->execute($params);
        return $st->columnCount() > 0 ? $st->fetchAll() : [];
    }

    public function one(string $sql, array $params = []): ?array
    {
        return $this->q($sql, $params)[0] ?? null;
    }

    public function tx(callable $fn): mixed
    {
        $this->db->beginTransaction();
        try {
            $out = $fn();
            $this->db->commit();
            return $out;
        } catch (Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    /**
     * Apply migrations/<driver>/*.sql once each. A marker file in the
     * private folder skips the check on normal requests.
     */
    public function migrate(): void
    {
        $dir = dirname(__DIR__) . '/migrations/' . $this->driver;
        $files = glob($dir . '/*.sql') ?: [];
        sort($files);
        $latest = $files ? basename(end($files)) : '';
        $marker = rtrim($this->cfg['private_dir'] ?? sys_get_temp_dir(), '/\\') . '/.schema-' . $this->driver;
        if ($latest !== '' && is_file($marker) && trim((string) file_get_contents($marker)) === $latest) return;

        if ($this->driver === 'pgsql') $this->db->exec('SELECT pg_advisory_lock(424242)');
        try {
            $this->db->exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
            $applied = array_column($this->q('SELECT version FROM schema_migrations'), 'version');
            foreach ($files as $file) {
                $v = basename($file);
                if (in_array($v, $applied, true)) continue;
                $this->tx(function () use ($file, $v) {
                    $this->db->exec((string) file_get_contents($file));
                    $this->q('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [$v, now_iso()]);
                });
            }
        } finally {
            if ($this->driver === 'pgsql') $this->db->exec('SELECT pg_advisory_unlock(424242)');
        }
        @file_put_contents($marker, $latest);
    }

    public function isConflict(PDOException $e): bool
    {
        return str_starts_with((string) $e->getCode(), '23');
    }

    /** Fixed-window rate limit stored in the database (PHP keeps no memory between requests). */
    public function rateLimited(string $key, int $limit, int $windowSeconds): bool
    {
        $now = now_iso();
        $cutoff = gmdate('Y-m-d\TH:i:s\Z', time() - $windowSeconds);
        $row = $this->one('SELECT window_start, hits FROM rate_limits WHERE key = ?', [$key]);
        if (!$row || iso($row['window_start']) < $cutoff) {
            $this->q('DELETE FROM rate_limits WHERE key = ?', [$key]);
            $this->q('INSERT INTO rate_limits (key, window_start, hits) VALUES (?, ?, 1)', [$key, $now]);
            return false;
        }
        $this->q('UPDATE rate_limits SET hits = hits + 1 WHERE key = ?', [$key]);
        return ((int) $row['hits'] + 1) > $limit;
    }
}

// ── helpers ─────────────────────────────────────────────────────────────────
function now_iso(?int $t = null): string
{
    return gmdate('Y-m-d\TH:i:s\Z', $t ?? time());
}

/** Any stored timestamp (PostgreSQL or ISO text) → ISO-8601 UTC, or null. */
function iso(?string $v): ?string
{
    if ($v === null || $v === '') return null;
    $t = strtotime($v);
    return $t === false ? null : gmdate('Y-m-d\TH:i:s\Z', $t);
}

function uuid4(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
}

function token(): string
{
    return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
}

function token_hash(string $t): string
{
    return hash('sha256', $t);
}

function str_in(mixed $v, int $max): string
{
    return is_string($v) ? mb_substr(trim($v), 0, $max) : '';
}

function mask_phone(mixed $p): string
{
    return mb_substr(preg_replace('/\d(?=\d{3})/', '•', (string) $p), -16);
}

/** Client timestamp → ISO, within a sane range. */
function client_time(mixed $v): ?string
{
    if ($v === null || $v === '') return null;
    $t = strtotime((string) $v);
    if ($t === false || $t < strtotime('2020-01-01') || $t > time() + 86400) {
        throw new HttpError(400, 'BAD_TIME', 'Invalid timestamp.');
    }
    return now_iso($t);
}

function send_json(int $status, ?array $body = null): void
{
    http_response_code($status);
    header('Cache-Control: no-store');
    if ($status === 204 || $body === null) return;
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}

function read_json(int $limit = 32768): array
{
    $raw = (string) file_get_contents('php://input', false, null, 0, $limit + 1);
    if (strlen($raw) > $limit) throw new HttpError(413, 'TOO_LARGE', 'Request too large.');
    if ($raw === '') return [];
    $type = $_SERVER['CONTENT_TYPE'] ?? '';
    if (str_starts_with($type, 'application/x-www-form-urlencoded')) {
        parse_str($raw, $out);
        return $out;
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) throw new HttpError(400, 'BAD_JSON', 'Invalid JSON.');
    return $data;
}

function header_value(string $name): string
{
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    if (isset($_SERVER[$key])) return (string) $_SERVER[$key];
    // Apache + PHP-FPM often hides Authorization; .htaccess passes it as REDIRECT_HTTP_AUTHORIZATION.
    if (isset($_SERVER['REDIRECT_' . $key])) return (string) $_SERVER['REDIRECT_' . $key];
    if (function_exists('getallheaders')) {
        foreach (getallheaders() as $k => $v) if (strcasecmp($k, $name) === 0) return (string) $v;
    }
    return '';
}

function client_ip(array $cfg): string
{
    if (!empty($cfg['trust_proxy'])) {
        $fwd = trim(explode(',', header_value('X-Forwarded-For'))[0] ?? '');
        if ($fwd !== '') return $fwd;
    }
    return (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
}

function app_log(string $msg): void
{
    error_log('[vishwas] ' . $msg); // never bodies, passwords or tokens
}
