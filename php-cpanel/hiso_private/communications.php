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

function hiso_customer_contact_directory(): array {
    return hiso_pdo()->query(
        'SELECT id, name, email, phone FROM customer_profiles WHERE email_verified_at IS NOT NULL ORDER BY name LIMIT 2000'
    )->fetchAll(PDO::FETCH_ASSOC);
}

function hiso_customer_contact_groups(): array {
    $groups = hiso_pdo()->query('SELECT id, name FROM customer_contact_groups ORDER BY name')->fetchAll(PDO::FETCH_ASSOC);
    $stmt = hiso_pdo()->query('SELECT group_id, customer_id FROM customer_contact_group_members ORDER BY customer_id');
    $members = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $members[(string)$row['group_id']][] = (string)$row['customer_id'];
    }
    return array_map(static fn($group) => [
        'id' => (string)$group['id'],
        'name' => (string)$group['name'],
        'customerIds' => $members[(string)$group['id']] ?? [],
    ], $groups);
}

function hiso_save_customer_contact_group(array $body, string $actorId): array {
    $id = trim((string)($body['id'] ?? ''));
    $name = trim((string)($body['name'] ?? ''));
    $customerIds = $body['customerIds'] ?? null;
    if ($name === '' || strlen($name) > 80 || preg_match('/[\r\n]/', $name)) {
        throw new InvalidArgumentException('Enter a group name between 1 and 80 characters.');
    }
    if (!is_array($customerIds) || count($customerIds) > 1000) {
        throw new InvalidArgumentException('Select up to 1,000 verified customers for this group.');
    }
    foreach ($customerIds as $customerId) {
        if (!is_string($customerId) || !preg_match('/^[A-Fa-f0-9-]{36}$/', $customerId)) {
            throw new InvalidArgumentException('Customer group selection is invalid.');
        }
    }
    $customerIds = array_values(array_unique($customerIds));
    if ($customerIds) {
        $stmt = hiso_pdo()->prepare(
            'SELECT COUNT(*) FROM customer_profiles WHERE email_verified_at IS NOT NULL AND id IN (' .
            implode(',', array_fill(0, count($customerIds), '?')) . ')'
        );
        $stmt->execute($customerIds);
        if ((int)$stmt->fetchColumn() !== count($customerIds)) {
            throw new InvalidArgumentException('Groups can include only existing, verified customer accounts.');
        }
    }
    if ($id !== '' && !preg_match('/^[A-Fa-f0-9-]{36}$/', $id)) {
        throw new InvalidArgumentException('Contact group ID is invalid.');
    }
    $pdo = hiso_pdo();
    $isUpdate = $id !== '';
    if ($isUpdate) {
        $stmt = $pdo->prepare('SELECT id FROM customer_contact_groups WHERE id = ? LIMIT 1');
        $stmt->execute([$id]);
        if (!$stmt->fetchColumn()) throw new InvalidArgumentException('Contact group not found.');
    } else {
        $id = hiso_uuid();
    }
    try {
        $pdo->beginTransaction();
        if ($isUpdate) {
            $pdo->prepare('UPDATE customer_contact_groups SET name = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([$name, $id]);
        } else {
            $pdo->prepare('INSERT INTO customer_contact_groups (id, name, created_by) VALUES (?, ?, ?)')
                ->execute([$id, $name, $actorId]);
        }
        $pdo->prepare('DELETE FROM customer_contact_group_members WHERE group_id = ?')->execute([$id]);
        $insert = $pdo->prepare('INSERT INTO customer_contact_group_members (group_id, customer_id) VALUES (?, ?)');
        foreach ($customerIds as $customerId) $insert->execute([$id, $customerId]);
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        if ($error instanceof PDOException && (string)$error->getCode() === '23000') {
            throw new InvalidArgumentException('A contact group with that name already exists.');
        }
        throw $error;
    }
    return ['id' => $id];
}

function hiso_delete_customer_contact_group(string $id): void {
    if (!preg_match('/^[A-Fa-f0-9-]{36}$/', $id)) {
        throw new InvalidArgumentException('Contact group ID is invalid.');
    }
    $stmt = hiso_pdo()->prepare('DELETE FROM customer_contact_groups WHERE id = ?');
    $stmt->execute([$id]);
    if ($stmt->rowCount() === 0) throw new InvalidArgumentException('Contact group not found.');
}

function hiso_customer_contact_group_recipients(string $groupId, string $channel): array {
    if (!preg_match('/^[A-Fa-f0-9-]{36}$/', $groupId) || !in_array($channel, ['email', 'whatsapp'], true)) {
        throw new InvalidArgumentException('Contact group or delivery channel is invalid.');
    }
    $exists = hiso_pdo()->prepare('SELECT id FROM customer_contact_groups WHERE id = ? LIMIT 1');
    $exists->execute([$groupId]);
    if (!$exists->fetchColumn()) throw new InvalidArgumentException('Contact group not found.');
    $total = hiso_pdo()->prepare('SELECT COUNT(*) FROM customer_contact_group_members WHERE group_id = ?');
    $total->execute([$groupId]);
    $column = $channel === 'email' ? 'email' : 'phone';
    $stmt = hiso_pdo()->prepare(
        'SELECT c.id, c.name, c.email, c.phone FROM customer_contact_group_members m ' .
        'JOIN customer_profiles c ON c.id = m.customer_id ' .
        'JOIN communications_consents x ON x.customer_id = c.id AND x.channel = ? ' .
        'WHERE m.group_id = ? AND c.email_verified_at IS NOT NULL AND x.consented_at IS NOT NULL ' .
        'AND x.revoked_at IS NULL AND c.' . $column . ' <> "" ORDER BY c.name'
    );
    $stmt->execute([$channel, $groupId]);
    $contacts = $stmt->fetchAll(PDO::FETCH_ASSOC);
    if ($channel === 'email') {
        $contacts = array_values(array_filter($contacts, static fn($contact) =>
            filter_var($contact['email'] ?? '', FILTER_VALIDATE_EMAIL) !== false
        ));
    } else {
        $contacts = array_values(array_filter($contacts, static fn($contact) =>
            preg_match('/^\+[1-9][0-9]{7,14}$/', (string)($contact['phone'] ?? '')) === 1
        ));
    }
    return ['contacts' => $contacts, 'skipped' => max(0, (int)$total->fetchColumn() - count($contacts))];
}

function hiso_customer_contact_group_push_recipients(string $groupId): array {
    if (!preg_match('/^[A-Fa-f0-9-]{36}$/', $groupId)) {
        throw new InvalidArgumentException('Contact group ID is invalid.');
    }
    if (!hiso_table_exists('customer_contact_groups') || !hiso_table_exists('customer_contact_group_members')) {
        throw new InvalidArgumentException('Apply php-cpanel/migrations/010-staff-profiles-contact-groups.sql before using groups for push notifications.');
    }
    $exists = hiso_pdo()->prepare('SELECT id FROM customer_contact_groups WHERE id = ? LIMIT 1');
    $exists->execute([$groupId]);
    if (!$exists->fetchColumn()) throw new InvalidArgumentException('Contact group not found.');

    $total = hiso_pdo()->prepare('SELECT COUNT(*) FROM customer_contact_group_members WHERE group_id = ?');
    $total->execute([$groupId]);
    $subscribed = hiso_pdo()->prepare(
        'SELECT DISTINCT c.id FROM customer_contact_group_members m ' .
        'JOIN customer_profiles c ON c.id = m.customer_id ' .
        'JOIN push_subscriptions p ON p.owner_type = ? AND p.owner_id = c.id ' .
        'WHERE m.group_id = ? AND c.email_verified_at IS NOT NULL'
    );
    $subscribed->execute(['customer', $groupId]);
    $customerIds = array_map('strval', array_column($subscribed->fetchAll(PDO::FETCH_ASSOC), 'id'));
    return [
        'customerIds' => $customerIds,
        'skipped' => max(0, (int)$total->fetchColumn() - count($customerIds)),
    ];
}

function hiso_send_lifecycle_email_to_roles(string $eventKey, array $roles, string $subject, string $message): void {
    $roles = array_values(array_unique(array_filter($roles, static fn($role) =>
        is_string($role) && in_array($role, ['admin', 'director', 'superadmin'], true)
    )));
    if (!$roles) return;
    $stmt = hiso_pdo()->prepare(
        'SELECT id, email FROM users WHERE status="Active" AND role IN (' .
        implode(',', array_fill(0, count($roles), '?')) . ') ORDER BY name'
    );
    $stmt->execute($roles);
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $recipient) {
        $id = (string)$recipient['id'];
        $email = trim((string)$recipient['email']);
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            hiso_communications_log($eventKey, 'staff', $id, 'email', 'skipped', 'recipient_email_unavailable');
            continue;
        }
        try {
            hiso_send_mail($email, $subject, $message);
            hiso_communications_log($eventKey, 'staff', $id, 'email', 'sent');
        } catch (Throwable $error) {
            hiso_log_mail_failure($error);
            hiso_communications_log($eventKey, 'staff', $id, 'email', 'failed', hiso_mail_failure_category($error));
        }
    }
}

function hiso_send_enquiry_emails(array $enquiry, ?string $quoteCode = null): void {
    $eventKey = 'new_enquiry';
    global $CONFIG;
    $appUrl = rtrim((string)($CONFIG['APP_URL'] ?? ''), '/');
    $name = trim((string)($enquiry['customerName'] ?? ''));
    $email = trim((string)($enquiry['email'] ?? ''));
    $id = (string)($enquiry['id'] ?? '');
    $refCode = (string)($enquiry['refCode'] ?? '');
    $customerMessage = "Hello {$name},\n\n"
        . "We have received your HI-SOTECH enquiry {$refCode}"
        . ($quoteCode ? " (load estimate {$quoteCode})" : '') . ".\n"
        . "A representative will review your request and get back to you shortly using the WhatsApp number you provided.\n\n"
        . "Thank you,\nHI-SOTECH Solar Solutions";
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        hiso_communications_log($eventKey, 'enquiry', $id, 'email', 'skipped', 'recipient_email_unavailable');
    } else {
        try {
            hiso_send_mail($email, 'We received your HI-SOTECH enquiry ' . $refCode, $customerMessage);
            hiso_communications_log($eventKey, 'enquiry', $id, 'email', 'sent');
        } catch (Throwable $error) {
            hiso_log_mail_failure($error);
            hiso_communications_log($eventKey, 'enquiry', $id, 'email', 'failed', hiso_mail_failure_category($error));
        }
    }

    $adminMessage = "A customer has submitted a HI-SOTECH enquiry.\n\n"
        . 'Name: ' . $name . "\n"
        . 'Phone / WhatsApp: ' . trim((string)($enquiry['phone'] ?? '')) . "\n"
        . 'Email: ' . ($email !== '' ? $email : 'Not provided') . "\n"
        . 'Location: ' . trim((string)($enquiry['location'] ?? '')) . "\n"
        . 'Enquiry code: ' . $refCode . "\n"
        . ($quoteCode ? "Estimator quotation: {$quoteCode}\n" : '')
        . 'Details: ' . trim((string)($enquiry['needSummary'] ?? '')) . "\n\n"
        . 'Open the enquiry workspace to follow up: ' . $appUrl . '/#workspace?tab=enquiries';
    hiso_send_lifecycle_email_to_roles(
        $eventKey,
        ['admin', 'superadmin'],
        'New enquiry ' . $refCode . ': ' . $name,
        $adminMessage
    );
}

function hiso_send_enquiry_confirmation_whatsapp(
    string $enquiryId,
    string $phone,
    string $name,
    string $refCode,
    ?string $quoteCode = null
): void {
    $message = "Hello {$name}, we have received your HI-SOTECH enquiry {$refCode}"
        . ($quoteCode ? " and load estimate {$quoteCode}" : '')
        . '. A representative will get back to you shortly using this WhatsApp number. Thank you.';
    try {
        $contact = hiso_whatsapp_consent_contact('enquiry', $enquiryId, 'operational');
    } catch (Throwable $error) {
        hiso_communications_log('new_enquiry', 'enquiry', $enquiryId, 'whatsapp', 'failed', 'consent_lookup_failed');
        return;
    }
    if (!$contact || (string)$contact['phone'] !== $phone) {
        hiso_communications_log('new_enquiry', 'enquiry', $enquiryId, 'whatsapp', 'skipped', 'no_active_operational_consent');
        return;
    }
    try {
        $config = hiso_whatsapp_template_config('new_enquiry');
        hiso_whatsapp_send_template($config, $phone, $message);
        hiso_communications_log('new_enquiry', 'enquiry', $enquiryId, 'whatsapp', 'sent');
    } catch (Throwable $error) {
        $configured = str_contains(strtolower($error->getMessage()), 'not configured')
            || str_contains(strtolower($error->getMessage()), 'configuration')
            || str_contains(strtolower($error->getMessage()), 'template header');
        hiso_communications_log(
            'new_enquiry', 'enquiry', $enquiryId, 'whatsapp',
            $configured ? 'not_configured' : 'failed',
            $configured ? 'template_or_credentials_missing' : 'provider_delivery_failed'
        );
    }
}

function hiso_send_store_order_emails(array $order): void {
    $eventKey = 'store_order_created';
    $id = (string)($order['enquiryId'] ?? '');
    $name = trim((string)($order['customerName'] ?? ''));
    $orderCode = (string)($order['orderCode'] ?? '');
    $email = trim((string)($order['email'] ?? ''));
    $items = is_array($order['items'] ?? null) ? $order['items'] : [];
    $itemRows = implode("\n", array_map(static fn($item) =>
        (int)$item['qty'] . ' × ' . (string)$item['name'] . ' — ₦' .
        number_format((float)$item['qty'] * (float)$item['unitPriceNgn']),
        $items
    ));
    $customerMessage = "Hello {$name},\n\n"
        . "We received your purchase order {$orderCode} (enquiry reference " . (string)($order['refCode'] ?? '') . ").\n\n"
        . "Items:\n{$itemRows}\n\n"
        . 'Items subtotal: ₦' . number_format((float)($order['subtotalNgn'] ?? 0)) . "\n"
        . 'VAT: ₦' . number_format((float)($order['taxNgn'] ?? 0)) . "\n"
        . "Logistics / delivery: TBD\n"
        . 'Current total excluding delivery: ₦' . number_format((float)($order['totalNgn'] ?? 0)) . "\n\n"
        . "Your purchase order is pending Director confirmation. We will confirm delivery/logistics pricing and any additional items before issuing your invoice. No payment is due from this purchase-order email.\n\n"
        . "Thank you,\nHI-SOTECH Solar Solutions";
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        hiso_communications_log($eventKey, 'enquiry', $id, 'email', 'skipped', 'recipient_email_unavailable');
    } else {
        try {
            hiso_send_mail($email, 'HI-SOTECH purchase order ' . $orderCode . ' received — pending confirmation', $customerMessage);
            hiso_communications_log($eventKey, 'enquiry', $id, 'email', 'sent');
        } catch (Throwable $error) {
            hiso_log_mail_failure($error);
            hiso_communications_log($eventKey, 'enquiry', $id, 'email', 'failed', hiso_mail_failure_category($error));
        }
    }

    global $CONFIG;
    $appUrl = rtrim((string)($CONFIG['APP_URL'] ?? ''), '/');
    $adminMessage = "New customer purchase order {$orderCode}; status: Pending Director confirmation.\n\n"
        . "Customer: {$name}\n"
        . 'Phone / WhatsApp: ' . trim((string)($order['phone'] ?? '')) . "\n"
        . 'Email: ' . ($email !== '' ? $email : 'Not provided') . "\n"
        . 'Location: ' . trim((string)($order['location'] ?? '')) . "\n"
        . 'Delivery method/address: ' . (string)($order['deliveryMethod'] ?? '') . ' — ' . (string)($order['deliveryAddress'] ?? '') . "\n"
        . 'Enquiry reference: ' . (string)($order['refCode'] ?? '') . "\n"
        . "Items:\n{$itemRows}\n"
        . 'Subtotal: ₦' . number_format((float)($order['subtotalNgn'] ?? 0)) . "\n"
        . 'VAT: ₦' . number_format((float)($order['taxNgn'] ?? 0)) . "\n"
        . "Logistics / delivery: TBD\n"
        . 'Current total excluding delivery: ₦' . number_format((float)($order['totalNgn'] ?? 0)) . "\n"
        . 'Customer notes: ' . (trim((string)($order['notes'] ?? '')) ?: 'None') . "\n\n"
        . 'Review and follow up: ' . $appUrl . '/#workspace?tab=orders';
    hiso_send_lifecycle_email_to_roles(
        $eventKey, ['admin', 'superadmin', 'director'],
        'Purchase order ' . $orderCode . ' awaits Director confirmation', $adminMessage
    );
}

function hiso_send_invoice_issued_emails(array $invoice): void {
    $eventKey = 'invoice_status';
    $enquiryId = (string)($invoice['enquiryId'] ?? '');
    $name = trim((string)($invoice['customerName'] ?? ''));
    $email = trim((string)($invoice['email'] ?? ''));
    $invoiceCode = (string)($invoice['invoiceCode'] ?? '');
    $items = is_array($invoice['items'] ?? null) ? $invoice['items'] : [];
    $itemRows = implode("\n", array_map(static fn($item) =>
        (float)$item['qty'] . ' × ' . (string)($item['description'] ?? $item['name'] ?? '') . ' — ₦' .
        number_format((float)$item['qty'] * (float)$item['unitPriceNgn']),
        $items
    ));
    global $CONFIG;
    $appUrl = rtrim((string)($CONFIG['APP_URL'] ?? ''), '/');
    $message = "Hello {$name},\n\n"
        . "Your HI-SOTECH invoice {$invoiceCode} has been issued and is pending payment.\n\n"
        . "Invoice items:\n{$itemRows}\n\n"
        . 'Amount due: ₦' . number_format((float)($invoice['totalNgn'] ?? 0)) . "\n"
        . 'View your account and invoice at: ' . $appUrl . '/#customer' . "\n\n"
        . "Please contact the HI-SOTECH front desk if you have any questions.";
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        hiso_communications_log($eventKey, 'enquiry', $enquiryId, 'email', 'skipped', 'recipient_email_unavailable');
    } else {
        try {
            hiso_send_mail($email, 'HI-SOTECH invoice ' . $invoiceCode, $message);
            hiso_communications_log($eventKey, 'enquiry', $enquiryId, 'email', 'sent');
        } catch (Throwable $error) {
            hiso_log_mail_failure($error);
            hiso_communications_log($eventKey, 'enquiry', $enquiryId, 'email', 'failed', hiso_mail_failure_category($error));
        }
    }
    hiso_send_lifecycle_email_to_roles(
        $eventKey,
        ['admin', 'superadmin'],
        'Invoice issued: ' . $invoiceCode,
        "Invoice {$invoiceCode} for {$name} was issued.\nCustomer email: " . ($email ?: 'Not provided') .
            "\nAmount: ₦" . number_format((float)($invoice['totalNgn'] ?? 0)) .
            "\nFollow up: " . $appUrl . '/#workspace?tab=invoices'
    );
}

function hiso_send_account_setup_email(
    string $eventKey,
    string $recipientType,
    string $recipientId,
    string $email,
    string $name,
    string $username,
    string $pin
): bool {
    global $CONFIG;
    $appUrl = rtrim((string)($CONFIG['APP_URL'] ?? ''), '/');
    $parts = parse_url($appUrl);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || !$parts || empty($parts['host'])
        || !in_array($parts['scheme'] ?? '', ['https', 'http'], true)
        || !preg_match('/^\d{4}$/', $pin)) {
        hiso_communications_log($eventKey, $recipientType, $recipientId, 'email', 'not_configured', 'account_setup_mail_not_configured');
        return false;
    }
    $destination = $recipientType === 'customer' ? 'customer portal' : 'staff workspace';
    $link = $appUrl . ($recipientType === 'customer' ? '/#customer' : '/#workspace');
    $message = "Hello {$name},\n\n"
        . "Your HI-SOTECH {$destination} account is ready.\n"
        . "Username: {$username}\n"
        . "One-time setup PIN: {$pin}\n"
        . "The PIN expires in 24 hours and can only be used once.\n"
        . "Open {$link}, choose first-time password setup, enter the PIN, and create a password of at least 12 characters.\n"
        . "If you did not expect this account, contact HI-SOTECH support.";
    try {
        $subject = $eventKey === 'customer_password_reset'
            ? 'Your HI-SOTECH password reset instructions'
            : 'Your HI-SOTECH account setup instructions';
        hiso_send_mail($email, $subject, $message);
        hiso_communications_log($eventKey, $recipientType, $recipientId, 'email', 'sent');
        return true;
    } catch (Throwable $error) {
        hiso_log_mail_failure($error);
        hiso_communications_log($eventKey, $recipientType, $recipientId, 'email', 'failed', hiso_mail_failure_category($error));
        return false;
    }
}

function hiso_send_account_setup_whatsapp(
    string $eventKey,
    string $recipientType,
    string $accountId,
    string $consentType,
    string $consentId,
    string $phone,
    string $name,
    string $username,
    string $pin
): void {
    try {
        $contact = hiso_whatsapp_consent_contact($consentType, $consentId, 'operational');
    } catch (Throwable $error) {
        hiso_communications_log($eventKey, $recipientType, $accountId, 'whatsapp', 'failed', 'consent_lookup_failed');
        return;
    }
    if (!$contact || (string)$contact['phone'] !== $phone) {
        hiso_communications_log($eventKey, $recipientType, $accountId, 'whatsapp', 'skipped', 'no_active_operational_consent');
        return;
    }
    global $CONFIG;
    $destination = $recipientType === 'customer' ? 'customer' : 'staff';
    $link = rtrim((string)($CONFIG['APP_URL'] ?? ''), '/') . ($recipientType === 'customer' ? '/#customer' : '/#workspace');
    $message = "HI-SOTECH {$destination} account setup for {$name}. Username: {$username}. One-time PIN: {$pin}. It expires in 24 hours. Open {$link} to set your password.";
    try {
        $config = hiso_whatsapp_template_config($eventKey);
        hiso_whatsapp_send_template($config, $phone, $message);
        hiso_communications_log($eventKey, $recipientType, $accountId, 'whatsapp', 'sent');
    } catch (Throwable $error) {
        $configured = str_contains(strtolower($error->getMessage()), 'not configured')
            || str_contains(strtolower($error->getMessage()), 'configuration')
            || str_contains(strtolower($error->getMessage()), 'template header');
        hiso_communications_log(
            $eventKey,
            $recipientType,
            $accountId,
            'whatsapp',
            $configured ? 'not_configured' : 'failed',
            $configured ? 'template_or_credentials_missing' : 'provider_delivery_failed'
        );
    }
}

function hiso_whatsapp_send(string $phone, string $message): void {
    global $CONFIG;
    $phone = trim($phone);
    if (!preg_match('/^\+[1-9][0-9]{7,14}$/', $phone)) {
        throw new InvalidArgumentException('Please use the required country code for the WhatsApp number (for example, +234…).');
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

function hiso_newsletter_send(string $subject, string $message, array $attachments, ?array $recipients = null): int {
    global $CONFIG;
    $messageLength = preg_match_all('/./us', $message);
    if (trim($subject) === '' || strlen($subject) > 180 || preg_match('/[\r\n]/', $subject)
        || trim($message) === '' || $messageLength === false || $messageLength > 10000 || strlen($message) > 40000) {
        throw new InvalidArgumentException('Newsletter subject or message is invalid.');
    }
    if (count($attachments) > 3) {
        throw new InvalidArgumentException('A newsletter may include at most three attachments.');
    }
    $recipients = $recipients ?? hiso_marketing_contacts('email');
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

function hiso_vapid_key_pair_is_valid(string $privateKey, string $publicKey): bool {
    if (strlen($privateKey) !== 32 || strlen($publicKey) !== 65 || $publicKey[0] !== "\x04"
        || !function_exists('openssl_pkey_get_private') || !function_exists('openssl_sign')
        || !function_exists('openssl_verify')) {
        return false;
    }

    $privateDer = hex2bin('30770201010420') . $privateKey
        . hex2bin('a00a06082a8648ce3d030107a144034200') . $publicKey;
    $publicDer = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . $publicKey;
    $privatePem = "-----BEGIN EC PRIVATE KEY-----\n"
        . chunk_split(base64_encode($privateDer), 64, "\n")
        . "-----END EC PRIVATE KEY-----\n";
    $publicPem = "-----BEGIN PUBLIC KEY-----\n"
        . chunk_split(base64_encode($publicDer), 64, "\n")
        . "-----END PUBLIC KEY-----\n";

    try {
        $key = @openssl_pkey_get_private($privatePem);
        if ($key === false) return false;
        $details = openssl_pkey_get_details($key);
        if (!is_array($details) || ($details['type'] ?? null) !== OPENSSL_KEYTYPE_EC) return false;
        $message = 'HI-SOTECH VAPID key-pair check';
        $signature = '';
        return openssl_sign($message, $signature, $key, OPENSSL_ALGO_SHA256)
            && openssl_verify($message, $signature, $publicPem, OPENSSL_ALGO_SHA256) === 1;
    } catch (Throwable) {
        return false;
    }
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
        throw new InvalidArgumentException('Please use the required country code for the WhatsApp number (for example, +234…).');
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

function hiso_whatsapp_consent_contact(
    string $recipientType,
    string $recipientId,
    string $purpose,
    bool $includeInvalidPhone = false
): ?array {
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
    if (!$contact || (!$includeInvalidPhone && !preg_match('/^\+[1-9][0-9]{7,14}$/', (string)$contact['phone']))) {
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
    string $message,
    bool $sendEmail = true
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
        $staff = $pdo->query('SELECT id, name, email, phone FROM users WHERE status = "Active" AND role IN ("admin","director","superadmin") ORDER BY name')
            ->fetchAll(PDO::FETCH_ASSOC);
        foreach ($staff as $member) {
            $targets[] = $member + ['recipient_type' => 'staff'];
        }
    } else {
        $enquiryId = null;
        $customerId = null;
        $assignedStaffId = null;
        if ($entityType === 'quote') {
            $stmt = $pdo->prepare('SELECT enquiry_id FROM quotations WHERE id = ? OR quote_code = ? LIMIT 1');
            $stmt->execute([$entityId, $entityId]);
            $enquiryId = $stmt->fetchColumn() ?: null;
        } elseif ($entityType === 'invoice') {
            $stmt = $pdo->prepare('SELECT enquiry_id FROM invoices WHERE id = ? OR invoice_code = ? LIMIT 1');
            $stmt->execute([$entityId, $entityId]);
            $enquiryId = $stmt->fetchColumn() ?: null;
        } elseif ($entityType === 'installation') {
            $stmt = $pdo->prepare('SELECT enquiry_id, assigned_engineer_id FROM installations WHERE id = ? OR job_code = ? LIMIT 1');
            $stmt->execute([$entityId, $entityId]);
            $installation = $stmt->fetch(PDO::FETCH_ASSOC);
            $enquiryId = $installation['enquiry_id'] ?? null;
            $assignedStaffId = $installation['assigned_engineer_id'] ?? null;
        } elseif ($entityType === 'ticket') {
            $stmt = $pdo->prepare('SELECT customer_id, assigned_tech_id FROM service_tickets WHERE id = ? OR ticket_code = ? LIMIT 1');
            $stmt->execute([$entityId, $entityId]);
            $ticket = $stmt->fetch(PDO::FETCH_ASSOC);
            $customerId = $ticket['customer_id'] ?? null;
            $assignedStaffId = $ticket['assigned_tech_id'] ?? null;
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
        if ($assignedStaffId) {
            $stmt = $pdo->prepare('SELECT id, name, email, phone FROM users WHERE id = ? AND status = "Active" LIMIT 1');
            $stmt->execute([$assignedStaffId]);
            $staffMember = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($staffMember) {
                $targets[] = $staffMember + ['recipient_type' => 'staff'];
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
        if ($sendEmail && filter_var($email, FILTER_VALIDATE_EMAIL)) {
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
        } elseif ($sendEmail) {
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
