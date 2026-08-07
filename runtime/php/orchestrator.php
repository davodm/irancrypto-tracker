<?php
/**
 * Scrape orchestration: job-mode scrapers run via parallel http_multi_get;
 * custom scrape_* handlers (pagination) run sequentially afterward.
 */

/**
 * Resolve registry callables that may be string function names or Closures.
 * @param mixed $fn
 * @param mixed ...$args
 * @return mixed
 */
function registry_call(mixed $fn, mixed ...$args): mixed
{
    if (is_string($fn)) {
        if (!function_exists($fn)) {
            throw new RuntimeException("Unknown registry function: {$fn}");
        }
        return $fn(...$args);
    }
    if (is_callable($fn)) {
        return $fn(...$args);
    }
    throw new RuntimeException('Invalid registry callable');
}

/**
 * @param list<array{slug:string,support?:list<string>}> $exchanges
 * @param list<string> $coins
 * @return list<array<string,mixed>>
 */
function scrape_exchanges(array $exchanges, array $coins): array
{
    $registry = scraper_registry();
    $ignored = ignore_list();
    $jobs = [];
    $meta = [];
    $collected = [];

    foreach ($exchanges as $ex) {
        $slug = strtolower($ex['slug']);
        if (in_array($slug, $ignored, true)) {
            log_info("Ignoring exchange: {$slug}");
            continue;
        }
        if (!isset($registry[$slug])) {
            log_info("No PHP scraper for: {$slug}");
            continue;
        }
        $cfg = $registry[$slug];
        if (isset($cfg['skip'])) {
            $reason = registry_call($cfg['skip']);
            if ($reason !== null) {
                log_info("Skipping {$slug}: {$reason}");
                continue;
            }
        }

        $filter = ($cfg['coin_use'] === 'own')
            ? array_values(array_map(static fn($c) => strtoupper((string) $c), $ex['support'] ?? []))
            : $coins;

        if (isset($cfg['scrape'])) {
            $meta[$slug] = ['mode' => 'custom', 'filter' => $filter, 'fn' => $cfg['scrape']];
            continue;
        }

        $job = registry_call($cfg['job']);
        $jobs[$slug] = $job;
        $meta[$slug] = ['mode' => 'job', 'filter' => $filter, 'parse' => $cfg['parse']];
    }

    log_info('Fetching ' . count($jobs) . ' exchange endpoint(s) in parallel…');
    $t0 = microtime(true);
    $responses = http_multi_get($jobs);
    log_info(sprintf('Parallel fetch done in %.1fs', microtime(true) - $t0));

    foreach ($meta as $slug => $m) {
        if ($m['mode'] !== 'job') {
            continue;
        }
        $resp = $responses[$slug] ?? ['ok' => false, 'error' => 'missing response'];
        if (empty($resp['ok'])) {
            log_error("{$slug}: " . ($resp['error'] ?? 'failed'));
            continue;
        }
        try {
            $rows = registry_call($m['parse'], $resp['json'], $m['filter']);
            $collected = array_merge($collected, $rows);
            log_info("{$slug}: " . count($rows) . ' rows');
        } catch (Throwable $e) {
            log_error("{$slug} parse: " . $e->getMessage());
        }
    }

    foreach ($meta as $slug => $m) {
        if ($m['mode'] !== 'custom') {
            continue;
        }
        if (!assert_time_budget(HTTP_TIMEOUT_SEC + 10)) {
            log_error("Skipping {$slug}: time budget");
            continue;
        }
        try {
            $t1 = microtime(true);
            $rows = registry_call($m['fn'], $m['filter']);
            $collected = array_merge($collected, $rows);
            log_info(sprintf('%s: %d rows in %.1fs', $slug, count($rows), microtime(true) - $t1));
        } catch (Throwable $e) {
            log_error("{$slug}: " . $e->getMessage());
        }
    }

    return $collected;
}
