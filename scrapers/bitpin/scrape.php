<?php

/** @return list<array<string,mixed>> */
function parse_bitpin_list(array $list, array $coins): array
{
    $out = [];
    foreach ($list as $row) {
        if (!is_array($row)) {
            continue;
        }
        if (($row['currency2']['code'] ?? '') !== 'IRT') {
            continue;
        }
        if (!empty($row['currency1']['forTest']) || empty($row['order_book_info']['price'])) {
            continue;
        }
        $symbol = strtoupper((string) ($row['currency1']['code'] ?? ''));
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $created = $row['internal_price_info']['created_at'] ?? null;
        $ts = $created ? (int) num($created, ['roundUp' => true]) : time();
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => num($row['order_book_info']['price'], ['decimalPlaces' => 8, 'multiply' => 10]),
            'volume_1d' => num($row['order_book_info']['value'] ?? 0, ['multiply' => 10, 'roundUp' => true]),
            'coin_volume_1d' => num($row['order_book_info']['amount'] ?? 0),
            'change_1d' => num($row['order_book_info']['change'] ?? 0, ['decimalPlaces' => 2]),
            'source' => 'bitpin',
            'last_update' => ['date' => gmdate('c', $ts), 'timestamp' => $ts],
        ];
    }
    return $out;
}

/** Follow Django-style `next` pagination (and page=N fallback). @return list<array<string,mixed>> */
function scrape_bitpin(array $coins): array
{
    $all = [];
    $nextUrl = null;
    $page = 1;
    $maxPages = 50;

    for ($i = 0; $i < $maxPages; $i++) {
        if (!assert_time_budget(HTTP_TIMEOUT_SEC + 5)) {
            break;
        }
        if ($nextUrl !== null) {
            $result = http_get_json($nextUrl);
        } else {
            $query = $page > 1 ? ['page' => $page] : [];
            $result = http_get_json('https://api.bitpin.ir/v1/mkt/markets/', $query);
        }
        if (!is_array($result) || empty($result['results']) || !is_array($result['results'])) {
            throw new RuntimeException('Bitpin: invalid response');
        }
        foreach ($result['results'] as $row) {
            $all[] = $row;
        }
        if (!empty($result['next']) && is_string($result['next'])) {
            $nextUrl = $result['next'];
            continue;
        }
        $count = (int) ($result['count'] ?? 0);
        if ($count > 0 && count($all) < $count && count($result['results']) > 0) {
            $nextUrl = null;
            $page++;
            continue;
        }
        break;
    }

    if ($all === []) {
        throw new RuntimeException('Bitpin: empty');
    }
    return parse_bitpin_list($all, $coins);
}

function register_bitpin(): array
{
    return [
        'coin_use' => 'all',
        'scrape' => 'scrape_bitpin',
    ];
}
