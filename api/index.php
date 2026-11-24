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

$configPath = $privateDir . '/config.php';
if (!is_file($configPath)) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    echo '{"error":"Private API configuration is missing."}';
    exit;
}
require_once $configPath;

foreach (['auth.php', 'communications.php', 'upload.php'] as $runtimeFile) {
    if (!is_file($privateDir . '/' . $runtimeFile)) {
        http_response_code(503);
        header('Content-Type: application/json; charset=utf-8');
        echo '{"error":"Private API runtime is incomplete. Deploy the server runtime files and retry."}';
        exit;
    }
    require_once $privateDir . '/' . $runtimeFile;
}

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
        'grade' => $c['grade'] ?? 'Standard',
        'unit' => $c['unit'],
        'priceNgn' => (float)$c['price_ngn'],
        'stockQty' => (int)$c['stock_qty'],
        'capacityKw' => $c['capacity_kw'] !== null ? (float)$c['capacity_kw'] : null,
        'watts' => $c['watts'] !== null ? (int)$c['watts'] : null,
        'description' => (string)($c['description'] ?? ''),
        'imagePath' => $c['image_path'],
    ], $rows);
}

function hiso_platform_settings_table_exists(): bool {
    $stmt = hiso_pdo()->prepare(
        'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?'
    );
    $stmt->execute(['platform_settings']);
    return (int)$stmt->fetchColumn() > 0;
}

function hiso_table_exists(string $table): bool {
    $stmt = hiso_pdo()->prepare(
        'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?'
    );
    $stmt->execute([$table]);
    return (int)$stmt->fetchColumn() > 0;
}

function hiso_default_estimator_settings(array $catalog): array {
    $categories = [];
    foreach ($catalog as $item) {
        if (($item['itemType'] ?? '') === 'equipment' && is_string($item['category'] ?? null)) {
            $categories[] = $item['category'];
        }
    }
    $categories = array_values(array_unique($categories));
    $chooseCategory = static function (string $preferred, string $pattern) use ($categories): string {
        if (in_array($preferred, $categories, true)) return $preferred;
        foreach ($categories as $category) {
            if (preg_match($pattern, $category)) return $category;
        }
        return $preferred;
    };
    $inverterCategory = $chooseCategory('Inverters', '/inverter/i');
    $batteryCategory = $chooseCategory('Battery Storage', '/batter/i');
    $panelCategory = $chooseCategory('Solar Panels', '/solar|panel|module|pv/i');
    $core = [$inverterCategory, $batteryCategory, $panelCategory];
    $accessories = [];
    $installations = [];
    $logistics = [];
    foreach ($catalog as $item) {
        if (($item['itemType'] ?? '') === 'equipment' && !in_array($item['category'] ?? '', $core, true)) {
            $accessories[] = (string)$item['sku'];
        }
        if (($item['itemType'] ?? '') !== 'service') continue;
        $description = (string)($item['category'] ?? '') . ' ' . (string)($item['name'] ?? '') . ' ' . (string)($item['sku'] ?? '');
        if (!$installations && preg_match('/install|commission|survey/i', $description)) {
            $installations[] = (string)$item['sku'];
        }
        if (preg_match('/logistic|delivery|transport/i', $description)) {
            $logistics[] = (string)$item['sku'];
        }
    }
    return [
        'inverterCategory' => $inverterCategory,
        'parallelInverterSkus' => [],
        'batteryCategory' => $batteryCategory,
        'panelCategory' => $panelCategory,
        'accessorySkus' => $accessories,
        'installationSkus' => $installations,
        'logisticsSkus' => $logistics,
    ];
}

function hiso_load_platform_settings(?array $catalog = null): array {
    $catalog ??= hiso_hydrate_catalog();
    $defaults = [
        'bankDetails' => ['bankName' => '', 'accountName' => '', 'accountNumber' => ''],
        'estimator' => hiso_default_estimator_settings($catalog),
    ];
    if (!hiso_platform_settings_table_exists()) return $defaults;
    $stmt = hiso_pdo()->prepare('SELECT settings_json FROM platform_settings WHERE id = ? LIMIT 1');
    $stmt->execute(['global']);
    $row = $stmt->fetch();
    if (!$row) return $defaults;
    $stored = json_decode((string)$row['settings_json'], true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($stored)) throw new RuntimeException('Stored platform settings are invalid.');
    $bank = $stored['bankDetails'] ?? [];
    if (!is_array($bank)) throw new RuntimeException('Stored invoice bank details are invalid.');
    foreach (['bankName', 'accountName', 'accountNumber'] as $field) {
        if (isset($bank[$field]) && !is_string($bank[$field])) {
            throw new RuntimeException('Stored invoice bank details are invalid.');
        }
    }
    $estimator = $stored['estimator'] ?? [];
    if (!is_array($estimator)) throw new RuntimeException('Stored estimator settings are invalid.');
    $normalized = $defaults['estimator'];
    foreach (['inverterCategory', 'batteryCategory', 'panelCategory'] as $field) {
        $category = $estimator[$field] ?? null;
        if (is_string($category) && ($catalog === [] || count(array_filter(
            $catalog,
            static fn($item) => ($item['itemType'] ?? '') === 'equipment' && ($item['category'] ?? '') === $category
        )) > 0)) {
            $normalized[$field] = $category;
        }
    }
    foreach (['accessorySkus' => 'equipment', 'installationSkus' => 'service', 'logisticsSkus' => 'service'] as $field => $itemType) {
        if (!is_array($estimator[$field] ?? null)) continue;
        $allowed = [];
        foreach ($catalog as $item) {
            if (($item['itemType'] ?? '') === $itemType) $allowed[(string)$item['sku']] = true;
        }
        $normalized[$field] = array_values(array_unique(array_filter(
            $estimator[$field],
            static fn($sku) => is_string($sku) && isset($allowed[$sku])
        )));
    }
    $parallelAllowed = [];
    foreach ($catalog as $item) {
        if (($item['itemType'] ?? '') === 'equipment'
            && ($item['category'] ?? '') === $normalized['inverterCategory']
            && (float)($item['capacityKw'] ?? 0) > 0) {
            $parallelAllowed[(string)$item['sku']] = true;
        }
    }
    $parallelSelected = $estimator['parallelInverterSkus'] ?? [];
    if (is_array($parallelSelected)) {
        $normalized['parallelInverterSkus'] = array_values(array_unique(array_filter(
            $parallelSelected,
            static fn($sku) => is_string($sku) && isset($parallelAllowed[$sku])
        )));
    }
    return [
        'bankDetails' => [
            'bankName' => (string)($bank['bankName'] ?? ''),
            'accountName' => (string)($bank['accountName'] ?? ''),
            'accountNumber' => (string)($bank['accountNumber'] ?? ''),
        ],
        'estimator' => $normalized,
    ];
}

function hiso_estimate_quote_lines(array $estimate, array $catalog, array $settings): array {
    $rules = $settings['estimator'];
    $grade = strtolower(trim((string)($estimate['equipmentGrade'] ?? 'Standard')));
    $byCategory = static function (string $category, string $type) use ($catalog, $grade): array {
        $items = array_values(array_filter($catalog, static fn($item) =>
            ($item['itemType'] ?? '') === $type && ($item['category'] ?? '') === $category
        ));
        $matching = array_values(array_filter($items, static fn($item) =>
            strtolower(trim((string)($item['grade'] ?? ''))) === $grade
        ));
        $ungraded = array_values(array_filter($items, static fn($item) => trim((string)($item['grade'] ?? '')) === ''));
        return $matching ?: ($ungraded ?: $items);
    };
    $repeatCapacity = static function (array $items, float $required, string $capacityKey, int $minQty = 1): ?array {
        $options = [];
        foreach ($items as $item) {
            $capacity = (float)($item[$capacityKey] ?? 0);
            $price = (float)($item['priceNgn'] ?? 0);
            if ($capacity <= 0 || $price <= 0) continue;
            $qty = max($minQty, (int)ceil($required / $capacity));
            if ($qty > (int)floor((float)($item['stockQty'] ?? 0))) continue;
            $options[] = [
                'item' => $item,
                'qty' => $qty,
                'total' => $qty * $price,
                'oversupply' => $qty * $capacity - $required,
            ];
        }
        usort($options, static fn($a, $b) =>
            ($a['total'] <=> $b['total'])
            ?: ($a['oversupply'] <=> $b['oversupply'])
            ?: ($a['qty'] <=> $b['qty'])
            ?: strcmp((string)$a['item']['sku'], (string)$b['item']['sku'])
        );
        if (!$options) return null;
        $selected = $options[0];
        $item = $selected['item'];
        return [
            'sku' => $item['sku'], 'description' => $item['name'], 'unit' => $item['unit'],
            'qty' => $selected['qty'], 'unitPriceNgn' => (float)$item['priceNgn'],
        ];
    };
    $lines = [];
    $requiredArrayWatts = (float)($estimate['recommendedArrayWatts'] ?? ((float)($estimate['recommendedPanels550w'] ?? 0) * 550));
    if ($requiredArrayWatts > 0) {
        $panel = $repeatCapacity($byCategory((string)$rules['panelCategory'], 'equipment'), $requiredArrayWatts, 'watts', 2);
        $lines[] = $panel ?? [
            'sku' => 'TBD-SOLAR-ARRAY', 'description' => 'Solar array (' . $requiredArrayWatts . ' W) — To Be Determined',
            'unit' => 'lot', 'qty' => 1, 'unitPriceNgn' => 0, 'isTbd' => true,
        ];
    }

    $inverterNeed = (float)($estimate['inverterMinKw'] ?? 0);
    $inverters = array_values(array_filter($byCategory((string)$rules['inverterCategory'], 'equipment'), static fn($item) =>
        (float)($item['capacityKw'] ?? 0) >= $inverterNeed
        && (float)($item['priceNgn'] ?? 0) > 0
        && (float)($item['stockQty'] ?? 0) >= 1
    ));
    usort($inverters, static fn($a, $b) =>
        ((float)$a['capacityKw'] <=> (float)$b['capacityKw'])
        ?: ((float)$a['priceNgn'] <=> (float)$b['priceNgn'])
        ?: strcmp((string)$a['sku'], (string)$b['sku'])
    );
    $inverter = $inverters ? [
        'sku' => $inverters[0]['sku'], 'description' => $inverters[0]['name'], 'unit' => $inverters[0]['unit'],
        'qty' => 1, 'unitPriceNgn' => (float)$inverters[0]['priceNgn'],
    ] : $repeatCapacity(
        array_values(array_filter($byCategory((string)$rules['inverterCategory'], 'equipment'), static fn($item) =>
            in_array((string)$item['sku'], $rules['parallelInverterSkus'], true)
        )),
        $inverterNeed,
        'capacityKw'
    );
    $lines[] = $inverter ?? [
        'sku' => 'TBD-INVERTER', 'description' => 'Inverter (' . $inverterNeed . ' kW minimum) — To Be Determined',
        'unit' => 'lot', 'qty' => 1, 'unitPriceNgn' => 0, 'isTbd' => true,
    ];

    $batteryNeed = (float)($estimate['batteryTargetKwh'] ?? 0);
    if ($batteryNeed > 0) {
        $battery = $repeatCapacity($byCategory((string)$rules['batteryCategory'], 'equipment'), $batteryNeed, 'capacityKw');
        $lines[] = $battery ?? [
            'sku' => 'TBD-BATTERY', 'description' => 'Battery (' . $batteryNeed . ' kWh) — To Be Determined',
            'unit' => 'lot', 'qty' => 1, 'unitPriceNgn' => 0, 'isTbd' => true,
        ];
    }
    foreach ([
        ['TBD-ACCESSORIES', 'Accessories'],
        ['TBD-INSTALLATION', 'Installation'],
        ['TBD-LOGISTICS', 'Logistics'],
    ] as [$sku, $label]) {
        $lines[] = [
            'sku' => $sku, 'description' => $label . ' — To Be Determined',
            'unit' => 'lot', 'qty' => 1, 'unitPriceNgn' => 0, 'isTbd' => true,
        ];
    }
    return $lines;
}

function hiso_calculate_solar_estimate(array $appliances, array $options): array {
    if (!$appliances || count($appliances) > 100) {
        throw new InvalidArgumentException('An estimator enquiry must include between 1 and 100 appliance items.');
    }
    $connectedLoad = 0.0;
    $dailyWh = 0.0;
    foreach ($appliances as $item) {
        if (!is_array($item) || !is_string($item['name'] ?? null)
            || trim($item['name']) === '' || strlen($item['name']) > 120
            || !is_numeric($item['qty'] ?? null) || (float)$item['qty'] < 0 || (float)$item['qty'] > 1000
            || !is_numeric($item['watts'] ?? null) || (float)$item['watts'] < 0 || (float)$item['watts'] > 100000
            || !is_numeric($item['hours'] ?? null) || (float)$item['hours'] < 0 || (float)$item['hours'] > 24) {
            throw new InvalidArgumentException('Estimator appliance details are invalid.');
        }
        $qty = (float)$item['qty'];
        $watts = (float)$item['watts'];
        $hours = (float)$item['hours'];
        $connectedLoad += $qty * $watts;
        $dailyWh += $qty * $watts * $hours;
    }
    if ($connectedLoad <= 0 || $dailyWh <= 0) {
        throw new InvalidArgumentException('Add at least one appliance with a positive quantity, wattage, and usage time.');
    }
    $powerMode = $options['powerMode'] ?? 'Hybrid';
    if (!in_array($powerMode, ['Hybrid', 'Off-grid', 'Grid-backup'], true)) {
        throw new InvalidArgumentException('The selected solar power mode is invalid.');
    }
    $peakSunHours = max(2, min(8, is_numeric($options['peakSunHours'] ?? null) ? (float)$options['peakSunHours'] : 4.5));
    $usableDepthPercent = max(50, min(95, is_numeric($options['usableDepthPercent'] ?? null) ? (float)$options['usableDepthPercent'] : 85));
    $autonomyHours = max(2, min(48, is_numeric($options['autonomyHours'] ?? null) ? (float)$options['autonomyHours'] : ($powerMode === 'Off-grid' ? 16 : 10)));
    $dailyKwh = round($dailyWh / 1000, 2);
    $rawInverterKw = ($connectedLoad * 1.3) / 1000;
    $sizes = [1.5, 3, 5, 8, 10, 15, 20, 30, 50, 80, 100, 120];
    $inverterKw = 0.0;
    foreach ($sizes as $size) {
        if ($size >= $rawInverterKw) {
            $inverterKw = $size;
            break;
        }
    }
    if ($inverterKw === 0.0) $inverterKw = ceil($rawInverterKw / 10) * 10;
    $modeMultiplier = $powerMode === 'Off-grid' ? 1.0 : ($powerMode === 'Grid-backup' ? 0.55 : 0.65);
    $batteryKwh = round(($dailyKwh * $modeMultiplier * max(0.75, $autonomyHours / 12)) / ($usableDepthPercent / 100), 1);
    $arrayWatts = $dailyKwh === 0 || $powerMode === 'Grid-backup'
        ? 0
        : ceil(($dailyKwh * ($powerMode === 'Off-grid' ? 1.35 : 1.25) * 1000) / $peakSunHours);
    return [
        'connectedLoadWatts' => (int)round($connectedLoad),
        'dailyEnergyKwh' => $dailyKwh,
        'inverterMinKw' => $inverterKw,
        'batteryTargetKwh' => $batteryKwh,
        'recommendedPanels550w' => $arrayWatts === 0 ? 0 : max(2, (int)ceil($arrayWatts / 550)),
        'recommendedBatteries5kwh' => $batteryKwh === 0 ? 0 : max(1, (int)ceil($batteryKwh / 5.12)),
        'powerMode' => $powerMode,
        'autonomyHours' => $autonomyHours,
        'peakSunHours' => $peakSunHours,
        'usableDepthPercent' => $usableDepthPercent,
        'recommendedArrayWatts' => $arrayWatts,
        'equipmentGrade' => substr(trim((string)($options['equipmentGrade'] ?? 'Standard')) ?: 'Standard', 0, 60),
    ];
}

function hiso_can_manage_platform_settings(array $user): bool {
    $permissions = $user['permissions'] ?? [];
    return ($user['role'] ?? '') === 'superadmin'
        || ($user['role'] ?? '') === 'admin'
        || (in_array('manage_storefront', $permissions, true) && in_array('manage_invoices', $permissions, true));
}

function hiso_save_platform_settings(array $actor, array $body): array {
    if (!hiso_platform_settings_table_exists()) {
        throw new RuntimeException('Platform settings migration is required. Import php-cpanel/migrations/005-platform-settings.sql in phpMyAdmin.');
    }
    $bank = $body['bankDetails'] ?? null;
    $estimator = $body['estimator'] ?? null;
    if (!is_array($bank) || !is_array($estimator)) throw new InvalidArgumentException('Settings data is invalid.');
    $bankDetails = [];
    foreach (['bankName' => 120, 'accountName' => 120, 'accountNumber' => 50] as $field => $maxLength) {
        if (!is_string($bank[$field] ?? null)) throw new InvalidArgumentException('Bank details are invalid.');
        $value = trim($bank[$field]);
        if (strlen($value) > $maxLength || preg_match('/[\x00-\x1f\x7f]/', $value)) {
            throw new InvalidArgumentException('Bank details exceed the allowed length or contain invalid characters.');
        }
        $bankDetails[$field] = $value;
    }
    $bankValues = array_values($bankDetails);
    if (count(array_filter($bankValues, static fn($value) => $value !== '')) > 0
        && count(array_filter($bankValues, static fn($value) => $value === '')) > 0) {
        throw new InvalidArgumentException('Provide all bank details, or leave all three fields blank.');
    }
    $catalog = hiso_hydrate_catalog();
    $defaults = hiso_default_estimator_settings($catalog);
    $safeEstimator = [];
    foreach (['inverterCategory', 'batteryCategory', 'panelCategory'] as $field) {
        $category = $estimator[$field] ?? null;
        if (!is_string($category) || ($catalog !== [] && !in_array($category, array_map(
            static fn($item) => (string)$item['category'],
            array_values(array_filter($catalog, static fn($item) => ($item['itemType'] ?? '') === 'equipment'))
        ), true))) {
            throw new InvalidArgumentException('Select valid Store categories for estimator equipment.');
        }
        $safeEstimator[$field] = $category;
    }
    foreach (['accessorySkus' => 'equipment', 'installationSkus' => 'service', 'logisticsSkus' => 'service'] as $field => $itemType) {
        $selected = $estimator[$field] ?? null;
        if (!is_array($selected) || count($selected) > 100) {
            throw new InvalidArgumentException('Estimator Store item selections are invalid.');
        }
        $allowed = [];
        foreach ($catalog as $item) {
            if (($item['itemType'] ?? '') === $itemType) $allowed[(string)$item['sku']] = true;
        }
        foreach ($selected as $sku) {
            if (!is_string($sku) || !isset($allowed[$sku])) {
                throw new InvalidArgumentException('Estimator Store item selections are invalid. Refresh the Store and try again.');
            }
        }
        $safeEstimator[$field] = array_values(array_unique($selected));
    }
    $parallelSelected = $estimator['parallelInverterSkus'] ?? [];
    if (!is_array($parallelSelected) || count($parallelSelected) > 100) {
        throw new InvalidArgumentException('Parallel inverter selections are invalid.');
    }
    $parallelAllowed = [];
    foreach ($catalog as $item) {
        if (($item['itemType'] ?? '') === 'equipment'
            && ($item['category'] ?? '') === $safeEstimator['inverterCategory']
            && (float)($item['capacityKw'] ?? 0) > 0) {
            $parallelAllowed[(string)$item['sku']] = true;
        }
    }
    foreach ($parallelSelected as $sku) {
        if (!is_string($sku) || !isset($parallelAllowed[$sku])) {
            throw new InvalidArgumentException('Parallel inverter selections must reference capacity-rated items in the selected inverter category.');
        }
    }
    $safeEstimator['parallelInverterSkus'] = array_values(array_unique($parallelSelected));
    foreach (['inverterCategory', 'batteryCategory', 'panelCategory'] as $field) {
        if ($catalog === [] && $safeEstimator[$field] === '') $safeEstimator[$field] = $defaults[$field];
    }
    $settings = ['bankDetails' => $bankDetails, 'estimator' => $safeEstimator];
    $stmt = hiso_pdo()->prepare(
        'INSERT INTO platform_settings (id, settings_json, updated_by) VALUES (?, ?, ?) ' .
        'ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json), updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP'
    );
    $stmt->execute(['global', json_encode($settings, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $actor['id']]);
    hiso_audit($actor, 'UPDATE_PLATFORM_SETTINGS', 'PlatformSettings', 'global', 'Updated invoice bank details and solar estimator rules.');
    return $settings;
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

    $staffPhotoSelect = hiso_column_exists('users', 'profile_photo_filename')
        ? 'profile_photo_filename'
        : 'NULL AS profile_photo_filename';
    $staffRaw = $pdo->query(
        'SELECT id, name, username, email, phone, ' . $staffPhotoSelect .
        ', role, title, skills, status, must_set_password, created_at AS createdAt FROM users ORDER BY created_at ASC'
    )->fetchAll();
    $staff = array_map(function($s) use ($rolesMap) {
        $r = $rolesMap[$s['role']] ?? null;
        $s['roleName'] = $r ? $r['name'] : $s['role'];
        $s['permissions'] = $r ? $r['permissions'] : [];
        $s['mustSetPassword'] = (bool)$s['must_set_password'];
        $s['profilePhotoUrl'] = !empty($s['profile_photo_filename'])
            ? '/api/staff/profile/photo/' . rawurlencode((string)$s['id']) . '?v=' . rawurlencode((string)$s['profile_photo_filename'])
            : null;
        unset($s['must_set_password']);
        unset($s['profile_photo_filename']);
        return $s;
    }, $staffRaw);

    $catalog = hiso_hydrate_catalog();

    $enquiriesRaw = $canCommercial ? $pdo->query('SELECT * FROM enquiries WHERE archived_at IS NULL ORDER BY created_at DESC')->fetchAll() : [];
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
        'status' => (string)$i['status'],
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

    $notifStmt = $pdo->prepare('SELECT * FROM notifications WHERE user_id = ? AND is_archived = 0 ORDER BY created_at DESC LIMIT 40');
    $notifStmt->execute([$user['id']]);
    $notifications = array_map(fn($n) => [
        'id' => $n['id'],
        'userId' => $n['user_id'],
        'title' => $n['title'],
        'body' => $n['body'],
        'targetModule' => $n['target_module'],
        'targetRef' => $n['target_ref'],
        'isRead' => (bool)$n['is_read'],
        'isArchived' => (bool)$n['is_archived'],
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
    if ($route === 'whatsapp/webhook') {
        global $CONFIG;
        header('Cache-Control: no-store');
        if ($method === 'GET') {
            $mode = (string)($_GET['hub_mode'] ?? $_GET['hub.mode'] ?? '');
            $verifyToken = (string)($CONFIG['WHATSAPP_WEBHOOK_VERIFY_TOKEN'] ?? '');
            $providedToken = (string)($_GET['hub_verify_token'] ?? $_GET['hub.verify_token'] ?? '');
            $challenge = (string)($_GET['hub_challenge'] ?? $_GET['hub.challenge'] ?? '');
            $failure = $mode !== 'subscribe' ? 'mode_mismatch'
                : ($verifyToken === '' ? 'verify_token_not_configured'
                    : ($providedToken === '' ? 'verify_token_missing'
                        : (!hash_equals($verifyToken, $providedToken) ? 'verify_token_mismatch'
                            : (strlen($challenge) > 2048 ? 'challenge_too_large' : ''))));
            if ($failure !== '') {
                hiso_log_whatsapp_webhook_verification($failure);
                http_response_code(403);
                exit;
            }
            hiso_log_whatsapp_webhook_verification('verified');
            header('Content-Type: text/plain; charset=utf-8');
            echo $challenge;
            exit;
        }
        if ($method === 'POST') {
            $contentLength = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
            if ($contentLength > 2097152) {
                http_response_code(413);
                exit;
            }
            $body = file_get_contents('php://input', false, null, 0, 2097153);
            if ($body === false || strlen($body) > 2097152
                || !hiso_whatsapp_webhook_signature_is_valid(
                    $body,
                    (string)($_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? ''),
                    (string)($CONFIG['WHATSAPP_APP_SECRET'] ?? '')
                )) {
                http_response_code(403);
                exit;
            }
            $payload = json_decode($body, true);
            if (json_last_error() !== JSON_ERROR_NONE || !is_array($payload)) {
                http_response_code(400);
                exit;
            }
            http_response_code(200);
            exit;
        }
        header('Allow: GET, POST');
        http_response_code(405);
        exit;
    }

    if ($method === 'GET' && $route === 'push/config') {
        global $CONFIG;
        $publicKey = trim((string)($CONFIG['VAPID_PUBLIC_KEY'] ?? ''));
        $publicBytes = hiso_b64url_decode($publicKey);
        $privateBytes = hiso_b64url_decode((string)($CONFIG['VAPID_PRIVATE_KEY'] ?? ''));
        $subject = trim((string)($CONFIG['VAPID_SUBJECT'] ?? ''));
        if ($publicBytes === false || $privateBytes === false
            || !hiso_vapid_key_pair_is_valid($privateBytes, $publicBytes)
            || !preg_match('/^(mailto:[^@\s]+@[^@\s]+|https:\/\/[^\/\s]+)$/', $subject)) {
            hiso_json_response(['error' => 'Web Push is not configured correctly on the private server.'], 503);
        }
        hiso_json_response(['publicKey' => $publicKey]);
    }

    if ($method === 'GET' && $route === 'website/content') {
        $rows = hiso_pdo()->query('SELECT section_id, heading, body, enabled FROM homepage_sections')
            ->fetchAll(PDO::FETCH_ASSOC);
        $homepage = [];
        foreach ($rows as $row) {
            $homepage[(string)$row['section_id']] = [
                'heading' => (string)$row['heading'],
                'body' => (string)$row['body'],
                'enabled' => (bool)$row['enabled'],
            ];
        }
        hiso_json_response(['homepage' => $homepage]);
    }

    if ($method === 'POST' && $route === 'website/content') {
        $user = hiso_current_user();
        if (!$user) hiso_json_response(['error' => 'Authentication required.'], 401);
        if (($user['role'] ?? '') !== 'superadmin') {
            hiso_json_response(['error' => 'Superuser access required.'], 403);
        }

        $body = hiso_json_body();
        $homepage = $body['homepage'] ?? null;
        $sectionIds = ['hero', 'workflow', 'about', 'services', 'projects', 'pricing'];
        if (!is_array($homepage)) {
            hiso_json_response(['error' => 'Homepage sections are invalid.'], 422);
        }

        $validated = [];
        foreach ($sectionIds as $sectionId) {
            $section = $homepage[$sectionId] ?? null;
            if (
                !is_array($section) ||
                !isset($section['heading'], $section['body'], $section['enabled']) ||
                !is_string($section['heading']) ||
                trim($section['heading']) === '' ||
                strlen($section['heading']) > 180 ||
                !is_string($section['body']) ||
                strlen($section['body']) > 1200 ||
                !is_bool($section['enabled'])
            ) {
                hiso_json_response(['error' => 'Homepage sections are invalid.'], 422);
            }
            $validated[$sectionId] = [
                'heading' => trim($section['heading']),
                'body' => trim($section['body']),
                'enabled' => $section['enabled'],
            ];
        }

        $pdo = hiso_pdo();
        $statement = $pdo->prepare(
            'INSERT INTO homepage_sections (section_id, heading, body, enabled, updated_by) VALUES (?, ?, ?, ?, ?) ' .
            'ON DUPLICATE KEY UPDATE heading = VALUES(heading), body = VALUES(body), enabled = VALUES(enabled), ' .
            'updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP'
        );
        $pdo->beginTransaction();
        try {
            foreach ($validated as $sectionId => $section) {
                $statement->execute([
                    $sectionId,
                    $section['heading'],
                    $section['body'],
                    $section['enabled'] ? 1 : 0,
                    $user['id'],
                ]);
            }
            $pdo->commit();
        } catch (Throwable $error) {
            $pdo->rollBack();
            throw $error;
        }

        $rows = $pdo->query('SELECT section_id, heading, body, enabled FROM homepage_sections')
            ->fetchAll(PDO::FETCH_ASSOC);
        $savedHomepage = [];
        foreach ($rows as $row) {
            $savedHomepage[(string)$row['section_id']] = [
                'heading' => (string)$row['heading'],
                'body' => (string)$row['body'],
                'enabled' => (bool)$row['enabled'],
            ];
        }
        hiso_json_response(['homepage' => $savedHomepage]);
    }

    if ($method === 'GET' && $route === 'public/bootstrap') {
        $catalog = hiso_hydrate_catalog();
        $settings = hiso_load_platform_settings($catalog);
        hiso_json_response(['catalog' => $catalog, 'estimatorSettings' => $settings['estimator']]);
    }

    if ($method === 'POST' && $route === 'public/enquiries') {
        $body = hiso_json_body();
        $name = trim((string)($body['customerName'] ?? ''));
        $phone = trim((string)($body['phone'] ?? ''));
        $location = trim((string)($body['location'] ?? ''));
        $estimateInput = is_array($body['estimate'] ?? null) ? $body['estimate'] : null;
        $source = $body['source'] ?? (($estimateInput && (float)($estimateInput['connectedLoadWatts'] ?? 0) > 0) ? 'estimator' : 'homepage');
        $updatesConsent = $body['whatsappUpdatesConsent'] ?? false;
        $marketingConsent = $body['whatsappMarketingConsent'] ?? false;
        if ($name === '' || $phone === '' || $location === '') {
            hiso_json_response(['error' => 'Name, phone number, and site location are required.'], 422);
        }
        if (!in_array($source, ['homepage', 'estimator'], true)) {
            hiso_json_response(['error' => 'Enquiry source is invalid.'], 422);
        }
        if (!is_bool($updatesConsent) || !is_bool($marketingConsent)) {
            hiso_json_response(['error' => 'WhatsApp consent choices are invalid.'], 422);
        }
        if (($updatesConsent || $marketingConsent) && !preg_match('/^\+[1-9][0-9]{7,14}$/', $phone)) {
            hiso_json_response(['error' => 'Please use the required country code for the WhatsApp number (for example, +234…).'], 422);
        }
        $estimate = null;
        $appliances = [];
        if ($source === 'estimator') {
            $rawAppliances = $body['appliances'] ?? null;
            if (!is_array($rawAppliances)) {
                hiso_json_response(['error' => 'An estimator enquiry must include appliance items.'], 422);
            }
            try {
                $estimate = hiso_calculate_solar_estimate($rawAppliances, $estimateInput ?? []);
                $appliances = array_map(static fn($item) => [
                    'id' => substr((string)($item['id'] ?? ''), 0, 80),
                    'name' => trim((string)$item['name']),
                    'qty' => (float)$item['qty'],
                    'watts' => (float)$item['watts'],
                    'hours' => (float)$item['hours'],
                    'catalogSku' => isset($item['catalogSku']) ? substr((string)$item['catalogSku'], 0, 80) : null,
                ], $rawAppliances);
            } catch (InvalidArgumentException $error) {
                hiso_json_response(['error' => $error->getMessage()], 422);
            }
        }
        $id = hiso_uuid();
        $ref = hiso_next_code('enquiries', 'ref_code', 'HISO');
        $pdo = hiso_pdo();
        $quoteId = null;
        $quoteCode = null;
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare('INSERT INTO enquiries (id, ref_code, customer_name, email, phone, location, channel, need_summary, appliances_json, estimate_json, status, owner_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "admin-idee")');
            $stmt->execute([
                $id, $ref, $name, trim((string)($body['email'] ?? '')), $phone, $location,
                $source === 'estimator' ? 'Website · Load Estimator' : 'Website · Home Enquiry',
                trim((string)($body['needSummary'] ?? 'General solar consultation request')),
                json_encode($appliances, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                $estimate ? json_encode($estimate, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) : null,
                'New',
            ]);
            if ($estimate) {
                $catalog = hiso_hydrate_catalog();
                $settings = hiso_load_platform_settings($catalog);
                $lines = hiso_estimate_quote_lines($estimate, $catalog, $settings);
                $quoteId = hiso_uuid();
                $quoteCode = hiso_next_code('quotations', 'quote_code', 'QUO');
                $quoteItems = json_encode($lines, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
                $now = gmdate('c');
                $revisions = json_encode([[
                    'revisionNo' => 1,
                    'changedBy' => 'Estimator',
                    'note' => 'Draft quotation generated from the submitted load estimate.',
                    'createdAt' => $now,
                    'totalNgn' => array_sum(array_map(static fn($line) => (float)$line['qty'] * (float)$line['unitPriceNgn'], $lines)),
                ]], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
                $scope = 'Turnkey solar system design and supply for ' . $location . '.';
                $note = 'Core equipment estimate only. Accessories, installation, and logistics require director pricing before approval.';
                $pdo->prepare('INSERT INTO quotations (id, quote_code, enquiry_id, customer_name, status, revision_no, scope, terms, note, discount_ngn, tax_percent, issued_date, valid_until, items_json, revisions_json) VALUES (?, ?, ?, ?, "Draft", 1, ?, ?, ?, 0, 7.5, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 7 DAY), ?, ?)')
                    ->execute([$quoteId, $quoteCode, $id, $name, $scope, '50% deposit on acceptance, 50% prior to commissioning.', $note, $quoteItems, $revisions]);
            }
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
        if ($updatesConsent) {
            hiso_save_whatsapp_recipient_consent('enquiry', $id, 'operational', $phone, true, 'public_enquiry_form');
        }
        if ($marketingConsent) {
            hiso_save_whatsapp_recipient_consent('enquiry', $id, 'marketing', $phone, true, 'public_enquiry_form');
        }
        hiso_notify_roles(['superadmin', 'director', 'admin'], 'New solar enquiry ' . $ref, $name . ' (' . $location . ') submitted an enquiry.', 'enquiries', $id);
        hiso_send_enquiry_emails([
            'id' => $id,
            'refCode' => $ref,
            'customerName' => $name,
            'email' => trim((string)($body['email'] ?? '')),
            'phone' => $phone,
            'location' => $location,
            'needSummary' => trim((string)($body['needSummary'] ?? 'General solar consultation request')),
        ], $quoteCode);
        hiso_send_enquiry_confirmation_whatsapp($id, $phone, $name, $ref, $quoteCode);
        hiso_audit(['name' => $name, 'role' => 'customer'], 'CREATE_ENQUIRY', 'Enquiry', $ref, 'Public enquiry submitted.');
        hiso_json_response(['refCode' => $ref, 'id' => $id, 'quoteId' => $quoteId, 'quoteCode' => $quoteCode], 201);
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
        $deliveryFee = 0.0;
        $tax = round($subtotal * 0.075);
        $total = round($subtotal + $tax);

        $orderId = hiso_uuid();
        $orderCode = hiso_next_code('store_orders', 'order_code', 'ORD');
        $enqId = hiso_uuid();
        $refCode = hiso_next_code('enquiries', 'ref_code', 'HISO');
        $summaryList = array_map(fn($x) => $x['qty'] . '× ' . $x['name'], $resolved);
        $needSummary = 'Store Order ' . $orderCode . ' (' . $deliveryMethod . '): ' . implode(', ', $summaryList);

        $pdo->prepare('INSERT INTO enquiries (id, ref_code, customer_name, email, phone, location, channel, need_summary, appliances_json, estimate_json, status, owner_user_id) VALUES (?, ?, ?, ?, ?, ?, "Website · Store Order", ?, "[]", NULL, "New", "admin-idee")')
            ->execute([$enqId, $refCode, $name, trim((string)($body['email'] ?? '')), $phone, $location, $needSummary]);

        $pdo->prepare('INSERT INTO store_orders (id, order_code, enquiry_id, ref_code, customer_name, email, phone, location, delivery_address, delivery_method, payment_method, notes, items_json, subtotal_ngn, delivery_fee_ngn, tax_ngn, total_ngn, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "Pending")')
            ->execute([$orderId, $orderCode, $enqId, $refCode, $name, trim((string)($body['email'] ?? '')), $phone, $location, $address, $deliveryMethod, $paymentMethod, trim((string)($body['notes'] ?? '')), json_encode($resolved), $subtotal, $deliveryFee, $tax, $total]);

        hiso_notify_roles(['superadmin', 'director', 'admin'], 'New Store Order ' . $orderCode, $name . ' (' . $location . ') ordered ₦' . number_format($total), 'orders', $orderCode);
        hiso_audit(['name' => $name, 'role' => 'customer'], 'CREATE_ORDER', 'StoreOrder', $orderCode, 'Placed Store order ' . $orderCode);

        $oStmt = $pdo->prepare('SELECT * FROM store_orders WHERE id = ? LIMIT 1');
        $oStmt->execute([$orderId]);
        $orderRow = $oStmt->fetch();
        if ($orderRow) {
            hiso_send_store_order_emails(hiso_hydrate_order($orderRow));
        }
        hiso_json_response(['id' => $orderId, 'orderCode' => $orderCode, 'refCode' => $refCode, 'totalNgn' => $total, 'order' => $orderRow ? hiso_hydrate_order($orderRow) : null], 201);
    }

    if ($method === 'GET' && $route === 'public/track') {
        header('Cache-Control: no-store, private');
        $user = hiso_current_user();
        $customer = $user ? null : hiso_current_customer();
        if (!$user && !$customer) {
            hiso_json_response(['error' => 'Verified customer sign-in required.'], 401);
        }
        $trackPermissions = [
            'manage_enquiries', 'manage_tickets', 'manage_storefront',
            'manage_invoices', 'release_installations', 'update_installations',
        ];
        if ($user && $user['role'] !== 'superadmin'
            && !array_intersect($trackPermissions, $user['permissions'] ?? [])) {
            hiso_json_response(['error' => 'Your role does not permit customer tracking access.'], 403);
        }
        $ref = strtoupper(trim((string)($_GET['ref'] ?? '')));
        if ($ref === '' || strlen($ref) > 32) {
            hiso_json_response(['error' => 'Tracking reference is invalid.'], 422);
        }
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
        if (!$enq) hiso_json_response(['error' => 'No matching request was found for this account.'], 404);
        if ($customer) {
            $customerEmail = strtolower(trim((string)$customer['email']));
            $enquiryEmail = strtolower(trim((string)($enq['email'] ?? '')));
            $orderEmail = strtolower(trim((string)($orderRow['email'] ?? '')));
            if ($enquiryEmail === '' || !hash_equals($customerEmail, $enquiryEmail)
                || ($orderEmail !== '' && !hash_equals($customerEmail, $orderEmail))) {
                hiso_json_response(['error' => 'No matching request was found for this account.'], 404);
            }
        }

        $qStmt = $pdo->prepare('SELECT id, quote_code, status, revision_no, issued_date, valid_until FROM quotations WHERE enquiry_id = ? AND status IN ("Approved","Invoiced") ORDER BY created_at DESC LIMIT 1');
        $qStmt->execute([$enq['id']]);
        $quote = $qStmt->fetch();

        $iStmt = $pdo->prepare('SELECT id, invoice_code, total_ngn, status, customer_accepted, accepted_at, issued_date, due_date FROM invoices WHERE enquiry_id = ? ORDER BY created_at DESC LIMIT 1');
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
            'invoice' => $inv ? ['id' => $inv['id'], 'invoiceCode' => $inv['invoice_code'], 'totalNgn' => (float)$inv['total_ngn'], 'status' => $inv['status'], 'confirmedPaidNgn' => $confirmedPaid, 'balanceNgn' => max(0, (float)$inv['total_ngn'] - $confirmedPaid), 'customerAccepted' => (bool)$inv['customer_accepted'], 'dueDate' => $inv['due_date']] : null,
            'installation' => $jobPayload,
            'order' => $orderRow ? hiso_hydrate_order($orderRow) : null,
        ]);
    }

    if ($method === 'POST' && $route === 'public/accept-invoice') {
        header('Cache-Control: no-store, private');
        $customer = hiso_require_customer();
        $body = hiso_json_body();
        $invoiceId = (string)($body['invoiceId'] ?? '');
        if ($invoiceId === '' || strlen($invoiceId) > 80) {
            hiso_json_response(['error' => 'Invoice reference is invalid.'], 422);
        }
        $invoiceStmt = hiso_pdo()->prepare(
            'SELECT i.id, i.customer_accepted FROM invoices i JOIN enquiries e ON e.id = i.enquiry_id WHERE (i.id = ? OR i.invoice_code = ?) AND LOWER(e.email) = LOWER(?) LIMIT 1'
        );
        $invoiceStmt->execute([$invoiceId, $invoiceId, (string)$customer['email']]);
        $invoice = $invoiceStmt->fetch();
        if (!$invoice) hiso_json_response(['error' => 'Invoice not found for this account.'], 404);
        if (!(bool)$invoice['customer_accepted']) {
            hiso_pdo()->prepare('UPDATE invoices SET customer_accepted = 1, accepted_at = NOW() WHERE id = ?')->execute([$invoice['id']]);
            hiso_send_lifecycle_whatsapp('invoice_status', 'invoice', (string)$invoice['id'], 'Your invoice was acknowledged.');
        }
        hiso_json_response(['accepted' => true]);
    }

    if ($method === 'GET' && $route === 'public/documents') {
        header('Cache-Control: no-store, private');
        $type = ($_GET['type'] ?? 'quote') === 'invoice' ? 'invoice' : 'quote';
        $id = trim((string)($_GET['id'] ?? ''));
        if ($id === '' || strlen($id) > 80) {
            hiso_json_response(['error' => 'Document reference is invalid.'], 422);
        }
        $user = hiso_current_user();
        $customer = $user ? null : hiso_current_customer();
        if (!$user && !$customer) {
            hiso_json_response(['error' => 'Verified customer sign-in required.'], 401);
        }
        if ($user && $user['role'] !== 'superadmin') {
            $documentPermissions = $type === 'invoice'
                ? ['manage_invoices', 'release_installations']
                : ['draft_quotes', 'approve_quotes', 'manage_invoices'];
            if (!array_intersect($documentPermissions, $user['permissions'] ?? [])) {
                hiso_json_response(['error' => 'Your role does not permit access to this document.'], 403);
            }
        }
        if ($type === 'invoice') {
            $sql = 'SELECT i.*, e.location, e.phone, e.email, e.ref_code FROM invoices i JOIN enquiries e ON e.id = i.enquiry_id WHERE (i.id = ? OR i.invoice_code = ?)';
            if ($customer) $sql .= ' AND LOWER(e.email) = LOWER(?)';
            $stmt = hiso_pdo()->prepare($sql . ' LIMIT 1');
            $params = [$id, $id];
            if ($customer) $params[] = (string)$customer['email'];
            $stmt->execute($params);
            $row = $stmt->fetch();
            if (!$row) hiso_json_response(['error' => 'Document not found for this account.'], 404);
            hiso_json_response([
                'type' => 'invoice', 'documentCode' => $row['invoice_code'], 'customerName' => $row['customer_name'],
                'location' => $row['location'], 'phone' => $row['phone'], 'email' => $row['email'], 'refCode' => $row['ref_code'],
                'issuedDate' => $row['issued_date'], 'dueDate' => $row['due_date'], 'discountNgn' => (float)$row['discount_ngn'],
                'taxPercent' => (float)$row['tax_percent'], 'totalNgn' => (float)$row['total_ngn'],
                'bankDetails' => json_decode($row['bank_details_json'] ?: '{}', true),
                'customerAccepted' => (bool)$row['customer_accepted'], 'items' => json_decode($row['items_json'] ?: '[]', true),
            ]);
        } else {
            $sql = 'SELECT q.*, e.location, e.phone, e.email, e.ref_code FROM quotations q JOIN enquiries e ON e.id = q.enquiry_id WHERE (q.id = ? OR q.quote_code = ?)';
            if ($customer) $sql .= " AND LOWER(e.email) = LOWER(?) AND q.status IN ('Approved', 'Invoiced')";
            $stmt = hiso_pdo()->prepare($sql . ' LIMIT 1');
            $params = [$id, $id];
            if ($customer) $params[] = (string)$customer['email'];
            $stmt->execute($params);
            $row = $stmt->fetch();
            if (!$row) hiso_json_response(['error' => 'Document not found for this account.'], 404);
            hiso_json_response([
                'type' => 'quote', 'documentCode' => $row['quote_code'], 'revisionNo' => (int)$row['revision_no'], 'status' => $row['status'],
                'customerName' => $row['customer_name'], 'location' => $row['location'], 'phone' => $row['phone'], 'email' => $row['email'], 'refCode' => $row['ref_code'],
                'scope' => $row['scope'], 'terms' => $row['terms'], 'note' => $row['note'], 'issuedDate' => $row['issued_date'], 'validUntil' => $row['valid_until'],
                'discountNgn' => (float)$row['discount_ngn'], 'taxPercent' => (float)$row['tax_percent'], 'approvedBy' => $row['approved_by'], 'items' => json_decode($row['items_json'] ?: '[]', true),
            ]);
        }
    }

    if ($method === 'POST' && $route === 'documents/send-email') {
        $user = hiso_current_user();
        if (!$user) hiso_json_response(['error' => 'Authentication required.'], 401);
        $body = hiso_json_body();
        $type = ($body['type'] ?? null) === 'invoice' ? 'invoice' : (($body['type'] ?? null) === 'quote' ? 'quote' : '');
        $id = trim((string)($body['id'] ?? ''));
        if (($type === 'invoice' && !in_array('manage_invoices', $user['permissions'] ?? [], true))
            || ($type === 'quote' && !in_array('draft_quotes', $user['permissions'] ?? [], true)
                && !in_array('manage_invoices', $user['permissions'] ?? [], true))) {
            hiso_json_response(['error' => 'Your role does not permit sending this document.'], 403);
        }
        if ($type === '' || $id === '' || strlen($id) > 80) {
            hiso_json_response(['error' => 'Document type or reference is invalid.'], 422);
        }
        hiso_require_communications_rate_limit($user, 'document-email', 10);
        $table = $type === 'invoice' ? 'invoices' : 'quotations';
        $codeColumn = $type === 'invoice' ? 'invoice_code' : 'quote_code';
        $stmt = hiso_pdo()->prepare(
            "SELECT d.{$codeColumn} AS document_code, e.email FROM {$table} d JOIN enquiries e ON e.id = d.enquiry_id WHERE d.id = ? OR d.{$codeColumn} = ? LIMIT 1"
        );
        $stmt->execute([$id, $id]);
        $document = $stmt->fetch();
        if (!$document || !filter_var($document['email'] ?? '', FILTER_VALIDATE_EMAIL)) {
            hiso_json_response(['error' => 'The customer email address is not available for this document.'], 422);
        }
        try {
            $media = hiso_validate_whatsapp_media(is_array($body['attachment'] ?? null) ? $body['attachment'] : []);
            if ($media['mime'] !== 'application/pdf' || strtolower(pathinfo($media['name'], PATHINFO_EXTENSION)) !== 'pdf') {
                throw new InvalidArgumentException('A validated PDF attachment is required.');
            }
            $safeCode = preg_replace('/[^A-Za-z0-9._-]/', '-', (string)$document['document_code']);
            $documentName = substr($safeCode ?: 'HI-SOTECH-document', 0, 80) . '.pdf';
            $label = $type === 'invoice' ? 'Invoice' : 'Quotation';
            hiso_send_mail(
                (string)$document['email'],
                'HI-SOTECH ' . $label . ' ' . (string)$document['document_code'],
                'Please find the HI-SOTECH ' . strtolower($label) . ' attached as a PDF.',
                [['bytes' => $media['bytes'], 'name' => $documentName, 'mime' => 'application/pdf']]
            );
            hiso_json_response(['ok' => true]);
        } catch (InvalidArgumentException $error) {
            hiso_json_response(['error' => $error->getMessage()], 422);
        } catch (Throwable $error) {
            hiso_json_response(['error' => 'The document email could not be sent. Please try again later.'], 502);
        }
    }

    // --- Customer Portal Endpoints ---
    if ($method === 'POST' && $route === 'customer/setup-password') {
        $body = hiso_json_body();
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $pin = (string)($body['pin'] ?? '');
        $password = (string)($body['password'] ?? '');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190) {
            hiso_json_response(['error' => 'Enter the email address used for your account.'], 422);
        }
        $remote = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
        if (!hiso_customer_auth_rate_limit('customer-pin-ip:' . $remote, 10, 900)
            || !hiso_customer_auth_rate_limit('customer-pin-email:' . $email, 5, 900)) {
            hiso_json_response(['error' => 'Too many setup attempts. Please try again later.'], 429);
        }
        try {
            hiso_setup_customer_password($email, $pin, $password);
            hiso_json_response(['ok' => true]);
        } catch (InvalidArgumentException $error) {
            hiso_json_response(['error' => $error->getMessage()], 422);
        }
    }

    if ($method === 'POST' && $route === 'customer/login') {
        $body = hiso_json_body();
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $password = (string)($body['password'] ?? '');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190 || strlen($password) > 128) {
            hiso_json_response(['error' => 'Invalid email or password.'], 422);
        }
        $remote = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
        if (!hiso_customer_auth_rate_limit('customer-login-ip:' . $remote, 10, 900)
            || !hiso_customer_auth_rate_limit('customer-login-email:' . $email, 5, 900)) {
            hiso_json_response(['error' => 'Too many sign-in attempts. Please try again later.'], 429);
        }
        $portal = hiso_customer_password_login($email, $password);
        if (!$portal) {
            hiso_json_response(['error' => 'Invalid email or password.'], 401);
        }
        hiso_json_response($portal);
    }

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
        $lookup = $pdo->prepare('SELECT id FROM customer_profiles WHERE LOWER(email) = ? AND email_verified_at IS NOT NULL AND must_set_password = 0 LIMIT 1');
        $lookup->execute([$email]);
        $customerId = $lookup->fetchColumn();
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
                hiso_log_mail_failure($e);
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
            $stmt = $pdo->prepare(
                'SELECT t.customer_id FROM customer_login_tokens t JOIN customer_profiles c ON c.id=t.customer_id ' .
                'WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at > UTC_TIMESTAMP() AND c.must_set_password=0 LIMIT 1'
            );
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
        $previousPhoneStmt = $pdo->prepare('SELECT phone FROM customer_profiles WHERE id = ? AND email_verified_at IS NOT NULL LIMIT 1');
        $previousPhoneStmt->execute([$customer['id']]);
        $previousPhone = (string)($previousPhoneStmt->fetchColumn() ?: '');
        $pdo->prepare('UPDATE customer_profiles SET name=?, phone=?, location=?, company=?, ref_code=? WHERE id=? AND email_verified_at IS NOT NULL')
            ->execute([$name, $phone, $location, $company, $refCode, $customer['id']]);
        if (trim($previousPhone) !== $phone) {
            $pdo->prepare('UPDATE communications_consents SET revoked_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE customer_id = ? AND channel = "whatsapp" AND revoked_at IS NULL')
                ->execute([$customer['id']]);
            $pdo->prepare('UPDATE whatsapp_recipient_consents SET revoked_at = UTC_TIMESTAMP() WHERE recipient_type = "customer" AND recipient_id = ? AND revoked_at IS NULL')
                ->execute([$customer['id']]);
        }
        $stmt = $pdo->prepare('SELECT id, name, email, phone, location, company, ref_code, created_at FROM customer_profiles WHERE id = ? AND email_verified_at IS NOT NULL');
        $stmt->execute([$customer['id']]);
        $updated = $stmt->fetch();
        if (!$updated) hiso_json_response(['error' => 'Verified customer profile not found.'], 404);
        $consents = hiso_customer_consent_state((string)$updated['id']);
        hiso_json_response(['profile' => [
            'id' => $updated['id'], 'name' => $updated['name'], 'email' => $updated['email'], 'phone' => $updated['phone'],
            'location' => $updated['location'], 'company' => $updated['company'], 'refCode' => $updated['ref_code'], 'createdAt' => $updated['created_at'],
            'emailMarketingConsent' => $consents['email'],
            'whatsappMarketingConsent' => $consents['whatsapp'],
            'whatsappUpdatesConsent' => hiso_customer_whatsapp_updates_consent((string)$updated['id'], (string)$updated['phone']),
        ]]);
    }

    if ($method === 'POST' && $route === 'customer/communications/consent') {
        $customer = hiso_require_customer();
        $body = hiso_json_body();
        if (!is_bool($body['email'] ?? null) || !is_bool($body['whatsapp'] ?? null) || !is_bool($body['whatsappUpdates'] ?? null)) {
            hiso_json_response(['error' => 'Email, WhatsApp marketing, and WhatsApp service-update consent choices are required.'], 422);
        }
        if (($body['whatsapp'] || $body['whatsappUpdates']) && !preg_match('/^\+[1-9][0-9]{7,14}$/', trim((string)$customer['phone']))) {
            hiso_json_response(['error' => 'Please use the required country code in the phone number before opting in to WhatsApp.'], 422);
        }
        $pdo = hiso_pdo();
        $save = $pdo->prepare(
            'INSERT INTO communications_consents (customer_id, channel, consented_at, revoked_at) VALUES (?, ?, ?, ?) ' .
            'ON DUPLICATE KEY UPDATE consented_at = IF(VALUES(consented_at) IS NOT NULL AND (consented_at IS NULL OR revoked_at IS NOT NULL), VALUES(consented_at), consented_at), ' .
            'revoked_at = VALUES(revoked_at), updated_at = CURRENT_TIMESTAMP'
        );
        foreach (['email' => $body['email'], 'whatsapp' => $body['whatsapp']] as $channel => $enabled) {
            $now = gmdate('Y-m-d H:i:s');
            $save->execute([$customer['id'], $channel, $enabled ? $now : null, $enabled ? null : $now]);
        }
        hiso_save_whatsapp_recipient_consent(
            'customer',
            (string)$customer['id'],
            'operational',
            trim((string)$customer['phone']),
            $body['whatsappUpdates'],
            'customer_portal'
        );
        hiso_json_response([
            'ok' => true,
            'emailMarketingConsent' => $body['email'],
            'whatsappMarketingConsent' => $body['whatsapp'],
            'whatsappUpdatesConsent' => $body['whatsappUpdates'],
        ]);
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
            $equipmentId = hiso_uuid();
            $pdo->prepare('INSERT INTO customer_equipment (id, customer_id, equipment_type, brand_model, serial_number, capacity_kw, install_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$equipmentId, $customer['id'], $type, $brand, $serial, $capacity, $installDate, $notes]);
            $photos = $body['photos'] ?? [];
            if (!is_array($photos)) $photos = [];
            if (count($photos) > 4) hiso_json_response(['error' => 'At most 4 equipment photos may be added at once.'], 422);
            foreach ($photos as $photo) {
                if (!is_array($photo) || !is_string($photo['dataUrl'] ?? null) || !is_string($photo['name'] ?? null)
                    || strlen($photo['dataUrl']) > 6 * 1024 * 1024) {
                    hiso_json_response(['error' => 'Equipment photo data is invalid.'], 422);
                }
                try {
                    $stored = hiso_store_photo_data_url((string)$photo['dataUrl'], (string)$photo['name']);
                } catch (Throwable $error) {
                    hiso_json_response(['error' => $error->getMessage()], 422);
                }
                $pdo->prepare(
                    'INSERT INTO customer_equipment_photos (id, equipment_id, customer_id, storage_filename, original_name, mime_type) VALUES (?, ?, ?, ?, ?, ?)'
                )->execute([
                    hiso_uuid(), $equipmentId, $customer['id'], $stored['storage_filename'],
                    $stored['original_name'], $stored['mime_type'],
                ]);
            }
        }
        $eqStmt = $pdo->prepare('SELECT * FROM customer_equipment WHERE customer_id = ? ORDER BY created_at DESC');
        $eqStmt->execute([$customer['id']]);
        hiso_json_response(['equipment' => array_map(function ($e) use ($pdo, $customer) {
            $photoStmt = $pdo->prepare('SELECT id, original_name, created_at FROM customer_equipment_photos WHERE equipment_id = ? AND customer_id = ? ORDER BY created_at DESC');
            $photoStmt->execute([$e['id'], $customer['id']]);
            $photos = array_map(static fn($photo) => [
                'id' => $photo['id'],
                'fileUrl' => '/api/customer-equipment-photo/' . rawurlencode($photo['id']),
                'originalName' => $photo['original_name'],
                'createdAt' => $photo['created_at'],
            ], $photoStmt->fetchAll());
            return [
                'id' => $e['id'], 'customerId' => $e['customer_id'], 'equipmentType' => $e['equipment_type'],
                'brandModel' => $e['brand_model'], 'serialNumber' => $e['serial_number'], 'capacityKw' => $e['capacity_kw'],
                'installDate' => $e['install_date'], 'notes' => $e['notes'], 'createdAt' => $e['created_at'],
                'photos' => $photos,
            ];
        }, $eqStmt->fetchAll())]);
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
        hiso_send_lifecycle_whatsapp('ticket_status', 'ticket', $code, 'Service ticket ' . $code . ' was received.');
        hiso_send_lifecycle_email_to_roles(
            'ticket_status',
            ['admin', 'superadmin'],
            'HI-SOTECH service ticket received: ' . $code,
            'Service ticket ' . $code . ' was received. Review it in the Staff Workspace.'
        );
        hiso_audit(['name' => $customer['name'], 'role' => 'customer'], 'CREATE_TICKET', 'ServiceTicket', $code, 'Customer filed ' . $category);
        $tStmt = $pdo->prepare('SELECT * FROM service_tickets WHERE customer_id = ? ORDER BY created_at DESC');
        $tStmt->execute([$customer['id']]);
        hiso_json_response(['ticketCode' => $code, 'tickets' => array_map('hiso_hydrate_ticket', $tStmt->fetchAll())], 201);
    }

    // --- Auth Endpoints ---
    if ($method === 'GET' && $route === 'setup/status') {
        global $CONFIG;
        $pdo = hiso_pdo();
        $userCount = (int)$pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
        $setupStmt = $pdo->query('SELECT completed_at FROM app_setup WHERE id = 1');
        $setupState = $setupStmt->fetch(PDO::FETCH_ASSOC);
        $available = trim((string)($CONFIG['SETUP_SECRET'] ?? '')) !== ''
            && $userCount === 0
            && (!$setupState || $setupState['completed_at'] === null);
        hiso_json_response(['available' => $available]);
    }

    if ($method === 'POST' && $route === 'setup/first-admin') {
        global $CONFIG;
        $body = hiso_json_body();
        $remote = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
        if (!hiso_customer_auth_rate_limit('first-admin-setup:' . $remote, 10, 3600)) {
            hiso_json_response(['error' => 'Too many setup attempts. Try again later.'], 429);
        }
        $setupSecret = (string)($CONFIG['SETUP_SECRET'] ?? '');
        if ($setupSecret === '' || !hash_equals($setupSecret, (string)($body['setupSecret'] ?? ''))) {
            hiso_json_response(['error' => 'Initial account setup is unavailable.'], 403);
        }
        $name = trim((string)($body['name'] ?? ''));
        $username = strtolower(trim((string)($body['username'] ?? '')));
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $phone = trim((string)($body['phone'] ?? ''));
        $password = (string)($body['password'] ?? '');
        if ($name === '' || strlen($name) > 120 || !preg_match('/^[a-z0-9._-]{3,50}$/', $username)
            || !filter_var($email, FILTER_VALIDATE_EMAIL)
            || strlen($email) > 190 || strlen($phone) > 40 || strlen($password) < 14 || strlen($password) > 128) {
            hiso_json_response(['error' => 'Name, username, valid email, phone, and a 14-character password are required.'], 422);
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
            $pdo->prepare('INSERT INTO users (id, name, username, email, email_verified_at, phone, password_hash, role, title, skills, status) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), ?, ?, "superadmin", "System Super Administrator", "", "Active")')
                ->execute([$id, $name, $username, $email, $phone, password_hash($password, PASSWORD_DEFAULT)]);
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

    if ($method === 'POST' && $route === 'auth/setup-password') {
        $body = hiso_json_body();
        $identifier = strtolower(trim((string)($body['identifier'] ?? '')));
        $pin = (string)($body['pin'] ?? '');
        $password = (string)($body['password'] ?? '');
        if ($identifier === '' || strlen($identifier) > 190) {
            hiso_json_response(['error' => 'Enter your staff email or username.'], 422);
        }
        $clientAddress = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
        if (!hiso_customer_auth_rate_limit('staff-pin-ip:' . $clientAddress, 10, 900)
            || !hiso_customer_auth_rate_limit('staff-pin-identifier:' . $identifier, 5, 900)) {
            hiso_json_response(['error' => 'Too many setup attempts. Please try again later.'], 429);
        }
        try {
            hiso_setup_staff_password($identifier, $pin, $password);
            hiso_json_response(['ok' => true]);
        } catch (InvalidArgumentException $error) {
            hiso_json_response(['error' => $error->getMessage()], 422);
        }
    }

    if ($method === 'POST' && $route === 'auth/forgot-password') {
        global $CONFIG;
        $body = hiso_json_body();
        $email = strtolower(trim((string)($body['email'] ?? '')));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190) {
            hiso_json_response(['error' => 'Enter a valid staff email address.'], 422);
        }
        $clientAddress = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
        if (!hiso_customer_auth_rate_limit('staff-reset-ip:' . $clientAddress, 5, 900)
            || !hiso_customer_auth_rate_limit('staff-reset-email:' . $email, 3, 3600)) {
            hiso_json_response(['error' => 'Too many password reset requests. Please try again later.'], 429);
        }
        $account = hiso_create_staff_password_reset($email);
        if (!$account) {
            hiso_json_response(['error' => 'Staff user does not exist or does not have a verified email address.'], 404);
        }
        $appUrl = rtrim((string)($CONFIG['APP_URL'] ?? ''), '/');
        $parts = parse_url($appUrl);
        if (!$parts || empty($parts['host']) || !in_array($parts['scheme'] ?? '', ['https', 'http'], true)) {
            hiso_json_response(['error' => 'Password reset email is not configured. Contact the system administrator.'], 503);
        }
        $resetUrl = $appUrl . '/#workspace?reset=' . rawurlencode((string)$account['token']);
        try {
            hiso_send_mail(
                (string)$account['email'],
                'Reset your HI-SOTECH staff password',
                "Hello {$account['name']},\n\n"
                . "Use this secure link to reset your staff workspace password. It expires in 30 minutes and can only be used once.\n"
                . $resetUrl . "\n\n"
                . "If you did not request this reset, you can ignore this email."
            );
            hiso_json_response(['ok' => true]);
        } catch (Throwable $error) {
            hiso_log_mail_failure($error);
            hiso_json_response(['error' => 'The password reset email could not be sent. Please try again later.'], 502);
        }
    }

    if ($method === 'POST' && $route === 'auth/reset-password') {
        $body = hiso_json_body();
        $token = is_string($body['token'] ?? null) ? $body['token'] : '';
        $password = is_string($body['password'] ?? null) ? $body['password'] : '';
        $clientAddress = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
        if (!hiso_customer_auth_rate_limit('staff-reset-complete-ip:' . $clientAddress, 10, 900)
            || !hiso_customer_auth_rate_limit('staff-reset-token:' . $token, 5, 900)) {
            hiso_json_response(['error' => 'Too many password reset attempts. Please try again later.'], 429);
        }
        try {
            hiso_reset_staff_password($token, $password);
            hiso_json_response(['ok' => true]);
        } catch (InvalidArgumentException $error) {
            hiso_json_response(['error' => $error->getMessage()], 422);
        }
    }

    if ($method === 'POST' && $route === 'auth/login') {
        $body = hiso_json_body();
        $identifier = strtolower(trim((string)($body['identifier'] ?? '')));
        $password = (string)($body['password'] ?? '');
        if (strlen($identifier) > 190 || strlen($password) > 128) {
            hiso_json_response(['error' => 'Invalid email or password.'], 422);
        }
        $clientAddress = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
        if (!hiso_customer_auth_rate_limit('staff-ip:' . $clientAddress, 10, 900)
            || !hiso_customer_auth_rate_limit('staff-identifier:' . $identifier, 5, 900)) {
            hiso_json_response(['error' => 'Too many sign-in attempts. Please try again later.'], 429);
        }
        $stmt = hiso_pdo()->prepare('SELECT * FROM users WHERE (LOWER(email) = ? OR LOWER(username) = ?) AND status = "Active" LIMIT 1');
        $stmt->execute([$identifier, $identifier]);
        $user = $stmt->fetch();
        if ($user && (int)($user['must_set_password'] ?? 0) === 1) {
            $pinHash = (string)($user['initial_pin_hash'] ?? '');
            $pinIsActive = preg_match('/^\d{4}$/', $password) && $pinHash !== ''
                && (int)($user['pin_attempts'] ?? HISO_SETUP_PIN_MAX_ATTEMPTS) < HISO_SETUP_PIN_MAX_ATTEMPTS
                && !empty($user['pin_expires_at']) && strtotime((string)$user['pin_expires_at']) > time();
            if ($pinIsActive) {
                if (password_verify($password, $pinHash)) {
                    hiso_json_response(['setupRequired' => true]);
                }
                hiso_record_failed_setup_pin_attempt('users', (string)$user['id'], $pinHash);
            }
            hiso_json_response(['error' => 'Invalid email or password.'], 401);
        }
        if (!$user || (($user['auth_type'] ?? 'password') === 'pin' && !preg_match('/^\d{6}$/', $password))
            || !password_verify($password, (string)($user['password_hash'] ?? ''))) {
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

    if ($method === 'POST' && $route === 'staff/profile') {
        $user = hiso_current_user();
        if (!$user) hiso_json_response(['error' => 'Authentication required.'], 401);
        if (!hiso_column_exists('users', 'profile_photo_filename')) {
            hiso_json_response(['error' => 'Apply php-cpanel/migrations/010-staff-profiles-contact-groups.sql before using staff profiles.'], 503);
        }
        $body = hiso_json_body();
        if (!is_string($body['name'] ?? null) || !is_string($body['phone'] ?? null)
            || (isset($body['photoDataUrl']) && !is_string($body['photoDataUrl']))
            || (isset($body['removePhoto']) && !is_bool($body['removePhoto']))) {
            hiso_json_response(['error' => 'Profile name, phone, or photo data is invalid.'], 422);
        }
        try {
            $updated = hiso_update_staff_profile($user, $body);
            hiso_audit($updated, 'UPDATE_OWN_STAFF_PROFILE', 'Staff', (string)$updated['id'], 'Updated own profile details.');
            hiso_json_response(['user' => $updated]);
        } catch (InvalidArgumentException $error) {
            hiso_json_response(['error' => $error->getMessage()], 422);
        }
    }

    if ($method === 'POST' && $route === 'staff/authentication') {
        $user = hiso_current_user();
        if (!$user) hiso_json_response(['error' => 'Authentication required.'], 401);
        if (!hiso_column_exists('users', 'auth_type')) {
            hiso_json_response(['error' => 'Apply php-cpanel/migrations/011-staff-authentication.sql before changing authentication type.'], 503);
        }
        try {
            $updated = hiso_save_staff_authentication($user, hiso_json_body());
            hiso_audit($updated, 'UPDATE_STAFF_AUTHENTICATION', 'Staff', (string)$updated['id'], 'Updated own authentication type.');
            hiso_json_response(['user' => $updated]);
        } catch (InvalidArgumentException $error) {
            hiso_json_response(['error' => $error->getMessage()], 422);
        }
    }

    // --- Authenticated Workspace Endpoints ---
    if ($method === 'GET' && $route === 'workspace/bootstrap') {
        $user = hiso_current_user();
        if (!$user) hiso_json_response(['error' => 'Authentication required.'], 401);
        $workspace = hiso_hydrate_workspace($user);
        $workspace['settings'] = hiso_load_platform_settings();
        if (!hiso_can_manage_platform_settings($user)) {
            $workspace['settings']['bankDetails'] = ['bankName' => '', 'accountName' => '', 'accountNumber' => ''];
        }
        hiso_json_response($workspace);
    }

    if ($method === 'POST' && $route === 'workspace/settings') {
        $user = hiso_current_user();
        if (!$user) hiso_json_response(['error' => 'Authentication required.'], 401);
        if (!hiso_can_manage_platform_settings($user)) {
            hiso_json_response(['error' => 'Platform settings permission required.'], 403);
        }
        if (!hiso_platform_settings_table_exists()) {
            hiso_json_response(['error' => 'Platform settings migration is required. Import php-cpanel/migrations/005-platform-settings.sql in phpMyAdmin.'], 503);
        }
        try {
            $settings = hiso_save_platform_settings($user, hiso_json_body());
            hiso_json_response(['settings' => $settings]);
        } catch (InvalidArgumentException $error) {
            hiso_json_response(['error' => $error->getMessage()], 422);
        }
    }

    if ($method === 'GET' && $route === 'communications/my-whatsapp-consent') {
        $user = hiso_current_user();
        if (!$user) hiso_json_response(['error' => 'Authentication required.'], 401);
        $operational = hiso_whatsapp_consent_contact('staff', (string)$user['id'], 'operational');
        $marketing = hiso_whatsapp_consent_contact('staff', (string)$user['id'], 'marketing');
        hiso_json_response([
            'operational' => $operational !== null,
            'marketing' => $marketing !== null,
            'phone' => (string)($user['phone'] ?? ''),
        ]);
    }

    if ($method === 'POST' && $route === 'communications/my-whatsapp-consent') {
        $user = hiso_current_user();
        if (!$user) hiso_json_response(['error' => 'Authentication required.'], 401);
        $body = hiso_json_body();
        if (!is_bool($body['operational'] ?? null) || !is_bool($body['marketing'] ?? null)) {
            hiso_json_response(['error' => 'Explicit operational and marketing consent choices are required.'], 422);
        }
        try {
            $phone = trim((string)($user['phone'] ?? ''));
            hiso_save_whatsapp_recipient_consent('staff', (string)$user['id'], 'operational', $phone, $body['operational'], 'staff_self_service');
            hiso_save_whatsapp_recipient_consent('staff', (string)$user['id'], 'marketing', $phone, $body['marketing'], 'staff_self_service');
        } catch (InvalidArgumentException $error) {
            hiso_json_response(['error' => $error->getMessage()], 422);
        }
        hiso_json_response(['operational' => $body['operational'], 'marketing' => $body['marketing']]);
    }

    if ($method === 'POST' && $route === 'communications/test-email') {
        $user = hiso_require_permission('manage_communications');
        if (($user['role'] ?? '') !== 'superadmin') {
            hiso_json_response(['error' => 'Only Super Admin can send test emails.'], 403);
        }
        hiso_require_communications_rate_limit($user, 'smtp-test', 2);
        $body = hiso_json_body();
        $email = trim((string)($body['recipientEmail'] ?? '')) ?: trim((string)($user['email'] ?? ''));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            hiso_json_response(['error' => 'The signed-in staff email address is invalid.'], 422);
        }
        try {
            hiso_send_mail(
                $email,
                'HI-SOTECH email delivery test',
                'This is a test of HI-SOTECH email delivery. If you received it, outbound email is working.'
            );
            hiso_json_response(['ok' => true]);
        } catch (Throwable $error) {
            hiso_log_mail_failure($error);
            $category = hiso_mail_failure_category($error);
            if ($category === 'authentication') {
                hiso_json_response([
                    'error' => 'SMTP authentication was rejected. Reset or verify the mailbox password in cPanel, update MAIL_PASSWORD in the private .env.php, then test again.',
                    'category' => $category,
                ], 502);
            }
            hiso_json_response([
                'error' => 'The test email could not be accepted by SMTP. Check the private mail settings and server mail log.',
                'category' => $category,
            ], 502);
        }
    }

    if ($method === 'GET' && $route === 'communications/contacts') {
        $user = hiso_require_permission('manage_communications');
        $contactGroupsReady = hiso_table_exists('customer_contact_groups')
            && hiso_table_exists('customer_contact_group_members');
        $pushCustomers = hiso_pdo()->query(
            "SELECT DISTINCT c.id, c.name FROM customer_profiles c JOIN push_subscriptions p ON p.owner_id = c.id " .
            "WHERE p.owner_type = 'customer' AND c.email_verified_at IS NOT NULL ORDER BY c.name LIMIT 500"
        )->fetchAll(PDO::FETCH_ASSOC);
        hiso_json_response([
            'email' => hiso_marketing_contacts('email'),
            'whatsapp' => hiso_whatsapp_consent_contacts('marketing'),
            'whatsappOperational' => hiso_whatsapp_consent_contacts('operational'),
            'whatsappServiceRequests' => hiso_whatsapp_service_requests(),
            'pushCustomers' => $pushCustomers,
            'customerDirectory' => hiso_customer_contact_directory(),
            'customerGroups' => $contactGroupsReady ? hiso_customer_contact_groups() : [],
            'contactGroupsReady' => $contactGroupsReady,
            'myWhatsappConsents' => [
                'operational' => hiso_whatsapp_consent_contact('staff', (string)$user['id'], 'operational') !== null,
                'marketing' => hiso_whatsapp_consent_contact('staff', (string)$user['id'], 'marketing') !== null,
                'phone' => (string)($user['phone'] ?? ''),
            ],
        ]);
    }

    if ($method === 'POST' && $route === 'communications/contact-groups') {
        $user = hiso_require_permission('manage_communications');
        if (!hiso_table_exists('customer_contact_groups') || !hiso_table_exists('customer_contact_group_members')) {
            hiso_json_response(['error' => 'Apply php-cpanel/migrations/010-staff-profiles-contact-groups.sql before managing contact groups.'], 503);
        }
        $body = hiso_json_body();
        if (!is_string($body['name'] ?? null) || (isset($body['id']) && !is_string($body['id']))) {
            hiso_json_response(['error' => 'Contact group name or ID is invalid.'], 422);
        }
        try {
            $result = hiso_save_customer_contact_group($body, (string)$user['id']);
            $groupName = substr(trim((string)($body['name'] ?? '')), 0, 80);
            hiso_audit(
                $user,
                isset($body['id']) ? 'UPDATE_CUSTOMER_CONTACT_GROUP' : 'CREATE_CUSTOMER_CONTACT_GROUP',
                'Contact group',
                $result['id'],
                'Saved customer contact group "' . $groupName . '".'
            );
            hiso_json_response($result + ['groups' => hiso_customer_contact_groups()]);
        } catch (InvalidArgumentException $error) {
            hiso_json_response(['error' => $error->getMessage()], 422);
        }
    }

    if ($method === 'DELETE' && str_starts_with($route, 'communications/contact-groups/')) {
        $user = hiso_require_permission('manage_communications');
        if (!hiso_table_exists('customer_contact_groups') || !hiso_table_exists('customer_contact_group_members')) {
            hiso_json_response(['error' => 'Apply php-cpanel/migrations/010-staff-profiles-contact-groups.sql before managing contact groups.'], 503);
        }
        $groupId = substr($route, strlen('communications/contact-groups/'));
        try {
            hiso_delete_customer_contact_group($groupId);
            hiso_audit($user, 'DELETE_CUSTOMER_CONTACT_GROUP', 'Contact group', $groupId, 'Deleted a customer contact group.');
            hiso_json_response(['ok' => true, 'groups' => hiso_customer_contact_groups()]);
        } catch (InvalidArgumentException $error) {
            hiso_json_response(['error' => $error->getMessage()], 422);
        }
    }

    if ($method === 'POST' && $route === 'communications/whatsapp') {
        $user = hiso_require_permission('manage_communications');
        hiso_require_communications_rate_limit($user, 'whatsapp-single', 30);
        $body = hiso_json_body();
        $recipientType = (string)($body['recipientType'] ?? '');
        $recipientId = trim((string)($body['recipientId'] ?? ''));
        if (!in_array($recipientType, ['customer', 'staff', 'enquiry'], true) || $recipientId === '' || !is_string($body['message'] ?? null)) {
            hiso_json_response(['error' => 'Select a recipient with active WhatsApp marketing consent and enter a message.'], 422);
        }
        $message = trim((string)($body['message'] ?? ''));
        $messageLength = preg_match_all('/./us', $message);
        if ($message === '' || $messageLength === false || $messageLength > 1024 || strlen($message) > 4096) {
            hiso_json_response(['error' => 'Enter a template body parameter of at most 1024 characters.'], 422);
        }
        $contact = hiso_whatsapp_consent_contact($recipientType, $recipientId, 'marketing', true);
        if (!$contact) {
            hiso_json_response(['error' => 'This recipient has no active WhatsApp marketing consent. Service-update consent is separate and does not authorize marketing messages.'], 422);
        }
        if (!preg_match('/^\+[1-9][0-9]{7,14}$/', (string)$contact['phone'])) {
            hiso_json_response(['error' => 'Please use the required country code in the opted-in phone number.'], 422);
        }
        $attachments = $body['attachments'] ?? [];
        if (!is_array($attachments) || count($attachments) > 1) {
            hiso_json_response(['error' => 'A WhatsApp message may include at most one image or PDF attachment.'], 422);
        }
        try {
            $media = count($attachments) ? hiso_validate_whatsapp_media($attachments[0]) : null;
            $config = hiso_whatsapp_template_config('manual', $media['mime'] ?? null);
            $mediaId = $media ? hiso_whatsapp_upload_media($config, $media) : null;
            hiso_whatsapp_send_template($config, (string)$contact['phone'], $message, $mediaId, $media['mime'] ?? null);
        } catch (InvalidArgumentException $error) {
            hiso_json_response(['error' => $error->getMessage()], 422);
        } catch (Throwable $error) {
            $configured = str_contains(strtolower($error->getMessage()), 'not configured')
                || str_contains(strtolower($error->getMessage()), 'configuration')
                || str_contains(strtolower($error->getMessage()), 'template header');
            hiso_json_response(['error' => $configured ? $error->getMessage() : 'WhatsApp provider delivery failed. Check private configuration and provider status.'], $configured ? 503 : 502);
        }
        hiso_audit($user, 'SEND_WHATSAPP_MARKETING', ucfirst($recipientType), $recipientId, 'Sent approved-template WhatsApp marketing message.');
        hiso_json_response(['ok' => true]);
    }

    if ($method === 'POST' && $route === 'communications/whatsapp-service') {
        $user = hiso_require_permission('manage_communications');
        hiso_require_communications_rate_limit($user, 'whatsapp-service-single', 30);
        $body = hiso_json_body();
        $requestType = is_string($body['requestType'] ?? null) ? $body['requestType'] : '';
        $requestId = is_string($body['requestId'] ?? null) ? trim($body['requestId']) : '';
        $message = is_string($body['message'] ?? null) ? trim($body['message']) : '';
        $messageLength = preg_match_all('/./us', $message);
        if (!in_array($requestType, ['enquiry', 'ticket'], true) || $requestId === '' || strlen($requestId) > 36
            || $message === '' || $messageLength === false || $messageLength > 1024 || strlen($message) > 4096) {
            hiso_json_response(['error' => 'Select an active enquiry or support ticket and enter a service reply of up to 1024 characters.'], 422);
        }
        try {
            $contact = hiso_whatsapp_service_request_contact($requestType, $requestId);
        } catch (Throwable $error) {
            hiso_json_response(['error' => 'The service request could not be verified. Please retry.'], 503);
        }
        if (!$contact) {
            hiso_json_response(['error' => 'That request is unavailable, closed, or has no valid country-code WhatsApp number.'], 422);
        }
        try {
            $templateKey = $requestType === 'enquiry' ? 'new_enquiry' : 'ticket_status';
            $config = hiso_whatsapp_template_config($templateKey);
            hiso_whatsapp_send_template($config, (string)$contact['phone'], $message);
        } catch (InvalidArgumentException $error) {
            hiso_json_response(['error' => $error->getMessage()], 422);
        } catch (Throwable $error) {
            $configured = str_contains(strtolower($error->getMessage()), 'not configured')
                || str_contains(strtolower($error->getMessage()), 'configuration')
                || str_contains(strtolower($error->getMessage()), 'template header');
            hiso_json_response(['error' => $configured ? $error->getMessage() : 'WhatsApp service reply could not be delivered. Check private provider configuration and status.'], $configured ? 503 : 502);
        }
        hiso_audit(
            $user,
            'SEND_WHATSAPP_SERVICE_REPLY',
            $requestType,
            (string)$contact['requestCode'],
            'Sent a service reply for ' . (string)$contact['requestCode'] . '.'
        );
        hiso_json_response(['ok' => true]);
    }

    if ($method === 'POST' && $route === 'communications/whatsapp-newsletter') {
        $user = hiso_require_permission('manage_communications');
        hiso_require_communications_rate_limit($user, 'whatsapp-newsletter', 3);
        $body = hiso_json_body();
        $message = trim((string)($body['message'] ?? ''));
        $length = preg_match_all('/./us', $message);
        $recipients = $body['recipients'] ?? null;
        if (isset($body['groupId']) && !is_string($body['groupId'])) {
            hiso_json_response(['error' => 'Contact group selection is invalid.'], 422);
        }
        $groupId = trim((string)($body['groupId'] ?? ''));
        $attachments = $body['attachments'] ?? [];
        if ($message === '' || $length === false || $length > 1024 || strlen($message) > 4096) {
            hiso_json_response(['error' => 'WhatsApp newsletter template text is required and limited to 1024 characters.'], 422);
        }
        if (!is_array($recipients) || count($recipients) < 1 || count($recipients) > 200
            || !is_array($attachments) || count($attachments) > 1) {
            hiso_json_response(['error' => 'Select 1–200 recipients and at most one validated image or PDF attachment.'], 422);
        }
        $uniqueRecipients = [];
        foreach ($recipients as $recipient) {
            if (!is_array($recipient) || !in_array($recipient['recipientType'] ?? null, ['customer', 'staff', 'enquiry'], true)
                || !is_string($recipient['recipientId'] ?? null) || $recipient['recipientId'] === ''
                || strlen($recipient['recipientId']) > 36) {
                hiso_json_response(['error' => 'Recipient selection is invalid.'], 422);
            }
            $uniqueRecipients[(string)$recipient['recipientType'] . ':' . $recipient['recipientId']] = $recipient;
        }
        $skipped = 0;
        $eligibleGroupContacts = null;
        if ($groupId !== '') {
            try {
                $groupResult = hiso_customer_contact_group_recipients($groupId, 'whatsapp');
                $eligibleGroupContacts = [];
                foreach ($groupResult['contacts'] as $contact) $eligibleGroupContacts[(string)$contact['id']] = true;
                $skipped = $groupResult['skipped'];
            } catch (InvalidArgumentException $error) {
                hiso_json_response(['error' => $error->getMessage()], 422);
            }
        }
        $contacts = [];
        foreach ($uniqueRecipients as $recipient) {
            $recipientType = (string)$recipient['recipientType'];
            $recipientId = (string)$recipient['recipientId'];
            if ($eligibleGroupContacts !== null
                && ($recipientType !== 'customer' || !isset($eligibleGroupContacts[$recipientId]))) {
                $skipped++;
                continue;
            }
            $contact = hiso_whatsapp_consent_contact($recipientType, $recipientId, 'marketing', true);
            if (!$contact || !preg_match('/^\+[1-9][0-9]{7,14}$/', (string)$contact['phone'])) {
                $skipped++;
                continue;
            }
            $contacts[] = $contact;
        }
        if (!$contacts) {
            hiso_json_response([
                'error' => 'No selected recipients currently have active WhatsApp marketing consent and a valid country-code phone number. Service-update consent is separate.',
                'skipped' => $skipped,
            ], 422);
        }
        try {
            $media = count($attachments) ? hiso_validate_whatsapp_media($attachments[0]) : null;
            $config = hiso_whatsapp_template_config('newsletter', $media['mime'] ?? null);
        } catch (InvalidArgumentException $error) {
            hiso_json_response(['error' => $error->getMessage()], 422);
        } catch (Throwable $error) {
            hiso_json_response(['error' => $error->getMessage()], 503);
        }
        try {
            $mediaId = $media ? hiso_whatsapp_upload_media($config, $media) : null;
            foreach ($contacts as $contact) {
                hiso_whatsapp_send_template($config, (string)$contact['phone'], $message, $mediaId, $media['mime'] ?? null);
            }
        } catch (Throwable $error) {
            $status = str_contains($error->getMessage(), 'HTTP ') ? 502 : 503;
            hiso_json_response(['error' => $status === 503 ? $error->getMessage() : 'WhatsApp newsletter delivery failed.'], $status);
        }
        hiso_audit($user, 'SEND_WHATSAPP_NEWSLETTER', 'Newsletter', hiso_uuid(), 'Sent to ' . count($contacts) . ' marketing-consented recipients.');
        hiso_json_response(['ok' => true, 'delivered' => count($contacts), 'skipped' => $skipped]);
    }

    if ($method === 'POST' && $route === 'communications/newsletter') {
        $user = hiso_require_permission('manage_communications');
        hiso_require_communications_rate_limit($user, 'email-newsletter', 3);
        $body = hiso_json_body();
        if (!is_string($body['subject'] ?? null) || !is_string($body['message'] ?? null)) {
            hiso_json_response(['error' => 'Newsletter subject and message are required.'], 422);
        }
        $attachments = $body['attachments'] ?? [];
        if (!is_array($attachments)) hiso_json_response(['error' => 'Attachment data is invalid.'], 422);
        if (isset($body['groupId']) && !is_string($body['groupId'])) {
            hiso_json_response(['error' => 'Contact group selection is invalid.'], 422);
        }
        $groupId = trim((string)($body['groupId'] ?? ''));
        $recipients = hiso_marketing_contacts('email');
        $skipped = 0;
        if ($groupId !== '') {
            try {
                $groupResult = hiso_customer_contact_group_recipients($groupId, 'email');
                $recipients = $groupResult['contacts'];
                $skipped = $groupResult['skipped'];
            } catch (InvalidArgumentException $error) {
                hiso_json_response(['error' => $error->getMessage()], 422);
            }
        }
        if (!$recipients) {
            hiso_json_response([
                'error' => 'No customers in this selection have active email marketing consent and a valid email address.',
                'skipped' => $skipped,
            ], 422);
        }
        try {
            $delivered = hiso_newsletter_send(
                (string)($body['subject'] ?? ''),
                (string)($body['message'] ?? ''),
                $attachments,
                $recipients
            );
        } catch (InvalidArgumentException $error) {
            hiso_json_response(['error' => $error->getMessage()], 422);
        } catch (Throwable $error) {
            $configured = str_contains($error->getMessage(), 'not configured') || str_contains($error->getMessage(), 'dependency is unavailable');
            hiso_json_response(['error' => $configured ? $error->getMessage() : 'Newsletter delivery failed. Check the private SMTP configuration and mail server status.'], $configured ? 503 : 502);
        }
        hiso_audit($user, 'SEND_OPTED_IN_NEWSLETTER', 'Newsletter', hiso_uuid(), 'Sent newsletter to ' . $delivered . ' consented recipients.');
        hiso_json_response(['ok' => true, 'delivered' => $delivered, 'skipped' => $skipped]);
    }

    if ($method === 'POST' && $route === 'communications/push') {
        $user = hiso_require_permission('manage_communications');
        hiso_require_communications_rate_limit($user, 'push', 60);
        global $CONFIG;
        $vapidPublic = hiso_b64url_decode((string)($CONFIG['VAPID_PUBLIC_KEY'] ?? ''));
        $vapidPrivate = hiso_b64url_decode((string)($CONFIG['VAPID_PRIVATE_KEY'] ?? ''));
        $vapidSubject = trim((string)($CONFIG['VAPID_SUBJECT'] ?? ''));
        if ($vapidPublic === false || strlen($vapidPublic) !== 65 || $vapidPublic[0] !== "\x04"
            || $vapidPrivate === false || strlen($vapidPrivate) !== 32
            || !hiso_vapid_key_pair_is_valid($vapidPrivate, $vapidPublic)
            || !preg_match('/^(mailto:[^@\s]+@[^@\s]+|https:\/\/[^\/\s]+)$/', $vapidSubject)
            || !function_exists('curl_init') || !function_exists('openssl_pkey_derive')) {
            hiso_json_response(['error' => 'VAPID Web Push is not configured correctly on the private server.'], 503);
        }
        $body = hiso_json_body();
        if (!is_string($body['title'] ?? null) || !is_string($body['body'] ?? null)) {
            hiso_json_response(['error' => 'Push title and body are required.'], 422);
        }
        $title = trim((string)($body['title'] ?? ''));
        $message = trim((string)($body['body'] ?? ''));
        $targets = $body['userIds'] ?? [];
        $customerTargets = $body['customerIds'] ?? [];
        $customerGroupId = $body['customerGroupId'] ?? '';
        $titleLength = preg_match_all('/./us', $title);
        $messageLength = preg_match_all('/./us', $message);
        if ($title === '' || $titleLength === false || $titleLength > 120 || strlen($title) > 480
            || $message === '' || $messageLength === false || $messageLength > 500 || strlen($message) > 2000) {
            hiso_json_response(['error' => 'Push title (max 120 characters) and body (max 500 characters) are required.'], 422);
        }
        if (!is_array($targets) || !is_array($customerTargets)
            || !is_string($customerGroupId) || strlen($customerGroupId) > 36
            || count(array_filter(array_merge($targets, $customerTargets), fn($id) => !is_string($id) || strlen($id) > 36)) > 0) {
            hiso_json_response(['error' => 'Select valid staff/customer recipients and an optional customer group.'], 422);
        }
        if (count($targets) + count($customerTargets) > 200) {
            hiso_json_response(['error' => 'Select no more than 200 staff or customer accounts.'], 422);
        }
        $targets = array_values(array_unique(array_filter($targets, fn($id) => is_string($id) && strlen($id) <= 36)));
        $customerTargets = array_values(array_unique(array_filter($customerTargets, fn($id) => is_string($id) && strlen($id) <= 36)));
        $skipped = 0;
        if ($customerGroupId !== '') {
            try {
                $groupRecipients = hiso_customer_contact_group_push_recipients($customerGroupId);
                $customerTargets = array_values(array_unique(array_merge($customerTargets, $groupRecipients['customerIds'])));
                $skipped = $groupRecipients['skipped'];
            } catch (InvalidArgumentException $error) {
                hiso_json_response(['error' => $error->getMessage()], 422);
            }
        }
        $requestedAccounts = count($targets) + count($customerTargets);
        if ($requestedAccounts < 1 && $customerGroupId !== '') {
            hiso_json_response(['error' => 'No group members have an active push subscription. ' . $skipped . ' member(s) skipped.'], 422);
        }
        if ($requestedAccounts < 1 || $requestedAccounts > 200) {
            hiso_json_response(['error' => 'Select between 1 and 200 staff or subscribed customer accounts.'], 422);
        }
        $pdo = hiso_pdo();
        $validTargets = [];
        if ($targets) {
            $userStmt = $pdo->prepare("SELECT id FROM users WHERE status = 'Active' AND id IN (" . implode(',', array_fill(0, count($targets), '?')) . ')');
            $userStmt->execute($targets);
            $validTargets = array_column($userStmt->fetchAll(PDO::FETCH_ASSOC), 'id');
        }
        $validCustomerTargets = [];
        if ($customerTargets) {
            $customerStmt = $pdo->prepare('SELECT id FROM customer_profiles WHERE email_verified_at IS NOT NULL AND id IN (' . implode(',', array_fill(0, count($customerTargets), '?')) . ')');
            $customerStmt->execute($customerTargets);
            $validCustomerTargets = array_column($customerStmt->fetchAll(PDO::FETCH_ASSOC), 'id');
        }
        if (!$validTargets && !$validCustomerTargets) hiso_json_response(['error' => 'No active staff or verified customer recipients were found.'], 422);
        $conditions = [];
        $parameters = [];
        if ($validTargets) {
            $conditions[] = '(owner_type = "staff" AND owner_id IN (' . implode(',', array_fill(0, count($validTargets), '?')) . '))';
            array_push($parameters, ...$validTargets);
        }
        if ($validCustomerTargets) {
            $conditions[] = '(owner_type = "customer" AND owner_id IN (' . implode(',', array_fill(0, count($validCustomerTargets), '?')) . '))';
            array_push($parameters, ...$validCustomerTargets);
        }
        $pushStmt = $pdo->prepare(
            'SELECT id, owner_type, owner_id, endpoint, endpoint_hash, p256dh, auth_key FROM push_subscriptions WHERE ' . implode(' OR ', $conditions)
        );
        $pushStmt->execute($parameters);
        $subscriptions = $pushStmt->fetchAll(PDO::FETCH_ASSOC);
        if (!$subscriptions) hiso_json_response(['error' => 'Selected users have no active Web Push subscriptions.'], 422);
        $delivered = 0;
        $failed = 0;
        foreach ($subscriptions as $subscription) {
            try {
                hiso_push_send($subscription, [
                    'title' => $title,
                    'body' => $message,
                    'url' => $subscription['owner_type'] === 'customer' ? '/#customer' : '/#workspace',
                ]);
                $delivered++;
            } catch (Throwable $error) {
                $failed++;
            }
        }
        foreach ($validTargets as $targetId) {
            hiso_notify((string)$targetId, $title, $message, 'communications', 'push');
        }
        hiso_audit($user, 'SEND_WEB_PUSH', 'User', 'multiple', 'Sent push notification to ' . $delivered . ' subscribed device(s).');
        hiso_json_response(['ok' => true, 'delivered' => $delivered, 'failed' => $failed, 'skipped' => $skipped]);
    }

    if ($method === 'POST' && $route === 'push/subscriptions') {
        $user = hiso_current_user();
        $customer = $user ? null : hiso_current_customer();
        if (!$user && !$customer) hiso_json_response(['error' => 'Sign in to subscribe to notifications.'], 401);
        if (!hiso_table_exists('push_subscriptions')) {
            hiso_json_response(['error' => 'Push notification storage is not installed. Apply php-cpanel/migrations/003-communications-integrations.sql.'], 503);
        }
        $body = hiso_json_body();
        $subscription = $body['subscription'] ?? null;
        $endpoint = is_array($subscription) ? trim((string)($subscription['endpoint'] ?? '')) : '';
        $keys = is_array($subscription) ? ($subscription['keys'] ?? []) : [];
        $url = parse_url($endpoint);
        $host = strtolower((string)($url['host'] ?? ''));
        $allowedHost = $host === 'fcm.googleapis.com' || str_ends_with($host, '.push.services.mozilla.com')
            || str_ends_with($host, '.notify.windows.com') || $host === 'web.push.apple.com';
        $p256dh = is_array($keys) ? (string)($keys['p256dh'] ?? '') : '';
        $authKey = is_array($keys) ? (string)($keys['auth'] ?? '') : '';
        if (($url['scheme'] ?? '') !== 'https' || !$allowedHost || isset($url['user']) || isset($url['pass'])
            || (isset($url['port']) && (int)$url['port'] !== 443) || isset($url['fragment']) || strlen($endpoint) > 2048
            || !preg_match('/^[A-Za-z0-9_-]{80,100}$/', $p256dh)
            || !preg_match('/^[A-Za-z0-9_-]{20,30}$/', $authKey)) {
            hiso_json_response(['error' => 'Push subscription data is invalid.'], 422);
        }
        $ownerType = $user ? 'staff' : 'customer';
        $ownerId = $user ? $user['id'] : $customer['id'];
        $endpointHash = hash('sha256', $endpoint);
        hiso_pdo()->prepare(
            'INSERT INTO push_subscriptions (id, owner_type, owner_id, endpoint_hash, endpoint, p256dh, auth_key) ' .
            'VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE owner_type = VALUES(owner_type), owner_id = VALUES(owner_id), ' .
            'endpoint = VALUES(endpoint), p256dh = VALUES(p256dh), auth_key = VALUES(auth_key), updated_at = CURRENT_TIMESTAMP'
        )->execute([hiso_uuid(), $ownerType, $ownerId, $endpointHash, $endpoint, $p256dh, $authKey]);
        hiso_json_response(['ok' => true]);
    }

    if ($method === 'DELETE' && $route === 'push/subscriptions') {
        $user = hiso_current_user();
        $customer = $user ? null : hiso_current_customer();
        if (!$user && !$customer) hiso_json_response(['error' => 'Sign in to manage notification subscriptions.'], 401);
        if (!hiso_table_exists('push_subscriptions')) {
            hiso_json_response(['error' => 'Push notification storage is not installed. Apply php-cpanel/migrations/003-communications-integrations.sql.'], 503);
        }
        $body = hiso_json_body();
        $endpoint = trim((string)($body['endpoint'] ?? ''));
        if ($endpoint === '' || strlen($endpoint) > 2048) hiso_json_response(['error' => 'Invalid push subscription endpoint.'], 422);
        $ownerType = $user ? 'staff' : 'customer';
        $ownerId = $user ? $user['id'] : $customer['id'];
        hiso_pdo()->prepare('DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND owner_type = ? AND owner_id = ?')
            ->execute([hash('sha256', $endpoint), $ownerType, $ownerId]);
        hiso_json_response(['ok' => true]);
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
        hiso_send_lifecycle_whatsapp('new_enquiry', 'enquiry', $id, 'New enquiry ' . $ref . ' received. Our team will follow up.');
        hiso_json_response(['id' => $id, 'refCode' => $ref], 201);
    }

    if ($method === 'POST' && $route === 'enquiries/forward') {
        $user = hiso_require_permission('manage_enquiries');
        $body = hiso_json_body();
        $enquiryId = is_string($body['enquiryId'] ?? null) ? trim($body['enquiryId']) : '';
        $message = is_string($body['message'] ?? null) ? trim($body['message']) : '';
        if ($enquiryId === '' || strlen($enquiryId) > 80 || $message === '' || strlen($message) > 4096) {
            hiso_json_response(['error' => 'A valid enquiry and follow-up message are required.'], 422);
        }
        $pdo = hiso_pdo();
        $stmt = $pdo->prepare('SELECT id, ref_code, customer_name, email, phone, location, channel, need_summary FROM enquiries WHERE id=? AND archived_at IS NULL LIMIT 1');
        $stmt->execute([$enquiryId]);
        $enquiry = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$enquiry) hiso_json_response(['error' => 'Enquiry not found or already archived.'], 404);
        hiso_notify_roles(
            ['director', 'superadmin'],
            'Enquiry forwarded: ' . $enquiry['ref_code'],
            $enquiry['customer_name'] . ' — ' . $enquiry['location'] . '.',
            'enquiries',
            $enquiry['id']
        );
        $appUrl = rtrim((string)(($CONFIG['APP_URL'] ?? '') ?: ''), '/');
        $emailBody = implode("\n", [
            'Enquiry ' . $enquiry['ref_code'] . ' has been forwarded by ' . $user['name'] . '.',
            '',
            'Customer: ' . $enquiry['customer_name'],
            'Phone / WhatsApp: ' . $enquiry['phone'],
            'Email: ' . ($enquiry['email'] ?: 'Not provided'),
            'Location: ' . $enquiry['location'],
            'Channel: ' . $enquiry['channel'],
            'Enquiry details: ' . $enquiry['need_summary'],
            '',
            'Follow-up draft / note:',
            $message,
            '',
            'Open the enquiry workspace: ' . $appUrl . '/#workspace?tab=enquiries',
        ]);
        hiso_send_lifecycle_email_to_roles(
            'new_enquiry',
            ['director', 'superadmin'],
            'HI-SOTECH enquiry forwarded for follow-up: ' . $enquiry['ref_code'],
            $emailBody
        );
        hiso_audit($user, 'FORWARD_ENQUIRY', 'Enquiry', $enquiry['ref_code'], 'Forwarded enquiry to Director for follow-up.');
        hiso_json_response(['ok' => true]);
    }

    if ($method === 'POST' && $route === 'enquiries/archive') {
        $user = hiso_require_permission('manage_enquiries');
        $body = hiso_json_body();
        $enquiryId = is_string($body['enquiryId'] ?? null) ? trim($body['enquiryId']) : '';
        if ($enquiryId === '' || strlen($enquiryId) > 80) {
            hiso_json_response(['error' => 'A valid enquiry is required.'], 422);
        }
        $pdo = hiso_pdo();
        $stmt = $pdo->prepare('SELECT ref_code FROM enquiries WHERE id=? AND archived_at IS NULL LIMIT 1');
        $stmt->execute([$enquiryId]);
        $enquiry = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$enquiry) hiso_json_response(['error' => 'Enquiry not found or already archived.'], 404);
        $activeOrder = $pdo->prepare('SELECT 1 FROM store_orders WHERE enquiry_id=? AND status NOT IN ("Completed","Cancelled") LIMIT 1');
        $activeOrder->execute([$enquiryId]);
        if ($activeOrder->fetchColumn()) {
            hiso_json_response(['error' => 'This enquiry is linked to an active Store order and cannot be archived yet.'], 422);
        }
        $pdo->prepare('UPDATE enquiries SET archived_at=CURRENT_TIMESTAMP WHERE id=? AND archived_at IS NULL')->execute([$enquiryId]);
        hiso_audit($user, 'ARCHIVE_ENQUIRY', 'Enquiry', $enquiry['ref_code'], 'Archived enquiry from the active desk.');
        hiso_json_response(['ok' => true]);
    }

    if ($method === 'POST' && $route === 'customers/provision') {
        $user = hiso_require_roles(['admin', 'superadmin']);
        $body = hiso_json_body();
        $quoteId = is_string($body['quoteId'] ?? null) ? trim($body['quoteId']) : '';
        if ($quoteId === '' || strlen($quoteId) > 80) {
            hiso_json_response(['error' => 'A valid approved quotation is required.'], 422);
        }
        try {
            $account = hiso_create_customer_account_from_approved_quote($user, $quoteId);
            if (!hiso_send_account_setup_email(
                'customer_account_created',
                'customer',
                $account['id'],
                $account['email'],
                $account['name'],
                $account['email'],
                $account['pin']
            )) {
                hiso_clear_customer_initial_pin($account['id']);
                hiso_json_response([
                    'error' => 'The account is pending, but the setup email could not be delivered. Retry from the approved quotation.',
                ], 503);
            }
            hiso_send_account_setup_whatsapp(
                'customer_account_created',
                'customer',
                $account['id'],
                'enquiry',
                $account['enquiryId'],
                $account['phone'],
                $account['name'],
                $account['email'],
                $account['pin']
            );
            hiso_json_response(['ok' => true, 'email' => $account['email']], 201);
        } catch (RuntimeException $error) {
            hiso_json_response(['error' => $error->getMessage()], 422);
        }
    }

    if ($method === 'POST' && $route === 'customers/reset-password') {
        $user = hiso_require_roles(['admin', 'superadmin']);
        $body = hiso_json_body();
        $quoteId = is_string($body['quoteId'] ?? null) ? trim($body['quoteId']) : '';
        if ($quoteId === '' || strlen($quoteId) > 80) {
            hiso_json_response(['error' => 'A valid approved quotation is required.'], 422);
        }
        try {
            $account = hiso_issue_customer_password_reset_pin($user, $quoteId);
            if (!hiso_send_account_setup_email(
                'customer_password_reset',
                'customer',
                $account['id'],
                $account['email'],
                $account['name'],
                $account['email'],
                $account['pin']
            )) {
                hiso_clear_customer_initial_pin($account['id']);
                hiso_json_response(['error' => 'The reset email could not be delivered. Verify SMTP settings and retry.'], 503);
            }
            hiso_send_account_setup_whatsapp(
                'customer_password_reset',
                'customer',
                $account['id'],
                'enquiry',
                $account['enquiryId'],
                $account['phone'],
                $account['name'],
                $account['email'],
                $account['pin']
            );
            hiso_json_response(['ok' => true, 'email' => $account['email']]);
        } catch (RuntimeException $error) {
            hiso_json_response(['error' => $error->getMessage()], 422);
        }
    }

    if ($method === 'POST' && $route === 'catalog') {
        $user = hiso_require_permission('manage_storefront');
        $body = hiso_json_body();
        $sku = trim((string)($body['sku'] ?? ''));
        $name = trim((string)($body['name'] ?? ''));
        $itemType = trim((string)($body['itemType'] ?? 'equipment'));
        $category = trim((string)($body['category'] ?? ''));
        $grade = trim((string)($body['grade'] ?? 'Standard'));
        $unit = trim((string)($body['unit'] ?? 'unit'));
        $price = $body['priceNgn'] ?? null;
        $stock = filter_var($body['stockQty'] ?? null, FILTER_VALIDATE_INT);
        $capacity = $body['capacityKw'] ?? null;
        $watts = $body['watts'] ?? null;
        if ($sku === '' || strlen($sku) > 60 || $name === '' || strlen($name) > 180
            || $category === '' || strlen($category) > 80 || $grade === '' || strlen($grade) > 60
            || $unit === '' || strlen($unit) > 40 || !in_array($itemType, ['equipment', 'service', 'appliance'], true)
            || !is_numeric($price) || (float)$price < 0 || $stock === false || $stock < 0
            || ($capacity !== null && $capacity !== '' && (!is_numeric($capacity) || (float)$capacity <= 0))
            || ($watts !== null && $watts !== '' && filter_var($watts, FILTER_VALIDATE_INT) === false)) {
            hiso_json_response(['error' => 'Enter valid SKU, item details, grade, price, stock, and equipment capacity.'], 422);
        }
        $imgPath = trim((string)($body['imagePath'] ?? '/src/assets/images/catalog_hybrid_inverter_1794819207311.jpg'));
        if (!empty($body['imageDataUrl'])) {
            $stored = hiso_store_photo_data_url((string)$body['imageDataUrl'], 'cat-' . $sku . '.jpg');
            $imgPath = '/api/catalog-image/' . $stored['storage_filename'];
        }
        $stmt = hiso_pdo()->prepare('INSERT INTO catalog_items (id, sku, name, item_type, category, grade, unit, price_ngn, stock_qty, capacity_kw, watts, description, image_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), item_type=VALUES(item_type), category=VALUES(category), grade=VALUES(grade), unit=VALUES(unit), price_ngn=VALUES(price_ngn), stock_qty=VALUES(stock_qty), capacity_kw=VALUES(capacity_kw), watts=VALUES(watts), description=VALUES(description), image_path=VALUES(image_path)');
        $stmt->execute([
            hiso_uuid(), $sku, $name, $itemType, $category, $grade, $unit,
            (float)$price, $stock,
            $capacity !== null && $capacity !== '' ? (float)$capacity : null,
            $watts !== null && $watts !== '' ? (int)$watts : null,
            trim((string)($body['description'] ?? '')),
            $imgPath,
        ]);
        hiso_audit($user, 'UPSERT_CATALOG', 'Catalog', $sku, 'Updated Store SKU ' . $sku);
        hiso_json_response(['ok' => true, 'imagePath' => $imgPath]);
    }

    if ($method === 'POST' && $route === 'catalog/delete') {
        $user = hiso_require_permission('manage_storefront');
        $body = hiso_json_body();
        hiso_pdo()->prepare('DELETE FROM catalog_items WHERE sku = ?')->execute([trim((string)$body['sku'])]);
        hiso_audit($user, 'DELETE_CATALOG', 'Catalog', (string)$body['sku'], 'Removed SKU from Store');
        hiso_json_response(['ok' => true]);
    }

    if ($method === 'POST' && $route === 'quotes') {
        $user = hiso_require_permission('draft_quotes');
        $body = hiso_json_body();
        $pdo = hiso_pdo();
        $items = $body['items'] ?? [];
        if (!is_array($items) || count($items) > 100) {
            hiso_json_response(['error' => 'Quotation line items are invalid.'], 422);
        }
        foreach ($items as $item) {
            if (!is_array($item) || !is_string($item['sku'] ?? null) || strlen($item['sku']) > 80
                || !is_string($item['description'] ?? null) || trim($item['description']) === '' || strlen($item['description']) > 240
                || !is_string($item['unit'] ?? null) || strlen($item['unit']) > 40
                || !is_numeric($item['qty'] ?? null) || (float)$item['qty'] <= 0 || (float)$item['qty'] > 10000
                || !is_numeric($item['unitPriceNgn'] ?? null) || (float)$item['unitPriceNgn'] < 0
                || (isset($item['isTbd']) && !is_bool($item['isTbd']))) {
                hiso_json_response(['error' => 'Quotation line item details are invalid.'], 422);
            }
        }
        $discount = (float)($body['discountNgn'] ?? 0);
        $tax = (float)($body['taxPercent'] ?? 0);
        $subtotal = 0.0;
        foreach ($items as $it) $subtotal += (float)$it['qty'] * (float)$it['unitPriceNgn'];
        $taxable = max(0, $subtotal - min($subtotal, max(0, $discount)));
        $total = round($taxable * (1 + max(0, $tax) / 100));
        $status = !empty($body['submitForApproval']) ? 'Pending MD' : 'Draft';
        $savedId = isset($body['quoteId']) ? (string)$body['quoteId'] : '';

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
            $enquiryStmt = $pdo->prepare('SELECT estimate_json FROM enquiries WHERE id=? AND archived_at IS NULL LIMIT 1');
            $enquiryStmt->execute([(string)($body['enquiryId'] ?? '')]);
            $enquiry = $enquiryStmt->fetch(PDO::FETCH_ASSOC);
            if (!$enquiry) {
                hiso_json_response(['error' => 'Enquiry not found or already archived.'], 404);
            }
            $orderStmt = $pdo->prepare('SELECT id FROM store_orders WHERE enquiry_id=? LIMIT 1');
            $orderStmt->execute([(string)($body['enquiryId'] ?? '')]);
            $linkedOrder = (bool)$orderStmt->fetchColumn();
            if ($linkedOrder) {
                $quoteStmt = $pdo->prepare('SELECT id FROM quotations WHERE enquiry_id=? LIMIT 1');
                $quoteStmt->execute([(string)$body['enquiryId']]);
                if ($quoteStmt->fetchColumn()) {
                    hiso_json_response(['error' => 'A quotation already exists for this Store order. Revise the existing quotation instead.'], 422);
                }
            }
            if (!$linkedOrder && empty($enquiry['estimate_json'])) {
                hiso_json_response(['error' => 'Only load-estimator enquiries and Store orders can have quotations.'], 422);
            }
            $id = hiso_uuid();
            $savedId = $id;
            $code = hiso_next_code('quotations', 'quote_code', 'QUO');
            $revs = [['revisionNo' => 1, 'changedBy' => $user['name'], 'note' => 'Initial quotation', 'createdAt' => gmdate('c'), 'totalNgn' => $total]];
            $pdo->prepare('INSERT INTO quotations (id, quote_code, enquiry_id, customer_name, status, revision_no, scope, terms, note, discount_ngn, tax_percent, issued_date, valid_until, items_json, revisions_json) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, CURDATE(), ?, ?, ?)')
                ->execute([$id, $code, $body['enquiryId'], $body['customerName'], $status, $body['scope'], $body['terms'], $body['note'], $discount, $tax, $body['validUntil'], json_encode($items), json_encode($revs)]);
        }
        if ($status === 'Pending MD') {
            hiso_notify_roles(['director', 'superadmin'], 'Quotation awaiting approval: ' . $code, $body['customerName'] . ' submitted for Director review.', 'quotes', $code);
            hiso_send_lifecycle_email_to_roles(
                'quote_status',
                ['director', 'superadmin'],
                'HI-SOTECH quotation awaiting Director approval: ' . $code,
                "Quotation {$code} is ready for Director approval.\nCustomer: " . $body['customerName'] . "\nScope: " . $body['scope'] . "\nReview: " . rtrim((string)(($CONFIG['APP_URL'] ?? '') ?: ''), '/') . '/#workspace?tab=quotes'
            );
        }
        hiso_audit($user, 'SAVE_QUOTE', 'Quotation', $code, 'Saved quotation (' . $status . ')');
        hiso_json_response(['id' => $savedId, 'quoteCode' => $code]);
    }

    if ($method === 'POST' && $route === 'quotes/approve') {
        $user = hiso_require_permission('approve_quotes');
        $body = hiso_json_body();
        $decision = $body['decision'] ?? null;
        $quoteId = is_string($body['quoteId'] ?? null) ? trim($body['quoteId']) : '';
        if (!in_array($decision, ['Approved', 'Rejected'], true) || $quoteId === '' || strlen($quoteId) > 36) {
            hiso_json_response(['error' => 'Quotation decision is invalid.'], 422);
        }
        $pdo = hiso_pdo();
        $quoteStmt = $pdo->prepare('SELECT items_json FROM quotations WHERE id = ? LIMIT 1');
        $quoteStmt->execute([$quoteId]);
        $quote = $quoteStmt->fetch();
        if (!$quote) hiso_json_response(['error' => 'Quotation not found.'], 404);
        $quoteItems = json_decode((string)$quote['items_json'], true);
        if ($decision === 'Approved' && is_array($quoteItems)
            && array_filter($quoteItems, static fn($item) => !empty($item['isTbd']))) {
            hiso_json_response(['error' => 'Price all To Be Determined quotation lines before approving.'], 422);
        }
        $pdo->prepare('UPDATE quotations SET status = ?, approved_by = ?, approved_at = NOW() WHERE id = ?')->execute([$decision, $user['name'], $quoteId]);
        if ($decision === 'Approved') {
            $pdo->prepare('UPDATE store_orders SET status = "Confirmed" WHERE enquiry_id = (SELECT enquiry_id FROM quotations WHERE id = ?)')->execute([$quoteId]);
        }
        hiso_notify_roles(['admin'], 'Quotation ' . $decision, $user['name'] . ' marked quotation ' . $decision . '.', 'quotes', $quoteId);
        hiso_send_lifecycle_email_to_roles(
            'quote_status',
            ['admin', 'superadmin'],
            'HI-SOTECH quotation decision: ' . $decision,
            "Quotation decision: {$decision}.\nQuotation ID: {$quoteId}\nReview: " . rtrim((string)(($CONFIG['APP_URL'] ?? '') ?: ''), '/') . '/#workspace?tab=quotes'
        );
        hiso_audit($user, 'DECIDE_QUOTE', 'Quotation', $quoteId, 'Quotation ' . $decision);
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
        $bankDetails = hiso_load_platform_settings()['bankDetails'];
        $pdo->prepare('INSERT INTO invoices (id, invoice_code, quotation_id, enquiry_id, customer_name, discount_ngn, tax_percent, total_ngn, bank_details_json, issued_date, due_date, items_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 14 DAY), ?)')
            ->execute([$invId, $invCode, $quote['id'], $quote['enquiry_id'], $quote['customer_name'], $quote['discount_ngn'], $quote['tax_percent'], $total, json_encode($bankDetails, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $quote['items_json']]);
        $pdo->prepare('UPDATE quotations SET status = "Invoiced" WHERE id = ?')->execute([$quote['id']]);
        hiso_audit($user, 'ISSUE_INVOICE', 'Invoice', $invCode, 'Issued invoice from ' . $quote['quote_code']);
        $enquiryStmt = $pdo->prepare('SELECT id, email, phone FROM enquiries WHERE id=? LIMIT 1');
        $enquiryStmt->execute([$quote['enquiry_id']]);
        $enquiry = $enquiryStmt->fetch(PDO::FETCH_ASSOC) ?: [];
        $invoiceMessage = [
            'id' => $invId,
            'enquiryId' => (string)$quote['enquiry_id'],
            'invoiceCode' => $invCode,
            'customerName' => (string)$quote['customer_name'],
            'email' => (string)($enquiry['email'] ?? ''),
            'phone' => (string)($enquiry['phone'] ?? ''),
            'totalNgn' => $total,
            'items' => is_array($items) ? $items : [],
        ];
        hiso_send_invoice_issued_emails($invoiceMessage);
        hiso_send_lifecycle_whatsapp(
            'invoice_status',
            'invoice',
            $invId,
            "Hello " . (string)$quote['customer_name'] . ", your HI-SOTECH invoice {$invCode} has been issued and is pending payment.\n" .
                implode("\n", array_map(static fn($item) => (float)$item['qty'] . ' × ' . (string)($item['description'] ?? $item['name'] ?? '') . ': ₦' . number_format((float)$item['qty'] * (float)$item['unitPriceNgn']), $items)) .
                "\nAmount due: ₦" . number_format($total) . ". Open your customer portal: " . rtrim((string)(($CONFIG['APP_URL'] ?? '') ?: ''), '/') . '/#customer',
            false
        );
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
        hiso_send_lifecycle_whatsapp(
            'invoice_status',
            'invoice',
            (string)$body['invoiceId'],
            "Payment receipt {$payCode} was logged.\nAmount: ₦" . number_format((float)$body['amountNgn']) . "\nStatus: Pending verification\nReview: " . rtrim((string)(($CONFIG['APP_URL'] ?? '') ?: ''), '/') . '/#workspace?tab=finance'
        );
        hiso_send_lifecycle_email_to_roles(
            'invoice_status',
            ['director', 'superadmin'],
            'HI-SOTECH payment receipt awaiting verification: ' . $payCode,
            "Payment receipt {$payCode} was logged.\nAmount: ₦" . number_format((float)$body['amountNgn']) . "\nStatus: Pending verification\nReview: " . rtrim((string)(($CONFIG['APP_URL'] ?? '') ?: ''), '/') . '/#workspace?tab=finance'
        );
        hiso_json_response(['id' => $payId, 'paymentCode' => $payCode], 201);
    }

    if ($method === 'POST' && $route === 'payments/verify') {
        $user = hiso_require_permission('verify_payments');
        $body = hiso_json_body();
        if (!in_array($body['decision'] ?? null, ['Confirmed', 'Rejected'], true)) {
            hiso_json_response(['error' => 'Payment decision is invalid.'], 422);
        }
        $decision = ($body['decision'] ?? '') === 'Confirmed' ? 'Confirmed' : 'Rejected';
        $paymentStmt = hiso_pdo()->prepare('SELECT p.invoice_id, i.total_ngn, i.enquiry_id FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.id = ? LIMIT 1');
        $paymentStmt->execute([$body['paymentId']]);
        $payment = $paymentStmt->fetch();
        if (!$payment) hiso_json_response(['error' => 'Payment receipt not found.'], 404);
        $invoiceId = (string)$payment['invoice_id'];
        $pdo = hiso_pdo();
        $pdo->prepare('UPDATE payments SET status = ?, verified_by = ?, verified_at = NOW(), rejection_reason = ? WHERE id = ?')->execute([$decision, $user['name'], $body['reason'] ?? null, $body['paymentId']]);
        $paidStmt = $pdo->prepare('SELECT COALESCE(SUM(amount_ngn),0) FROM payments WHERE invoice_id=? AND status="Confirmed"');
        $paidStmt->execute([$invoiceId]);
        $confirmedPaid = (float)$paidStmt->fetchColumn();
        $invoiceStatus = $confirmedPaid >= (float)$payment['total_ngn'] ? 'Completed' : ($confirmedPaid > 0 ? 'Confirmed' : 'Pending');
        $pdo->prepare('UPDATE invoices SET status=? WHERE id=?')->execute([$invoiceStatus, $invoiceId]);
        if ($invoiceStatus === 'Completed') {
            $pdo->prepare('UPDATE store_orders SET status="Completed" WHERE enquiry_id=? AND status="Delivered"')->execute([$payment['enquiry_id']]);
        }
        hiso_audit($user, 'VERIFY_PAYMENT', 'Payment', (string)$body['paymentId'], 'Receipt ' . $decision);
        if ($invoiceId !== '') hiso_send_lifecycle_whatsapp('invoice_status', 'invoice', $invoiceId, 'A payment receipt for your invoice was ' . strtolower($decision) . '. Invoice status: ' . $invoiceStatus . '.');
        hiso_json_response(['status' => $decision, 'invoiceStatus' => $invoiceStatus]);
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
        if ($engId) hiso_notify($engId, 'New installation assigned: ' . $jobCode, $inv['customer_name'] . ' (' . $inv['location'] . ') released for delivery.', 'jobs', $jobId);
        hiso_audit($user, 'RELEASE_INSTALLATION', 'Installation', $jobCode, 'Released installation (' . $releaseType . ').');
        hiso_send_lifecycle_whatsapp('installation_status', 'installation', $jobId, 'Installation ' . $jobCode . ' has been scheduled.');
        hiso_json_response(['id' => $jobId, 'jobCode' => $jobCode], 201);
    }

    if ($method === 'POST' && $route === 'installations/assign') {
        $user = hiso_require_permission('manage_enquiries');
        $body = hiso_json_body();
        hiso_pdo()->prepare('UPDATE installations SET assigned_engineer_id = ?, engineer_acknowledged = 0 WHERE id = ?')->execute([$body['engineerId'], $body['installationId']]);
        hiso_notify((string)$body['engineerId'], 'Installation assigned', 'Please review and acknowledge your assigned installation.', 'jobs', (string)$body['installationId']);
        hiso_audit($user, 'ASSIGN_TECHNICIAN', 'Installation', (string)$body['installationId'], 'Assigned technician.');
        hiso_send_lifecycle_whatsapp('installation_status', 'installation', (string)$body['installationId'], 'Your installation has been assigned to a field engineer.');
        hiso_json_response(['ok' => true]);
    }

    if ($method === 'POST' && $route === 'installations/ack') {
        $user = hiso_current_user();
        if (!$user) hiso_json_response(['error' => 'Authentication required.'], 401);
        $body = hiso_json_body();
        $installationId = trim((string)($body['installationId'] ?? ''));
        if ($installationId === '' || strlen($installationId) > 80) {
            hiso_json_response(['error' => 'Installation reference is invalid.'], 422);
        }
        $pdo = hiso_pdo();
        $jobStmt = $pdo->prepare('SELECT assigned_engineer_id, engineer_acknowledged FROM installations WHERE id = ? LIMIT 1');
        $jobStmt->execute([$installationId]);
        $job = $jobStmt->fetch();
        if (!$job) hiso_json_response(['error' => 'Installation not found.'], 404);
        $permissions = $user['permissions'] ?? [];
        $canSupervise = $user['role'] === 'superadmin'
            || in_array('manage_enquiries', $permissions, true)
            || in_array('release_installations', $permissions, true);
        if ((string)($job['assigned_engineer_id'] ?? '') !== (string)$user['id'] && !$canSupervise) {
            hiso_json_response(['error' => 'Only the assigned engineer or an authorized supervisor can acknowledge this installation.'], 403);
        }
        if (!(bool)$job['engineer_acknowledged']) {
            $update = $pdo->prepare('UPDATE installations SET engineer_acknowledged = 1 WHERE id = ? AND (assigned_engineer_id = ? OR ? = 1)');
            $update->execute([$installationId, (string)$user['id'], $canSupervise ? 1 : 0]);
            if ($update->rowCount() !== 1) {
                hiso_json_response(['error' => 'Installation assignment changed before it could be acknowledged.'], 409);
            }
            hiso_audit($user, 'ACK_INSTALLATION', 'Installation', $installationId, $user['name'] . ' acknowledged assignment.');
        }
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
        hiso_send_lifecycle_whatsapp('installation_status', 'installation', $jobId, 'Installation update: stage ' . $stage . ', ' . $activityTitle . '.');
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
        hiso_send_lifecycle_whatsapp('ticket_status', 'ticket', (string)$body['ticketId'], 'Service ticket ' . $t['ticket_code'] . ' status changed to ' . (string)$body['status'] . '.');
        hiso_send_lifecycle_email_to_roles(
            'ticket_status',
            ['admin', 'superadmin'],
            'HI-SOTECH service ticket updated: ' . $t['ticket_code'],
            'Service ticket ' . $t['ticket_code'] . ' status changed to ' . (string)$body['status'] . '.'
        );
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
        if (!in_array($body['status'] ?? null, ['Pending', 'Confirmed', 'Dispatched', 'Delivered', 'Cancelled'], true)) {
            hiso_json_response(['error' => 'Order status is invalid.'], 422);
        }
        $pdo = hiso_pdo();
        $stmt = $pdo->prepare('SELECT * FROM store_orders WHERE id = ? LIMIT 1');
        $stmt->execute([$body['orderId']]);
        $ord = $stmt->fetch();
        if (!$ord) hiso_json_response(['error' => 'Order not found.'], 404);
        $status = (string)$body['status'];
        if ($status === 'Delivered') {
            $invoiceStmt = $pdo->prepare('SELECT status FROM invoices WHERE enquiry_id=? ORDER BY created_at DESC LIMIT 1');
            $invoiceStmt->execute([$ord['enquiry_id']]);
            if ($invoiceStmt->fetchColumn() === 'Completed') $status = 'Completed';
        }
        $pdo->prepare('UPDATE store_orders SET status = ?, notes = ? WHERE id = ?')
            ->execute([$status, trim((string)($body['notes'] ?? $ord['notes'])), $body['orderId']]);
        hiso_audit($user, 'UPDATE_ORDER', 'StoreOrder', $ord['order_code'], 'Marked ' . $status);
        hiso_json_response(['ok' => true]);
    }

    if ($method === 'POST' && $route === 'roles') {
        $user = hiso_require_permission('manage_roles');
        if ($user['role'] !== 'superadmin') {
            hiso_json_response(['error' => 'Only Super Admin can create or edit roles.'], 403);
        }
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
        $username = strtolower(trim((string)($body['username'] ?? '')));
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $phone = trim((string)($body['phone'] ?? ''));
        $role = trim((string)($body['role'] ?? ''));
        $title = trim((string)($body['title'] ?? ''));
        $skills = trim((string)($body['skills'] ?? ''));
        $status = (string)($body['status'] ?? 'Active');
        $password = trim((string)($body['password'] ?? ''));
        $idValue = $body['id'] ?? null;
        $id = is_string($idValue) && trim($idValue) !== '' ? trim($idValue) : null;
        if ($name === '' || strlen($name) > 120
            || (!$id && !preg_match('/^[a-z0-9._-]{3,50}$/', $username))
            || ($username !== '' && !preg_match('/^[a-z0-9._-]{3,50}$/', $username))
            || !filter_var($email, FILTER_VALIDATE_EMAIL)
            || strlen($email) > 190 || strlen($phone) > 40 || strlen($role) > 60
            || strlen($title) > 120 || strlen($skills) > 4000
            || !in_array($status, ['Active', 'Inactive'], true)) {
            hiso_json_response(['error' => 'Valid name, username, email, phone, role, title, skills, and status are required.'], 422);
        }
        if ($role === 'superadmin' && $user['role'] !== 'superadmin') {
            hiso_json_response(['error' => 'Only Super Admin can create Super Admin accounts.'], 403);
        }
        $pdo = hiso_pdo();
        if (!$id && $user['role'] !== 'superadmin') {
            hiso_json_response(['error' => 'Only Super Admin can create staff accounts.'], 403);
        }
        $creating = !$id;
        if ($id) {
            $existingStmt = $pdo->prepare('SELECT role, username FROM users WHERE id = ? LIMIT 1');
            $existingStmt->execute([$id]);
            $existingStaff = $existingStmt->fetch();
            if (!$existingStaff) hiso_json_response(['error' => 'Staff account not found.'], 404);
            $usernameValue = $username !== '' ? $username : ($existingStaff['username'] ?: null);
            if ($user['role'] !== 'superadmin'
                && ($existingStaff['role'] !== $role || (string)($existingStaff['username'] ?? '') !== (string)($usernameValue ?? ''))) {
                hiso_json_response(['error' => 'Only Super Admin can change usernames or assign roles.'], 403);
            }
        } else {
            $usernameValue = $username;
        }
        if ($usernameValue !== null && $usernameValue !== '') {
            $usernameStmt = $pdo->prepare('SELECT COUNT(*) FROM users WHERE username = ? AND id <> ?');
            $usernameStmt->execute([$usernameValue, $id ?? '']);
            if ((int)$usernameStmt->fetchColumn() > 0) {
                hiso_json_response(['error' => 'That username is already in use.'], 422);
            }
        }
        $roleStmt = $pdo->prepare('SELECT COUNT(*) FROM roles WHERE id = ?');
        $roleStmt->execute([$role]);
        if ((int)$roleStmt->fetchColumn() !== 1) {
            hiso_json_response(['error' => 'Select a valid staff role.'], 422);
        }
        if ($id) {
           $oldPhoneStmt = $pdo->prepare('SELECT phone FROM users WHERE id = ? LIMIT 1');
           $oldPhoneStmt->execute([$id]);
           $oldPhone = (string)($oldPhoneStmt->fetchColumn() ?: '');
            $active = $pdo->prepare('SELECT COUNT(*) FROM installations WHERE assigned_engineer_id = ? AND current_stage < 5');
            $active->execute([$id]);
            if ((int)$active->fetchColumn() > 0 && ($role !== 'technician' || $status !== 'Active')) {
                hiso_json_response(['error' => 'Reassign active installations before changing role or deactivating this technician.'], 422);
            }
            if ($password !== '' && (strlen($password) < 12 || strlen($password) > 128)) {
                hiso_json_response(['error' => 'Staff passwords must be between 12 and 128 characters.'], 422);
            }
            $pdo->prepare('UPDATE users SET name=?, username=?, phone=?, role=?, title=?, skills=?, status=? WHERE id=?')
                ->execute([$name, $usernameValue, $phone, $role, $title, $skills, $status, $id]);
            if (trim($oldPhone) !== $phone) {
                $pdo->prepare('UPDATE whatsapp_recipient_consents SET revoked_at = UTC_TIMESTAMP() WHERE recipient_type = "staff" AND recipient_id = ? AND revoked_at IS NULL')
                    ->execute([$id]);
            }
            if ($password !== '') {
                $pdo->prepare("UPDATE users SET password_hash=?, auth_type='password' WHERE id=?")
                    ->execute([password_hash($password, PASSWORD_DEFAULT), $id]);
                $pdo->prepare('DELETE FROM staff_password_reset_tokens WHERE user_id=?')->execute([$id]);
            }
        } else {
            $orderStmt = $pdo->prepare('SELECT id FROM store_orders WHERE enquiry_id=? LIMIT 1');
            $orderStmt->execute([(string)($body['enquiryId'] ?? '')]);
            if ($orderStmt->fetchColumn()) {
                $quoteStmt = $pdo->prepare('SELECT id FROM quotations WHERE enquiry_id=? LIMIT 1');
                $quoteStmt->execute([(string)$body['enquiryId']]);
                if ($quoteStmt->fetchColumn()) {
                    hiso_json_response(['error' => 'A quotation already exists for this Store order. Revise the existing quotation instead.'], 422);
                }
            }
            $id = hiso_uuid();
            $pin = (string)random_int(1000, 9999);
            $pinHash = password_hash($pin, PASSWORD_DEFAULT);
            $expires = gmdate('Y-m-d H:i:s', time() + 86400);
            $unusablePasswordHash = password_hash(bin2hex(random_bytes(32)), PASSWORD_DEFAULT);
            $pdo->prepare(
                'INSERT INTO users (id, name, username, email, email_verified_at, phone, password_hash, initial_pin_hash, pin_expires_at, must_set_password, role, title, skills, status) ' .
                'VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), ?, ?, ?, ?, 1, ?, ?, ?, "Active")'
            )->execute([$id, $name, $usernameValue, $email, $phone, $unusablePasswordHash, $pinHash, $expires, $role, $title, $skills]);
        }
        hiso_audit($user, $creating ? 'CREATE_STAFF' : 'UPDATE_STAFF', 'Staff', (string)$id, 'Saved staff account ' . $name);
        if ($creating) {
            if (!hiso_send_account_setup_email('staff_account_created', 'staff', (string)$id, $email, $name, $usernameValue, $pin)) {
                hiso_json_response([
                    'error' => 'The staff account was created, but its setup email could not be delivered. Use Resend Setup PIN to retry.',
                ], 503);
            }
            hiso_send_account_setup_whatsapp(
                'staff_account_created',
                'staff',
                (string)$id,
                'staff',
                (string)$id,
                $phone,
                $name,
                (string)$usernameValue,
                $pin
            );
        }
        hiso_json_response(['id' => $id]);
    }

    if ($method === 'POST' && $route === 'staff/resend-pin') {
        $user = hiso_require_roles(['admin', 'superadmin']);
        $body = hiso_json_body();
        $staffId = is_string($body['staffId'] ?? null) ? trim($body['staffId']) : '';
        if ($staffId === '' || strlen($staffId) > 80) {
            hiso_json_response(['error' => 'A valid staff account is required.'], 422);
        }
        try {
            $account = hiso_issue_staff_password_reset_pin($user, $staffId);
        } catch (RuntimeException $error) {
            hiso_json_response(['error' => $error->getMessage()], 422);
        }
        $pin = (string)$account['pin'];
        if (!hiso_send_account_setup_email(
            'staff_account_created', 'staff', (string)$account['id'], (string)$account['email'],
            (string)$account['name'], (string)$account['username'], $pin
        )) {
            hiso_json_response(['error' => 'The staff setup email could not be delivered. Check SMTP configuration and retry.'], 503);
        }
        hiso_send_account_setup_whatsapp(
            'staff_account_created',
            'staff',
            (string)$account['id'],
            'staff',
            (string)$account['id'],
            (string)$account['phone'],
            (string)$account['name'],
            (string)$account['username'],
            $pin
        );
        hiso_json_response(['ok' => true]);
    }

    if ($method === 'GET' && $route === 'notifications') {
        $user = hiso_current_user();
        if (!$user) hiso_json_response(['error' => 'Authentication required.'], 401);
        if (!hiso_column_exists('notifications', 'is_archived')) {
            hiso_json_response(['error' => 'Apply php-cpanel/migrations/013-notification-archive.sql before managing archived notifications.'], 503);
        }
        $archived = ($_GET['archived'] ?? 'false') === 'true';
        $stmt = hiso_pdo()->prepare(
            'SELECT * FROM notifications WHERE user_id = ? AND is_archived = ? ORDER BY created_at DESC LIMIT 40'
        );
        $stmt->execute([$user['id'], $archived ? 1 : 0]);
        $notifications = array_map(static fn($notification) => [
            'id' => $notification['id'],
            'userId' => $notification['user_id'],
            'title' => $notification['title'],
            'body' => $notification['body'],
            'targetModule' => $notification['target_module'],
            'targetRef' => $notification['target_ref'],
            'isRead' => (bool)$notification['is_read'],
            'isArchived' => (bool)$notification['is_archived'],
            'createdAt' => $notification['created_at'],
        ], $stmt->fetchAll());
        hiso_json_response(['notifications' => $notifications]);
    }

    if ($method === 'POST' && $route === 'notifications/manage') {
        $user = hiso_current_user();
        if (!$user) hiso_json_response(['error' => 'Authentication required.'], 401);
        if (!hiso_column_exists('notifications', 'is_archived')) {
            hiso_json_response(['error' => 'Apply php-cpanel/migrations/013-notification-archive.sql before managing archived notifications.'], 503);
        }
        $body = hiso_json_body();
        $action = $body['action'] ?? null;
        $notificationIds = $body['notificationIds'] ?? null;
        if (!in_array($action, ['archive', 'restore', 'clear'], true) || !is_array($notificationIds)
            || count($notificationIds) < 1 || count($notificationIds) > 100) {
            hiso_json_response(['error' => 'Select between 1 and 100 notifications and choose a valid action.'], 422);
        }
        foreach ($notificationIds as $notificationId) {
            if (!is_string($notificationId) || !preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i', $notificationId)) {
                hiso_json_response(['error' => 'Notification selection is invalid.'], 422);
            }
        }
        $notificationIds = array_values(array_unique($notificationIds));
        $placeholders = implode(',', array_fill(0, count($notificationIds), '?'));
        if ($action === 'clear') {
            $stmt = hiso_pdo()->prepare("DELETE FROM notifications WHERE user_id = ? AND id IN ({$placeholders})");
            $stmt->execute(array_merge([$user['id']], $notificationIds));
        } else {
            $stmt = hiso_pdo()->prepare(
                "UPDATE notifications SET is_archived = ? WHERE user_id = ? AND id IN ({$placeholders})"
            );
            $stmt->execute(array_merge([$action === 'archive' ? 1 : 0, $user['id']], $notificationIds));
        }
        hiso_json_response(['ok' => true, 'affected' => $stmt->rowCount()]);
    }

    if ($method === 'POST' && $route === 'notifications/read') {
        $user = hiso_current_user();
        if (!$user) hiso_json_response(['error' => 'Authentication required.'], 401);
        hiso_pdo()->prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_archived = 0')->execute([$user['id']]);
        hiso_json_response(['ok' => true]);
    }

    if ($method === 'GET' && str_starts_with($route, 'customer-equipment-photo/')) {
        $customer = hiso_require_customer();
        $photoId = substr($route, strlen('customer-equipment-photo/'));
        if (!preg_match('/^[A-Za-z0-9-]{36}$/', $photoId)) {
            http_response_code(404);
            exit('Not found');
        }
        $stmt = hiso_pdo()->prepare('SELECT storage_filename, mime_type FROM customer_equipment_photos WHERE id = ? AND customer_id = ? LIMIT 1');
        $stmt->execute([$photoId, $customer['id']]);
        $photo = $stmt->fetch();
        if (!$photo) {
            http_response_code(404);
            exit('Not found');
        }
        $path = hiso_storage_dir('job_photos') . '/' . basename($photo['storage_filename']);
        if (!is_file($path)) {
            http_response_code(404);
            exit('Missing file');
        }
        header('Content-Type: ' . $photo['mime_type']);
        header('Content-Length: ' . (string)filesize($path));
        header('Cache-Control: private, max-age=86400');
        header('X-Content-Type-Options: nosniff');
        readfile($path);
        exit;
    }

    if ($method === 'GET' && str_starts_with($route, 'staff/profile/photo/')) {
        if (!hiso_current_user()) {
            http_response_code(401);
            exit('Authentication required.');
        }
        if (!hiso_column_exists('users', 'profile_photo_filename')) {
            http_response_code(503);
            exit('Apply php-cpanel/migrations/010-staff-profiles-contact-groups.sql first.');
        }
        $staffId = substr($route, strlen('staff/profile/photo/'));
        if (!preg_match('/^[A-Fa-f0-9-]{36}$/', $staffId)) {
            http_response_code(404);
            exit('Not found');
        }
        $stmt = hiso_pdo()->prepare(
            "SELECT profile_photo_filename FROM users WHERE id = ? AND status = 'Active' LIMIT 1"
        );
        $stmt->execute([$staffId]);
        $filename = $stmt->fetchColumn();
        if (!is_string($filename) || !preg_match('/^[A-Fa-f0-9-]{36}\.jpg$/', $filename)) {
            http_response_code(404);
            exit('Not found');
        }
        $path = hiso_storage_dir('staff_profiles') . '/' . basename($filename);
        if (!is_file($path)) {
            http_response_code(404);
            exit('Missing file');
        }
        header('Content-Type: image/jpeg');
        header('Content-Length: ' . (string)filesize($path));
        header('Cache-Control: private, max-age=3600');
        header('X-Content-Type-Options: nosniff');
        readfile($path);
        exit;
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
