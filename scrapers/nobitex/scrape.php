<?php

function parse_nobitex(mixed $data, array $coins): array
{
    if (!is_array($data) || empty($data['stats']) || !is_array($data['stats'])) {
        throw new RuntimeException('Nobitex: empty stats');
    }
    if (isset($data['status']) && $data['status'] !== 'ok') {
        throw new RuntimeException('Nobitex: invalid status');
    }
    $out = [];
    $lu = last_update_now();
    foreach ($data['stats'] as $key => $row) {
        if (!is_array($row) || !empty($row['isClosed'])) {
            continue;
        }
        $split = explode('-', strtoupper((string) $key));
        $symbol = $split[0] ?? '';
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => num($row['latest'] ?? 0, ['decimalPlaces' => 8]),
            'volume_1d' => num($row['volumeDst'] ?? 0, ['roundUp' => true]),
            'coin_volume_1d' => num($row['volumeSrc'] ?? 0),
            'change_1d' => num($row['dayChange'] ?? 0, ['decimalPlaces' => 2]),
            'source' => 'nobitex',
            'last_update' => $lu,
        ];
    }
    return $out;
}

function job_nobitex(): array
{
    return [
        'url' => 'https://apiv2.nobitex.ir/market/stats',
        'query' => ['dstCurrency' => 'rls'],
        'headers' => [
            'Origin' => 'https://nobitex.ir',
            'Referer' => 'https://nobitex.ir/',
        ],
    ];
}

function register_nobitex(): array
{
    return [
        'coin_use' => 'own',
        'job' => 'job_nobitex',
        'parse' => 'parse_nobitex',
    ];
}
