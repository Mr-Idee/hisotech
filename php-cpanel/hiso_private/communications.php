<?php
declare(strict_types=1);

function hiso_marketing_contacts(string $channel): array {
    if (!in_array($channel, ['email', 'whatsapp'], true)) {
        throw new InvalidArgumentException('Unsupported marketing channel.');
    }
    $column = $channel === 'email' ? 'email' : 'phone';
    $stmt = hiso_pdo()->prepare(
        'SELECT c.id, c.name, c.email, c.phone FROM customer_profiles c ' .
        'JOIN communications_consents x ON x.customer_id = c.id ' .
        'WHERE x.channel = ? AND x.consented_at IS NOT NULL AND x.revoked_at IS NULL ' .
        'AND c.email_verified_at IS NOT NULL AND c.' . $column . ' <> "" ORDER BY c.name'
    );
    $stmt->execute([$channel]);
    $contacts = $stmt->fetchAll(PDO::FETCH_ASSOC);
    if ($channel === 'email') {
        return array_values(array_filter($contacts, fn($contact) => filter_var($contact['email'] ?? '', FILTER_VALIDATE_EMAIL) !== false));
    }
    return $contacts;
}

function hiso_whatsapp_send(string $phone, string $message): void {
    global $CONFIG;
    $phone = trim($phone);
    if (!preg_match('/^\+[1-9][0-9]{7,14}$/', $phone)) {
        throw new InvalidArgumentException('Customer phone number is not valid E.164 format.');
    }
    $characterCount = preg_match_all('/./us', $message);
    if (trim($message) === '' || $characterCount === false || $characterCount > 4096 || strlen($message) > 16384) {
        throw new InvalidArgumentException('Message is required and must be no more than 4096 characters.');
    }
    $phoneId = trim((string)($CONFIG['WHATSAPP_PHONE_NUMBER_ID'] ?? ''));
    $token = (string)($CONFIG['WHATSAPP_ACCESS_TOKEN'] ?? '');
    $version = trim((string)($CONFIG['WHATSAPP_API_VERSION'] ?? 'v21.0'));
    if ($phoneId === '' || $token === '' || !preg_match('/^v[0-9]{2}\.[0-9]+$/', $version)) {
        throw new RuntimeException('WhatsApp Cloud API is not configured on the private server.');
    }
    if (!function_exists('curl_init')) {
        throw new RuntimeException('PHP cURL extension is required for WhatsApp delivery.');
    }
    $url = 'https://graph.facebook.com/' . $version . '/' . rawurlencode($phoneId) . '/messages';
    $payload = json_encode([
        'messaging_product' => 'whatsapp',
        'recipient_type' => 'individual',
        'to' => substr($phone, 1),
        'type' => 'text',
        'text' => ['preview_url' => false, 'body' => trim($message)],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token, 'Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $response = curl_exec($curl);
    $status = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
    unset($curl);
    if ($response === false || $status < 200 || $status >= 300) {
        throw new RuntimeException('WhatsApp provider delivery failed (HTTP ' . $status . ').');
    }
}

function hiso_newsletter_send(string $subject, string $message, array $attachments): int {
    global $CONFIG;
    $messageLength = preg_match_all('/./us', $message);
    if (trim($subject) === '' || strlen($subject) > 180 || preg_match('/[\r\n]/', $subject)
        || trim($message) === '' || $messageLength === false || $messageLength > 10000 || strlen($message) > 40000) {
        throw new InvalidArgumentException('Newsletter subject or message is invalid.');
    }
    if (count($attachments) > 3) {
        throw new InvalidArgumentException('A newsletter may include at most three attachments.');
    }
    $recipients = hiso_marketing_contacts('email');
    if (!$recipients) {
        throw new InvalidArgumentException('No verified customers have active email marketing consent.');
    }
    $total = 0;
    $validated = [];
    foreach ($attachments as $attachment) {
        if (!is_array($attachment)) {
            throw new InvalidArgumentException('Attachment data is invalid.');
        }
        $name = $attachment['name'] ?? null;
        $mime = $attachment['mimeType'] ?? null;
        $encoded = $attachment['data'] ?? null;
        $size = filter_var($attachment['size'] ?? null, FILTER_VALIDATE_INT);
        if (!is_string($name) || !is_string($mime) || !is_string($encoded)
            || $name === '' || strlen($name) > 160 || preg_match('/[\/\\\\\r\n]/', $name)
            || $size === false || $size < 1 || $size > 2 * 1024 * 1024
            || !preg_match('/^[A-Za-z0-9+\/]*={0,2}$/', $encoded)) {
            throw new InvalidArgumentException('Attachment filename, encoding, or size is invalid.');
        }
        $bytes = base64_decode($encoded, true);
        if ($bytes === false || strlen($bytes) !== $size) {
            throw new InvalidArgumentException('Attachment data is invalid.');
        }
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $detectedMime = $finfo->buffer($bytes);
        if (!in_array($mime, ['image/jpeg', 'image/png', 'application/pdf'], true) || $detectedMime !== $mime) {
            throw new InvalidArgumentException('WhatsApp supports validated JPEG or PNG images and PDF attachments.');
        }
        $allowedExtensions = [
            'image/jpeg' => ['jpg', 'jpeg'],
            'image/png' => ['png'],
            'application/pdf' => ['pdf'],
        ];
        if (!in_array(strtolower(pathinfo($name, PATHINFO_EXTENSION)), $allowedExtensions[$mime], true)) {
            throw new InvalidArgumentException('Attachment filename extension does not match its file type.');
        }
        $total += $size;
        if ($total > 4 * 1024 * 1024) {
            throw new InvalidArgumentException('Combined newsletter attachments may not exceed 4MB.');
        }
        $validated[] = [$bytes, $name, $mime];
    }
    $from = trim((string)($CONFIG['MAIL_FROM'] ?? ''));
    $host = trim((string)($CONFIG['MAIL_HOST'] ?? ''));
    $username = trim((string)($CONFIG['MAIL_USERNAME'] ?? ''));
    $password = (string)($CONFIG['MAIL_PASSWORD'] ?? '');
    $port = filter_var($CONFIG['MAIL_PORT'] ?? null, FILTER_VALIDATE_INT);
    $encryption = strtolower((string)($CONFIG['MAIL_ENCRYPTION'] ?? 'ssl'));
    if (!filter_var($from, FILTER_VALIDATE_EMAIL) || $host === '' || $username === '' || $password === ''
        || $port === false || $port < 1 || $port > 65535 || !in_array($encryption, ['ssl', 'tls'], true)) {
        throw new RuntimeException('Newsletter SMTP is not configured on the private server.');
    }
    if (!class_exists(\PHPMailer\PHPMailer\PHPMailer::class)) {
        throw new RuntimeException('Newsletter SMTP dependency is unavailable.');
    }
    foreach (array_chunk($recipients, 40) as $batch) {
        $mailer = new \PHPMailer\PHPMailer\PHPMailer(true);
        $mailer->isSMTP();
        $mailer->Host = $host;
        $mailer->Port = $port;
        $mailer->SMTPAuth = true;
        $mailer->Username = $username;
        $mailer->Password = $password;
        $mailer->SMTPSecure = $encryption === 'ssl'
            ? \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_SMTPS
            : \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
        $mailer->CharSet = 'UTF-8';
        $mailer->setFrom($from, (string)($CONFIG['MAIL_FROM_NAME'] ?? 'HI-SOTECH'));
        $mailer->addAddress($from);
        foreach ($batch as $recipient) {
            $mailer->addBCC((string)$recipient['email'], (string)$recipient['name']);
        }
        $mailer->Subject = trim($subject);
        $mailer->Body = trim($message);
        $mailer->AltBody = trim($message);
        foreach ($validated as [$bytes, $name, $mime]) {
            $mailer->addStringAttachment($bytes, $name, 'base64', $mime);
        }
        $mailer->send();
    }
    return count($recipients);
}

function hiso_b64url_decode(string $value): string|false {
    $padding = (4 - strlen($value) % 4) % 4;
    return base64_decode(strtr($value, '-_', '+/') . str_repeat('=', $padding), true);
}

function hiso_save_whatsapp_recipient_consent(
    string $recipientType,
    string $recipientId,
    string $purpose,
    string $phone,
    bool $enabled,
    string $source
): void {
    if (!in_array($recipientType, ['customer', 'staff', 'enquiry'], true)
        || !in_array($purpose, ['operational', 'marketing'], true)) {
        throw new InvalidArgumentException('WhatsApp consent scope is invalid.');
    }
    $pdo = hiso_pdo();
    $stmt = $pdo->prepare(
        'SELECT consented_at, revoked_at, phone_at_consent FROM whatsapp_recipient_consents WHERE recipient_type = ? AND recipient_id = ? AND purpose = ? LIMIT 1'
    );
    $stmt->execute([$recipientType, $recipientId, $purpose]);
    $existing = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$enabled) {
        if ($existing && $existing['revoked_at'] === null) {
            $pdo->prepare(
                'UPDATE whatsapp_recipient_consents SET revoked_at = UTC_TIMESTAMP() WHERE recipient_type = ? AND recipient_id = ? AND purpose = ?'
            )->execute([$recipientType, $recipientId, $purpose]);
        }
        return;
    }
    if (!preg_match('/^\+[1-9][0-9]{7,14}$/', $phone)) {
        throw new InvalidArgumentException('WhatsApp consent requires a valid E.164 phone number.');
    }
    $pdo->prepare(
        'INSERT INTO whatsapp_recipient_consents (recipient_type, recipient_id, purpose, phone_at_consent, consented_at, revoked_at, consent_source) ' .
        'VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), NULL, ?) ON DUPLICATE KEY UPDATE ' .
        'consented_at = IF(revoked_at IS NOT NULL OR phone_at_consent <> VALUES(phone_at_consent), VALUES(consented_at), consented_at), ' .
        'phone_at_consent = VALUES(phone_at_consent), revoked_at = NULL, consent_source = VALUES(consent_source)'
    )->execute([$recipientType, $recipientId, $purpose, $phone, $source]);
}

function hiso_whatsapp_consent_contacts(string $purpose): array {
    if (!in_array($purpose, ['operational', 'marketing'], true)) {
        throw new InvalidArgumentException('WhatsApp consent scope is invalid.');
    }
    if ($purpose === 'marketing') {
        $sql =
            'SELECT c.id, c.name, c.email, c.phone, "customer" AS recipient_type FROM customer_profiles c ' .
            'JOIN communications_consents x ON x.customer_id = c.id WHERE x.channel = "whatsapp" ' .
            'AND x.consented_at IS NOT NULL AND x.revoked_at IS NULL AND c.email_verified_at IS NOT NULL AND c.phone <> "" ' .
            'UNION ALL SELECT u.id, u.name, u.email, u.phone, "staff" AS recipient_type FROM users u ' .
            'JOIN whatsapp_recipient_consents x ON x.recipient_type = "staff" AND x.recipient_id = u.id ' .
            'AND x.purpose = "marketing" AND x.revoked_at IS NULL AND x.phone_at_consent = u.phone WHERE u.status = "Active" AND u.phone <> "" ' .
            'UNION ALL SELECT e.id, e.customer_name AS name, e.email, e.phone, "enquiry" AS recipient_type FROM enquiries e ' .
            'JOIN whatsapp_recipient_consents x ON x.recipient_type = "enquiry" AND x.recipient_id = e.id ' .
            'AND x.purpose = "marketing" AND x.revoked_at IS NULL AND x.phone_at_consent = e.phone WHERE e.phone <> "" ORDER BY name';
    } else {
        $sql =
            'SELECT x.recipient_id AS id, u.name, u.email, u.phone, x.recipient_type FROM whatsapp_recipient_consents x ' .
            'JOIN users u ON x.recipient_type = "staff" AND x.recipient_id = u.id WHERE x.purpose = "operational" ' .
            'AND x.revoked_at IS NULL AND x.phone_at_consent = u.phone AND u.status = "Active" ' .
            'UNION ALL SELECT x.recipient_id AS id, e.customer_name AS name, e.email, e.phone, x.recipient_type FROM whatsapp_recipient_consents x ' .
            'JOIN enquiries e ON x.recipient_type = "enquiry" AND x.recipient_id = e.id WHERE x.purpose = "operational" ' .
            'AND x.revoked_at IS NULL AND x.phone_at_consent = e.phone ' .
            'UNION ALL SELECT x.recipient_id AS id, c.name, c.email, c.phone, x.recipient_type FROM whatsapp_recipient_consents x ' .
            'JOIN customer_profiles c ON x.recipient_type = "customer" AND x.recipient_id = c.id WHERE x.purpose = "operational" ' .
            'AND x.revoked_at IS NULL AND x.phone_at_consent = c.phone AND c.email_verified_at IS NOT NULL ORDER BY name';
    }
    $contacts = hiso_pdo()->query($sql)->fetchAll(PDO::FETCH_ASSOC);
    return array_values(array_filter($contacts, fn($contact) =>
        preg_match('/^\+[1-9][0-9]{7,14}$/', (string)($contact['phone'] ?? '')) === 1
    ));
}

function hiso_whatsapp_consent_contact(string $recipientType, string $recipientId, string $purpose): ?array {
    if (!in_array($recipientType, ['customer', 'staff', 'enquiry'], true)
        || !in_array($purpose, ['operational', 'marketing'], true)) {
        return null;
    }
    if ($purpose === 'marketing' && $recipientType === 'customer') {
        $sql = 'SELECT c.id, c.name, c.email, c.phone, "customer" AS recipient_type FROM customer_profiles c ' .
            'JOIN communications_consents x ON x.customer_id = c.id AND x.channel = "whatsapp" ' .
            'WHERE c.id = ? AND c.email_verified_at IS NOT NULL AND c.phone <> "" ' .
            'AND x.consented_at IS NOT NULL AND x.revoked_at IS NULL LIMIT 1';
    } elseif ($purpose === 'marketing' && $recipientType === 'staff') {
        $sql = 'SELECT u.id, u.name, u.email, u.phone, "staff" AS recipient_type FROM users u ' .
            'JOIN whatsapp_recipient_consents x ON x.recipient_type = "staff" AND x.recipient_id = u.id ' .
            'WHERE u.id = ? AND u.status = "Active" AND u.phone <> "" AND x.purpose = "marketing" ' .
            'AND x.revoked_at IS NULL AND x.phone_at_consent = u.phone LIMIT 1';
    } elseif ($purpose === 'marketing') {
        $sql = 'SELECT e.id, e.customer_name AS name, e.email, e.phone, "enquiry" AS recipient_type FROM enquiries e ' .
            'JOIN whatsapp_recipient_consents x ON x.recipient_type = "enquiry" AND x.recipient_id = e.id ' .
            'WHERE e.id = ? AND e.phone <> "" AND x.purpose = "marketing" ' .
            'AND x.revoked_at IS NULL AND x.phone_at_consent = e.phone LIMIT 1';
    } elseif ($recipientType === 'customer') {
        $sql = 'SELECT c.id, c.name, c.email, c.phone, "customer" AS recipient_type FROM customer_profiles c ' .
            'JOIN whatsapp_recipient_consents x ON x.recipient_type = "customer" AND x.recipient_id = c.id ' .
            'WHERE c.id = ? AND c.email_verified_at IS NOT NULL AND c.phone <> "" AND x.purpose = "operational" ' .
            'AND x.revoked_at IS NULL AND x.phone_at_consent = c.phone LIMIT 1';
    } elseif ($recipientType === 'staff') {
        $sql = 'SELECT u.id, u.name, u.email, u.phone, "staff" AS recipient_type FROM users u ' .
            'JOIN whatsapp_recipient_consents x ON x.recipient_type = "staff" AND x.recipient_id = u.id ' .
            'WHERE u.id = ? AND u.status = "Active" AND u.phone <> "" AND x.purpose = "operational" ' .
            'AND x.revoked_at IS NULL AND x.phone_at_consent = u.phone LIMIT 1';
    } else {
        $sql = 'SELECT e.id, e.customer_name AS name, e.email, e.phone, "enquiry" AS recipient_type FROM enquiries e ' .
            'JOIN whatsapp_recipient_consents x ON x.recipient_type = "enquiry" AND x.recipient_id = e.id ' .
            'WHERE e.id = ? AND e.phone <> "" AND x.purpose = "operational" ' .
            'AND x.revoked_at IS NULL AND x.phone_at_consent = e.phone LIMIT 1';
    }
    $stmt = hiso_pdo()->prepare($sql);
    $stmt->execute([$recipientId]);
    $contact = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$contact || !preg_match('/^\+[1-9][0-9]{7,14}$/', (string)$contact['phone'])) {
        return null;
    }
    return $contact;
}

function hiso_communications_log(string $eventKey, string $recipientType, string $recipientId, string $channel, string $status, ?string $errorCode = null): void {
    hiso_pdo()->prepare(
        'INSERT INTO communications_delivery_events (id, event_key, recipient_type, recipient_id, channel, status, error_code) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )->execute([hiso_uuid(), $eventKey, $recipientType, $recipientId, $channel, $status, $errorCode]);
}

function hiso_require_communications_rate_limit(array $user, string $action, int $limit): void {
    if (!hiso_customer_auth_rate_limit('communications:' . (string)$user['id'] . ':' . $action, $limit, 3600)) {
        hiso_json_response(['error' => 'Communications send limit reached. Try again later.'], 429);
    }
}

function hiso_whatsapp_template_config(string $templateKey, ?string $mediaMime = null): array {
    global $CONFIG;
    $phoneId = trim((string)($CONFIG['WHATSAPP_PHONE_NUMBER_ID'] ?? ''));
    $token = (string)($CONFIG['WHATSAPP_ACCESS_TOKEN'] ?? '');
    $version = trim((string)($CONFIG['WHATSAPP_API_VERSION'] ?? 'v21.0'));
    $subject = trim((string)($CONFIG['WHATSAPP_TEMPLATES_JSON'] ?? '{}'));
    $templates = json_decode($subject, true);
    $template = is_array($templates) ? ($templates[$templateKey] ?? null) : null;
    if ($phoneId === '' || $token === '' || !preg_match('/^v[0-9]{2}\.[0-9]+$/', $version)
        || !is_array($template)) {
        throw new RuntimeException('WhatsApp credentials and approved "' . $templateKey . '" template are not configured on the private server.');
    }
    $name = trim((string)($template['name'] ?? ''));
    $language = trim((string)($template['language'] ?? ''));
    $format = $template['headerFormat'] ?? null;
    if (!preg_match('/^[a-z0-9_]{1,512}$/', $name) || !preg_match('/^[a-z]{2,3}(?:_[A-Z]{2})?$/', $language)
        || ($format !== null && !in_array($format, ['IMAGE', 'DOCUMENT'], true))) {
        throw new RuntimeException('Private "' . $templateKey . '" WhatsApp template configuration is invalid.');
    }
    if (($mediaMime === null && $format !== null)
        || ($mediaMime !== null && $format !== ($mediaMime === 'application/pdf' ? 'DOCUMENT' : 'IMAGE'))) {
        throw new RuntimeException('Configured approved template header does not match the selected image or PDF media.');
    }
    return ['phoneId' => $phoneId, 'token' => $token, 'version' => $version, 'name' => $name, 'language' => $language, 'headerFormat' => $format];
}

function hiso_validate_whatsapp_media(array $attachment): array {
    $name = $attachment['name'] ?? null;
    $mime = $attachment['mimeType'] ?? null;
    $encoded = $attachment['data'] ?? null;
    $size = filter_var($attachment['size'] ?? null, FILTER_VALIDATE_INT);
    if (!is_string($name) || !is_string($mime) || !is_string($encoded)
        || $name === '' || strlen($name) > 160 || preg_match('/[\/\\\\\r\n]/', $name)
        || $size === false || $size < 1 || $size > 2 * 1024 * 1024
        || !preg_match('/^[A-Za-z0-9+\/]*={0,2}$/', $encoded)) {
        throw new InvalidArgumentException('WhatsApp media filename, encoding, or size is invalid.');
    }
    $bytes = base64_decode($encoded, true);
    if ($bytes === false || strlen($bytes) !== $size) {
        throw new InvalidArgumentException('WhatsApp media data is invalid.');
    }
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $detectedMime = $finfo->buffer($bytes);
    $extensions = [
        'image/jpeg' => ['jpg', 'jpeg'],
        'image/png' => ['png'],
        'image/webp' => ['webp'],
        'application/pdf' => ['pdf'],
    ];
    if (!isset($extensions[$mime]) || $detectedMime !== $mime
        || !in_array(strtolower(pathinfo($name, PATHINFO_EXTENSION)), $extensions[$mime], true)) {
        throw new InvalidArgumentException('Only validated JPEG, PNG, WebP image and PDF attachments are accepted.');
    }
    return ['bytes' => $bytes, 'name' => $name, 'mime' => $mime];
}

function hiso_whatsapp_upload_media(array $config, array $media): string {
    if (!function_exists('curl_init') || !class_exists(CURLStringFile::class)) {
        throw new RuntimeException('PHP cURL with CURLStringFile is required for WhatsApp media upload.');
    }
    $curl = curl_init('https://graph.facebook.com/' . $config['version'] . '/' . rawurlencode($config['phoneId']) . '/media');
    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => [
            'messaging_product' => 'whatsapp',
            'type' => $media['mime'],
            'file' => new CURLStringFile($media['bytes'], $media['name'], $media['mime']),
        ],
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $config['token']],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $response = curl_exec($curl);
    $status = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
    unset($curl);
    $body = is_string($response) ? json_decode($response, true) : null;
    if ($response === false || $status < 200 || $status >= 300 || !is_array($body) || !is_string($body['id'] ?? null)) {
        throw new RuntimeException('WhatsApp media upload failed (HTTP ' . $status . ').');
    }
    return $body['id'];
}

function hiso_whatsapp_send_template(array $config, string $phone, string $message, ?string $mediaId = null, ?string $mediaMime = null): int {
    if (!preg_match('/^\+[1-9][0-9]{7,14}$/', $phone) || trim($message) === '' || strlen($message) > 4096) {
        throw new InvalidArgumentException('WhatsApp recipient or template body parameter is invalid.');
    }
    $components = [['type' => 'body', 'parameters' => [['type' => 'text', 'text' => $message]]]];
    if ($mediaId !== null && $mediaMime !== null) {
        $format = $mediaMime === 'application/pdf' ? 'document' : 'image';
        array_unshift($components, ['type' => 'header', 'parameters' => [['type' => $format, $format => ['id' => $mediaId]]]]);
    }
    $payload = json_encode([
        'messaging_product' => 'whatsapp',
        'recipient_type' => 'individual',
        'to' => substr($phone, 1),
        'type' => 'template',
        'template' => [
            'name' => $config['name'],
            'language' => ['code' => $config['language']],
            'components' => $components,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    $curl = curl_init('https://graph.facebook.com/' . $config['version'] . '/' . rawurlencode($config['phoneId']) . '/messages');
    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $config['token'], 'Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $response = curl_exec($curl);
    $status = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
    unset($curl);
    if ($response === false || $status < 200 || $status >= 300) {
        throw new RuntimeException('WhatsApp template delivery failed (HTTP ' . $status . ').');
    }
    return $status;
}

function hiso_send_lifecycle_whatsapp(
    string $eventKey,
    string $entityType,
    string $entityId,
    string $message
): void {
    $valid = ['new_enquiry', 'quote_status', 'invoice_status', 'ticket_status', 'installation_status'];
    if (!in_array($eventKey, $valid, true)) return;
    $pdo = hiso_pdo();
    $targets = [];
    if ($entityType === 'enquiry') {
        $stmt = $pdo->prepare('SELECT id, customer_name AS name, email, phone FROM enquiries WHERE id = ? LIMIT 1');
        $stmt->execute([$entityId]);
        $enquiry = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($enquiry) {
            $targets[] = $enquiry + ['recipient_type' => 'enquiry'];
        }
        $staff = $pdo->query('SELECT id, name, email, phone FROM users WHERE status = "Active" ORDER BY name')
            ->fetchAll(PDO::FETCH_ASSOC);
        foreach ($staff as $member) {
            $targets[] = $member + ['recipient_type' => 'staff'];
        }
    } else {
        $enquiryId = null;
        $customerId = null;
        if ($entityType === 'quote') {
            $stmt = $pdo->prepare('SELECT enquiry_id FROM quotations WHERE id = ? OR quote_code = ? LIMIT 1');
            $stmt->execute([$entityId, $entityId]);
            $enquiryId = $stmt->fetchColumn() ?: null;
        } elseif ($entityType === 'invoice') {
            $stmt = $pdo->prepare('SELECT enquiry_id FROM invoices WHERE id = ? OR invoice_code = ? LIMIT 1');
            $stmt->execute([$entityId, $entityId]);
            $enquiryId = $stmt->fetchColumn() ?: null;
        } elseif ($entityType === 'installation') {
            $stmt = $pdo->prepare('SELECT enquiry_id FROM installations WHERE id = ? OR job_code = ? LIMIT 1');
            $stmt->execute([$entityId, $entityId]);
            $enquiryId = $stmt->fetchColumn() ?: null;
        } elseif ($entityType === 'ticket') {
            $stmt = $pdo->prepare('SELECT customer_id FROM service_tickets WHERE id = ? OR ticket_code = ? LIMIT 1');
            $stmt->execute([$entityId, $entityId]);
            $customerId = $stmt->fetchColumn() ?: null;
        }
        if ($enquiryId) {
            $stmt = $pdo->prepare('SELECT id, customer_name AS name, email, phone FROM enquiries WHERE id = ? LIMIT 1');
            $stmt->execute([$enquiryId]);
            $enquiry = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($enquiry) {
                $email = trim((string)$enquiry['email']);
                if ($email !== '') {
                    $stmt = $pdo->prepare('SELECT id, name, email, phone FROM customer_profiles WHERE LOWER(email) = LOWER(?) AND email_verified_at IS NOT NULL LIMIT 1');
                    $stmt->execute([$email]);
                    $customer = $stmt->fetch(PDO::FETCH_ASSOC);
                    if ($customer) {
                        $targets[] = $customer + ['recipient_type' => 'customer'];
                    }
                }
                if (!$targets) {
                    $targets[] = $enquiry + ['recipient_type' => 'enquiry'];
                }
            }
        }
        if ($customerId) {
            $stmt = $pdo->prepare('SELECT id, name, email, phone FROM customer_profiles WHERE id = ? AND email_verified_at IS NOT NULL LIMIT 1');
            $stmt->execute([$customerId]);
            $customer = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($customer) {
                $targets[] = $customer + ['recipient_type' => 'customer'];
            }
        }
    }

    if (!$targets) {
        hiso_communications_log($eventKey, $entityType === 'ticket' ? 'customer' : 'enquiry', $entityId, 'whatsapp', 'skipped', 'recipient_not_found');
        return;
    }
    foreach ($targets as $target) {
        $recipientType = (string)$target['recipient_type'];
        $recipientId = (string)$target['id'];
        $email = trim((string)($target['email'] ?? ''));
        if (filter_var($email, FILTER_VALIDATE_EMAIL)) {
            global $CONFIG;
            $smtpConfigured = trim((string)($CONFIG['MAIL_HOST'] ?? '')) !== ''
                && trim((string)($CONFIG['MAIL_USERNAME'] ?? '')) !== ''
                && (string)($CONFIG['MAIL_PASSWORD'] ?? '') !== '';
            if (!$smtpConfigured) {
                hiso_communications_log($eventKey, $recipientType, $recipientId, 'email', 'not_configured', 'smtp_configuration_missing');
            } else {
                try {
                    hiso_send_mail($email, 'HI-SOTECH service update', $message);
                    hiso_communications_log($eventKey, $recipientType, $recipientId, 'email', 'sent');
                } catch (Throwable $error) {
                    hiso_communications_log($eventKey, $recipientType, $recipientId, 'email', 'failed', 'smtp_delivery_failed');
                }
            }
        } else {
            hiso_communications_log($eventKey, $recipientType, $recipientId, 'email', 'skipped', 'recipient_email_unavailable');
        }

        $whatsappTarget = hiso_whatsapp_consent_contact($recipientType, $recipientId, 'operational');
        $pushOwnerType = $recipientType;
        $pushOwnerId = $recipientId;
        if ($pushOwnerType === 'enquiry') {
            $stmt = $pdo->prepare('SELECT id FROM customer_profiles WHERE LOWER(email) = LOWER(?) AND email_verified_at IS NOT NULL LIMIT 1');
            $stmt->execute([$email]);
            $pushOwnerId = (string)($stmt->fetchColumn() ?: '');
            $pushOwnerType = $pushOwnerId !== '' ? 'customer' : '';
        }
        $pushRows = in_array($pushOwnerType, ['customer', 'staff'], true)
            ? $pdo->prepare('SELECT endpoint, endpoint_hash, p256dh, auth_key FROM push_subscriptions WHERE owner_type = ? AND owner_id = ?')
            : null;
        if ($pushRows) $pushRows->execute([$pushOwnerType, $pushOwnerId]);
        $subscriptions = $pushRows ? $pushRows->fetchAll(PDO::FETCH_ASSOC) : [];
        if (!$subscriptions) {
            hiso_communications_log($eventKey, $recipientType, $recipientId, 'push', 'skipped', 'no_active_subscription');
        } else {
            global $CONFIG;
            $vapidSubject = trim((string)($CONFIG['VAPID_SUBJECT'] ?? ''));
            $vapidPublic = trim((string)($CONFIG['VAPID_PUBLIC_KEY'] ?? ''));
            $vapidPrivate = trim((string)($CONFIG['VAPID_PRIVATE_KEY'] ?? ''));
            if ($vapidSubject === '' || $vapidPublic === '' || $vapidPrivate === '') {
                hiso_communications_log($eventKey, $recipientType, $recipientId, 'push', 'not_configured', 'vapid_configuration_missing');
            } else {
                try {
                    foreach ($subscriptions as $pushSubscription) {
                        hiso_push_send($pushSubscription, [
                            'title' => 'HI-SOTECH update',
                            'body' => mb_substr($message, 0, 500),
                            'url' => $pushOwnerType === 'customer' ? '/#customer' : '/#workspace',
                        ]);
                    }
                    hiso_communications_log($eventKey, $recipientType, $recipientId, 'push', 'sent');
                } catch (Throwable $error) {
                    hiso_communications_log($eventKey, $recipientType, $recipientId, 'push', 'failed', 'push_delivery_failed');
                }
            }
        }

        if (!$whatsappTarget) {
            hiso_communications_log($eventKey, $recipientType, $recipientId, 'whatsapp', 'skipped', 'no_active_operational_consent');
            continue;
        }
        try {
            $config = hiso_whatsapp_template_config($eventKey);
            hiso_whatsapp_send_template($config, (string)$whatsappTarget['phone'], mb_substr($message, 0, 1024));
            hiso_communications_log($eventKey, $recipientType, $recipientId, 'whatsapp', 'sent');
        } catch (Throwable $error) {
            $notConfigured = str_contains(strtolower($error->getMessage()), 'not configured')
                || str_contains(strtolower($error->getMessage()), 'configuration is invalid');
            hiso_communications_log(
                $eventKey,
                $recipientType,
                $recipientId,
                'whatsapp',
                $notConfigured ? 'not_configured' : 'failed',
                $notConfigured ? 'template_or_credentials_missing' : 'provider_delivery_failed'
            );
        }
    }
}

function hiso_push_subscription(array $subscription): \Minishlink\WebPush\Subscription {
    $endpoint = (string)($subscription['endpoint'] ?? '');
    $url = parse_url($endpoint);
    $host = strtolower((string)($url['host'] ?? ''));
    $allowedHost = $host === 'fcm.googleapis.com' || str_ends_with($host, '.push.services.mozilla.com')
        || str_ends_with($host, '.notify.windows.com') || $host === 'web.push.apple.com';
    if (($url['scheme'] ?? '') !== 'https' || !$allowedHost || !isset($url['scheme'], $url['host'])) {
        throw new InvalidArgumentException('Push endpoint is invalid.');
    }

    $publicKey = (string)($subscription['p256dh'] ?? '');
    $authKey = (string)($subscription['auth_key'] ?? '');
    $publicBytes = hiso_b64url_decode($publicKey);
    $authBytes = hiso_b64url_decode($authKey);
    if ($publicBytes === false || strlen($publicBytes) !== 65 || $publicBytes[0] !== "\x04"
        || $authBytes === false || strlen($authBytes) !== 16) {
        throw new InvalidArgumentException('Push subscription keys are invalid.');
    }
    return \Minishlink\WebPush\Subscription::create([
        'endpoint' => $endpoint,
        'publicKey' => $publicKey,
        'authToken' => $authKey,
        'contentEncoding' => 'aes128gcm',
    ]);
}

function hiso_push_send(array $subscription, array $payload): int {
    global $CONFIG;
    $endpoint = (string)($subscription['endpoint'] ?? '');
    $subject = trim((string)($CONFIG['VAPID_SUBJECT'] ?? ''));
    $publicKey = (string)($CONFIG['VAPID_PUBLIC_KEY'] ?? '');
    $privateKey = (string)($CONFIG['VAPID_PRIVATE_KEY'] ?? '');
    if ($publicKey === '' || $privateKey === ''
        || !preg_match('/^(mailto:[^@\s]+@[^@\s]+|https:\/\/[^\/\s]+)$/', $subject)) {
        throw new RuntimeException('VAPID Web Push is not configured on the private server.');
    }

    try {
        $webPush = new \Minishlink\WebPush\WebPush(
            ['VAPID' => ['subject' => $subject, 'publicKey' => $publicKey, 'privateKey' => $privateKey]],
            ['TTL' => 60],
            15,
            ['allow_redirects' => false]
        );
        $report = $webPush->sendOneNotification(
            hiso_push_subscription($subscription),
            json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)
        );
    } catch (InvalidArgumentException $error) {
        throw $error;
    } catch (Throwable $error) {
        throw new RuntimeException('Web Push delivery could not be completed.');
    }

    $status = $report->getResponse()?->getStatusCode() ?? 0;
    if (!$report->isSuccess()) {
        if ($report->isSubscriptionExpired()) {
            hiso_pdo()->prepare('DELETE FROM push_subscriptions WHERE endpoint_hash = ?')
                ->execute([hash('sha256', $endpoint)]);
        }
        throw new RuntimeException('Web Push provider delivery failed (HTTP ' . $status . ').');
    }
    return $status;
}
