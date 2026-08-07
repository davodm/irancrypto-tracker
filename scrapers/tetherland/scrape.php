<?php

function getLatest_tetherland($filterCoins = []) {
    $url = "https://api.tetherland.com/currencies";
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
    if (!isset($data['data']['currencies']) || empty($data['data']['currencies'])) {
        throw new Exception("Response data is empty");
    }

    return processList_tetherland($data['data']['currencies'], $filterCoins);
}

function processList_tetherland($list, $coinsFilter = []) {
    $result = [];
    $now = date('c');
    $timestamp = time();

    foreach ($list as $symbol => $item) {
        $upperSymbol = strtoupper($symbol);
        if (!empty($coinsFilter) && !in_array($upperSymbol, $coinsFilter)) {
            continue;
        }

        $rawPrice = $item['price'] ?? $item['buy_price'] ?? 0;
        $price = floatval($rawPrice) * 10;
        $change1d = floatval($item['diff24d'] ?? 0);

        $result[] = [
            'source' => 'tetherland',
            'currency' => 'IRR',
            'symbol' => $upperSymbol,
            'price' => $price,
            'volume_1d' => 0,
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
