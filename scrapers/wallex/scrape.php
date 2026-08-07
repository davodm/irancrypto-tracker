<?php

/** @return list<array<string,mixed>> */
function parse_wallex(mixed $data, array $coins): array
{
    if (!is_array($data)) {
        throw new RuntimeException('Wallex: invalid');
    }
    $symbols = $data['result']['symbols'] ?? $data['symbols'] ?? null;
    if (!is_array($symbols) || $symbols === []) {
        throw new RuntimeException('Wallex: empty');
    }
    $out = [];
    $lu = last_update_now();
    foreach ($symbols as $row) {
        if (!is_array($row)) {
            continue;
        }
        if (strtoupper((string) ($row['quoteAsset'] ?? '')) !== 'TMN') {
            continue;
        }
        if (empty($row['stats']['lastPrice'])) {
            continue;
        }
        $symbol = strtoupper((string) ($row['baseAsset'] ?? ''));
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $stats = $row['stats'];
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => num($stats['lastPrice'], ['multiply' => 10, 'decimalPlaces' => 8]),
            'volume_1d' => num($stats['24h_quoteVolume'] ?? 0, ['roundUp' => true, 'multiply' => 10]),
            'coin_volume_1d' => num($stats['24h_volume'] ?? 0),
            'change_1d' => num($stats['24h_ch'] ?? 0, ['decimalPlaces' => 2]),
            'change_7d' => num($stats['7d_ch'] ?? 0, ['decimalPlaces' => 2]),
            'source' => 'wallex',
            'last_update' => $lu,
        ];
    }
    return $out;
}

function job_wallex(): array
{
    return [
        'url' => 'https://api.wallex.ir/v1/markets',
    ];
}

function register_wallex(): array
{
    return [
        'coin_use' => 'all',
        'job' => 'job_wallex',
        'parse' => 'parse_wallex',
    ];
}
