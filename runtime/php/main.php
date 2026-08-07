
// =============================================================================
// MAIN
// =============================================================================

/**
 * @param array{
 *   all:bool,exchange:?string,finalize:bool,finalize_only:bool,run_id:?string,
 *   dry_run:bool,from_json:?string,prune_logs:bool,help:bool
 * } $cli
 */
function main(array $cli): int
{
    global $RUN_LOGGER;

    if ($cli['help']) {
        print_help();
        return 0;
    }

    if ($cli['prune_logs'] && !$cli['all'] && $cli['exchange'] === null && !$cli['finalize_only'] && $cli['from_json'] === null) {
        $n = prune_logs(LOG_DIR, LOG_RETENTION_DAYS);
        log_info("Pruned {$n} log file(s) older than " . LOG_RETENTION_DAYS . " days");
        return 0;
    }

    $runId = $cli['run_id'] ?: default_run_id();
    $RUN_LOGGER = new RunLogger(LOG_DIR, INGEST_NODE, $runId);
    log_info('IranCrypto track.php starting (PHP ' . PHP_VERSION . ') run_id=' . $runId);
    log_info('Logs: ' . $RUN_LOGGER->path());
    $RUN_LOGGER->event('run_start', [
        'run_id' => $runId,
        'node' => INGEST_NODE,
        'dry_run' => $cli['dry_run'],
        'finalize' => $cli['finalize'] || $cli['finalize_only'],
    ]);

    if ($cli['finalize_only']) {
        if ($cli['dry_run']) {
            log_info('Dry-run: would finalize ' . $runId);
            $RUN_LOGGER->event('run_end', ['ok' => true, 'dry_run' => true]);
            return 0;
        }
        try {
            finalize_when_ready($runId);
            prune_logs(LOG_DIR, LOG_RETENTION_DAYS);
            $RUN_LOGGER->event('run_end', ['ok' => true]);
            log_info(sprintf('Finalize done in %.1fs', elapsed_sec()));
            return 0;
        } catch (Throwable $e) {
            $RUN_LOGGER->event('finalize_err', ['message' => $e->getMessage()]);
            log_error('Finalize: ' . $e->getMessage());
            $RUN_LOGGER->event('run_end', ['ok' => false]);
            return 1;
        }
    }

    if (!$cli['all'] && $cli['exchange'] === null && $cli['from_json'] === null) {
        log_error('Specify --all, --exchange=SLUG, --from-json=, or --finalize-only');
        print_help();
        return 1;
    }

    if (!assert_time_budget(30)) {
        return 1;
    }

    if ($cli['dry_run'] && INGEST_SECRET === '') {
        log_info('Dry-run without INGEST_SECRET: using empty config (scrapes still need exchange list)');
    }

    $config = [];
    if (!$cli['dry_run'] || INGEST_SECRET !== '') {
        $config = ingest_config();
        $RUN_LOGGER->event('config_ok', [
            'exchanges' => count($config['exchanges'] ?? []),
            'coins' => count($config['coins'] ?? []),
        ]);
    }

    if ($cli['run_id'] === null && !empty($config['run_id_default'])) {
        $runId = (string) $config['run_id_default'];
    }

    $exchanges = [];
    foreach ($config['exchanges'] ?? [] as $ex) {
        if (!is_array($ex) || empty($ex['slug'])) {
            continue;
        }
        $item = ['slug' => (string) $ex['slug']];
        if (!empty($ex['support']) && is_array($ex['support'])) {
            $item['support'] = array_values(array_map('strval', $ex['support']));
        }
        $exchanges[] = $item;
    }
    $coins = array_values(array_map('strtoupper', array_map('strval', $config['coins'] ?? [])));

    $exchanges = select_exchanges($exchanges, $cli);
    $RUN_LOGGER->event('run_start', [
        'run_id' => $runId,
        'node' => INGEST_NODE,
        'exchanges' => array_map(static fn($e) => $e['slug'], $exchanges),
    ]);

    $bySource = [];

    if ($cli['from_json'] !== null) {
        $rawJson = file_get_contents($cli['from_json']);
        if ($rawJson === false) {
            throw new RuntimeException('Cannot read --from-json file');
        }
        $decoded = json_decode($rawJson, true);
        if (!is_array($decoded)) {
            throw new RuntimeException('Invalid JSON in --from-json');
        }
        $rows = isset($decoded['rows']) && is_array($decoded['rows']) ? $decoded['rows'] : $decoded;
        foreach ($rows as $row) {
            if (!is_array($row) || empty($row['source'])) {
                continue;
            }
            $src = strtolower((string) $row['source']);
            $bySource[$src][] = $row;
        }
    } else {
        if ($exchanges === [] || $coins === []) {
            log_error('No exchanges or coins from config (check API / filters)');
            return 1;
        }
        $raw = scrape_exchanges($exchanges, $coins);
        $filtered = filter_rows_for_ingest($raw, $coins);
        foreach ($filtered as $row) {
            $bySource[$row['source']][] = $row;
        }
        log_info(sprintf('Discovered %d filtered rows from %d sources', count($filtered), count($bySource)));
    }

    $collectedAt = gmdate('c');
    $ok = true;
    foreach ($bySource as $source => $rows) {
        $RUN_LOGGER->event('scrape_ok', [
            'source' => $source,
            'rows' => count($rows),
        ]);
        $payload = [
            'run_id' => $runId,
            'mode' => 'partial',
            'source' => $source,
            'collected_at' => $collectedAt,
            'node' => INGEST_NODE,
            'rows' => $rows,
            'finalize' => false,
        ];
        if ($cli['dry_run']) {
            log_info("Dry-run: would ingest {$source} rows=" . count($rows));
            $RUN_LOGGER->event('ingest_skip', ['source' => $source, 'reason' => 'dry_run', 'rows' => count($rows)]);
            continue;
        }
        try {
            $t1 = microtime(true);
            $res = ingest_post($payload);
            $RUN_LOGGER->event('ingest_ok', [
                'source' => $source,
                'rows' => count($rows),
                'upserted' => $res['upserted'] ?? null,
                'skipped' => $res['skipped'] ?? null,
                'http' => 200,
                'ms' => (int) round((microtime(true) - $t1) * 1000),
            ]);
            log_info("Ingested {$source}: rows=" . count($rows));
        } catch (Throwable $e) {
            $ok = false;
            $RUN_LOGGER->event('ingest_err', [
                'source' => $source,
                'message' => $e->getMessage(),
            ]);
            log_error("Ingest {$source}: " . $e->getMessage());
        }
    }

    if ($cli['finalize'] && !$cli['dry_run']) {
        try {
            finalize_when_ready($runId);
        } catch (Throwable $e) {
            $ok = false;
            $RUN_LOGGER->event('finalize_err', ['message' => $e->getMessage()]);
            log_error('Finalize: ' . $e->getMessage());
        }
    }

    $pruned = prune_logs(LOG_DIR, LOG_RETENTION_DAYS);
    if ($pruned > 0) {
        log_info("Pruned {$pruned} old log file(s)");
    }
    $RUN_LOGGER->event('run_end', ['ok' => $ok]);
    log_info(sprintf('Done in %.1fs ok=%s', elapsed_sec(), $ok ? 'true' : 'false'));
    return $ok ? 0 : 1;
}

// =============================================================================
// BOOT
// =============================================================================

try {
    $CLI = parse_cli($argv ?? []);
    exit(main($CLI));
} catch (Throwable $e) {
    log_error($e->getMessage());
    if ($RUN_LOGGER instanceof RunLogger) {
        $RUN_LOGGER->event('run_end', ['ok' => false, 'error' => $e->getMessage()]);
    }
    exit(1);
}
