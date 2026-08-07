<?php

/** @return list<array<string,mixed>> */
function parse_exir(mixed $data, array $coins): array
{
    if (!is_array($data) || $data === []) {
        throw new RuntimeException('Exir: empty');
    }
    $out = [];
    $lu = last_update_now();
    foreach ($data as $key => $row) {
        if (!is_array($row)) {
            continue;
        }
        $split = explode('-', strtoupper((string) $key));
        $symbol = $split[0] ?? '';
        $currency = $split[1] ?? '';
        if ($currency !== 'IRT' || empty($row['last'])) {
            continue;
        }
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $price = num($row['last'] ?? $row['close'] ?? 0, ['multiply' => 10, 'decimalPlaces' => 8]);
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => $price,
            'volume_1d' => num($row['volume'] ?? 0, ['multiply' => $price, 'roundUp' => true]),
            'coin_volume_1d' => num($row['volume'] ?? 0),
            'source' => 'exir',
            'last_update' => $lu,
        ];
    }
    return $out;
}

function job_exir(): array
{
    return [
        'url' => 'https://api.exir.io/v2/ticker/all',
    ];
}

function register_exir(): array
{
    return [
        'coin_use' => 'all',
        'job' => 'job_exir',
        'parse' => 'parse_exir',
    ];
}
