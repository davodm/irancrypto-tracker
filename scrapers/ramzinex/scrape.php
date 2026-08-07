<?php

/** @return list<array<string,mixed>> */
function parse_ramzinex(mixed $data, array $coins): array
{
    $list = is_array($data) && isset($data['data']) ? $data['data'] : $data;
    if (!is_array($list) || $list === []) {
        throw new RuntimeException('Ramzinex: empty');
    }
    $out = [];
    $lu = last_update_now();
    foreach ($list as $row) {
        if (!is_array($row)) {
            continue;
        }
        $quote = strtoupper((string) ($row['quote_currency_symbol']['en'] ?? ''));
        if ($quote !== 'IRR' || !isset($row['sell'])) {
            continue;
        }
        $symbol = strtoupper((string) ($row['base_currency_symbol']['en'] ?? ''));
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $fin = $row['financial']['last24h'] ?? [];
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => num($row['sell'], ['decimalPlaces' => 8]),
            'volume_1d' => num($fin['quote_volume'] ?? 0, ['roundUp' => true]),
            'coin_volume_1d' => num($fin['base_volume'] ?? 0),
            'change_1d' => num($fin['change_percent'] ?? 0, ['decimalPlaces' => 2]),
            'source' => 'ramzinex',
            'last_update' => $lu,
        ];
    }
    return $out;
}

function job_ramzinex(): array
{
    return [
        'url' => 'https://publicapi.ramzinex.com/exchange/api/v1.0/exchange/pairs',
    ];
}

function register_ramzinex(): array
{
    return [
        'coin_use' => 'all',
        'job' => 'job_ramzinex',
        'parse' => 'parse_ramzinex',
    ];
}
