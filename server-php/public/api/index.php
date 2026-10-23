<?php
// VISHWAS API front controller — the only PHP file inside httpdocs.
// The application code lives outside the website folder (vishwas-app) and
// the settings in vishwas-private; neither is reachable from the web.
$appDir = getenv('VISHWAS_APP_DIR') ?: dirname($_SERVER['DOCUMENT_ROOT']) . '/vishwas-app/server-php';
require $appDir . '/src/main.php';
