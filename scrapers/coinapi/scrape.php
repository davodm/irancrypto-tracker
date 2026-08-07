<?php

/** @return list<array<string,mixed>> */
function parse_coinapi(mixed $data, array $coins): array
{
    if (!is_array($data) || $data === []) {
        throw new RuntimeException('CoinAPI: empty');
    }
    $out = [];
    foreach ($data as $item) {
        if (!is_array($item)) {
            continue;
        }
        if (!isset($item['type_is_crypto']) || (int) $item['type_is_crypto'] !== 1) {
            continue;
        }
        $symbol = strtoupper((string) ($item['asset_id'] ?? ''));
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $iso = $item['data_quote_end'] ?? $item['data_end'] ?? null;
        $ts = $iso ? (int) (strtotime((string) $iso) ?: time()) : time();
        $out[] = [
            'currency' => 'USD',
            'symbol' => $symbol,
            'price' => num($item['price_usd'] ?? 0, ['decimalPlaces' => 8]),
            'volume_1d' => num($item['volume_1day_usd'] ?? 0, ['roundUp' => true]),
            'source' => 'coinapi',
            'last_update' => ['date' => gmdate('c', $ts), 'timestamp' => $ts],
        ];
    }
    return $out;
}

function skip_coinapi(): ?string
{
    return COINAPI_KEY === '' ? 'COINAPI_KEY empty' : null;
}

function job_coinapi(): array
{
    return [
        'url' => 'https://rest.coinapi.io/v1/assets',
        'headers' => ['X-CoinAPI-Key' => COINAPI_KEY],
    ];
}

function register_coinapi(): array
{
    return [
        'coin_use' => 'all',
        'skip' => 'skip_coinapi',
        'job' => 'job_coinapi',
        'parse' => 'parse_coinapi',
    ];
}
