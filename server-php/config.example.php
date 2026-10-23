<?php
// VISHWAS server settings. Copy to:
//   /var/www/vhosts/adabhishek1.in/vishwas-private/config.php
// (outside httpdocs — never inside the website folder, never in Git).
// Placeholders only below; fill in the real values on the server.
return [
    // Same value as EXPO_PUBLIC_VISHWAS_API_KEY in the app (gates SMS/WhatsApp alerts).
    'app_key' => 'CHANGE_ME_long_random_string',

    // Your Plesk PostgreSQL database (Databases → Connection info).
    'database' => [
        'dsn' => 'pgsql:host=localhost;port=5432;dbname=DATABASE_NAME',
        'user' => 'vvishwas',
        'password' => 'DATABASE_PASSWORD',
    ],

    // Private folders (created automatically if missing).
    'private_dir' => '/var/www/vhosts/adabhishek1.in/vishwas-private',
    'storage_dir' => '/var/www/vhosts/adabhishek1.in/vishwas-private/recordings',
    'max_upload_mb' => 200,      // also raise PHP post_max_size in Plesk (see DEPLOY.md)
    'session_days' => 30,

    // Public HTTPS address of this API (reset links, Twilio callbacks, WhatsApp clip links).
    'public_url' => 'https://adabhishek1.in/api',
    'trust_proxy' => true,       // Plesk's nginx sits in front of Apache

    // Password-reset emails via the server's mail system (PHP mail()).
    'mail_enabled' => false,
    'mail_from' => 'VISHWAS <no-reply@adabhishek1.in>',

    // Optional: SMS / WhatsApp alerts through Twilio.
    'twilio' => [
        'account_sid' => '',
        'auth_token' => '',
        'from' => '',                     // Twilio SMS number, e.g. +15551234567
        'messaging_service_sid' => '',
        'whatsapp_from' => '',            // e.g. whatsapp:+14155238886 (sandbox)
    ],
    'default_country_code' => '91',
];
