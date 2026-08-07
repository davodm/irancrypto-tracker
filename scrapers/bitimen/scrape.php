<?php

function getLatest_bitimen($filterCoins = []) {
    $url = "https://api2.bitimen.com/api/market/stats?quote_asset=IRT";
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    $response = curl_exec($ch);
    curl_close($ch);

    if (!$response) {
        throw new Exception("Response data is empty");
    }

    $data = json_decode($response, true);
    if (!is_array($data) || empty($data)) {
        throw new Exception("Response data is empty");
    }

    return processList_bitimen($data, $filterCoins);
}

function processList_bitimen($list, $coinsFilter = []) {
    $result = [];
    $now = date('c');
    $timestamp = time();

    foreach ($list as $key => $item) {
        $symbol = strtoupper($item['base_asset_ticker'] ?? '');
        if (!$symbol) continue;

        if (!empty($coinsFilter) && !in_array($symbol, $coinsFilter)) {
            continue;
        }

        $rawPrice = $item['last_price'] ?? $item['best_bid_raw'] ?? 0;
        $price = floatval($rawPrice) * 10;
        $rawVol = str_replace(',', '', $item['volume'] ?? '0');
        $volume1d = floatval($rawVol) * 10;
        $change1d = floatval($item['change_display'] ?? $item['change'] ?? 0);

        $result[] = [
            'source' => 'bitimen',
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => $price,
            'volume_1d' => round($volume1d),
            'coin_volume_1d' => 0,
            'change_1d' => round($change1d, 2),
            'last_update' => [
                'date' => $now,
                'timestamp' => $timestamp,
            ]
        ];
    }

    return $result;
}
