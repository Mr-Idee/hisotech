<?php
declare(strict_types=1);

/**
 * HI-SOTECH Operations & Website REST API V2 (PHP 8.2+ / PDO MySQL)
 * Deployed inside public_html/api/index.php; requires hiso_private/ above web root.
 */

$privateDir = dirname(__DIR__, 2) . '/hiso_private';
if (!is_dir($privateDir)) {
    $privateDir = dirname(__DIR__) . '/hiso_private';
}

require_once $privateDir . '/config.php';
require_once $privateDir . '/auth.php';
require_once $privateDir . '/upload.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$route = trim((string)($_GET['route'] ?? ''), '/');
if ($route === '') {
    $uriPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    if (preg_match('#/api/(.+)$#', $uriPath, $m)) {
        $route = trim($m[1], '/');
    }
}

function hiso_next_code(string $table, string $column, string $prefix): string {
    $rows = hiso_pdo()->query("SELECT {$column} AS c FROM {$table}")->fetchAll();
    $max = 1000;
    foreach ($rows as $row) {
        $parts = explode('-', (string)$row['c']);
        $num = (int)end($parts);
        if ($num > $max) {
            $max = $num;
        }
    }
    return $prefix . '-' . ($max + 1);
}

function hiso_hydrate_catalog(): array {
    $rows = hiso_pdo()->query('SELECT * FROM catalog_items ORDER BY item_type, category, price_ngn')->fetchAll();
    return array_map(fn($c) => [
        'id' => $c['id'],
        'sku' => $c['sku'],
        'name' => $c['name'],
        'itemType' => $c['item_type'] ?? 'equipment',
        'category' => $c['category'],
        'unit' => $c['unit'],
        'priceNgn' => (float)$c['price_ngn'],
        'stockQty' => (int)$c['stock_qty'],
        'capacityKw' => $c['capacity_kw'] !== null ? (float)$c['capacity_kw'] : null,
        'watts' => $c['watts'] !== null ? (int)$c['watts'] : null,
        'description' => (string)($c['description'] ?? ''),
        'imagePath' => $c['image_path'],
    ], $rows);
}

function hiso_hydrate_ticket(array $t): array {
    return [
        'id' => $t['id'],
        'ticketCode' => $t['ticket_code'],
        'customerId' => $t['customer_id'],
        'customerName' => $t['customer_name'],
        'customerPhone' => $t['customer_phone'],
        'location' => $t['location'],
        'equipmentId' => $t['equipment_id'],
        'equipmentSummary' => $t['equipment_summary'],
        'category' => $t['category'],
        'priority' => $t['priority'],
        'subject' => $t['subject'],
        'description' => $t['description'],
        'status' => $t['status'],
        'assignedTechId' => $t['assigned_tech_id'],
        'assignedTechName' => $t['assigned_tech_name'],
        'resolutionNote' => $t['resolution_note'],
        'createdAt' => $t['created_at'],
        'updatedAt' => $t['updated_at'],
    ];
}

function hiso_hydrate_order(array $o): array {
    return [
        'id' => $o['id'],
        'orderCode' => $o['order_code'],
        'enquiryId' => $o['enquiry_id'],
        'refCode' => $o['ref_code'],
        'customerName' => $o['customer_name'],
        'email' => $o['email'] ?? '',
        'phone' => $o['phone'],
        'location' => $o['location'],
        'deliveryAddress' => $o['delivery_address'],
        'deliveryMethod' => $o['delivery_method'],
        'paymentMethod' => $o['payment_method'],
        'notes' => $o['notes'] ?? '',
        'items' => json_decode($o['items_json'] ?: '[]', true) ?: [],
        'subtotalNgn' => (float)$o['subtotal_ngn'],
        'deliveryFeeNgn' => (float)$o['delivery_fee_ngn'],
        'taxNgn' => (float)$o['tax_ngn'],
        'totalNgn' => (float)$o['total_ngn'],
        'status' => $o['status'],
        'createdAt' => $o['created_at'],
        'updatedAt' => $o['updated_at'],
    ];
}

function hiso_hydrate_workspace(array $user): array {
    $pdo = hiso_pdo();
    $perms = $user['permissions'] ?? [];
    $isSuper = ($user['role'] === 'superadmin');
    $canCommercial = $isSuper || count(array_intersect($perms, ['manage_enquiries', 'draft_quotes', 'approve_quotes', 'manage_invoices', 'verify_payments', 'release_installations'])) > 0;
    $canTickets = $isSuper || in_array('manage_tickets', $perms, true);
    $canAudit = $isSuper || in_array('view_audit', $perms, true);
    $isTechOnly = !$isSuper && $user['role'] === 'technician';

    $rolesRaw = $pdo->query('SELECT * FROM roles ORDER BY is_system DESC, created_at ASC')->fetchAll();
    $rolesMap = [];
    $roles = array_map(function($r) use (&$rolesMap) {
        $mapped = [
            'id' => $r['id'],
            'name' => $r['name'],
            'description' => $r['description'],
            'permissions' => json_decode($r['permissions_json'] ?: '[]', true) ?: [],
            'isSystem' => (bool)$r['is_system'],
            'createdAt' => $r['created_at'],
        ];
        $rolesMap[$r['id']] = $mapped;
        return $mapped;
    }, $rolesRaw);

    $staffRaw = $pdo->query('SELECT id, name, email, phone, role, title, skills, status, created_at AS createdAt FROM users ORDER BY created_at ASC')->fetchAll();
    $staff = array_map(function($s) use ($rolesMap) {
        $r = $rolesMap[$s['role']] ?? null;
        $s['roleName'] = $r ? $r['name'] : $s['role'];
        $s['permissions'] = $r ? $r['permissions'] : [];
        return $s;
    }, $staffRaw);

    $catalog = hiso_hydrate_catalog();

    $enquiriesRaw = $canCommercial ? $pdo->query('SELECT * FROM enquiries ORDER BY created_at DESC')->fetchAll() : [];
    $enquiries = array_map(fn($e) => [
        'id' => $e['id'],
        'refCode' => $e['ref_code'],
        'customerName' => $e['customer_name'],
        'email' => $e['email'],
        'phone' => $e['phone'],
        'location' => $e['location'],
        'channel' => $e['channel'],
        'needSummary' => $e['need_summary'],
        'appliances' => json_decode($e['appliances_json'] ?: '[]', true) ?: [],
        'estimate' => $e['estimate_json'] ? json_decode($e['estimate_json'], true) : null,
        'status' => $e['status'],
        'ownerUserId' => $e['owner_user_id'],
        'createdAt' => $e['created_at'],
    ], $enquiriesRaw);

    $quotesRaw = $canCommercial ? $pdo->query('SELECT * FROM quotations ORDER BY created_at DESC')->fetchAll() : [];
    $quotes = array_map(fn($q) => [
        'id' => $q['id'],
        'quoteCode' => $q['quote_code'],
        'enquiryId' => $q['enquiry_id'],
        'customerName' => $q['customer_name'],
        'status' => $q['status'],
        'revisionNo' => (int)$q['revision_no'],
        'scope' => $q['scope'],
        'terms' => $q['terms'],
        'note' => $q['note'],
        'discountNgn' => (float)$q['discount_ngn'],
        'taxPercent' => (float)$q['tax_percent'],
        'issuedDate' => $q['issued_date'],
        'validUntil' => $q['valid_until'],
        'approvedBy' => $q['approved_by'],
        'approvedAt' => $q['approved_at'],
        'items' => json_decode($q['items_json'] ?: '[]', true) ?: [],
        'revisions' => json_decode($q['revisions_json'] ?: '[]', true) ?: [],
    ], $quotesRaw);

    $invoicesRaw = $canCommercial ? $pdo->query('SELECT * FROM invoices ORDER BY created_at DESC')->fetchAll() : [];
    $invoices = array_map(fn($i) => [
        'id' => $i['id'],
        'invoiceCode' => $i['invoice_code'],
        'quotationId' => $i['quotation_id'],
        'enquiryId' => $i['enquiry_id'],
        'customerName' => $i['customer_name'],
        'discountNgn' => (float)$i['discount_ngn'],
        'taxPercent' => (float)$i['tax_percent'],
        'totalNgn' => (float)$i['total_ngn'],
        'bankDetails' => json_decode($i['bank_details_json'] ?: '{}', true) ?: [],
        'customerAccepted' => (bool)$i['customer_accepted'],
        'acceptedAt' => $i['accepted_at'],
        'issuedDate' => $i['issued_date'],
        'dueDate' => $i['due_date'],
        'items' => json_decode($i['items_json'] ?: '[]', true) ?: [],
    ], $invoicesRaw);

    $paymentsRaw = $canCommercial ? $pdo->query('SELECT * FROM payments ORDER BY created_at DESC')->fetchAll() : [];
    $payments = array_map(fn($p) => [
        'id' => $p['id'],
        'paymentCode' => $p['payment_code'],
        'invoiceId' => $p['invoice_id'],
        'amountNgn' => (float)$p['amount_ngn'],
        'paymentDate' => $p['payment_date'],
        'method' => $p['method'],
        'reference' => $p['reference'],
        'evidenceNote' => $p['evidence_note'],
        'status' => $p['status'],
        'recordedBy' => $p['recorded_by'],
        'verifiedBy' => $p['verified_by'],
        'verifiedAt' => $p['verified_at'],
        'rejectionReason' => $p['rejection_reason'],
        'createdAt' => $p['created_at'],
    ], $paymentsRaw);

    $jobSql = $isTechOnly
        ? 'SELECT * FROM installations WHERE assigned_engineer_id = ? ORDER BY released_at DESC'
        : 'SELECT * FROM installations ORDER BY released_at DESC';
    $jobStmt = $pdo->prepare($jobSql);
    $jobStmt->execute($isTechOnly ? [$user['id']] : []);
    $jobsRaw = $jobStmt->fetchAll();

    $updStmt = $pdo->prepare('SELECT * FROM installation_updates WHERE installation_id = ? ORDER BY created_at DESC');
    $photoStmt = $pdo->prepare('SELECT * FROM installation_photos WHERE update_id = ? ORDER BY created_at ASC');
    $installations = [];
    foreach ($jobsRaw as $j) {
        $updStmt->execute([$j['id']]);
        $updates = [];
        foreach ($updStmt->fetchAll() as $u) {
            $photoStmt->execute([$u['id']]);
            $photos = array_map(fn($ph) => [
                'id' => $ph['id'],
                'fileUrl' => '/api/files/' . $ph['id'],
                'originalName' => $ph['original_name'],
                'uploadedBy' => $ph['uploaded_by'],
                'createdAt' => $ph['created_at'],
            ], $photoStmt->fetchAll());
            $updates[] = [
                'id' => $u['id'],
                'stageNumber' => (int)$u['stage_number'],
                'activityTitle' => $u['activity_title'],
                'reportText' => $u['report_text'],
                'isCustomerVisible' => (bool)$u['is_customer_visible'],
                'createdBy' => $u['created_by'],
                'createdAt' => $u['created_at'],
                'photos' => $photos,
            ];
        }
        $installations[] = [
            'id' => $j['id'],
            'jobCode' => $j['job_code'],
            'invoiceId' => $j['invoice_id'],
            'enquiryId' => $j['enquiry_id'],
            'customerName' => $j['customer_name'],
            'location' => $j['location'],
            'systemSummary' => $j['system_summary'],
            'assignedEngineerId' => $j['assigned_engineer_id'],
            'engineerAcknowledged' => (bool)$j['engineer_acknowledged'],
            'currentStage' => (int)$j['current_stage'],
            'targetDate' => $j['target_date'],
            'releaseType' => $j['release_type'],
            'releaseNote' => $j['release_note'],
            'releasedBy' => $j['released_by'],
            'releasedAt' => $j['released_at'],
            'updates' => $updates,
        ];
    }

    $tickets = [];
    if ($canTickets) {
        if ($isTechOnly) {
            $tStmt = $pdo->prepare('SELECT * FROM service_tickets WHERE assigned_tech_id = ? ORDER BY created_at DESC');
            $tStmt->execute([$user['id']]);
            $tickets = array_map('hiso_hydrate_ticket', $tStmt->fetchAll());
        } else {
            $tickets = array_map('hiso_hydrate_ticket', $pdo->query('SELECT * FROM service_tickets ORDER BY created_at DESC')->fetchAll());
        }
    }

    $notifStmt = $pdo->prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40');
    $notifStmt->execute([$user['id']]);
    $notifications = array_map(fn($n) => [
        'id' => $n['id'],
        'userId' => $n['user_id'],
        'title' => $n['title'],
        'body' => $n['body'],
        'targetModule' => $n['target_module'],
        'targetRef' => $n['target_ref'],
        'isRead' => (bool)$n['is_read'],
        'createdAt' => $n['created_at'],
    ], $notifStmt->fetchAll());

    $auditRaw = $canAudit ? $pdo->query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 60')->fetchAll() : [];
    $auditLogs = array_map(fn($a) => [
        'id' => $a['id'],
        'actorName' => $a['actor_name'],
        'actorRole' => $a['actor_role'],
        'actionType' => $a['action_type'],
        'entityType' => $a['entity_type'],
        'entityId' => $a['entity_id'],
        'summary' => $a['summary'],
        'createdAt' => $a['created_at'],
    ], $auditRaw);

    $canOrders = $canCommercial || in_array('manage_storefront', $perms, true);
    $orders = $canOrders
        ? array_map('hiso_hydrate_order', $pdo->query('SELECT * FROM store_orders ORDER BY created_at DESC')->fetchAll())
        : [];

    return [
        'user' => $user,
        'roles' => $roles,
        'staff' => $staff,
        'catalog' => $catalog,
        'orders' => $orders,
        'enquiries' => $enquiries,
        'quotes' => $quotes,
        'invoices' => $invoices,
        'payments' => $payments,
        'installations' => $installations,
        'tickets' => $tickets,
        'notifications' => $notifications,
        'auditLogs' => $auditLogs,
    ];
}

try {
    if ($method === 'GET' && $route === 'public/bootstrap') {
        $samples = hiso_pdo()->query('SELECT ref_code, customer_name, status FROM enquiries ORDER BY created_at DESC LIMIT 4')->fetchAll();
        hiso_json_response(['catalog' => hiso_hydrate_catalog(), 'sampleRefs' => $samples]);
    }

    if ($method === 'POST' && $route === 'public/enquiries') {
        $body = hiso_json_body();
        $name = trim((string)($body['customerName'] ?? ''));
        $phone = trim((string)($body['phone'] ?? ''));
        $location = trim((string)($body['location'] ?? ''));
        if ($name === '' || $phone === '' || $location === '') {
            hiso_json_response(['error' => 'Name, phone number, and site location are required.'], 422);
        }
        $id = hiso_uuid();
        $ref = hiso_next_code('enquiries', 'ref_code', 'HISO');
        $stmt = hiso_pdo()->prepare('INSERT INTO enquiries (id, ref_code, customer_name, email, phone, location, channel, need_summary, appliances_json, estimate_json, status, owner_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "New", "admin-idee")');
        $stmt->execute([
            $id, $ref, $name, trim((string)($body['email'] ?? '')), $phone, $location,
            trim((string)($body['channel'] ?? 'Website · Load Estimator')),
            trim((string)($body['needSummary'] ?? 'Solar sizing enquiry')),
            json_encode($body['appliances'] ?? []),
            json_encode($body['estimate'] ?? null),
        ]);
        hiso_notify_roles(['superadmin', 'director', 'admin'], 'New solar enquiry ' . $ref, $name . ' (' . $location . ') submitted an enquiry.', 'enquiries', $id);
        hiso_audit(['name' => $name, 'role' => 'customer'], 'CREATE_ENQUIRY', 'Enquiry', $ref, 'Public enquiry submitted.');
        hiso_json_response(['refCode' => $ref, 'id' => $id], 201);
    }

    if ($method === 'POST' && $route === 'public/orders') {
        $body = hiso_json_body();
        $name = trim((string)($body['customerName'] ?? ''));
        $phone = trim((string)($body['phone'] ?? ''));
        $address = trim((string)($body['deliveryAddress'] ?? ($body['location'] ?? '')));
        $location = trim((string)($body['location'] ?? $address));
        $rawItems = $body['items'] ?? [];
        if ($name === '' || $phone === '' || $address === '') {
            hiso_json_response(['error' => 'Customer name, phone number, and delivery address are required.'], 422);
        }
        if (!is_array($rawItems) || count($rawItems) === 0) {
            hiso_json_response(['error' => 'Cart is empty.'], 422);
        }
        $pdo = hiso_pdo();
        $catalog = hiso_hydrate_catalog();
        $bySku = [];
        foreach ($catalog as $c) {
            $bySku[$c['sku']] = $c;
        }
        $resolved = [];
        $subtotal = 0.0;
        foreach ($rawItems as $it) {
            $qty = max(0, min(999, (int)($it['qty'] ?? 0)));
            $sku = (string)($it['sku'] ?? '');
            if ($qty <= 0 || !isset($bySku[$sku])) continue;
            $cat = $bySku[$sku];
            $subtotal += $qty * (float)$cat['priceNgn'];
            $resolved[] = [
                'sku' => $cat['sku'],
                'name' => $cat['name'],
                'unit' => $cat['unit'],
                'qty' => $qty,
                'unitPriceNgn' => (float)$cat['priceNgn'],
                'imagePath' => $cat['imagePath'],
            ];
        }
        if (count($resolved) === 0) {
            hiso_json_response(['error' => 'No valid catalogue items found in cart.'], 422);
        }
        $deliveryMethod = ($body['deliveryMethod'] ?? '') === 'Abuja Warehouse Pickup' ? 'Abuja Warehouse Pickup' : 'Nationwide Delivery';
        $paymentMethod = ($body['paymentMethod'] ?? '') === 'Pay on Delivery (Abuja)' ? 'Pay on Delivery (Abuja)' : 'Bank Transfer on Invoice';
        $deliveryFee = ($deliveryMethod === 'Abuja Warehouse Pickup' || $subtotal >= 5000000) ? 0.0 : 25000.0;
        $tax = round($subtotal * 0.075);
        $total = round($subtotal + $deliveryFee + $tax);

        $orderId = hiso_uuid();
        $orderCode = hiso_next_code('store_orders', 'order_code', 'ORD');
        $enqId = hiso_uuid();
        $refCode = hiso_next_code('enquiries', 'ref_code', 'HISO');
        $summaryList = array_map(fn($x) => $x['qty'] . '× ' . $x['name'], $resolved);
        $needSummary = 'Storefront Order ' . $orderCode . ' (' . $deliveryMethod . '): ' . implode(', ', $summaryList);

        $pdo->prepare('INSERT INTO enquiries (id, ref_code, customer_name, email, phone, location, channel, need_summary, appliances_json, estimate_json, status, owner_user_id) VALUES (?, ?, ?, ?, ?, ?, "Website · Storefront Order", ?, "[]", NULL, "New", "admin-idee")')
            ->execute([$enqId, $refCode, $name, trim((string)($body['email'] ?? '')), $phone, $location, $needSummary]);

        $pdo->prepare('INSERT INTO store_orders (id, order_code, enquiry_id, ref_code, customer_name, email, phone, location, delivery_address, delivery_method, payment_method, notes, items_json, subtotal_ngn, delivery_fee_ngn, tax_ngn, total_ngn, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "Pending")')
            ->execute([$orderId, $orderCode, $enqId, $refCode, $name, trim((string)($body['email'] ?? '')), $phone, $location, $address, $deliveryMethod, $paymentMethod, trim((string)($body['notes'] ?? '')), json_encode($resolved), $subtotal, $deliveryFee, $tax, $total]);

        hiso_notify_roles(['superadmin', 'director', 'admin'], 'New Storefront Order ' . $orderCode, $name . ' (' . $location . ') ordered ₦' . number_format($total), 'orders', $orderCode);
        hiso_audit(['name' => $name, 'role' => 'customer'], 'CREATE_ORDER', 'StoreOrder', $orderCode, 'Placed Storefront order ' . $orderCode);

        $oStmt = $pdo->prepare('SELECT * FROM store_orders WHERE id = ? LIMIT 1');
        $oStmt->execute([$orderId]);
        $orderRow = $oStmt->fetch();
        hiso_json_response(['id' => $orderId, 'orderCode' => $orderCode, 'refCode' => $refCode, 'totalNgn' => $total, 'order' => $orderRow ? hiso_hydrate_order($orderRow) : null], 201);
    }

    if ($method === 'GET' && $route === 'public/track') {
        $ref = strtoupper(trim((string)($_GET['ref'] ?? '')));
        $pdo = hiso_pdo();
        $oStmt = $pdo->prepare('SELECT * FROM store_orders WHERE UPPER(order_code) = ? LIMIT 1');
        $oStmt->execute([$ref]);
        $orderRow = $oStmt->fetch();

        if ($orderRow) {
            $stmt = $pdo->prepare('SELECT * FROM enquiries WHERE id = ? LIMIT 1');
            $stmt->execute([$orderRow['enquiry_id']]);
            $enq = $stmt->fetch();
        } else {
            $stmt = $pdo->prepare('SELECT * FROM enquiries WHERE UPPER(ref_code) = ? LIMIT 1');
            $stmt->execute([$ref]);
            $enq = $stmt->fetch();
            if ($enq) {
                $o2 = $pdo->prepare('SELECT * FROM store_orders WHERE enquiry_id = ? ORDER BY created_at DESC LIMIT 1');
                $o2->execute([$enq['id']]);
                $orderRow = $o2->fetch();
            }
        }
        if (!$enq) hiso_json_response(['error' => 'No request found for reference ' . $ref], 404);

        $qStmt = $pdo->prepare('SELECT id, quote_code, status, revision_no, issued_date, valid_until FROM quotations WHERE enquiry_id = ? AND status IN ("Approved","Invoiced") ORDER BY created_at DESC LIMIT 1');
        $qStmt->execute([$enq['id']]);
        $quote = $qStmt->fetch();

        $iStmt = $pdo->prepare('SELECT id, invoice_code, total_ngn, customer_accepted, accepted_at, issued_date, due_date FROM invoices WHERE enquiry_id = ? ORDER BY created_at DESC LIMIT 1');
        $iStmt->execute([$enq['id']]);
        $inv = $iStmt->fetch();

        $confirmedPaid = 0.0;
        if ($inv) {
            $pStmt = $pdo->prepare('SELECT COALESCE(SUM(amount_ngn),0) FROM payments WHERE invoice_id = ? AND status = "Confirmed"');
            $pStmt->execute([$inv['id']]);
            $confirmedPaid = (float)$pStmt->fetchColumn();
        }

        $jStmt = $pdo->prepare('SELECT * FROM installations WHERE enquiry_id = ? LIMIT 1');
        $jStmt->execute([$enq['id']]);
        $job = $jStmt->fetch();
        $jobPayload = null;
        if ($job) {
            $uStmt = $pdo->prepare('SELECT * FROM installation_updates WHERE installation_id = ? AND is_customer_visible = 1 ORDER BY created_at DESC');
            $uStmt->execute([$job['id']]);
            $updates = [];
            $phStmt = $pdo->prepare('SELECT id, original_name, created_at FROM installation_photos WHERE update_id = ?');
            foreach ($uStmt->fetchAll() as $u) {
                $phStmt->execute([$u['id']]);
                $photos = array_map(fn($ph) => ['id' => $ph['id'], 'fileUrl' => '/api/files/' . $ph['id'], 'originalName' => $ph['original_name']], $phStmt->fetchAll());
                $updates[] = [
                    'id' => $u['id'], 'stageNumber' => (int)$u['stage_number'], 'activityTitle' => $u['activity_title'],
                    'reportText' => $u['report_text'], 'createdAt' => $u['created_at'], 'photos' => $photos,
                ];
            }
            $jobPayload = [
                'jobCode' => $job['job_code'], 'systemSummary' => $job['system_summary'],
                'currentStage' => (int)$job['current_stage'], 'targetDate' => $job['target_date'], 'updates' => $updates,
            ];
        }

        hiso_json_response([
            'enquiry' => [
                'refCode' => $enq['ref_code'], 'customerName' => $enq['customer_name'], 'location' => $enq['location'],
                'status' => $enq['status'], 'createdAt' => $enq['created_at'],
                'estimate' => $enq['estimate_json'] ? json_decode($enq['estimate_json'], true) : null,
            ],
            'quotation' => $quote ? ['id' => $quote['id'], 'quoteCode' => $quote['quote_code'], 'status' => $quote['status'], 'revisionNo' => (int)$quote['revision_no'], 'validUntil' => $quote['valid_until']] : null,
            'invoice' => $inv ? ['id' => $inv['id'], 'invoiceCode' => $inv['invoice_code'], 'totalNgn' => (float)$inv['total_ngn'], 'confirmedPaidNgn' => $confirmedPaid, 'balanceNgn' => max(0, (float)$inv['total_ngn'] - $confirmedPaid), 'customerAccepted' => (bool)$inv['customer_accepted'], 'dueDate' => $inv['due_date']] : null,
            'installation' => $jobPayload,
            'order' => $orderRow ? hiso_hydrate_order($orderRow) : null,
        ]);
    }

    if ($method === 'POST' && $route === 'public/accept-invoice') {
        $body = hiso_json_body();
        hiso_pdo()->prepare('UPDATE invoices SET customer_accepted = 1, accepted_at = NOW() WHERE id = ?')->execute([(string)($body['invoiceId'] ?? '')]);
        hiso_json_response(['accepted' => true]);
    }

    if ($method === 'GET' && $route === 'public/documents') {
        $type = ($_GET['type'] ?? 'quote') === 'invoice' ? 'invoice' : 'quote';
        $id = (string)($_GET['id'] ?? '');
        if ($type === 'invoice') {
            $stmt = hiso_pdo()->prepare('SELECT i.*, e.location, e.phone, e.email, e.ref_code FROM invoices i JOIN enquiries e ON e.id = i.enquiry_id WHERE i.id = ? OR i.invoice_code = ? LIMIT 1');
            $stmt->execute([$id, $id]);
            $row = $stmt->fetch();
            if (!$row) hiso_json_response(['error' => 'Invoice not found.'], 404);
            hiso_json_response([
                'type' => 'invoice', 'documentCode' => $row['invoice_code'], 'customerName' => $row['customer_name'],
                'location' => $row['location'], 'phone' => $row['phone'], 'email' => $row['email'], 'refCode' => $row['ref_code'],
                'issuedDate' => $row['issued_date'], 'dueDate' => $row['due_date'], 'discountNgn' => (float)$row['discount_ngn'],
                'taxPercent' => (float)$row['tax_percent'], 'totalNgn' => (float)$row['total_ngn'],
                'bankDetails' => json_decode($row['bank_details_json'] ?: '{}', true),
                'customerAccepted' => (bool)$row['customer_accepted'], 'items' => json_decode($row['items_json'] ?: '[]', true),
            ]);
        } else {
            $stmt = hiso_pdo()->prepare('SELECT q.*, e.location, e.phone, e.email, e.ref_code FROM quotations q JOIN enquiries e ON e.id = q.enquiry_id WHERE q.id = ? OR q.quote_code = ? LIMIT 1');
            $stmt->execute([$id, $id]);
            $row = $stmt->fetch();
            if (!$row) hiso_json_response(['error' => 'Quotation not found.'], 404);
            hiso_json_response([
                'type' => 'quote', 'documentCode' => $row['quote_code'], 'revisionNo' => (int)$row['revision_no'], 'status' => $row['status'],
                'customerName' => $row['customer_name'], 'location' => $row['location'], 'phone' => $row['phone'], 'email' => $row['email'], 'refCode' => $row['ref_code'],
                'scope' => $row['scope'], 'terms' => $row['terms'], 'note' => $row['note'], 'issuedDate' => $row['issued_date'], 'validUntil' => $row['valid_until'],
                'discountNgn' => (float)$row['discount_ngn'], 'taxPercent' => (float)$row['tax_percent'], 'approvedBy' => $row['approved_by'], 'items' => json_decode($row['items_json'] ?: '[]', true),
            ]);
        }
    }

    // --- Customer Portal Endpoints ---
    if ($method === 'POST' && $route === 'customer/login-link') {
        global $CONFIG;
        $body = hiso_json_body();
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $name = trim((string)($body['name'] ?? ''));
        $phone = trim((string)($body['phone'] ?? ''));
        $location = trim((string)($body['location'] ?? ''));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190) {
            hiso_json_response(['error' => 'Enter a valid email address.'], 422);
        }
        if (strlen($name) > 120 || strlen($phone) > 40 || strlen($location) > 190) {
            hiso_json_response(['error' => 'Some customer details exceed the allowed length.'], 422);
        }
        $appUrl = (string)($CONFIG['APP_URL'] ?? '');
        $mailFrom = (string)($CONFIG['MAIL_FROM'] ?? '');
        $parts = parse_url($appUrl);
        if (!$parts || empty($parts['host']) || !in_array($parts['scheme'] ?? '', ['https', 'http'], true)
            || !filter_var($mailFrom, FILTER_VALIDATE_EMAIL)
            || (!empty($CONFIG['SESSION_SECURE']) && ($parts['scheme'] ?? '') !== 'https')) {
            hiso_json_response(['error' => 'Customer email sign-in is not configured yet.'], 503);
        }
        $remote = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
        if (!hiso_customer_auth_rate_limit('email:' . $email, 5, 900)
            || !hiso_customer_auth_rate_limit('address:' . $remote, 20, 3600)) {
            hiso_json_response(['error' => 'Too many sign-in requests. Please try again later.'], 429);
        }

        $pdo = hiso_pdo();
        $lookup = $pdo->prepare('SELECT id FROM customer_profiles WHERE LOWER(email) = ? LIMIT 1');
        $lookup->execute([$email]);
        $customerId = $lookup->fetchColumn();
        if (!$customerId && $name !== '') {
            $customerId = hiso_uuid();
            $pdo->prepare('INSERT INTO customer_profiles (id, name, email, phone, location, company, ref_code) VALUES (?, ?, ?, ?, ?, ?, ?)')->execute([
                $customerId, $name, $email, $phone, $location,
                trim((string)($body['company'] ?? '')), trim((string)($body['refCode'] ?? '')),
            ]);
        }
        if ($customerId) {
            $token = bin2hex(random_bytes(32));
            $tokenHash = hash('sha256', $token);
            $pdo->prepare('DELETE FROM customer_login_tokens WHERE customer_id = ?')->execute([$customerId]);
            $pdo->prepare('INSERT INTO customer_login_tokens (token_hash, customer_id, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE))')
                ->execute([$tokenHash, $customerId]);
            $link = rtrim($appUrl, '/') . '/#customer?token=' . rawurlencode($token);
            try {
                hiso_send_mail(
                    $email,
                    'Your HI-SOTECH customer sign-in link',
                    "Use this one-time link to access your HI-SOTECH customer portal:\n\n{$link}\n\nThe link expires in 15 minutes and can only be used once. If you did not request it, you can ignore this message."
                );
            } catch (Throwable $e) {
                $pdo->prepare('DELETE FROM customer_login_tokens WHERE token_hash = ?')->execute([$tokenHash]);
                hiso_json_response(['error' => 'The sign-in email could not be sent. Please try again later.'], 503);
            }
        }
        hiso_json_response([
            'ok' => true,
            'message' => 'If this email can access the customer portal, a one-time sign-in link will arrive shortly.',
        ], 202);
    }

    if ($method === 'POST' && $route === 'customer/verify') {
        $body = hiso_json_body();
        $token = (string)($body['token'] ?? '');
        if (!preg_match('/^[a-f0-9]{64}$/', $token)) {
            hiso_json_response(['error' => 'This sign-in link is invalid or has expired.'], 422);
        }
        $pdo = hiso_pdo();
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare('SELECT customer_id FROM customer_login_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP() LIMIT 1');
            $stmt->execute([hash('sha256', $token)]);
            $customerId = $stmt->fetchColumn();
            if (!$customerId) {
                $pdo->rollBack();
                hiso_json_response(['error' => 'This sign-in link is invalid or has expired.'], 422);
            }
            $consume = $pdo->prepare('UPDATE customer_login_tokens SET used_at = UTC_TIMESTAMP() WHERE token_hash = ? AND used_at IS NULL');
            $consume->execute([hash('sha256', $token)]);
            if ($consume->rowCount() !== 1) {
                $pdo->rollBack();
                hiso_json_response(['error' => 'This sign-in link is invalid or has expired.'], 422);
            }
            $pdo->prepare('UPDATE customer_profiles SET email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()) WHERE id = ?')
                ->execute([$customerId]);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
        hiso_start_session();
        session_regenerate_id(true);
        $_SESSION['customer_id'] = $customerId;
        $customer = hiso_current_customer();
        if (!$customer) hiso_json_response(['error' => 'Customer verification could not be completed.'], 500);
        hiso_json_response(hiso_customer_portal_data($customer));
    }

    if ($method === 'GET' && $route === 'customer/session') {
        $customer = hiso_current_customer();
        hiso_json_response($customer
            ? ['authenticated' => true] + hiso_customer_portal_data($customer)
            : ['authenticated' => false, 'profile' => null, 'equipment' => [], 'tickets' => []]);
    }

    if ($method === 'POST' && $route === 'customer/logout') {
        hiso_start_session();
        unset($_SESSION['customer_id']);
        session_regenerate_id(true);
        hiso_json_response(['ok' => true]);
    }

    if ($method === 'POST' && $route === 'customer/profile') {
        $customer = hiso_require_customer();
        $body = hiso_json_body();
        $name = trim((string)($body['name'] ?? ''));
        $phone = trim((string)($body['phone'] ?? ''));
        $location = trim((string)($body['location'] ?? ''));
        $company = trim((string)($body['company'] ?? ''));
        $refCode = trim((string)($body['refCode'] ?? ''));
        if ($name === '' || strlen($name) > 120 || strlen($phone) > 40 || strlen($location) > 190
            || strlen($company) > 150 || strlen($refCode) > 32) {
            hiso_json_response(['error' => 'Customer profile details are invalid or too long.'], 422);
        }
        $pdo = hiso_pdo();
        $pdo->prepare('UPDATE customer_profiles SET name=?, phone=?, location=?, company=?, ref_code=? WHERE id=? AND email_verified_at IS NOT NULL')
            ->execute([$name, $phone, $location, $company, $refCode, $customer['id']]);
        $stmt = $pdo->prepare('SELECT id, name, email, phone, location, company, ref_code, created_at FROM customer_profiles WHERE id = ? AND email_verified_at IS NOT NULL');
        $stmt->execute([$customer['id']]);
        $updated = $stmt->fetch();
        if (!$updated) hiso_json_response(['error' => 'Verified customer profile not found.'], 404);
        hiso_json_response(['profile' => [
            'id' => $updated['id'], 'name' => $updated['name'], 'email' => $updated['email'], 'phone' => $updated['phone'],
            'location' => $updated['location'], 'company' => $updated['company'], 'refCode' => $updated['ref_code'], 'createdAt' => $updated['created_at'],
        ]]);
    }

    if ($method === 'POST' && $route === 'customer/equipment') {
        $customer = hiso_require_customer();
        $body = hiso_json_body();
        $type = trim((string)($body['equipmentType'] ?? ''));
        $brand = trim((string)($body['brandModel'] ?? ''));
        $serial = trim((string)($body['serialNumber'] ?? ''));
        $capacity = trim((string)($body['capacityKw'] ?? ''));
        $installDate = trim((string)($body['installDate'] ?? ''));
        $notes = trim((string)($body['notes'] ?? ''));
        if ($type === '' || $brand === '' || strlen($type) > 120 || strlen($brand) > 180
            || strlen($serial) > 120 || strlen($capacity) > 40 || strlen($installDate) > 20 || strlen($notes) > 2000) {
            hiso_json_response(['error' => 'Equipment details are invalid or too long.'], 422);
        }
        $pdo = hiso_pdo();
        if (!empty($body['id'])) {
            $stmt = $pdo->prepare('UPDATE customer_equipment SET equipment_type=?, brand_model=?, serial_number=?, capacity_kw=?, install_date=?, notes=? WHERE id=? AND customer_id=?');
            $stmt->execute([$type, $brand, $serial, $capacity, $installDate, $notes, $body['id'], $customer['id']]);
        } else {
            $pdo->prepare('INSERT INTO customer_equipment (id, customer_id, equipment_type, brand_model, serial_number, capacity_kw, install_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([hiso_uuid(), $customer['id'], $type, $brand, $serial, $capacity, $installDate, $notes]);
        }
        $eqStmt = $pdo->prepare('SELECT * FROM customer_equipment WHERE customer_id = ? ORDER BY created_at DESC');
        $eqStmt->execute([$customer['id']]);
        hiso_json_response(['equipment' => array_map(fn($e) => [
            'id' => $e['id'], 'customerId' => $e['customer_id'], 'equipmentType' => $e['equipment_type'],
            'brandModel' => $e['brand_model'], 'serialNumber' => $e['serial_number'], 'capacityKw' => $e['capacity_kw'],
            'installDate' => $e['install_date'], 'notes' => $e['notes'], 'createdAt' => $e['created_at'],
        ], $eqStmt->fetchAll())]);
    }

    if ($method === 'POST' && $route === 'customer/tickets') {
        $customer = hiso_require_customer();
        $body = hiso_json_body();
        $subject = trim((string)($body['subject'] ?? ''));
        $description = trim((string)($body['description'] ?? ''));
        $category = (string)($body['category'] ?? '');
        $priority = (string)($body['priority'] ?? '');
        if ($subject === '' || strlen($subject) > 160 || $description === '' || strlen($description) > 3000
            || !in_array($category, ['Service Request', 'Complaint', 'Warranty Claim', 'Preventive Maintenance'], true)
            || !in_array($priority, ['Normal', 'Urgent'], true)) {
            hiso_json_response(['error' => 'Service request details are invalid or too long.'], 422);
        }
        $pdo = hiso_pdo();
        $equipmentId = trim((string)($body['equipmentId'] ?? ''));
        $eqSummary = 'General System / Site';
        if ($equipmentId !== '') {
            $eStmt = $pdo->prepare('SELECT * FROM customer_equipment WHERE id = ? AND customer_id = ? LIMIT 1');
            $eStmt->execute([$equipmentId, $customer['id']]);
            $eq = $eStmt->fetch();
            if (!$eq) hiso_json_response(['error' => 'Selected equipment was not found.'], 422);
            $eqSummary = $eq['equipment_type'] . ' — ' . $eq['brand_model'] . ($eq['serial_number'] ? ' (S/N: ' . $eq['serial_number'] . ')' : '');
        }
        $code = hiso_next_code('service_tickets', 'ticket_code', 'TKT');
        $pdo->prepare('INSERT INTO service_tickets (id, ticket_code, customer_id, customer_name, customer_phone, location, equipment_id, equipment_summary, category, priority, subject, description, status, resolution_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "Open", "Logged to Help Desk queue.")')->execute([
            hiso_uuid(), $code, $customer['id'], $customer['name'], $customer['phone'] ?: 'Not provided', $customer['location'] ?: 'Nigeria',
            $equipmentId !== '' ? $equipmentId : null, $eqSummary, $category, $priority, $subject, $description,
        ]);
        hiso_notify_roles(['admin', 'superadmin', 'director'], 'New ' . $category . ': ' . $code, $customer['name'] . ' — ' . $subject, 'tickets', $code);
        hiso_audit(['name' => $customer['name'], 'role' => 'customer'], 'CREATE_TICKET', 'ServiceTicket', $code, 'Customer filed ' . $category);
        $tStmt = $pdo->prepare('SELECT * FROM service_tickets WHERE customer_id = ? ORDER BY created_at DESC');
        $tStmt->execute([$customer['id']]);
        hiso_json_response(['ticketCode' => $code, 'tickets' => array_map('hiso_hydrate_ticket', $tStmt->fetchAll())], 201);
    }

    // --- Auth Endpoints ---
    if ($method === 'POST' && $route === 'setup/first-admin') {
        global $CONFIG;
        $body = hiso_json_body();
        $setupSecret = (string)($CONFIG['SETUP_SECRET'] ?? '');
        if ($setupSecret === '' || !hash_equals($setupSecret, (string)($body['setupSecret'] ?? ''))) {
            hiso_json_response(['error' => 'Initial account setup is unavailable.'], 403);
        }
        $name = trim((string)($body['name'] ?? ''));
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $phone = trim((string)($body['phone'] ?? ''));
        $password = (string)($body['password'] ?? '');
        if ($name === '' || strlen($name) > 120 || !filter_var($email, FILTER_VALIDATE_EMAIL)
            || strlen($email) > 190 || strlen($phone) > 40 || strlen($password) < 14 || strlen($password) > 128) {
            hiso_json_response(['error' => 'Name, valid email, phone, and a 14-character password are required.'], 422);
        }
        $pdo = hiso_pdo();
        $pdo->beginTransaction();
        try {
            $pdo->exec('INSERT IGNORE INTO app_setup (id, completed_at) VALUES (1, NULL)');
            $setupStmt = $pdo->query('SELECT completed_at FROM app_setup WHERE id = 1 FOR UPDATE');
            $setupState = $setupStmt->fetch();
            if (!$setupState || $setupState['completed_at'] !== null) {
                $pdo->rollBack();
                hiso_json_response(['error' => 'Initial setup has already been completed.'], 409);
            }
            $usersCount = (int)$pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
            if ($usersCount !== 0) {
                $pdo->rollBack();
                hiso_json_response(['error' => 'Initial setup has already been completed.'], 409);
            }
            $id = hiso_uuid();
            $pdo->prepare('INSERT INTO users (id, name, email, phone, password_hash, role, title, skills, status) VALUES (?, ?, ?, ?, ?, "superadmin", "System Super Administrator", "", "Active")')
                ->execute([$id, $name, $email, $phone, password_hash($password, PASSWORD_DEFAULT)]);
            $pdo->exec('UPDATE app_setup SET completed_at = UTC_TIMESTAMP() WHERE id = 1');
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
        hiso_start_session();
        session_regenerate_id(true);
        $_SESSION['user_id'] = $id;
        $user = hiso_current_user();
        hiso_json_response(['user' => $user], 201);
    }

    if ($method === 'POST' && $route === 'auth/login') {
        global $CONFIG;
        $body = hiso_json_body();
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $password = (string)($body['password'] ?? '');
        if (strlen($email) > 190 || strlen($password) > 128) {
            hiso_json_response(['error' => 'Invalid email or password.'], 422);
        }
        $clientAddress = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
        if (!hiso_customer_auth_rate_limit('staff-ip:' . $clientAddress, 10, 900)
            || !hiso_customer_auth_rate_limit('staff-email:' . $email, 5, 900)) {
            hiso_json_response(['error' => 'Too many sign-in attempts. Please try again later.'], 429);
        }
        $stmt = hiso_pdo()->prepare('SELECT * FROM users WHERE LOWER(email) = ? AND status = "Active" LIMIT 1');
        $stmt->execute([$email]);
        $user = $stmt->fetch();
        $demoBypass = ($CONFIG['APP_ENV'] ?? 'production') !== 'production'
            && !empty($CONFIG['ALLOW_DEMO_LOGIN']) && !empty($body['demoQuickLogin']);
        if (!$user || (!$demoBypass && !password_verify($password, $user['password_hash']))) {
            hiso_json_response(['error' => 'Invalid email or password.'], 401);
        }
        hiso_start_session();
        session_regenerate_id(true);
        $_SESSION['user_id'] = $user['id'];
        unset($user['password_hash']);
        $user['permissions'] = hiso_user_permissions((string)$user['role']);
        hiso_json_response(['user' => $user]);
    }

    if ($method === 'POST' && $route === 'auth/logout') {
        hiso_start_session();
        $_SESSION = [];
        session_destroy();
        hiso_json_response(['ok' => true]);
    }

    if ($method === 'GET' && $route === 'auth/session') {
        $user = hiso_current_user();
        hiso_json_response(['authenticated' => (bool)$user, 'user' => $user ?: null]);
    }

    if ($method === 'GET' && $route === 'auth/me') {
        $user = hiso_current_user();
        if (!$user) hiso_json_response(['error' => 'Not signed in.'], 401);
        hiso_json_response(['user' => $user]);
    }

    // --- Authenticated Workspace Endpoints ---
    if ($method === 'GET' && $route === 'workspace/bootstrap') {
        $user = hiso_current_user();
        if (!$user) hiso_json_response(['error' => 'Authentication required.'], 401);
        hiso_json_response(hiso_hydrate_workspace($user));
    }

    if ($method === 'POST' && $route === 'enquiries') {
        $user = hiso_require_permission('manage_enquiries');
        $body = hiso_json_body();
        $id = hiso_uuid();
        $ref = hiso_next_code('enquiries', 'ref_code', 'HISO');
        hiso_pdo()->prepare('INSERT INTO enquiries (id, ref_code, customer_name, email, phone, location, channel, need_summary, appliances_json, estimate_json, status, owner_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, "[]", NULL, "Technical review", ?)')->execute([
            $id, $ref, trim((string)$body['customerName']), trim((string)($body['email'] ?? '')),
            trim((string)$body['phone']), trim((string)$body['location']), trim((string)($body['channel'] ?? 'Phone / WhatsApp')),
            trim((string)$body['needSummary']), $user['id'],
        ]);
        hiso_audit($user, 'CREATE_ENQUIRY', 'Enquiry', $ref, 'Logged manual enquiry for ' . $body['customerName']);
        hiso_json_response(['id' => $id, 'refCode' => $ref], 201);
    }

    if ($method === 'POST' && $route === 'catalog') {
        $user = hiso_require_permission('manage_storefront');
        $body = hiso_json_body();
        $sku = trim((string)($body['sku'] ?? ''));
        if ($sku === '') hiso_json_response(['error' => 'SKU is required.'], 422);
        $imgPath = trim((string)($body['imagePath'] ?? '/src/assets/images/catalog_hybrid_inverter_1794819207311.jpg'));
        if (!empty($body['imageDataUrl'])) {
            $stored = hiso_store_photo_data_url((string)$body['imageDataUrl'], 'cat-' . $sku . '.jpg');
            $imgPath = '/api/catalog-image/' . $stored['storage_filename'];
        }
        $stmt = hiso_pdo()->prepare('INSERT INTO catalog_items (id, sku, name, item_type, category, unit, price_ngn, stock_qty, capacity_kw, watts, description, image_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), item_type=VALUES(item_type), category=VALUES(category), unit=VALUES(unit), price_ngn=VALUES(price_ngn), stock_qty=VALUES(stock_qty), capacity_kw=VALUES(capacity_kw), watts=VALUES(watts), description=VALUES(description), image_path=VALUES(image_path)');
        $stmt->execute([
            hiso_uuid(), $sku, trim((string)$body['name']), trim((string)($body['itemType'] ?? 'equipment')),
            trim((string)$body['category']), trim((string)($body['unit'] ?? 'unit')),
            (float)$body['priceNgn'], (int)$body['stockQty'],
            isset($body['capacityKw']) && $body['capacityKw'] !== '' ? (float)$body['capacityKw'] : null,
            isset($body['watts']) && $body['watts'] !== '' ? (int)$body['watts'] : null,
            trim((string)($body['description'] ?? '')),
            $imgPath,
        ]);
        hiso_audit($user, 'UPSERT_CATALOG', 'Catalog', $sku, 'Updated storefront SKU ' . $sku);
        hiso_json_response(['ok' => true, 'imagePath' => $imgPath]);
    }

    if ($method === 'POST' && $route === 'catalog/delete') {
        $user = hiso_require_permission('manage_storefront');
        $body = hiso_json_body();
        hiso_pdo()->prepare('DELETE FROM catalog_items WHERE sku = ?')->execute([trim((string)$body['sku'])]);
        hiso_audit($user, 'DELETE_CATALOG', 'Catalog', (string)$body['sku'], 'Removed storefront SKU');
        hiso_json_response(['ok' => true]);
    }

    if ($method === 'POST' && $route === 'quotes') {
        $user = hiso_require_permission('draft_quotes');
        $body = hiso_json_body();
        $pdo = hiso_pdo();
        $items = $body['items'] ?? [];
        $discount = (float)($body['discountNgn'] ?? 0);
        $tax = (float)($body['taxPercent'] ?? 0);
        $subtotal = 0.0;
        foreach ($items as $it) $subtotal += (float)$it['qty'] * (float)$it['unitPriceNgn'];
        $taxable = max(0, $subtotal - min($subtotal, max(0, $discount)));
        $total = round($taxable * (1 + max(0, $tax) / 100));
        $status = !empty($body['submitForApproval']) ? 'Pending MD' : 'Draft';

        if (!empty($body['quoteId'])) {
            $stmt = $pdo->prepare('SELECT * FROM quotations WHERE id = ? LIMIT 1');
            $stmt->execute([$body['quoteId']]);
            $existing = $stmt->fetch();
            if (!$existing) hiso_json_response(['error' => 'Quotation not found.'], 404);
            $revNo = (int)$existing['revision_no'] + 1;
            $revs = json_decode($existing['revisions_json'] ?: '[]', true) ?: [];
            $revs[] = ['revisionNo' => $revNo, 'changedBy' => $user['name'], 'note' => $body['note'] ?? 'Revised', 'createdAt' => gmdate('c'), 'totalNgn' => $total];
            $pdo->prepare('UPDATE quotations SET status=?, revision_no=?, scope=?, terms=?, note=?, discount_ngn=?, tax_percent=?, valid_until=?, items_json=?, revisions_json=? WHERE id=?')
                ->execute([$status, $revNo, $body['scope'], $body['terms'], $body['note'], $discount, $tax, $body['validUntil'], json_encode($items), json_encode($revs), $existing['id']]);
            $code = $existing['quote_code'];
        } else {
            $id = hiso_uuid();
            $code = hiso_next_code('quotations', 'quote_code', 'QUO');
            $revs = [['revisionNo' => 1, 'changedBy' => $user['name'], 'note' => 'Initial quotation', 'createdAt' => gmdate('c'), 'totalNgn' => $total]];
            $pdo->prepare('INSERT INTO quotations (id, quote_code, enquiry_id, customer_name, status, revision_no, scope, terms, note, discount_ngn, tax_percent, issued_date, valid_until, items_json, revisions_json) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, CURDATE(), ?, ?, ?)')
                ->execute([$id, $code, $body['enquiryId'], $body['customerName'], $status, $body['scope'], $body['terms'], $body['note'], $discount, $tax, $body['validUntil'], json_encode($items), json_encode($revs)]);
            $pdo->prepare('UPDATE enquiries SET status = "Quoted" WHERE id = ? AND status IN ("New","Technical review")')->execute([$body['enquiryId']]);
        }
        if ($status === 'Pending MD') {
            hiso_notify_roles(['director', 'superadmin'], 'Quotation awaiting approval: ' . $code, $body['customerName'] . ' submitted for Director review.', 'quotes', $code);
        }
        hiso_audit($user, 'SAVE_QUOTE', 'Quotation', $code, 'Saved quotation (' . $status . ')');
        hiso_json_response(['quoteCode' => $code]);
    }

    if ($method === 'POST' && $route === 'quotes/approve') {
        $user = hiso_require_permission('approve_quotes');
        $body = hiso_json_body();
        $decision = ($body['decision'] ?? '') === 'Approved' ? 'Approved' : 'Rejected';
        hiso_pdo()->prepare('UPDATE quotations SET status = ?, approved_by = ?, approved_at = NOW() WHERE id = ?')->execute([$decision, $user['name'], $body['quoteId']]);
        hiso_notify_roles(['admin'], 'Quotation ' . $decision, $user['name'] . ' marked quotation ' . $decision . '.', 'quotes', (string)$body['quoteId']);
        hiso_audit($user, 'DECIDE_QUOTE', 'Quotation', (string)$body['quoteId'], 'Quotation ' . $decision);
        hiso_json_response(['status' => $decision]);
    }

    if ($method === 'POST' && $route === 'invoices') {
        $user = hiso_require_permission('manage_invoices');
        $body = hiso_json_body();
        $pdo = hiso_pdo();
        $qStmt = $pdo->prepare('SELECT * FROM quotations WHERE id = ? LIMIT 1');
        $qStmt->execute([$body['quotationId']]);
        $quote = $qStmt->fetch();
        if (!$quote || $quote['status'] !== 'Approved') hiso_json_response(['error' => 'Only Approved quotations can be invoiced.'], 422);
        $items = json_decode($quote['items_json'], true);
        $subtotal = 0.0;
        foreach ($items as $it) $subtotal += (float)$it['qty'] * (float)$it['unitPriceNgn'];
        $taxable = max(0, $subtotal - min($subtotal, (float)$quote['discount_ngn']));
        $total = round($taxable * (1 + (float)$quote['tax_percent'] / 100));

        $invId = hiso_uuid();
        $invCode = hiso_next_code('invoices', 'invoice_code', 'INV');
        $pdo->prepare('INSERT INTO invoices (id, invoice_code, quotation_id, enquiry_id, customer_name, discount_ngn, tax_percent, total_ngn, bank_details_json, issued_date, due_date, items_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 14 DAY), ?)')
            ->execute([$invId, $invCode, $quote['id'], $quote['enquiry_id'], $quote['customer_name'], $quote['discount_ngn'], $quote['tax_percent'], $total, json_encode(['bankName' => 'Example Bank', 'accountName' => 'DEMO ONLY - DO NOT PAY', 'accountNumber' => '0000000000']), $quote['items_json']]);
        $pdo->prepare('UPDATE quotations SET status = "Invoiced" WHERE id = ?')->execute([$quote['id']]);
        $pdo->prepare('UPDATE enquiries SET status = "Invoiced" WHERE id = ?')->execute([$quote['enquiry_id']]);
        hiso_audit($user, 'ISSUE_INVOICE', 'Invoice', $invCode, 'Issued proforma invoice from ' . $quote['quote_code']);
        hiso_json_response(['id' => $invId, 'invoiceCode' => $invCode], 201);
    }

    if ($method === 'POST' && $route === 'payments') {
        $user = hiso_require_permission('manage_invoices');
        $body = hiso_json_body();
        $payId = hiso_uuid();
        $payCode = hiso_next_code('payments', 'payment_code', 'PAY');
        hiso_pdo()->prepare('INSERT INTO payments (id, payment_code, invoice_id, amount_ngn, payment_date, method, reference, evidence_note, status, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, "Pending", ?)')
            ->execute([$payId, $payCode, $body['invoiceId'], (float)$body['amountNgn'], $body['paymentDate'] ?? date('Y-m-d'), $body['method'], $body['reference'], $body['evidenceNote'], $user['name']]);
        hiso_notify_roles(['director', 'superadmin'], 'Receipt pending verification: ' . $payCode, 'Amount ₦' . number_format((float)$body['amountNgn']) . ' awaiting confirmation.', 'finance', $payCode);
        hiso_audit($user, 'LOG_PAYMENT', 'Payment', $payCode, 'Logged payment receipt pending verification.');
        hiso_json_response(['id' => $payId, 'paymentCode' => $payCode], 201);
    }

    if ($method === 'POST' && $route === 'payments/verify') {
        $user = hiso_require_permission('verify_payments');
        $body = hiso_json_body();
        $decision = ($body['decision'] ?? '') === 'Confirmed' ? 'Confirmed' : 'Rejected';
        hiso_pdo()->prepare('UPDATE payments SET status = ?, verified_by = ?, verified_at = NOW(), rejection_reason = ? WHERE id = ?')->execute([$decision, $user['name'], $body['reason'] ?? null, $body['paymentId']]);
        hiso_audit($user, 'VERIFY_PAYMENT', 'Payment', (string)$body['paymentId'], 'Receipt ' . $decision);
        hiso_json_response(['status' => $decision]);
    }

    if ($method === 'POST' && $route === 'installations/release') {
        $user = hiso_require_permission('release_installations');
        $body = hiso_json_body();
        $pdo = hiso_pdo();
        $invStmt = $pdo->prepare('SELECT i.*, e.location FROM invoices i JOIN enquiries e ON e.id = i.enquiry_id WHERE i.id = ? LIMIT 1');
        $invStmt->execute([$body['invoiceId']]);
        $inv = $invStmt->fetch();
        if (!$inv) hiso_json_response(['error' => 'Invoice not found.'], 404);

        $pStmt = $pdo->prepare('SELECT COALESCE(SUM(amount_ngn),0) FROM payments WHERE invoice_id = ? AND status = "Confirmed"');
        $pStmt->execute([$inv['id']]);
        $balance = max(0, (float)$inv['total_ngn'] - (float)$pStmt->fetchColumn());
        $releaseType = ($body['releaseType'] ?? '') === 'MD Exception' ? 'MD Exception' : 'Full Payment';
        $releaseNote = trim((string)($body['releaseNote'] ?? ''));
        if ($balance > 1 && $releaseType === 'Full Payment') hiso_json_response(['error' => 'Balance remains unpaid. Confirm receipts or record an MD Exception.'], 422);
        if ($releaseType === 'MD Exception' && strlen($releaseNote) < 8) hiso_json_response(['error' => 'MD Exception requires a clear recorded justification.'], 422);

        $jobId = hiso_uuid();
        $jobCode = hiso_next_code('installations', 'job_code', 'JOB');
        $engId = $body['assignedEngineerId'] ?: null;
        $pdo->prepare('INSERT INTO installations (id, job_code, invoice_id, enquiry_id, customer_name, location, system_summary, assigned_engineer_id, engineer_acknowledged, current_stage, target_date, release_type, release_note, released_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?)')
            ->execute([$jobId, $jobCode, $inv['id'], $inv['enquiry_id'], $inv['customer_name'], $inv['location'], $body['systemSummary'] ?? 'Solar Hybrid Installation', $engId, $body['targetDate'] ?? date('Y-m-d', strtotime('+10 days')), $releaseType, $releaseNote ?: 'Full verified settlement', $user['name']]);
        $pdo->prepare('UPDATE enquiries SET status = "In delivery" WHERE id = ?')->execute([$inv['enquiry_id']]);
        if ($engId) hiso_notify($engId, 'New installation assigned: ' . $jobCode, $inv['customer_name'] . ' (' . $inv['location'] . ') released for delivery.', 'jobs', $jobId);
        hiso_audit($user, 'RELEASE_INSTALLATION', 'Installation', $jobCode, 'Released installation (' . $releaseType . ').');
        hiso_json_response(['id' => $jobId, 'jobCode' => $jobCode], 201);
    }

    if ($method === 'POST' && $route === 'installations/assign') {
        $user = hiso_require_permission('manage_enquiries');
        $body = hiso_json_body();
        hiso_pdo()->prepare('UPDATE installations SET assigned_engineer_id = ?, engineer_acknowledged = 0 WHERE id = ?')->execute([$body['engineerId'], $body['installationId']]);
        hiso_notify((string)$body['engineerId'], 'Installation assigned', 'Please review and acknowledge your assigned installation.', 'jobs', (string)$body['installationId']);
        hiso_audit($user, 'ASSIGN_TECHNICIAN', 'Installation', (string)$body['installationId'], 'Assigned technician.');
        hiso_json_response(['ok' => true]);
    }

    if ($method === 'POST' && $route === 'installations/ack') {
        $user = hiso_current_user();
        if (!$user) hiso_json_response(['error' => 'Authentication required.'], 401);
        $body = hiso_json_body();
        hiso_pdo()->prepare('UPDATE installations SET engineer_acknowledged = 1 WHERE id = ?')->execute([$body['installationId']]);
        hiso_audit($user, 'ACK_INSTALLATION', 'Installation', (string)$body['installationId'], $user['name'] . ' acknowledged assignment.');
        hiso_json_response(['ok' => true]);
    }

    if ($method === 'POST' && $route === 'installations/report') {
        $user = hiso_require_permission('update_installations');
        $contentLength = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
        if ($contentLength > 32 * 1024 * 1024 || ($contentLength > 0 && empty($_POST) && empty($_FILES))) {
            hiso_json_response(['error' => 'Photo upload exceeds the 32MB request limit.'], 413);
        }
        $body = json_decode((string)($_POST['report'] ?? ''), true);
        if (!is_array($body)) {
            hiso_json_response(['error' => 'Invalid field report data.'], 422);
        }
        $pdo = hiso_pdo();
        $jobId = (string)($body['installationId'] ?? '');
        $jobStmt = $pdo->prepare('SELECT assigned_engineer_id FROM installations WHERE id = ? LIMIT 1');
        $jobStmt->execute([$jobId]);
        $job = $jobStmt->fetch();
        if (!$job) hiso_json_response(['error' => 'Installation not found.'], 404);
        if ($user['role'] === 'technician' && $job['assigned_engineer_id'] !== $user['id']) {
            hiso_json_response(['error' => 'You can only report on installations assigned to you.'], 403);
        }
        $activityTitle = trim((string)($body['activityTitle'] ?? ''));
        $reportText = trim((string)($body['reportText'] ?? ''));
        if ($activityTitle === '' || strlen($activityTitle) > 160 || strlen($reportText) > 3000
            || !is_bool($body['isCustomerVisible'] ?? null) || !is_bool($body['advanceStage'] ?? null)) {
            hiso_json_response(['error' => 'Field report details are invalid or too long.'], 422);
        }
        $stage = max(1, min(5, (int)($body['stageNumber'] ?? 1)));
        $upload = $_FILES['photos'] ?? null;
        $photos = [];
        $totalBytes = 0;
        if ($upload !== null) {
            if (!is_array($upload['name'] ?? null)) {
                hiso_json_response(['error' => 'Invalid photo upload.'], 422);
            }
            if (count($upload['name']) > 8) {
                hiso_json_response(['error' => 'A field report can include at most 8 photos.'], 422);
            }
            try {
                foreach ($upload['name'] as $index => $originalName) {
                    $totalBytes += (int)($upload['size'][$index] ?? 0);
                    if ($totalBytes > 24 * 1024 * 1024) {
                        throw new RuntimeException('Photo upload exceeds the 24MB limit.');
                    }
                    $photos[] = hiso_store_photo_upload([
                        'name' => $originalName,
                        'type' => $upload['type'][$index] ?? '',
                        'tmp_name' => $upload['tmp_name'][$index] ?? '',
                        'error' => $upload['error'][$index] ?? UPLOAD_ERR_NO_FILE,
                        'size' => $upload['size'][$index] ?? 0,
                    ]);
                }
            } catch (Throwable $e) {
                foreach ($photos as $p) {
                    $storedPath = hiso_storage_dir('job_photos') . '/' . basename($p['storage_filename']);
                    if (is_file($storedPath)) unlink($storedPath);
                }
                throw $e;
            }
        }
        $updId = hiso_uuid();
        try {
            $pdo->beginTransaction();
            $pdo->prepare('INSERT INTO installation_updates (id, installation_id, stage_number, activity_title, report_text, is_customer_visible, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
                ->execute([$updId, $jobId, $stage, $activityTitle, $reportText, $body['isCustomerVisible'] ? 1 : 0, $user['name']]);
            foreach ($photos as $p) {
                $pdo->prepare('INSERT INTO installation_photos (id, update_id, storage_filename, original_name, mime_type, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)')
                    ->execute([hiso_uuid(), $updId, $p['storage_filename'], $p['original_name'], $p['mime_type'], $user['name']]);
            }
            if ($body['advanceStage']) {
                $pdo->prepare('UPDATE installations SET current_stage = GREATEST(current_stage, ?) WHERE id = ?')->execute([$stage, $jobId]);
                if ($stage === 5) {
                    $pdo->prepare('UPDATE enquiries e JOIN installations j ON j.enquiry_id = e.id SET e.status = "Completed" WHERE j.id = ?')->execute([$jobId]);
                }
            }
            hiso_audit($user, 'FIELD_REPORT', 'Installation', $jobId, 'Stage ' . $stage . ': ' . $activityTitle);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            foreach ($photos as $p) {
                $storedPath = hiso_storage_dir('job_photos') . '/' . basename($p['storage_filename']);
                if (is_file($storedPath)) unlink($storedPath);
            }
            throw $e;
        }
        hiso_json_response(['updateId' => $updId], 201);
    }

    if ($method === 'POST' && $route === 'tickets/update') {
        $user = hiso_require_permission('manage_tickets');
        $body = hiso_json_body();
        $pdo = hiso_pdo();
        $stmt = $pdo->prepare('SELECT * FROM service_tickets WHERE id = ? LIMIT 1');
        $stmt->execute([$body['ticketId']]);
        $t = $stmt->fetch();
        if (!$t) hiso_json_response(['error' => 'Ticket not found.'], 404);
        $techId = $t['assigned_tech_id'];
        $techName = $t['assigned_tech_name'];
        if (array_key_exists('assignedTechId', $body)) {
            $techId = $body['assignedTechId'] ?: null;
            $techName = null;
            if ($techId) {
                $uStmt = $pdo->prepare('SELECT name FROM users WHERE id = ? LIMIT 1');
                $uStmt->execute([$techId]);
                if ($uRow = $uStmt->fetch()) {
                    $techName = $uRow['name'];
                    hiso_notify($techId, 'Service ticket assigned: ' . $t['ticket_code'], $t['customer_name'] . ' — ' . $t['subject'], 'tickets', $t['ticket_code']);
                }
            }
        }
        $pdo->prepare('UPDATE service_tickets SET status=?, assigned_tech_id=?, assigned_tech_name=?, resolution_note=? WHERE id=?')
            ->execute([$body['status'], $techId, $techName, trim((string)($body['resolutionNote'] ?? $t['resolution_note'])), $body['ticketId']]);
        hiso_audit($user, 'UPDATE_TICKET', 'ServiceTicket', $t['ticket_code'], 'Marked ' . $body['status']);
        hiso_json_response(['ok' => true]);
    }

    if ($method === 'POST' && $route === 'orders/update') {
        $user = hiso_current_user();
        if (!$user) hiso_json_response(['error' => 'Authentication required.'], 401);
        $perms = $user['permissions'] ?? [];
        if ($user['role'] !== 'superadmin' && !in_array('manage_storefront', $perms, true) && !in_array('manage_enquiries', $perms, true) && !in_array('manage_invoices', $perms, true)) {
            hiso_json_response(['error' => 'Order management permission required.'], 403);
        }
        $body = hiso_json_body();
        $pdo = hiso_pdo();
        $stmt = $pdo->prepare('SELECT * FROM store_orders WHERE id = ? LIMIT 1');
        $stmt->execute([$body['orderId']]);
        $ord = $stmt->fetch();
        if (!$ord) hiso_json_response(['error' => 'Order not found.'], 404);
        $pdo->prepare('UPDATE store_orders SET status = ?, notes = ? WHERE id = ?')
            ->execute([$body['status'], trim((string)($body['notes'] ?? $ord['notes'])), $body['orderId']]);
        if ($body['status'] === 'Delivered') {
            $pdo->prepare('UPDATE enquiries SET status = "Completed" WHERE id = ?')->execute([$ord['enquiry_id']]);
        }
        hiso_audit($user, 'UPDATE_ORDER', 'StoreOrder', $ord['order_code'], 'Marked ' . $body['status']);
        hiso_json_response(['ok' => true]);
    }

    if ($method === 'POST' && $route === 'roles') {
        $user = hiso_require_permission('manage_roles');
        $body = hiso_json_body();
        $name = trim((string)($body['name'] ?? ''));
        if ($name === '') hiso_json_response(['error' => 'Role name is required.'], 422);
        $slug = trim((string)($body['id'] ?? '')) ?: trim(preg_replace('/[^a-z0-9]+/', '_', strtolower($name)), '_');
        if ($slug === '' || $slug === 'superadmin') hiso_json_response(['error' => 'Invalid or locked role ID.'], 422);
        hiso_pdo()->prepare('INSERT INTO roles (id, name, description, permissions_json, is_system) VALUES (?, ?, ?, ?, 0) ON DUPLICATE KEY UPDATE name=VALUES(name), description=VALUES(description), permissions_json=VALUES(permissions_json)')
            ->execute([$slug, $name, trim((string)($body['description'] ?? '')), json_encode($body['permissions'] ?? [])]);
        hiso_audit($user, 'SAVE_ROLE', 'Role', $slug, 'Saved role ' . $name);
        hiso_json_response(['id' => $slug], 201);
    }

    if ($method === 'POST' && $route === 'staff') {
        $user = hiso_require_permission('manage_staff');
        $body = hiso_json_body();
        $name = trim((string)($body['name'] ?? ''));
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $phone = trim((string)($body['phone'] ?? ''));
        $role = trim((string)($body['role'] ?? ''));
        $title = trim((string)($body['title'] ?? ''));
        $skills = trim((string)($body['skills'] ?? ''));
        $status = (string)($body['status'] ?? 'Active');
        $password = trim((string)($body['password'] ?? ''));
        if ($name === '' || strlen($name) > 120 || !filter_var($email, FILTER_VALIDATE_EMAIL)
            || strlen($email) > 190 || strlen($phone) > 40 || strlen($role) > 60
            || strlen($title) > 120 || strlen($skills) > 4000
            || !in_array($status, ['Active', 'Inactive'], true)) {
            hiso_json_response(['error' => 'Valid name, email, phone, role, title, skills, and status are required.'], 422);
        }
        if ($role === 'superadmin' && $user['role'] !== 'superadmin') {
            hiso_json_response(['error' => 'Only Super Admin can create Super Admin accounts.'], 403);
        }
        $pdo = hiso_pdo();
        $id = $body['id'] ?? null;
        $roleStmt = $pdo->prepare('SELECT COUNT(*) FROM roles WHERE id = ?');
        $roleStmt->execute([$role]);
        if ((int)$roleStmt->fetchColumn() !== 1) {
            hiso_json_response(['error' => 'Select a valid staff role.'], 422);
        }
        if ($id) {
            $active = $pdo->prepare('SELECT COUNT(*) FROM installations WHERE assigned_engineer_id = ? AND current_stage < 5');
            $active->execute([$id]);
            if ((int)$active->fetchColumn() > 0 && ($role !== 'technician' || $status !== 'Active')) {
                hiso_json_response(['error' => 'Reassign active installations before changing role or deactivating this technician.'], 422);
            }
            if ($password !== '' && (strlen($password) < 12 || strlen($password) > 128)) {
                hiso_json_response(['error' => 'Staff passwords must be between 12 and 128 characters.'], 422);
            }
            $pdo->prepare('UPDATE users SET name=?, phone=?, role=?, title=?, skills=?, status=? WHERE id=?')
                ->execute([$name, $phone, $role, $title, $skills, $status, $id]);
            if ($password !== '') {
                $pdo->prepare('UPDATE users SET password_hash=? WHERE id=?')
                    ->execute([password_hash($password, PASSWORD_DEFAULT), $id]);
            }
        } else {
            if (strlen($password) < 12 || strlen($password) > 128) {
                hiso_json_response(['error' => 'A staff password between 12 and 128 characters is required.'], 422);
            }
            $id = hiso_uuid();
            $hash = password_hash($password, PASSWORD_DEFAULT);
            $pdo->prepare('INSERT INTO users (id, name, email, phone, password_hash, role, title, skills, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, "Active")')
                ->execute([$id, $name, $email, $phone, $hash, $role, $title, $skills]);
        }
        hiso_audit($user, 'SAVE_STAFF', 'Staff', (string)$id, 'Updated staff account ' . $name);
        hiso_json_response(['id' => $id]);
    }

    if ($method === 'POST' && $route === 'notifications/read') {
        $user = hiso_current_user();
        if (!$user) hiso_json_response(['error' => 'Authentication required.'], 401);
        hiso_pdo()->prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?')->execute([$user['id']]);
        hiso_json_response(['ok' => true]);
    }

    if ($method === 'GET' && str_starts_with($route, 'files/')) {
        $photoId = substr($route, 6);
        $stmt = hiso_pdo()->prepare('SELECT p.*, u.is_customer_visible FROM installation_photos p JOIN installation_updates u ON u.id = p.update_id WHERE p.id = ? LIMIT 1');
        $stmt->execute([$photoId]);
        $photo = $stmt->fetch();
        if (!$photo) { http_response_code(404); exit('Not found'); }
        $user = hiso_current_user();
        if (!$user && !$photo['is_customer_visible']) { http_response_code(403); exit('Forbidden'); }
        $path = hiso_storage_dir('job_photos') . '/' . basename($photo['storage_filename']);
        if (!is_file($path)) { http_response_code(404); exit('Missing file'); }
        header('Content-Type: ' . $photo['mime_type']);
        header('Content-Length: ' . (string)filesize($path));
        header('Cache-Control: private, max-age=86400');
        header('X-Content-Type-Options: nosniff');
        readfile($path);
        exit;
    }

    if ($method === 'GET' && str_starts_with($route, 'catalog-image/')) {
        $fname = basename(substr($route, 14));
        $path = hiso_storage_dir('job_photos') . '/' . $fname;
        if (!is_file($path)) { http_response_code(404); exit('Not found'); }
        header('Content-Type: image/jpeg');
        header('Content-Length: ' . (string)filesize($path));
        header('Cache-Control: public, max-age=86400');
        header('X-Content-Type-Options: nosniff');
        readfile($path);
        exit;
    }

    hiso_json_response(['error' => 'Endpoint not found: ' . $route], 404);
} catch (Throwable $e) {
    global $CONFIG;
    $message = ($CONFIG['APP_ENV'] ?? 'production') === 'development'
        ? $e->getMessage()
        : 'Internal server error.';
    hiso_json_response(['error' => $message], 500);
}
