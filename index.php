<?php
declare(strict_types=1);

$index = __DIR__ . '/index.html';
if (!is_file($index)) {
    http_response_code(503);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'The production index is not deployed.';
    exit;
}

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache');
readfile($index);
