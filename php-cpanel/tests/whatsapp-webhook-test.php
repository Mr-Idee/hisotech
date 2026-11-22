<?php
declare(strict_types=1);

require_once __DIR__ . '/../hiso_private/vendor/autoload.php';
require_once __DIR__ . '/../hiso_private/auth.php';

$body = '{"object":"whatsapp_business_account","entry":[]}';
$secret = 'test-meta-app-secret';
$validSignature = 'sha256=' . hash_hmac('sha256', $body, $secret);

if (!hiso_whatsapp_webhook_signature_is_valid($body, $validSignature, $secret)) {
    throw new RuntimeException('A valid Meta webhook signature must be accepted.');
}
if (hiso_whatsapp_webhook_signature_is_valid($body . ' ', $validSignature, $secret)) {
    throw new RuntimeException('A signature for a different raw request body must be rejected.');
}
if (hiso_whatsapp_webhook_signature_is_valid($body, $validSignature, 'wrong-secret')) {
    throw new RuntimeException('A signature made with a different app secret must be rejected.');
}
if (hiso_whatsapp_webhook_signature_is_valid($body, 'sha256=invalid', $secret)) {
    throw new RuntimeException('A malformed webhook signature must be rejected.');
}
if (hiso_whatsapp_webhook_signature_is_valid($body, $validSignature, '')) {
    throw new RuntimeException('Webhook verification must fail when the app secret is missing.');
}

echo "WhatsApp webhook signature tests passed.\n";
