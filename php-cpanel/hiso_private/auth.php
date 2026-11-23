<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';

const HISO_SETUP_PIN_MAX_ATTEMPTS = 10;

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

function hiso_record_failed_setup_pin_attempt(string $table, string $id, string $pinHash): void {
    if (!in_array($table, ['users', 'customer_profiles'], true)) {
        throw new LogicException('Unsupported setup PIN account table.');
    }
    hiso_pdo()->prepare(
        "UPDATE {$table} SET pin_attempts=pin_attempts+1, " .
        'initial_pin_hash=CASE WHEN pin_attempts+1 >= ? THEN NULL ELSE initial_pin_hash END ' .
        'WHERE id=? AND initial_pin_hash=? AND must_set_password=1 ' .
        'AND pin_expires_at > UTC_TIMESTAMP() AND pin_attempts < ?'
    )->execute([HISO_SETUP_PIN_MAX_ATTEMPTS, $id, $pinHash, HISO_SETUP_PIN_MAX_ATTEMPTS]);
}

function hiso_current_customer(): ?array {
    hiso_start_session();
    $customerId = $_SESSION['customer_id'] ?? null;
    if (!$customerId) {
        return null;
    }
    $stmt = hiso_pdo()->prepare(
        'SELECT id, name, email, phone, location, company, ref_code, created_at FROM customer_profiles ' .
        'WHERE id = ? AND email_verified_at IS NOT NULL AND must_set_password = 0 LIMIT 1'
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
        'equipment' => array_map(function ($e) use ($pdo) {
            $photoStmt = $pdo->prepare('SELECT id, original_name, created_at FROM customer_equipment_photos WHERE equipment_id = ? AND customer_id = ? ORDER BY created_at DESC');
            $photoStmt->execute([$e['id'], $e['customer_id']]);
            $photos = array_map(static fn($photo) => [
                'id' => $photo['id'],
                'fileUrl' => '/api/customer-equipment-photo/' . rawurlencode($photo['id']),
                'originalName' => $photo['original_name'],
                'createdAt' => $photo['created_at'],
            ], $photoStmt->fetchAll());
            return [
                'id' => $e['id'],
                'customerId' => $e['customer_id'],
                'equipmentType' => $e['equipment_type'],
                'brandModel' => $e['brand_model'],
                'serialNumber' => $e['serial_number'],
                'capacityKw' => $e['capacity_kw'],
                'installDate' => $e['install_date'],
                'notes' => $e['notes'],
                'createdAt' => $e['created_at'],
                'photos' => $photos,
            ];
        }, $equipmentStmt->fetchAll()),
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

function hiso_create_customer_account_from_approved_quote(array $actor, string $quoteId): array {
    if (!in_array($actor['role'] ?? '', ['admin', 'superadmin'], true)) {
        throw new RuntimeException('Only Admin can approve a customer profile and create its account.');
    }
    $pdo = hiso_pdo();
    $stmt = $pdo->prepare(
        'SELECT e.id, e.customer_name, e.email, e.phone, e.location, e.ref_code FROM quotations q ' .
        'JOIN enquiries e ON e.id = q.enquiry_id WHERE q.id = ? AND q.status = "Approved" ' .
        'AND e.estimate_json IS NOT NULL LIMIT 1'
    );
    $stmt->execute([$quoteId]);
    $enquiry = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$enquiry) {
        throw new RuntimeException('Only Director-approved estimator quotations can be used to create customer accounts.');
    }
    $email = strtolower(trim((string)$enquiry['email']));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190) {
        throw new RuntimeException('A valid customer email address is required before account creation.');
    }

    $existingStmt = $pdo->prepare(
        'SELECT id, password_hash, email_verified_at FROM customer_profiles WHERE LOWER(email) = ? LIMIT 1'
    );
    $existingStmt->execute([$email]);
    $existing = $existingStmt->fetch(PDO::FETCH_ASSOC);
    if ($existing && (!empty($existing['password_hash']) || !empty($existing['email_verified_at']))) {
        throw new RuntimeException('A customer account already exists for this email address.');
    }
    $pin = (string)random_int(1000, 9999);
    $pinHash = password_hash($pin, PASSWORD_DEFAULT);
    if (!is_string($pinHash)) {
        throw new RuntimeException('Customer account setup could not be secured.');
    }
    $expires = gmdate('Y-m-d H:i:s', time() + 86400);
    if ($existing) {
        $id = (string)$existing['id'];
        $pdo->prepare(
            'UPDATE customer_profiles SET name=?, phone=?, location=?, ref_code=?, initial_pin_hash=?, ' .
            'pin_expires_at=?, pin_attempts=0, must_set_password=1 WHERE id=?'
        )->execute([
            $enquiry['customer_name'], $enquiry['phone'], $enquiry['location'],
            $enquiry['ref_code'], $pinHash, $expires, $id,
        ]);
    } else {
        $id = hiso_uuid();
        $pdo->prepare(
            'INSERT INTO customer_profiles (id, name, email, phone, location, company, ref_code, initial_pin_hash, pin_expires_at, must_set_password) ' .
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)'
        )->execute([
            $id, $enquiry['customer_name'], $email, $enquiry['phone'],
            $enquiry['location'], '', $enquiry['ref_code'], $pinHash, $expires,
        ]);
    }
    hiso_audit($actor, 'CREATE_CUSTOMER_ACCOUNT', 'Customer', $id, 'Approved customer profile and created portal account from quotation ' . $quoteId . '.');
    return [
        'id' => $id,
        'enquiryId' => (string)$enquiry['id'],
        'name' => (string)$enquiry['customer_name'],
        'email' => $email,
        'phone' => (string)$enquiry['phone'],
        'pin' => $pin,
    ];
}

function hiso_clear_customer_initial_pin(string $customerId): void {
    hiso_pdo()->prepare(
        'UPDATE customer_profiles SET initial_pin_hash=NULL, pin_expires_at=NULL WHERE id=? AND must_set_password=1'
    )->execute([$customerId]);
}

function hiso_issue_customer_password_reset_pin(array $actor, string $quoteId): array {
    if (!in_array($actor['role'] ?? '', ['admin', 'superadmin'], true)) {
        throw new RuntimeException('Only Admin can issue customer password reset instructions.');
    }
    $pdo = hiso_pdo();
    $stmt = $pdo->prepare(
        'SELECT e.id, e.customer_name, e.email, e.phone, c.id AS customer_id, c.password_hash, c.email_verified_at ' .
        'FROM quotations q JOIN enquiries e ON e.id=q.enquiry_id ' .
        'JOIN customer_profiles c ON LOWER(c.email)=LOWER(e.email) ' .
        'WHERE q.id=? AND q.status="Approved" AND e.estimate_json IS NOT NULL LIMIT 1'
    );
    $stmt->execute([$quoteId]);
    $account = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$account || empty($account['password_hash']) || empty($account['email_verified_at'])) {
        throw new RuntimeException('An active verified customer account was not found for this approved estimator enquiry.');
    }
    $pin = (string)random_int(1000, 9999);
    $pinHash = password_hash($pin, PASSWORD_DEFAULT);
    if (!is_string($pinHash)) {
        throw new RuntimeException('Customer account setup could not be secured.');
    }
    $expires = gmdate('Y-m-d H:i:s', time() + 86400);
    $pdo->beginTransaction();
    try {
        $pdo->prepare(
            'UPDATE customer_profiles SET initial_pin_hash=?, pin_expires_at=?, pin_attempts=0, must_set_password=1 WHERE id=?'
        )->execute([$pinHash, $expires, $account['customer_id']]);
        $pdo->prepare('DELETE FROM customer_sessions WHERE customer_id=?')->execute([$account['customer_id']]);
        $pdo->prepare('DELETE FROM customer_login_tokens WHERE customer_id=?')->execute([$account['customer_id']]);
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
    hiso_audit($actor, 'RESET_CUSTOMER_PASSWORD', 'Customer', (string)$account['customer_id'], 'Issued one-time customer password reset instructions.');
    return [
        'id' => (string)$account['customer_id'],
        'enquiryId' => (string)$account['id'],
        'name' => (string)$account['customer_name'],
        'email' => strtolower(trim((string)$account['email'])),
        'phone' => (string)$account['phone'],
        'pin' => $pin,
    ];
}

function hiso_setup_customer_password(string $email, string $pin, string $password): void {
    if (!preg_match('/^\d{4}$/', $pin) || strlen($password) < 12 || strlen($password) > 128) {
        throw new InvalidArgumentException('Enter the four-digit PIN and a password between 12 and 128 characters.');
    }
    $pdo = hiso_pdo();
    $stmt = $pdo->prepare(
        'SELECT id, initial_pin_hash, pin_attempts FROM customer_profiles WHERE LOWER(email)=? AND must_set_password=1 ' .
        'AND pin_expires_at > UTC_TIMESTAMP() AND pin_attempts < ? LIMIT 1'
    );
    $stmt->execute([strtolower(trim($email)), HISO_SETUP_PIN_MAX_ATTEMPTS]);
    $account = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$account || !is_string($account['initial_pin_hash'])) {
        throw new InvalidArgumentException('The PIN is invalid or has expired. Ask the Admin to resend your setup email.');
    }
    if (!password_verify($pin, $account['initial_pin_hash'])) {
        hiso_record_failed_setup_pin_attempt('customer_profiles', (string)$account['id'], $account['initial_pin_hash']);
        throw new InvalidArgumentException('The PIN is invalid or has expired. Ask the Admin to resend your setup email.');
    }
    $update = $pdo->prepare(
        'UPDATE customer_profiles SET password_hash=?, initial_pin_hash=NULL, pin_expires_at=NULL, pin_attempts=0, ' .
        'must_set_password=0, email_verified_at=COALESCE(email_verified_at, UTC_TIMESTAMP()) ' .
        'WHERE id=? AND initial_pin_hash=? AND must_set_password=1 AND pin_expires_at > UTC_TIMESTAMP() AND pin_attempts < ?'
    );
    $update->execute([password_hash($password, PASSWORD_DEFAULT), $account['id'], $account['initial_pin_hash'], HISO_SETUP_PIN_MAX_ATTEMPTS]);
    if ($update->rowCount() !== 1) {
        throw new InvalidArgumentException('The PIN is invalid or has expired. Ask the Admin to resend your setup email.');
    }
}

function hiso_customer_password_login(string $email, string $password): ?array {
    $stmt = hiso_pdo()->prepare(
        'SELECT id, password_hash FROM customer_profiles WHERE LOWER(email)=? AND email_verified_at IS NOT NULL ' .
        'AND must_set_password=0 LIMIT 1'
    );
    $stmt->execute([strtolower(trim($email))]);
    $account = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$account || !is_string($account['password_hash']) || !password_verify($password, $account['password_hash'])) {
        return null;
    }
    hiso_start_session();
    session_regenerate_id(true);
    $_SESSION['customer_id'] = $account['id'];
    $customer = hiso_current_customer();
    return $customer ? hiso_customer_portal_data($customer) : null;
}

function hiso_setup_staff_password(string $identifier, string $pin, string $password): void {
    if (!preg_match('/^\d{4}$/', $pin) || strlen($password) < 12 || strlen($password) > 128) {
        throw new InvalidArgumentException('Enter the four-digit PIN and a password between 12 and 128 characters.');
    }
    $pdo = hiso_pdo();
    $identifier = strtolower(trim($identifier));
    $stmt = $pdo->prepare(
        'SELECT id, initial_pin_hash FROM users WHERE (LOWER(email)=? OR LOWER(username)=?) ' .
        'AND status="Active" AND must_set_password=1 AND pin_expires_at > UTC_TIMESTAMP() ' .
        'AND pin_attempts < ? LIMIT 1'
    );
    $stmt->execute([$identifier, $identifier, HISO_SETUP_PIN_MAX_ATTEMPTS]);
    $account = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$account || !is_string($account['initial_pin_hash'])) {
        throw new InvalidArgumentException('The PIN is invalid or has expired. Ask your Super Admin to resend your setup email.');
    }
    if (!password_verify($pin, $account['initial_pin_hash'])) {
        hiso_record_failed_setup_pin_attempt('users', (string)$account['id'], $account['initial_pin_hash']);
        throw new InvalidArgumentException('The PIN is invalid or has expired. Ask your Super Admin to resend your setup email.');
    }
    $update = $pdo->prepare(
        "UPDATE users SET password_hash=?, auth_type='password', initial_pin_hash=NULL, pin_expires_at=NULL, pin_attempts=0, must_set_password=0 " .
        'WHERE id=? AND initial_pin_hash=? AND must_set_password=1 AND pin_expires_at > UTC_TIMESTAMP() AND pin_attempts < ?'
    );
    $update->execute([password_hash($password, PASSWORD_DEFAULT), $account['id'], $account['initial_pin_hash'], HISO_SETUP_PIN_MAX_ATTEMPTS]);
    if ($update->rowCount() !== 1) {
        throw new InvalidArgumentException('The PIN is invalid or has expired. Ask your Super Admin to resend your setup email.');
    }
    $pdo->prepare('DELETE FROM staff_password_reset_tokens WHERE user_id=?')->execute([$account['id']]);
}

function hiso_save_staff_authentication(array $user, array $body): array {
    $authType = $body['authType'] ?? null;
    $currentCredential = $body['currentCredential'] ?? null;
    $newCredential = $body['newCredential'] ?? null;
    if (!in_array($authType, ['password', 'pin'], true)
        || !is_string($currentCredential) || !is_string($newCredential)) {
        throw new InvalidArgumentException('Authentication type and credential fields are required.');
    }
    $pdo = hiso_pdo();
    $stmt = $pdo->prepare('SELECT password_hash, auth_type FROM users WHERE id=? AND status="Active" LIMIT 1');
    $stmt->execute([(string)$user['id']]);
    $account = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$account) throw new InvalidArgumentException('Active staff account not found.');
    $currentType = ($account['auth_type'] ?? 'password') === 'pin' ? 'pin' : 'password';
    if (($currentType === 'pin' && !preg_match('/^\d{6}$/', $currentCredential))
        || ($currentType === 'password' && ($currentCredential === '' || strlen($currentCredential) > 128))
        || !password_verify($currentCredential, (string)$account['password_hash'])) {
        throw new InvalidArgumentException('Your current password or PIN is incorrect.');
    }
    if (($authType === 'pin' && !preg_match('/^\d{6}$/', $newCredential))
        || ($authType === 'password' && (strlen($newCredential) < 12 || strlen($newCredential) > 128))) {
        throw new InvalidArgumentException($authType === 'pin'
            ? 'Choose a six-digit PIN.'
            : 'Choose a password between 12 and 128 characters.');
    }
    $pdo->prepare('UPDATE users SET password_hash=?, auth_type=? WHERE id=?')
        ->execute([password_hash($newCredential, PASSWORD_DEFAULT), $authType, (string)$user['id']]);
    $pdo->prepare('DELETE FROM staff_password_reset_tokens WHERE user_id=?')->execute([(string)$user['id']]);
    $updated = hiso_current_user();
    if (!$updated) throw new RuntimeException('Updated staff session could not be reloaded.');
    return $updated;
}

function hiso_create_staff_password_reset(string $email): ?array {
    if (!hiso_table_exists('staff_password_reset_tokens')) {
        throw new RuntimeException('Apply php-cpanel/migrations/011-staff-authentication.sql before using password resets.');
    }
    $email = strtolower(trim($email));
    $stmt = hiso_pdo()->prepare(
        'SELECT id, name, email FROM users WHERE LOWER(email)=? AND status="Active" AND email_verified_at IS NOT NULL LIMIT 1'
    );
    $stmt->execute([$email]);
    $account = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$account) return null;
    $token = bin2hex(random_bytes(32));
    $pdo = hiso_pdo();
    $pdo->prepare('DELETE FROM staff_password_reset_tokens WHERE user_id=?')->execute([$account['id']]);
    $pdo->prepare('INSERT INTO staff_password_reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
        ->execute([hash('sha256', $token), $account['id'], gmdate('Y-m-d H:i:s', time() + 1800)]);
    $account['token'] = $token;
    return $account;
}

function hiso_reset_staff_password(string $token, string $password): void {
    if (!preg_match('/^[a-f0-9]{64}$/i', $token) || strlen($password) < 12 || strlen($password) > 128) {
        throw new InvalidArgumentException('The reset link is invalid or expired, or the new password does not meet the requirements.');
    }
    $pdo = hiso_pdo();
    $tokenHash = hash('sha256', $token);
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare(
            'SELECT user_id FROM staff_password_reset_tokens WHERE token_hash=? AND expires_at > UTC_TIMESTAMP() LIMIT 1 FOR UPDATE'
        );
        $stmt->execute([$tokenHash]);
        $account = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$account) throw new InvalidArgumentException('The reset link is invalid or has expired. Request a new link.');
        $update = $pdo->prepare(
            "UPDATE users SET password_hash=?, auth_type='password', initial_pin_hash=NULL, pin_expires_at=NULL, must_set_password=0 " .
            'WHERE id=? AND status="Active" AND email_verified_at IS NOT NULL'
        );
        $update->execute([password_hash($password, PASSWORD_DEFAULT), $account['user_id']]);
        if ($update->rowCount() !== 1) throw new InvalidArgumentException('The staff account is no longer active or verified.');
        $pdo->prepare('DELETE FROM staff_password_reset_tokens WHERE token_hash=?')->execute([$tokenHash]);
        $pdo->prepare('DELETE FROM sessions WHERE user_id=?')->execute([$account['user_id']]);
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}

function hiso_issue_staff_password_reset_pin(array $actor, string $staffId): array {
    if (!in_array($actor['role'] ?? '', ['admin', 'superadmin'], true)) {
        throw new RuntimeException('Only Admin can reset staff passwords.');
    }
    $pdo = hiso_pdo();
    $stmt = $pdo->prepare('SELECT id, name, username, email, phone FROM users WHERE id=? AND status="Active" LIMIT 1');
    $stmt->execute([$staffId]);
    $staff = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$staff) throw new RuntimeException('An active staff account was not found.');
    $pin = (string)random_int(1000, 9999);
    $pinHash = password_hash($pin, PASSWORD_DEFAULT);
    if (!is_string($pinHash)) throw new RuntimeException('Staff account setup could not be secured.');
    $expires = gmdate('Y-m-d H:i:s', time() + 86400);
    $pdo->prepare('UPDATE users SET initial_pin_hash=?, pin_expires_at=?, pin_attempts=0, must_set_password=1 WHERE id=?')
        ->execute([$pinHash, $expires, $staff['id']]);
    $pdo->prepare('DELETE FROM sessions WHERE user_id=?')->execute([$staff['id']]);
    if (hiso_table_exists('staff_password_reset_tokens')) {
        $pdo->prepare('DELETE FROM staff_password_reset_tokens WHERE user_id=?')->execute([$staff['id']]);
    }
    hiso_audit($actor, 'RESET_STAFF_PASSWORD', 'Staff', (string)$staff['id'], 'Issued one-time staff password reset instructions.');
    $staff['pin'] = $pin;
    return $staff;
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
    $photoColumn = hiso_column_exists('users', 'profile_photo_filename');
    $stmt = hiso_pdo()->prepare(
        'SELECT id, name, email, phone' . ($photoColumn ? ', profile_photo_filename' : '') .
        ', auth_type AS authType, role, title, skills, status, created_at FROM users WHERE id = ? AND status = "Active" LIMIT 1'
    );
    $stmt->execute([$userId]);
    $user = $stmt->fetch();
    if (!$user) {
        return null;
    }
    unset($user['password_hash']);
    $user['profilePhotoUrl'] = !empty($user['profile_photo_filename'])
        ? '/api/staff/profile/photo/' . rawurlencode((string)$user['id']) . '?v=' . rawurlencode((string)$user['profile_photo_filename'])
        : null;
    unset($user['profile_photo_filename']);
    $user['permissions'] = hiso_user_permissions((string)$user['role']);
    return $user;
}

function hiso_column_exists(string $table, string $column): bool {
    if (!preg_match('/^[a-z_]+$/', $table) || !preg_match('/^[a-z_]+$/', $column)) {
        return false;
    }
    $stmt = hiso_pdo()->prepare(
        'SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?'
    );
    $stmt->execute([$table, $column]);
    return (int)$stmt->fetchColumn() > 0;
}

function hiso_update_staff_profile(array $user, array $body): array {
    if (!hiso_column_exists('users', 'profile_photo_filename')) {
        throw new RuntimeException('Apply php-cpanel/migrations/010-staff-profiles-contact-groups.sql before using staff profiles.');
    }
    $name = trim((string)($body['name'] ?? ''));
    $phone = trim((string)($body['phone'] ?? ''));
    $photoDataUrl = $body['photoDataUrl'] ?? null;
    $removePhoto = $body['removePhoto'] ?? false;
    if (strlen($name) < 2 || strlen($name) > 120 || preg_match('/[\r\n]/', $name)) {
        throw new InvalidArgumentException('Enter a name between 2 and 120 characters.');
    }
    if (strlen($phone) > 40 || preg_match('/[\r\n]/', $phone)) {
        throw new InvalidArgumentException('Enter a valid phone number of at most 40 characters.');
    }
    if (!is_bool($removePhoto) || ($photoDataUrl !== null && !is_string($photoDataUrl))
        || ($removePhoto && is_string($photoDataUrl) && $photoDataUrl !== '')) {
        throw new InvalidArgumentException('Profile photo data is invalid.');
    }

    $pdo = hiso_pdo();
    $stmt = $pdo->prepare("SELECT phone, profile_photo_filename FROM users WHERE id = ? AND status = 'Active' LIMIT 1");
    $stmt->execute([(string)$user['id']]);
    $existing = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$existing) throw new InvalidArgumentException('Active staff account not found.');

    $storedPhoto = null;
    if (is_string($photoDataUrl) && $photoDataUrl !== '') {
        if (strlen($photoDataUrl) > 1_400_000
            || !preg_match('#^data:image/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$#', $photoDataUrl, $matches)) {
            throw new InvalidArgumentException('Choose a compressed JPEG, PNG, or WebP profile photo no larger than 1MB.');
        }
        $binary = base64_decode($matches[2], true);
        if ($binary === false || strlen($binary) < 100 || strlen($binary) > 1024 * 1024) {
            throw new InvalidArgumentException('The profile photo is invalid or exceeds the 1MB limit.');
        }
        $dimensions = @getimagesizefromstring($binary);
        if ($dimensions === false || $dimensions[0] > 1440 || $dimensions[1] > 1440
            || $dimensions[0] * $dimensions[1] > 2073600) {
            throw new InvalidArgumentException('The profile photo dimensions exceed the supported 1440px limit.');
        }
        $storedPhoto = hiso_store_photo_data_url($photoDataUrl, 'staff-profile.jpg', 'staff_profiles');
    }
    $nextFilename = $storedPhoto['storage_filename'] ?? ($removePhoto ? null : $existing['profile_photo_filename']);
    try {
        $pdo->beginTransaction();
        $pdo->prepare('UPDATE users SET name = ?, phone = ?, profile_photo_filename = ? WHERE id = ? AND status = "Active"')
            ->execute([$name, $phone, $nextFilename, $user['id']]);
        if (trim((string)$existing['phone']) !== $phone) {
            $pdo->prepare(
                "UPDATE whatsapp_recipient_consents SET revoked_at = UTC_TIMESTAMP() WHERE recipient_type = 'staff' AND recipient_id = ? AND revoked_at IS NULL"
            )->execute([$user['id']]);
        }
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        if ($storedPhoto) {
            $path = hiso_storage_dir('staff_profiles') . '/' . basename($storedPhoto['storage_filename']);
            if (is_file($path)) unlink($path);
        }
        throw $error;
    }

    if (($storedPhoto || $removePhoto) && !empty($existing['profile_photo_filename'])) {
        $oldPath = hiso_storage_dir('staff_profiles') . '/' . basename((string)$existing['profile_photo_filename']);
        if (is_file($oldPath)) unlink($oldPath);
    }
    $updated = hiso_current_user();
    if (!$updated) throw new RuntimeException('Updated staff session could not be reloaded.');
    return $updated;
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
