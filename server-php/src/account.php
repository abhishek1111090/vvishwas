<?php
// account.php — registration, login, sessions, profile, password reset.
//
// Passwords: password_hash() with Argon2id (bcrypt only if this PHP build
// lacks Argon2). Sessions: 32 random bytes given to the app once; only the
// SHA-256 is stored. Login/register/reset are rate-limited per IP and email.
declare(strict_types=1);

const EMAIL_RE = '/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/';

function pw_hash(string $password): string
{
    return defined('PASSWORD_ARGON2ID')
        ? password_hash($password, PASSWORD_ARGON2ID)
        : password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
}

function public_user(array $u): array
{
    return ['id' => $u['id'], 'fullName' => $u['full_name'], 'email' => $u['email'], 'authProvider' => 'server', 'createdAt' => iso($u['created_at'])];
}

function start_session(App $app, string $userId): array
{
    $t = token();
    $expires = now_iso(time() + (int) ($app->cfg['session_days'] ?? 30) * 86400);
    $app->q('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [token_hash($t), $userId, now_iso(), $expires]);
    return ['token' => $t, 'expiresAt' => $expires];
}

/** The signed-in user (with token_hash), or a 401. */
function require_user(App $app): array
{
    if (!preg_match('/^Bearer\s+([A-Za-z0-9_-]{20,200})$/', header_value('Authorization'), $m)) {
        throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in required.');
    }
    $row = $app->one(
        'SELECT u.*, s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
        [token_hash($m[1]), now_iso()]
    );
    if (!$row) throw new HttpError(401, 'SESSION_EXPIRED', 'Your session has expired. Sign in again.');
    return $row;
}

function route_account(App $app, string $method, string $path, string $ip): ?array
{
    if ($method === 'POST' && $path === '/auth/register') {
        if ($app->rateLimited("reg:$ip", 10, 900)) throw new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
        $b = read_json();
        $name = str_in($b['fullName'] ?? null, 80);
        $email = mb_strtolower(str_in($b['email'] ?? null, 254));
        $pw = is_string($b['password'] ?? null) ? $b['password'] : '';
        if ($name === '') throw new HttpError(400, 'INVALID_NAME', 'Please enter your name.');
        if (!preg_match(EMAIL_RE, $email)) throw new HttpError(400, 'INVALID_EMAIL', 'Please enter a valid email address.');
        if (strlen($pw) < 8 || strlen($pw) > 128) throw new HttpError(400, 'WEAK_PASSWORD', 'Password must be 8–128 characters.');
        if ($app->one('SELECT id FROM users WHERE email = ?', [$email])) throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
        $user = ['id' => uuid4(), 'email' => $email, 'full_name' => $name, 'created_at' => now_iso()];
        try {
            $app->q('INSERT INTO users (id, email, full_name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [$user['id'], $email, $name, pw_hash($pw), $user['created_at'], $user['created_at']]);
        } catch (PDOException $e) {
            if ($app->isConflict($e)) throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
            throw $e;
        }
        return [201, ['user' => public_user($user)] + start_session($app, $user['id'])];
    }

    if ($method === 'POST' && $path === '/auth/login') {
        $b = read_json();
        $email = mb_strtolower(str_in($b['email'] ?? null, 254));
        if ($app->rateLimited("login:$ip", 10, 900) || $app->rateLimited("login:$email", 10, 900)) {
            throw new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
        }
        $pw = is_string($b['password'] ?? null) ? $b['password'] : '';
        $user = preg_match(EMAIL_RE, $email) ? $app->one('SELECT * FROM users WHERE email = ?', [$email]) : null;
        // Unknown email: still spend the time of a real hash, so timing doesn't reveal accounts.
        $ok = $user ? password_verify($pw, $user['password_hash']) : (pw_hash($pw) === '');
        if (!$user || !$ok) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
        if (password_needs_rehash($user['password_hash'], defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT)) {
            $app->q('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [pw_hash($pw), now_iso(), $user['id']]);
        }
        return [200, ['user' => public_user($user)] + start_session($app, $user['id'])];
    }

    if ($method === 'POST' && $path === '/auth/logout') {
        $user = require_user($app);
        $app->q('DELETE FROM sessions WHERE token_hash = ?', [$user['token_hash']]);
        return [204, null];
    }

    if ($path === '/auth/me' && $method === 'GET') {
        return [200, ['user' => public_user(require_user($app))]];
    }

    if ($path === '/auth/me' && $method === 'PATCH') {
        $user = require_user($app);
        $name = str_in(read_json()['fullName'] ?? null, 80);
        if ($name === '') throw new HttpError(400, 'INVALID_NAME', 'Please enter your name.');
        $app->q('UPDATE users SET full_name = ?, updated_at = ? WHERE id = ?', [$name, now_iso(), $user['id']]);
        return [200, ['user' => public_user(['full_name' => $name] + $user)]];
    }

    if ($method === 'POST' && $path === '/auth/forgot-password') {
        $email = mb_strtolower(str_in(read_json()['email'] ?? null, 254));
        if (!preg_match(EMAIL_RE, $email)) throw new HttpError(400, 'INVALID_EMAIL', 'Please enter a valid email address.');
        if (empty($app->cfg['mail_enabled'])) throw new HttpError(503, 'RESET_NOT_CONFIGURED', 'Password reset email is not set up on the server yet.');
        if ($app->rateLimited("reset:$ip", 5, 3600) || $app->rateLimited("reset:$email", 5, 3600)) {
            throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Try again later.');
        }
        $user = $app->one('SELECT id, email FROM users WHERE email = ?', [$email]);
        if ($user) {
            $t = token();
            $app->q('INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [token_hash($t), $user['id'], now_iso(), now_iso(time() + 1800)]);
            $link = rtrim((string) $app->cfg['public_url'], '/') . '/auth/reset?token=' . $t;
            $sent = send_mail($app, $user['email'], 'Reset your VISHWAS password',
                "Someone asked to reset the password for your VISHWAS account.\n\nOpen this link within 30 minutes to choose a new password:\n$link\n\nIf this wasn't you, ignore this email — your password stays the same.");
            if (!$sent) app_log('reset email could not be handed to the mail system');
        }
        return [202, ['ok' => true]]; // same answer whether or not the account exists
    }

    if ($method === 'GET' && $path === '/auth/reset') {
        $safe = preg_replace('/[^A-Za-z0-9_-]/', '', (string) ($_GET['token'] ?? ''));
        $action = htmlspecialchars(rtrim((string) $app->cfg['public_url'], '/') . '/auth/reset-password', ENT_QUOTES);
        return ['html', '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reset VISHWAS password</title>'
            . '<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:40px auto;padding:0 16px}input,button{width:100%;padding:12px;margin:6px 0;font-size:16px;box-sizing:border-box}button{background:#0B0B0B;color:#fff;border:0;border-radius:999px}</style></head>'
            . '<body><h2>Choose a new password</h2><form method="post" action="' . $action . '"><input type="hidden" name="token" value="' . $safe . '">'
            . '<input type="password" name="password" minlength="8" maxlength="128" placeholder="New password (8+ characters)" required autocomplete="new-password"><button type="submit">Save password</button></form></body></html>'];
    }

    if ($method === 'POST' && $path === '/auth/reset-password') {
        $form = str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'application/x-www-form-urlencoded');
        $b = read_json();
        $pw = is_string($b['password'] ?? null) ? $b['password'] : '';
        if (strlen($pw) < 8 || strlen($pw) > 128) throw new HttpError(400, 'WEAK_PASSWORD', 'Password must be 8–128 characters.');
        $hash = pw_hash($pw);
        $app->tx(function () use ($app, $b, $hash) {
            $row = $app->one('SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?', [token_hash(str_in($b['token'] ?? null, 200)), now_iso()]);
            if (!$row) throw new HttpError(400, 'BAD_TOKEN', 'This reset link is invalid or has expired.');
            $app->q('UPDATE password_resets SET used_at = ? WHERE token_hash = ?', [now_iso(), $row['token_hash']]);
            $app->q('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [$hash, now_iso(), $row['user_id']]);
            $app->q('DELETE FROM sessions WHERE user_id = ?', [$row['user_id']]); // signed out everywhere
        });
        return $form
            ? ['html', '<!doctype html><meta charset="utf-8"><p style="font-family:system-ui;margin:40px">Password changed. Open VISHWAS and sign in with your new password.</p>']
            : [204, null];
    }

    return null;
}

/** Hand an email to the server's mail system (Plesk: sendmail via PHP mail()). */
function send_mail(App $app, string $to, string $subject, string $text): bool
{
    if (isset($app->cfg['mailer']) && is_callable($app->cfg['mailer'])) return (bool) ($app->cfg['mailer'])($to, $subject, $text);
    $from = (string) ($app->cfg['mail_from'] ?? 'VISHWAS <no-reply@localhost>');
    $headers = "From: $from\r\nContent-Type: text/plain; charset=utf-8\r\n";
    return mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $text, $headers);
}
