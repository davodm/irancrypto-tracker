<?php

/** @return list<array<string,mixed>> */
function parse_kifpool_list(array $list, array $coins): array
{
    $out = [];
    foreach ($list as $row) {
        if (!is_array($row)) {
            continue;
        }
        if (!isset($row['priceSellIRT']) && !isset($row['priceBuyIRT'])) {
            continue;
        }
        $symbol = strtoupper((string) ($row['symbol'] ?? ''));
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $priceIRT = (float) ($row['priceSellIRT'] ?? $row['priceBuyIRT'] ?? 0);
        $ts = !empty($row['updatedAt']) ? (int) (strtotime((string) $row['updatedAt']) ?: time()) : time();
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => num($priceIRT, ['decimalPlaces' => 8, 'multiply' => 10]),
            'volume_1d' => num($row['volume'] ?? 0, ['roundUp' => true, 'multiply' => 10]),
            'coin_volume_1d' => $priceIRT > 0 ? num($row['volume'] ?? 0, ['divide' => $priceIRT]) : 0.0,
            'change_1d' => num($row['priceChangePercent'] ?? 0, ['decimalPlaces' => 2]),
            'source' => 'kifpool',
            'last_update' => ['date' => gmdate('c', $ts), 'timestamp' => $ts],
        ];
    }
    return $out;
}

/** @return list<array<string,mixed>> */
function scrape_kifpool(array $coins): array
{
    $offset = 0;
    $limit = 200;
    $all = [];
    while (true) {
        if (!assert_time_budget(HTTP_TIMEOUT_SEC + 5)) {
            break;
        }
        $response = http_get_json('https://api.kifpool.app/api/spot/price/paginated', [
            'offset' => $offset,
            'limit' => $limit,
        ]);
        if (!is_array($response) || empty($response['data']) || !is_array($response['data'])) {
            break;
        }
        foreach ($response['data'] as $row) {
            $all[] = $row;
        }
        $total = (int) ($response['meta']['total'] ?? 0);
        $offset += $limit;
        if (count($response['data']) < $limit || ($total > 0 && $offset >= $total)) {
            break;
        }
    }
    if ($all === []) {
        throw new RuntimeException('KifPool: empty');
    }
    return parse_kifpool_list($all, $coins);
}

function register_kifpool(): array
{
    return [
        'coin_use' => 'all',
        'scrape' => 'scrape_kifpool',
    ];
}
