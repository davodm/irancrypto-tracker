import * as Sentry from '@sentry/node';
import '@sentry/tracing';

let isInitialized = false;

export function initSentry() {
  // Only initialize if DSN is provided and not already initialized
  if (isInitialized) {
    return;
  }

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    return; // Silently skip if DSN is not provided
  }

  try {
    Sentry.init({
      dsn: dsn,
      tracesSampleRate: 0,
      environment: process.env.NODE_ENV || 'development',
    });
    isInitialized = true;
  } catch (error) {
    console.error('Failed to initialize Sentry:', error.message);
  }
}

export function captureError(error) {
  if (isInitialized) {
    Sentry.captureException(error);
  }
}
