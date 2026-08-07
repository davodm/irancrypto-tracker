<?php

/** @return list<array<string,mixed>> */
function parse_huluex(mixed $data, array $coins): array
{
    $list = is_array($data) && isset($data['data']) ? $data['data'] : $data;
    if (!is_array($list) || $list === []) {
        throw new RuntimeException('Huluex: empty');
    }
    $out = [];
    $lu = last_update_now();
    foreach ($list as $row) {
        if (!is_array($row)) {
            continue;
        }
        if (!isset($row['sellPrice']) && !isset($row['buyPrice'])) {
            continue;
        }
        $symbol = strtoupper((string) ($row['symbol'] ?? ''));
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $price = num($row['sellPrice'] ?? $row['buyPrice'] ?? 0, ['decimalPlaces' => 8, 'multiply' => 10]);
        $volRaw = $row['valume'] ?? $row['volume'] ?? 0;
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => $price,
            'volume_1d' => num($volRaw, ['multiply' => 10, 'roundUp' => true]),
            'coin_volume_1d' => $price > 0 ? num($volRaw, ['divide' => $price]) : 0.0,
            'change_1d' => num($row['changePrice'] ?? 0, ['decimalPlaces' => 2]),
            'source' => 'huluex',
            'last_update' => $lu,
        ];
    }
    return $out;
}

function job_huluex(): array
{
    return [
        'url' => 'https://api.huluex.com/api/market/getCoinsPriceV3',
        'query' => ['withGate' => 'true', 'version' => 4],
    ];
}

function register_huluex(): array
{
    return [
        'coin_use' => 'all',
        'job' => 'job_huluex',
        'parse' => 'parse_huluex',
    ];
}
