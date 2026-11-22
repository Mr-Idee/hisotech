<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';

$mailerAutoload = __DIR__ . '/vendor/autoload.php';
if (is_file($mailerAutoload)) {
    require_once $mailerAutoload;
}

function hiso_start_session(): void {
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    global $CONFIG;
    session_name($CONFIG['SESSION_NAME'] ?? 'HISOTECH_SESSID');
    session_set_cookie_params([
        'lifetime' => 86400 * 7,
        'path' => '/',
        'httponly' => true,
        'secure' => (bool)($CONFIG['SESSION_SECURE'] ?? false)
            || (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
        'samesite' => 'Lax',
    ]);
    session_start();
}

function hiso_current_customer(): ?array {
    hiso_start_session();
    $customerId = $_SESSION['customer_id'] ?? null;
    if (!$customerId) {
        return null;
    }
    $stmt = hiso_pdo()->prepare(
        'SELECT id, name, email, phone, location, company, ref_code, created_at FROM customer_profiles WHERE id = ? AND email_verified_at IS NOT NULL LIMIT 1'
    );
    $stmt->execute([$customerId]);
    return $stmt->fetch() ?: null;
}

function hiso_require_customer(): array {
    $customer = hiso_current_customer();
    if (!$customer) {
        hiso_json_response(['error' => 'Verified customer sign-in required.'], 401);
    }
    return $customer;
}

function hiso_customer_consent_state(string $customerId): array {
    $stmt = hiso_pdo()->prepare(
        'SELECT channel, consented_at, revoked_at FROM communications_consents WHERE customer_id = ?'
    );
    $stmt->execute([$customerId]);
    $state = ['email' => false, 'whatsapp' => false];
    foreach ($stmt->fetchAll() as $row) {
        $state[(string)$row['channel']] = !empty($row['consented_at']) && empty($row['revoked_at']);
    }
    return $state;
}

function hiso_customer_whatsapp_updates_consent(string $customerId, string $phone): bool {
    $stmt = hiso_pdo()->prepare(
        'SELECT consented_at FROM whatsapp_recipient_consents WHERE recipient_type = "customer" AND recipient_id = ? ' .
        'AND purpose = "operational" AND revoked_at IS NULL AND phone_at_consent = ? LIMIT 1'
    );
    $stmt->execute([$customerId, $phone]);
    return (bool)$stmt->fetchColumn();
}

function hiso_customer_portal_data(array $customer): array {
    $pdo = hiso_pdo();
    $consents = hiso_customer_consent_state((string)$customer['id']);
    $equipmentStmt = $pdo->prepare('SELECT * FROM customer_equipment WHERE customer_id = ? ORDER BY created_at DESC');
    $equipmentStmt->execute([$customer['id']]);
    $ticketStmt = $pdo->prepare('SELECT * FROM service_tickets WHERE customer_id = ? ORDER BY created_at DESC');
    $ticketStmt->execute([$customer['id']]);
    return [
        'profile' => [
            'id' => $customer['id'],
            'name' => $customer['name'],
            'email' => $customer['email'],
            'phone' => $customer['phone'],
            'location' => $customer['location'],
            'company' => $customer['company'],
            'refCode' => $customer['ref_code'],
            'createdAt' => $customer['created_at'],
            'emailMarketingConsent' => $consents['email'],
            'whatsappMarketingConsent' => $consents['whatsapp'],
            'whatsappUpdatesConsent' => hiso_customer_whatsapp_updates_consent((string)$customer['id'], (string)$customer['phone']),
        ],
        'equipment' => array_map(fn($e) => [
            'id' => $e['id'],
            'customerId' => $e['customer_id'],
            'equipmentType' => $e['equipment_type'],
            'brandModel' => $e['brand_model'],
            'serialNumber' => $e['serial_number'],
            'capacityKw' => $e['capacity_kw'],
            'installDate' => $e['install_date'],
            'notes' => $e['notes'],
            'createdAt' => $e['created_at'],
        ], $equipmentStmt->fetchAll()),
        'tickets' => array_map('hiso_hydrate_ticket', $ticketStmt->fetchAll()),
    ];
}

function hiso_customer_auth_rate_limit(string $scope, int $limit, int $windowSeconds): bool {
    $pdo = hiso_pdo();
    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $pdo->prepare('DELETE FROM customer_auth_rate_limits WHERE created_at < ?')
        ->execute([$now->modify('-1 day')->format('Y-m-d H:i:s')]);
    $keyHash = hash('sha256', $scope);
    $cutoff = $now->modify('-' . $windowSeconds . ' seconds')->format('Y-m-d H:i:s');
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM customer_auth_rate_limits WHERE key_hash = ? AND created_at >= ?');
    $stmt->execute([$keyHash, $cutoff]);
    if ((int)$stmt->fetchColumn() >= $limit) {
        return false;
    }
    $pdo->prepare('INSERT INTO customer_auth_rate_limits (id, key_hash, created_at) VALUES (?, ?, ?)')
        ->execute([hiso_uuid(), $keyHash, $now->format('Y-m-d H:i:s')]);
    return true;
}

function hiso_user_permissions(string $role): array {
    if ($role === 'superadmin') {
        return [
            'manage_enquiries', 'manage_tickets', 'manage_storefront', 'draft_quotes',
            'approve_quotes', 'manage_invoices', 'verify_payments', 'release_installations',
            'update_installations', 'manage_staff', 'manage_roles', 'view_audit',
            'manage_communications',
        ];
    }
    $stmt = hiso_pdo()->prepare('SELECT name, permissions_json FROM roles WHERE id = ? LIMIT 1');
    $stmt->execute([$role]);
    $r = $stmt->fetch();
    if ($r) {
        return json_decode($r['permissions_json'] ?: '[]', true) ?: [];
    }
    return [];
}

function hiso_current_user(): ?array {
    hiso_start_session();
    $userId = $_SESSION['user_id'] ?? null;
    if (!$userId) {
        return null;
    }
    $stmt = hiso_pdo()->prepare(
        'SELECT id, name, email, phone, role, title, skills, status, created_at FROM users WHERE id = ? AND status = "Active" LIMIT 1'
    );
    $stmt->execute([$userId]);
    $user = $stmt->fetch();
    if (!$user) {
        return null;
    }
    unset($user['password_hash']);
    $user['permissions'] = hiso_user_permissions((string)$user['role']);
    return $user;
}

function hiso_require_permission(string $permission): array {
    $user = hiso_current_user();
    if (!$user) {
        hiso_json_response(['error' => 'Authentication required.'], 401);
    }
    if ($user['role'] === 'superadmin' || in_array($permission, $user['permissions'] ?? [], true)) {
        return $user;
    }
    hiso_json_response(['error' => 'Your role does not permit this action (' . $permission . ').'], 403);
    exit;
}

function hiso_require_roles(array $allowedRoles): array {
    $user = hiso_current_user();
    if (!$user) {
        hiso_json_response(['error' => 'Authentication required.'], 401);
    }
    if ($user['role'] === 'superadmin' || in_array($user['role'], $allowedRoles, true)) {
        return $user;
    }
    hiso_json_response(['error' => 'Your role does not permit this action.'], 403);
    exit;
}

function hiso_audit(array $actor, string $actionType, string $entityType, string $entityId, string $summary): void {
    $stmt = hiso_pdo()->prepare(
        'INSERT INTO audit_logs (id, actor_name, actor_role, action_type, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        hiso_uuid(),
        $actor['name'] ?? 'System',
        $actor['role'] ?? 'public',
        $actionType,
        $entityType,
        $entityId,
        $summary,
    ]);
}

function hiso_notify(string $userId, string $title, string $body, string $module, string $ref): void {
    $stmt = hiso_pdo()->prepare(
        'INSERT INTO notifications (id, user_id, title, body, target_module, target_ref) VALUES (?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([hiso_uuid(), $userId, $title, $body, $module, $ref]);
}

function hiso_notify_roles(array $roleIds, string $title, string $body, string $module, string $ref): void {
    if (empty($roleIds)) return;
    $placeholders = implode(',', array_fill(0, count($roleIds), '?'));
    $stmt = hiso_pdo()->prepare("SELECT id FROM users WHERE status = 'Active' AND role IN ({$placeholders})");
    $stmt->execute($roleIds);
    foreach ($stmt->fetchAll() as $u) {
        hiso_notify((string)$u['id'], $title, $body, $module, $ref);
    }
}

function hiso_send_mail(string $toEmail, string $subject, string $message, array $attachments = []): void {
    global $CONFIG;
    if (!filter_var($toEmail, FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('Invalid email recipient.');
    }
    $mailFrom = (string)($CONFIG['MAIL_FROM'] ?? '');
    $mailFromName = (string)($CONFIG['MAIL_FROM_NAME'] ?? 'HI-SOTECH');
    $mailHost = trim((string)($CONFIG['MAIL_HOST'] ?? ''));
    $mailUsername = trim((string)($CONFIG['MAIL_USERNAME'] ?? ''));
    $mailPassword = (string)($CONFIG['MAIL_PASSWORD'] ?? '');
    $mailPort = filter_var($CONFIG['MAIL_PORT'] ?? null, FILTER_VALIDATE_INT);
    $mailEncryption = strtolower((string)($CONFIG['MAIL_ENCRYPTION'] ?? 'ssl'));
    if (!filter_var($mailFrom, FILTER_VALIDATE_EMAIL)
        || preg_match('/[\r\n]/', $mailFromName)
        || preg_match('/[\r\n]/', $subject)
        || $mailHost === ''
        || $mailUsername === ''
        || $mailPassword === ''
        || $mailPort === false
        || $mailPort < 1
        || $mailPort > 65535
        || !in_array($mailEncryption, ['ssl', 'tls'], true)) {
        throw new RuntimeException('Customer SMTP delivery is not configured.');
    }
    if (!class_exists(\PHPMailer\PHPMailer\PHPMailer::class)) {
        throw new RuntimeException('Customer SMTP delivery dependency is unavailable.');
    }

    $mailer = new \PHPMailer\PHPMailer\PHPMailer(true);
    $mailer->isSMTP();
    $mailer->Host = $mailHost;
    $mailer->SMTPAuth = true;
    $mailer->Username = $mailUsername;
    $mailer->Password = $mailPassword;
    $mailer->Port = $mailPort;
    $mailer->SMTPSecure = $mailEncryption === 'ssl'
        ? \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_SMTPS
        : \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
    $mailer->Timeout = 15;
    $mailer->SMTPDebug = \PHPMailer\PHPMailer\SMTP::DEBUG_OFF;
    $mailer->CharSet = 'UTF-8';
    $mailer->setFrom($mailFrom, $mailFromName);
    $mailer->addAddress($toEmail);
    $mailer->Subject = $subject;
    $mailer->Body = $message;
    foreach ($attachments as $attachment) {
        if (!is_array($attachment) || !is_string($attachment['bytes'] ?? null)
            || !is_string($attachment['name'] ?? null) || !is_string($attachment['mime'] ?? null)
            || $attachment['name'] === '' || strlen($attachment['name']) > 120
            || preg_match('/[\/\\\\\r\n]/', $attachment['name'])
            || !in_array($attachment['mime'], ['application/pdf', 'image/jpeg', 'image/png'], true)) {
            throw new InvalidArgumentException('Mail attachment data is invalid.');
        }
        $mailer->addStringAttachment($attachment['bytes'], $attachment['name'], 'base64', $attachment['mime']);
    }
    $mailer->send();
}

function hiso_mail_failure_category(Throwable $error): string {
    $message = strtolower($error->getMessage());
    if (str_contains($message, 'invalid email recipient')) {
        return 'invalid_recipient';
    }
    if (str_contains($message, 'not configured') || str_contains($message, 'dependency unavailable')) {
        return 'configuration';
    }
    if (preg_match('/authenticat|535|5\.7\.8/', $message)) {
        return 'authentication';
    }
    if (preg_match('/certificate|ssl|tls|crypto|handshake/', $message)) {
        return 'tls';
    }
    if (preg_match('/connect|connection|timed out|refused|network|socket/', $message)) {
        return 'connection';
    }
    if (preg_match('/recipient|mailbox|sender|5\.1\.1|5\.7\.1/', $message)) {
        return 'address_or_policy';
    }
    return 'smtp_other';
}

function hiso_log_mail_failure(Throwable $error): void {
    $entry = sprintf(
        "%s category=%s exception=%s source=%s:%d code=%d\n",
        gmdate('c'),
        hiso_mail_failure_category($error),
        get_class($error),
        basename($error->getFile()),
        $error->getLine(),
        $error->getCode()
    );
    $logPath = hiso_storage_dir('logs') . '/customer-mail-errors.log';
    if (file_put_contents($logPath, $entry, FILE_APPEND | LOCK_EX) === false) {
        error_log('[hiso-customer-login] delivery failed; ' . trim($entry));
    }
}

function hiso_whatsapp_webhook_signature_is_valid(string $body, string $signature, string $appSecret): bool {
    if ($appSecret === '' || !preg_match('/^sha256=[a-f0-9]{64}$/i', $signature)) {
        return false;
    }
    $provided = substr($signature, 7);
    return hash_equals(hash_hmac('sha256', $body, $appSecret), strtolower($provided));
}

function hiso_log_whatsapp_webhook_verification(string $reason): void {
    $allowedReasons = [
        'verified',
        'mode_mismatch',
        'verify_token_not_configured',
        'verify_token_missing',
        'verify_token_mismatch',
        'challenge_too_large',
    ];
    if (!in_array($reason, $allowedReasons, true)) {
        throw new InvalidArgumentException('Webhook verification log category is invalid.');
    }
    $entry = gmdate('c') . ' verification=' . $reason . "\n";
    $logPath = hiso_storage_dir('logs') . '/whatsapp-webhook-errors.log';
    if (file_put_contents($logPath, $entry, FILE_APPEND | LOCK_EX) === false) {
        error_log('[hiso-whatsapp-webhook] verification=' . $reason);
    }
}
