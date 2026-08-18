<?php

/** @return list<array<string,mixed>> */
function parse_coinmarketcap(mixed $data, array $coins): array
{
    $list = $data['data'] ?? $data;
    if (!is_array($data) || (isset($data['status']['error_code']) && (int) $data['status']['error_code'] !== 0)) {
        $msg = $data['status']['error_message'] ?? 'invalid';
        throw new RuntimeException('CMC: ' . $msg);
    }
    if (!is_array($list) || $list === []) {
        throw new RuntimeException('CMC: empty');
    }
    // If wrapped, use data key
    if (isset($data['data']) && is_array($data['data'])) {
        $list = $data['data'];
    }
    $out = [];
    foreach ($list as $row) {
        if (!is_array($row) || empty($row['quote']['USD'])) {
            continue;
        }
        $symbol = strtoupper((string) ($row['symbol'] ?? ''));
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $q = $row['quote']['USD'];
        $price = num($q['price'] ?? 0, ['decimalPlaces' => 8]);
        $ts = !empty($row['last_updated']) ? (int) (strtotime((string) $row['last_updated']) ?: time()) : time();
        $item = [
            'currency' => 'USD',
            'symbol' => $symbol,
            'price' => $price,
            'volume_1d' => num($q['volume_24h'] ?? 0, ['roundUp' => true]),
            'change_1d' => num($q['percent_change_24h'] ?? 0, ['decimalPlaces' => 2]),
            'change_7d' => num($q['percent_change_7d'] ?? 0, ['decimalPlaces' => 2]),
            'cap' => num($q['market_cap'] ?? 0, ['roundUp' => true]),
            'market_cap' => num($q['market_cap'] ?? 0, ['roundUp' => true]),
            'supply' => num($row['circulating_supply'] ?? 0),
            'max_supply' => num($row['max_supply'] ?? 0),
            'source' => 'coinmarketcap',
            'last_update' => ['date' => gmdate('c', $ts), 'timestamp' => $ts],
        ];
        if (isset($row['quote'][$symbol]['volume_24h'])) {
            $item['coin_volume_1d'] = num($row['quote'][$symbol]['volume_24h']);
        } elseif ($price > 0) {
            $item['coin_volume_1d'] = num($q['volume_24h'] ?? 0, ['divide' => $price]);
        }
        $out[] = $item;
    }
    return $out;
}

function skip_coinmarketcap(): ?string
{
    return cmc_keys() === [] ? 'COINMARKETCAP_API_KEY empty' : null;
}

function job_coinmarketcap(): array
{
    $keys = cmc_keys();
    $key = $keys[array_rand($keys)];
    return [
        'url' => 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest',
        'query' => [
            'start' => 1,
            'limit' => 200,
            'aux' => 'max_supply,circulating_supply,total_supply,market_cap_by_total_supply,volume_24h_reported,volume_7d,volume_7d_reported,volume_30d,volume_30d_reported,is_market_cap_included_in_calc',
        ],
        'headers' => ['X-CMC_PRO_API_KEY' => $key],
    ];
}

function register_coinmarketcap(): array
{
    return [
        'coin_use' => 'all',
        'skip' => 'skip_coinmarketcap',
        'job' => 'job_coinmarketcap',
        'parse' => 'parse_coinmarketcap',
    ];
}
