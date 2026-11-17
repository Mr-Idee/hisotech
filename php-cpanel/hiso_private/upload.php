<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';

/**
 * Validates and re-encodes a base64 Data URL or uploaded file into a clean JPEG
 * stored outside public_html to prevent polyglot script uploads.
 */
function hiso_store_photo_data_url(string $dataUrl, string $originalName = 'site-photo.jpg'): array {
    if (!preg_match('#^data:image/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$#', $dataUrl, $matches)) {
        throw new RuntimeException('Unsupported image payload. Use JPEG, PNG, or WebP.');
    }

    $binary = base64_decode($matches[2], true);
    if ($binary === false || strlen($binary) > 6 * 1024 * 1024) {
        throw new RuntimeException('Image exceeds 6MB limit or is malformed.');
    }
    return hiso_store_photo_binary($binary, $originalName);
}

function hiso_store_photo_upload(array $upload): array {
    if (($upload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK
        || !isset($upload['tmp_name'], $upload['size'])
        || (int)$upload['size'] <= 0
        || (int)$upload['size'] > 4 * 1024 * 1024
        || !is_uploaded_file((string)$upload['tmp_name'])) {
        throw new RuntimeException('A site photo is invalid or exceeds the 4MB limit.');
    }
    $binary = file_get_contents((string)$upload['tmp_name']);
    if ($binary === false) {
        throw new RuntimeException('Could not read uploaded site photo.');
    }
    return hiso_store_photo_binary($binary, (string)($upload['name'] ?? 'site-photo.jpg'));
}

function hiso_store_photo_binary(string $binary, string $originalName): array {
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime = $finfo->buffer($binary);
    if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
        throw new RuntimeException('Invalid image MIME signature.');
    }
    $dimensions = @getimagesizefromstring($binary);
    if ($dimensions === false || $dimensions[0] > 6000 || $dimensions[1] > 6000
        || $dimensions[0] * $dimensions[1] > 24000000) {
        throw new RuntimeException('Image dimensions exceed the supported limit.');
    }

    $filename = hiso_uuid() . '.jpg';
    $destDir = hiso_storage_dir('job_photos');
    $destPath = $destDir . '/' . $filename;

    if (function_exists('imagecreatefromstring')) {
        $img = @imagecreatefromstring($binary);
        if ($img === false) {
            throw new RuntimeException('Could not decode image bytes.');
        }
        $width = imagesx($img);
        $height = imagesy($img);
        $maxDim = 1440;
        if ($width > $maxDim || $height > $maxDim) {
            $scale = min($maxDim / $width, $maxDim / $height);
            $newW = max(1, (int)round($width * $scale));
            $newH = max(1, (int)round($height * $scale));
            $resized = imagecreatetruecolor($newW, $newH);
            imagecopyresampled($resized, $img, 0, 0, 0, 0, $newW, $newH, $width, $height);
            imagedestroy($img);
            $img = $resized;
        }
        $saved = imagejpeg($img, $destPath, 78);
        imagedestroy($img);
        if (!$saved) {
            throw new RuntimeException('Could not store the uploaded image.');
        }
    } elseif ($mime === 'image/jpeg') {
        if (file_put_contents($destPath, $binary, LOCK_EX) !== strlen($binary)) {
            throw new RuntimeException('Could not store the uploaded image.');
        }
    } else {
        throw new RuntimeException('GD is required to safely normalize this image format.');
    }

    return [
        'storage_filename' => $filename,
        'original_name' => substr(preg_replace('/[^A-Za-z0-9._-]/', '_', $originalName), 0, 140),
        'mime_type' => 'image/jpeg',
    ];
}
