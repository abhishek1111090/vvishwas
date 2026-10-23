<?php
// main.php — VISHWAS PHP API entry point (called by public/api/index.php).
//
// Config: a PHP file OUTSIDE the website folder (default:
// <subscription>/vishwas-private/config.php, or the VISHWAS_CONFIG env var).
// It holds the database password and keys — it is never inside httpdocs.
declare(strict_types=1);

require __DIR__ . '/core.php';
require __DIR__ . '/account.php';
require __DIR__ . '/data.php';
require __DIR__ . '/alerts.php';

function vishwas_run(): void
{
    header('X-Content-Type-Options: nosniff');
    $configFile = getenv('VISHWAS_CONFIG') ?: dirname((string) ($_SERVER['DOCUMENT_ROOT'] ?? __DIR__)) . '/vishwas-private/config.php';
    if (!is_file($configFile)) {
        send_json(503, ['code' => 'NOT_CONFIGURED', 'message' => 'The VISHWAS server is not configured yet.']);
        return;
    }
    $cfg = require $configFile;
    $app = new App($cfg);

    $path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
    if ($path === '/api' || str_starts_with($path, '/api/')) $path = substr($path, 4) ?: '/';
    if (strlen($path) > 1) $path = rtrim($path, '/');
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));

    try {
        try {
            $app->connect();
            $app->migrate();
        } catch (PDOException $e) {
            app_log('database unavailable: ' . $e->getCode());
            if ($method === 'GET' && $path === '/health') {
                send_json(200, ['ok' => true, 'db' => 'unavailable']);
                return;
            }
            throw new HttpError(503, 'DB_UNAVAILABLE', 'Server storage is unavailable. Try again shortly.');
        }

        if ($method === 'GET' && $path === '/health') {
            $t = twilio_cfg($app);
            send_json(200, ['ok' => true, 'db' => 'ok', 'sms' => $t['sms'], 'whatsapp' => $t['whatsapp']]);
            return;
        }
        $ip = client_ip($cfg);
        $result = route_account($app, $method, $path, $ip)
            ?? route_data($app, $method, $path)
            ?? route_alerts($app, $method, $path, $ip);
        if ($result === null) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
        [$status, $body] = $result;
        if ($status === 'stream') return;
        if ($status === 'html') {
            header('Content-Type: text/html; charset=utf-8');
            header('Cache-Control: no-store');
            echo $body;
            return;
        }
        send_json($status, $body);
    } catch (HttpError $e) {
        send_json($e->status, ['code' => $e->codeName, 'message' => $e->getMessage()]);
    } catch (Throwable $e) {
        // Log the kind of failure only — never request bodies, passwords or tokens.
        app_log("$method $path failed: " . get_class($e) . ' ' . $e->getCode());
        send_json(500, ['code' => 'SERVER_ERROR', 'message' => 'Server error.']);
    }
}

vishwas_run();
