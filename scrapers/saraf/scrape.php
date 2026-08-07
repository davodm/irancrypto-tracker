<?php

/** @return list<array<string,mixed>> */
function parse_saraf(mixed $data, array $coins): array
{
    $items = $data['price']['Items'] ?? null;
    if (!is_array($items)) {
        throw new RuntimeException('Saraf: empty');
    }
    $list = array_values($items);
    $out = [];
    foreach ($list as $item) {
        if (!is_array($item)) {
            continue;
        }
        if (strtoupper((string) ($item['assetType'] ?? '')) !== 'CRYPTO' || empty($item['p'])) {
            continue;
        }
        $symbol = strtoupper((string) ($item['s'] ?? ''));
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $priceIRT = num($item['p']);
        $ts = !empty($item['ut']) ? (int) round(((float) $item['ut']) / 1000) : time();
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => num($item['p'], ['decimalPlaces' => 8, 'multiply' => 10]),
            'volume_1d' => num($item['mc'] ?? 0, ['roundUp' => true, 'multiply' => 10]),
            'coin_volume_1d' => $priceIRT > 0 ? num($item['mc'] ?? 0, ['divide' => $priceIRT]) : 0.0,
            'change_1d' => num($item['c'] ?? 0, ['decimalPlaces' => 2]),
            'source' => 'saraf',
            'last_update' => ['date' => gmdate('c', $ts), 'timestamp' => $ts],
        ];
    }
    return $out;
}

function job_saraf(): array
{
    return [
        'url' => 'https://api.saraf.app/v3/prices/crypto',
    ];
}

function register_saraf(): array
{
    return [
        'coin_use' => 'all',
        'job' => 'job_saraf',
        'parse' => 'parse_saraf',
    ];
}
