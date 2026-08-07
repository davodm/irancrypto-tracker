<?php

/** @return list<array<string,mixed>> */
function parse_hitobit(mixed $data, array $coins): array
{
    if (!is_array($data) || $data === []) {
        throw new RuntimeException('Hitobit: empty');
    }
    $out = [];
    foreach ($data as $row) {
        if (!is_array($row)) {
            continue;
        }
        if (($row['quoteCurrencySymbol'] ?? '') !== 'IRT' || empty($row['lastPrice'])) {
            continue;
        }
        $symbol = strtoupper((string) ($row['baseCurrencySymbol'] ?? ''));
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $ts = isset($row['lastMarketInfoChangeDate'])
            ? (int) (strtotime((string) $row['lastMarketInfoChangeDate']) ?: time())
            : time();
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => num($row['lastPrice'], ['decimalPlaces' => 8, 'multiply' => 10]),
            'volume_1d' => num($row['quoteVolume'] ?? 0, ['multiply' => 10, 'roundUp' => true]),
            'coin_volume_1d' => num($row['baseVolume'] ?? 0),
            'change_1d' => num($row['priceChangePercent'] ?? 0, ['decimalPlaces' => 2]),
            'source' => 'hitobit',
            'last_update' => ['date' => gmdate('c', $ts), 'timestamp' => $ts],
        ];
    }
    return $out;
}

function job_hitobit(): array
{
    return [
        'url' => 'https://hitobit.com/hapi/exchange/v1/public/alltickers/24hr',
    ];
}

function register_hitobit(): array
{
    return [
        'coin_use' => 'all',
        'job' => 'job_hitobit',
        'parse' => 'parse_hitobit',
    ];
}
