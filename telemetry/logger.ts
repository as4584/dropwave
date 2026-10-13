/**
 * Structured telemetry logger.
 *
 * All events are machine-readable JSON. Never log credentials, tokens,
 * signed URLs, or cookies. Use sanitized representations for URLs.
 */

export type LogEventName =
  | 'audio_session_configured'
  | 'audio_session_config_failed'
  | 'queue_hydrated'
  | 'queue_mutated'
  | 'queue_restore_failed'
  | 'track_load_requested'
  | 'track_load_success'
  | 'track_load_failed'
  | 'play_requested'
  | 'play_started'
  | 'play_failed'
  | 'playback_paused'
  | 'playback_buffering_started'
  | 'playback_buffering_ended'
  | 'playback_interrupted'
  | 'playback_resumed'
  | 'playback_finished'
  | 'seek_requested'
  | 'seek_completed'
  | 'seek_failed'
  | 'route_changed'
  | 'download_requested'
  | 'download_started'
  | 'download_progress'
  | 'download_transfer_completed'
  | 'download_validation_started'
  | 'download_validation_failed'
  | 'download_published'
  | 'download_failed'
  | 'download_cancelled'
  | 'playback_checkpoint_saved'
  | 'playback_checkpoint_failed';

export interface LogContext {
  sessionId?: string;
  operationId?: number;
  trackId?: string;
  queueEntryId?: string;
  platform?: string;
  appVersion?: string;
  layer?: string;
  operation?: string;
  errorCode?: string;
  errorMessage?: string;
  retriable?: boolean;
  // Media context
  sourceKind?: string;
  uriScheme?: string;
  container?: string;
  codec?: string;
  fileSizeBytes?: number;
  durationSec?: number;
  positionSec?: number;
  // Queue context
  queueLength?: number;
  hasCurrentTrack?: boolean;
  wasPlaying?: boolean;
  autoResumed?: boolean;
  // Download context
  downloadId?: string;
  bytesReceived?: number;
  bytesExpected?: number;
  // Generic
  [key: string]: unknown;
}

let sessionId: string | null = null;

function getSessionId(): string {
  if (!sessionId) {
    sessionId = `s_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  }
  return sessionId;
}

export function logEvent(event: LogEventName, context: LogContext = {}): void {
  const entry = {
    event,
    timestamp: Date.now(),
    sessionId: getSessionId(),
    platform: 'ios', // TODO: detect from Platform.OS
    ...context,
  };
  // In production, this would go to a log service. For now, console.
  // Filter out verbose events in production.
  if (__DEV__) {
    console.log(`[${event}]`, JSON.stringify(entry));
  }
}

/** Sanitize a URL for logging: keep scheme/host/path category, drop query. */
export function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname ? '/...' : ''}`;
  } catch {
    return '[invalid-url]';
  }
}

declare const __DEV__: boolean;
