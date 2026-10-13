/**
 * ExpoAudioAdapter: wraps expo-audio native operations.
 *
 * Single responsibility: manage the native AudioPlayer lifecycle.
 * - Creates and disposes the player.
 * - Subscribes to native status updates.
 * - Surfaces native errors with context.
 * - Never holds app-level queue or UI state.
 */
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

export interface NativeStatus {
  isLoaded: boolean;
  isPlaying: boolean;
  positionSec: number;
  durationSec: number | null;
  didJustFinish: boolean;
}

export type StatusListener = (status: NativeStatus) => void;
export type ErrorListener = (error: Error, context: string) => void;

const POLL_INTERVAL_MS = 500;

export class ExpoAudioAdapter {
  private player: AudioPlayer | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private statusListeners = new Set<StatusListener>();
  private errorListeners = new Set<ErrorListener>();
  private lastStatus: NativeStatus = {
    isLoaded: false,
    isPlaying: false,
    positionSec: 0,
    durationSec: null,
    didJustFinish: false,
  };
  private finishedNotified = false;

  onStatus(fn: StatusListener): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  onError(fn: ErrorListener): () => void {
    this.errorListeners.add(fn);
    return () => this.errorListeners.delete(fn);
  }

  private emitError(error: Error, context: string): void {
    this.errorListeners.forEach((fn) => {
      try {
        fn(error, context);
      } catch {
        // listener must not break the adapter
      }
    });
  }

  private emitStatus(status: NativeStatus): void {
    this.lastStatus = status;
    this.statusListeners.forEach((fn) => {
      try {
        fn(status);
      } catch {
        // listener must not break the adapter
      }
    });
  }

  get status(): NativeStatus {
    return { ...this.lastStatus };
  }

  get hasPlayer(): boolean {
    return this.player !== null;
  }

  /** Load a URI into a fresh native player. Disposes any existing player. */
  async load(uri: string): Promise<void> {
    this.dispose();
    this.finishedNotified = false;
    try {
      this.player = createAudioPlayer(uri);
    } catch (e) {
      this.emitError(e instanceof Error ? e : new Error(String(e)), 'createAudioPlayer');
      throw e;
    }
    this.emitStatus({
      isLoaded: true,
      isPlaying: false,
      positionSec: 0,
      durationSec: null,
      didJustFinish: false,
    });
    this.startPolling();
  }

  play(): void {
    if (!this.player) {
      this.emitError(new Error('play() with no player'), 'play');
      return;
    }
    try {
      this.player.play();
    } catch (e) {
      this.emitError(e instanceof Error ? e : new Error(String(e)), 'play');
    }
  }

  pause(): void {
    if (!this.player) return;
    try {
      this.player.pause();
    } catch (e) {
      this.emitError(e instanceof Error ? e : new Error(String(e)), 'pause');
    }
  }

  seekTo(seconds: number): void {
    if (!this.player) return;
    try {
      this.player.seekTo(Math.max(0, seconds));
    } catch (e) {
      this.emitError(e instanceof Error ? e : new Error(String(e)), 'seekTo');
    }
  }

  /** Release the native player. Safe to call multiple times. */
  dispose(): void {
    this.stopPolling();
    if (this.player) {
      try {
        this.player.remove();
      } catch {
        // already removed; ignore
      }
      this.player = null;
    }
    this.emitStatus({
      isLoaded: false,
      isPlaying: false,
      positionSec: 0,
      durationSec: null,
      didJustFinish: false,
    });
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      if (!this.player) return;
      try {
        const positionSec = this.player.currentTime ?? 0;
        const durationSec = this.player.duration ?? null;
        const isPlaying = !!this.player.playing;
        const isLoaded = this.player.isLoaded ?? true;

        let didJustFinish = false;
        if (
          isLoaded &&
          durationSec != null &&
          durationSec > 0 &&
          positionSec >= durationSec - 0.3 &&
          !isPlaying &&
          !this.finishedNotified
        ) {
          didJustFinish = true;
          this.finishedNotified = true;
        }

        const status: NativeStatus = {
          isLoaded,
          isPlaying,
          positionSec,
          durationSec,
          didJustFinish,
        };

        // Only emit when something changed (avoid render storms).
        const prev = this.lastStatus;
        if (
          status.isPlaying !== prev.isPlaying ||
          status.isLoaded !== prev.isLoaded ||
          Math.abs(status.positionSec - prev.positionSec) > 0.25 ||
          status.durationSec !== prev.durationSec ||
          status.didJustFinish
        ) {
          this.emitStatus(status);
        }
      } catch (e) {
        // Player was removed mid-poll; stop quietly.
        this.stopPolling();
      }
    }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
