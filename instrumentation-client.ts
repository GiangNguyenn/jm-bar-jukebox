// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: 'https://dcd38d2e63ff7bbc09f9b88743d46b0b@o4509417600450560.ingest.de.sentry.io/4509417600843856',

  // Add optional integrations for additional features
  integrations: [
    Sentry.replayIntegration({
      // Block all media to avoid capturing album art, etc.
      blockAllMedia: true
    }),
    Sentry.consoleLoggingIntegration({ levels: ['error', 'warn'] })
  ],

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,

  // Define how likely Replay events are sampled.
  // This sets the sample rate to be 1%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: 0.01,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart

// Clear recovery state on page load to prevent issues with stale data
try {
  console.log('Clearing recovery state from localStorage...')
  localStorage.removeItem('spotify_recovery_state')
  localStorage.removeItem('spotify_recovery_lock_ts')
} catch (error) {
  console.error('Failed to clear recovery state:', error)
}
