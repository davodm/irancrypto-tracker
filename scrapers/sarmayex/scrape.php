<?php

/**
 * Parse currencies from the page's `__NUXT_DATA__` payload. Every currency object holds
 * payload indices; `sell.marketPrice` is the Toman mid-market rate (`sell.price` is
 * Sarmayex's own marked-up quote).
 *
 * @return list<array<string,mixed>>
 */
function parse_sarmayex_page(string $html, array $coins): array
{
    if (!preg_match('/<script[^>]*id="__NUXT_DATA__"[^>]*>([^<]*)<\/script>/', $html, $m)) {
        throw new RuntimeException('Sarmayex: Nuxt payload not found');
    }
    $payload = json_decode($m[1], true);
    if (!is_array($payload)) {
        throw new RuntimeException('Sarmayex: invalid Nuxt payload');
    }

    // Nuxt payload (devalue) wrappers whose second element is the index of the wrapped value.
    $wrappers = ['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef'];
    $deref = static function (mixed $index) use ($payload, $wrappers): mixed {
        if (!is_int($index)) {
            return null;
        }
        $value = $payload[$index] ?? null;
        while (is_array($value) && array_is_list($value) && in_array($value[0] ?? null, $wrappers, true)) {
            $value = $payload[$value[1]] ?? null;
        }
        return $value;
    };

    $out = [];
    $seen = [];
    $lu = last_update_now();
    foreach ($payload as $node) {
        if (!is_array($node) || array_is_list($node)) {
            continue;
        }
        if (!isset($node['symbol'], $node['sell'], $node['markets'])) {
            continue;
        }
        $symbol = strtoupper((string) $deref($node['symbol']));
        if ($symbol === '' || isset($seen[$symbol]) || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $markets = $deref($node['markets']);
        if (!is_array($markets) || !in_array("{$symbol}_IRT", array_map($deref, $markets), true)) {
            continue;
        }
        $sell = $deref($node['sell']);
        $priceToman = is_array($sell) ? num($deref($sell['marketPrice'] ?? null) ?? 0) : 0.0;
        if ($priceToman <= 0) {
            continue;
        }

        $seen[$symbol] = true;
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => num($priceToman, ['multiply' => 10, 'decimalPlaces' => 8]),
            'volume_1d' => 0,
            'coin_volume_1d' => 0,
            'change_1d' => 0,
            'source' => 'sarmayex',
            'last_update' => $lu,
        ];
    }
    return $out;
}

/** @return list<array<string,mixed>> */
function scrape_sarmayex(array $coins): array
{
    return parse_sarmayex_page(http_get_text('https://sarmayex.com/crypto-price'), $coins);
}

function register_sarmayex(): array
{
    return [
        'coin_use' => 'all',
        'scrape' => 'scrape_sarmayex',
    ];
}
