<?php

/** @return list<array<string,mixed>> */
function parse_tetherland(mixed $data, array $coins): array
{
    $currencies = is_array($data) ? ($data['data']['currencies'] ?? null) : null;
    if (!is_array($currencies) || $currencies === []) {
        throw new RuntimeException('Tetherland: empty currencies');
    }
    $out = [];
    $lu = last_update_now();
    foreach ($currencies as $symbol => $item) {
        if (!is_array($item)) {
            continue;
        }
        $symbol = strtoupper((string) $symbol);
        if (!coin_allowed($coins, $symbol)) {
            continue;
        }
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => num(($item['price'] ?? null) ?: ($item['buy_price'] ?? 0), ['multiply' => 10, 'decimalPlaces' => 8]),
            'volume_1d' => 0,
            'coin_volume_1d' => 0,
            'change_1d' => num($item['diff24d'] ?? 0, ['decimalPlaces' => 2]),
            'source' => 'tetherland',
            'last_update' => $lu,
        ];
    }
    return $out;
}

function job_tetherland(): array
{
    return [
        'url' => 'https://api.tetherland.com/currencies',
    ];
}

function register_tetherland(): array
{
    return [
        'coin_use' => 'all',
        'job' => 'job_tetherland',
        'parse' => 'parse_tetherland',
    ];
}
