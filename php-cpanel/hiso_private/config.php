<?php
declare(strict_types=1);

$envFile = __DIR__ . '/.env.php';
if (!file_exists($envFile)) {
    $envFile = __DIR__ . '/config.example.php';
}
$CONFIG = require $envFile;

foreach (['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASS'] as $requiredKey) {
    if (!array_key_exists($requiredKey, $CONFIG)) {
        throw new RuntimeException('Database configuration is incomplete.');
    }
}

function hiso_pdo(): PDO {
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    global $CONFIG;
    $dsn = sprintf(
        'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
        $CONFIG['DB_HOST'],
        $CONFIG['DB_PORT'] ?? '3306',
        $CONFIG['DB_NAME']
    );
    $pdo = new PDO($dsn, $CONFIG['DB_USER'], $CONFIG['DB_PASS'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    return $pdo;
}

function hiso_storage_dir(string $sub = ''): string {
    $base = __DIR__ . '/storage';
    if ($sub !== '') {
        $base .= '/' . trim($sub, '/');
    }
    if (!is_dir($base)) {
        mkdir($base, 0750, true);
    }
    return $base;
}

function hiso_uuid(): string {
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

function hiso_json_response(mixed $payload, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function hiso_json_body(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) {
        return [];
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}
