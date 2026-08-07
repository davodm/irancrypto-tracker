<?php

function getLatest_arzpaya($filterCoins = []) {
    $popularCoins = ["BTC", "ETH", "USDT", "LTC", "BCH", "TRX", "DOGE", "LINK", "XRP", "SOL", "ADA"];
    $targetCoins = !empty($filterCoins) ? $filterCoins : $popularCoins;

    $result = [];
    $now = date('c');
    $timestamp = time();

    foreach ($targetCoins as $coin) {
        if (strtoupper($coin) === 'IRT' || strtoupper($coin) === 'IRR') continue;
        $url = "https://na1.arzpaya.com/orderbook/buy/irt/" . strtolower($coin);
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 5);
        $response = curl_exec($ch);
        curl_close($ch);

        if (!$response) continue;

        $data = json_decode($response, true);
        if (isset($data['Data']) && is_array($data['Data']) && count($data['Data']) > 0) {
            $topBid = $data['Data'][0];
            $price = floatval($topBid['p']) * 10;

            $result[] = [
                'source' => 'arzpaya',
                'currency' => 'IRR',
                'symbol' => strtoupper($coin),
                'price' => $price,
                'volume_1d' => 0,
                'coin_volume_1d' => 0,
                'change_1d' => 0,
                'last_update' => [
                    'date' => $now,
                    'timestamp' => $timestamp,
                ]
            ];
        }
    }

    return $result;
}
