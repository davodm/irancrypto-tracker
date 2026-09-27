<?php

/**
 * OMPFinex labels its Rial markets "Toman" in display names, but quote_currency.id is IRR
 * and last_price / last_volume are already in Rial.
 *
 * @return list<array<string,mixed>>
 */
function parse_ompfinex(mixed $data, array $coins): array
{
    $list = is_array($data) && isset($data['data']) && is_array($data['data']) ? $data['data'] : [];
    if ($list === []) {
        throw new RuntimeException('Ompfinex: empty data list');
    }
    $out = [];
    $lu = last_update_now();
    foreach ($list as $item) {
        if (!is_array($item) || strtoupper((string) ($item['quote_currency']['id'] ?? '')) !== 'IRR') {
            continue;
        }
        if (!isset($item['last_price'])) {
            continue;
        }
        $symbol = strtoupper((string) ($item['base_currency']['id'] ?? ''));
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => num($item['last_price'], ['decimalPlaces' => 8]),
            'volume_1d' => num($item['last_volume'] ?? 0, ['roundUp' => true]),
            'coin_volume_1d' => 0,
            'change_1d' => num($item['day_change_percent'] ?? 0, ['decimalPlaces' => 2]),
            'source' => 'ompfinex',
            'last_update' => $lu,
        ];
    }
    return $out;
}

function job_ompfinex(): array
{
    return [
        'url' => 'https://api.ompfinex.com/v1/market',
    ];
}

function register_ompfinex(): array
{
    return [
        'coin_use' => 'all',
        'job' => 'job_ompfinex',
        'parse' => 'parse_ompfinex',
    ];
}
