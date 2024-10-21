import * as Sentry from '@sentry/node';
import '@sentry/tracing';

export function initSentry() {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0,
    environment: process.env.NODE_ENV || 'development',
  });
}

export function captureError(error) {
  Sentry.captureException(error);
}
