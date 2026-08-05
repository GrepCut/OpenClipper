import * as Sentry from "@sentry/react";

Sentry.addIntegration(
  Sentry.replayIntegration({
    maskAllText: true,
    blockAllMedia: true,
  }),
);
