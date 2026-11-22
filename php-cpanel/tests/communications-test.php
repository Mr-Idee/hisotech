<?php
declare(strict_types=1);

require_once __DIR__ . '/../hiso_private/vendor/autoload.php';
require_once __DIR__ . '/../hiso_private/communications.php';

function assert_throws(callable $callback, string $message): void {
    try {
        $callback();
    } catch (Throwable $error) {
        return;
    }
    throw new RuntimeException($message);
}

$publicKey = rtrim(strtr(base64_encode("\x04" . str_repeat("\x01", 64)), '+/', '-_'), '=');
$authKey = rtrim(strtr(base64_encode(str_repeat("\x02", 16)), '+/', '-_'), '=');
$vapidPrivate = hiso_b64url_decode('tWI00yOJl9BKVV1S9mRzyqQRaBWnyUdTyXEM1Ir_QRU');
$vapidPublic = hiso_b64url_decode('BB8Y0EyeFwDVD4EytwwLVdfgLhutJ_xuXNXoXLA9IgGayP2KTOz93dGyTjRhKzHF_eKWsHHgMJ9FMq5AHDsLV8o');
if ($vapidPrivate === false || $vapidPublic === false
    || !hiso_vapid_key_pair_is_valid($vapidPrivate, $vapidPublic)) {
    throw new RuntimeException('A matching VAPID key pair must pass configuration validation.');
}
$otherVapidPrivate = hiso_b64url_decode('zHlgzMOprdidH2vZZmnHo-14B-nnwVcpYRtburfE4nc');
if ($otherVapidPrivate === false || hiso_vapid_key_pair_is_valid($otherVapidPrivate, $vapidPublic)) {
    throw new RuntimeException('A mismatched VAPID key pair must be rejected.');
}

$subscription = hiso_push_subscription([
    'endpoint' => 'https://fcm.googleapis.com/fcm/send/offline-test',
    'p256dh' => $publicKey,
    'auth_key' => $authKey,
]);
if ($subscription->getContentEncoding() !== 'aes128gcm'
    || $subscription->getPublicKey() !== $publicKey
    || $subscription->getAuthToken() !== $authKey) {
    throw new RuntimeException('Web Push subscription keys were not normalized for the maintained library.');
}

assert_throws(
    fn() => hiso_push_subscription([
        'endpoint' => 'https://attacker.example/push',
        'p256dh' => $publicKey,
        'auth_key' => $authKey,
    ]),
    'A non-allowlisted push endpoint must be rejected.'
);
assert_throws(
    fn() => hiso_push_subscription([
        'endpoint' => 'https://fcm.googleapis.com/fcm/send/offline-test',
        'p256dh' => 'invalid',
        'auth_key' => $authKey,
    ]),
    'Malformed push keys must be rejected.'
);

$GLOBALS['CONFIG'] = [];
assert_throws(
    fn() => hiso_push_send([
        'endpoint' => 'https://fcm.googleapis.com/fcm/send/offline-test',
        'p256dh' => $publicKey,
        'auth_key' => $authKey,
    ], ['title' => 'Offline test']),
    'Missing private VAPID configuration must fail before any provider request.'
);

echo "PHP communications tests passed (no provider requests made).\n";
