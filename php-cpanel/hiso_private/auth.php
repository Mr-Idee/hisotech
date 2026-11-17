<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';

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

function hiso_customer_portal_data(array $customer): array {
    $pdo = hiso_pdo();
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

function hiso_send_mail(string $toEmail, string $subject, string $message): void {
    global $CONFIG;
    if (!filter_var($toEmail, FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('Invalid email recipient.');
    }
    $mailFrom = (string)($CONFIG['MAIL_FROM'] ?? '');
    $mailFromName = (string)($CONFIG['MAIL_FROM_NAME'] ?? 'HI-SOTECH');
    if (!filter_var($mailFrom, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $mailFromName)) {
        throw new RuntimeException('Customer email delivery is not configured.');
    }
    $headers = sprintf(
        "From: %s <%s>\r\nContent-Type: text/plain; charset=UTF-8\r\n",
        $mailFromName,
        $mailFrom
    );
    if (!mail($toEmail, $subject, $message, $headers)) {
        throw new RuntimeException('Customer email could not be sent.');
    }
}
