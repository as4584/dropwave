/**
 * PlaybackController: owns the playback lifecycle.
 *
 * This is the single owner of the native player. React screens observe
 * its state and send commands; they never create players directly.
 *
 * Responsibilities:
 * - Coordinate play/pause/seek/next/prev commands.
 * - Reconcile application state (queue/session) with native state.
 * - Handle interruptions and track transitions.
 * - Use operation IDs to reject stale async callbacks.
 * - Checkpoint position to SQLite (throttled, not on every status update).
 */
import { useSyncExternalStore } from 'react';
import { ExpoAudioAdapter, type NativeStatus } from './ExpoAudioAdapter';
import { PlaybackStateMachine } from './playbackMachine';
import { resolveSource } from './sourceResolver';
import { QueueRepository, type RepeatMode } from '../db/QueueRepository';
import { TrackRepository, type TrackRecord } from '../db/TrackRepository';
import { logEvent } from '../telemetry/logger';

export interface PlaybackViewState {
  state: string;
  currentTrack: TrackRecord | null;
  isPlaying: boolean;
  positionSec: number;
  durationSec: number | null;
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
  queueLength: number;
}

const CHECKPOINT_INTERVAL_MS = 5000;

class PlaybackController {
  private adapter = new ExpoAudioAdapter();
  private machine = new PlaybackStateMachine();
  private queueRepo: QueueRepository | null = null;
  private trackRepo: TrackRepository | null = null;
  private listeners = new Set<() => void>();
  private operationId = 0;
  private activeOperationId = 0;
  private currentTrack: TrackRecord | null = null;
  private lastCheckpoint = 0;
  private wasPlayingBeforeInterruption = false;

  private viewState: PlaybackViewState = {
    state: 'idle',
    currentTrack: null,
    isPlaying: false,
    positionSec: 0,
    durationSec: null,
    repeatMode: 'off',
    shuffleEnabled: false,
    queueLength: 0,
  };

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): PlaybackViewState => this.viewState;

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  private patch(p: Partial<PlaybackViewState>): void {
    this.viewState = { ...this.viewState, ...p };
    this.emit();
  }

  /** Initialize: open repos, subscribe to native status, restore session. */
  async init(): Promise<void> {
    this.queueRepo = await QueueRepository.create();
    this.trackRepo = await TrackRepository.create();

    this.adapter.onStatus((status) => this.handleNativeStatus(status));
    this.adapter.onError((error, context) => {
      logEvent('play_failed', {
        layer: 'native_player',
        operation: context,
        errorCode: 'NATIVE_ERROR',
        errorMessage: error.message,
      });
      this.machine.transition('play_failed');
      this.patch({ state: this.machine.current, isPlaying: false });
    });

    await this.restoreSession();
  }

  private async restoreSession(): Promise<void> {
    if (!this.queueRepo || !this.trackRepo) return;
    const session = await this.queueRepo.getSession();
    const entries = await this.queueRepo.listEntries();

    this.patch({
      repeatMode: session.repeatMode,
      shuffleEnabled: session.shuffleEnabled,
      queueLength: entries.length,
    });

    if (session.currentEntryId) {
      const entry = entries.find((e) => e.id === session.currentEntryId);
      if (entry) {
        const track = await this.trackRepo.getById(entry.trackId);
        if (track) {
          this.currentTrack = track;
          this.patch({
            currentTrack: track,
            positionSec: session.positionMs / 1000,
            durationSec: track.durationSec,
            state: 'paused',
          });
          // Load but do not autoplay on cold start.
          await this.loadTrack(track, false, session.positionMs / 1000);
        }
      }
    }

    logEvent('queue_hydrated', {
      queueLength: entries.length,
      hasCurrentTrack: !!this.currentTrack,
    });
  }

  private handleNativeStatus(status: NativeStatus): void {
    const opId = this.activeOperationId;

    if (status.didJustFinish) {
      logEvent('playback_finished', {
        trackId: this.currentTrack?.id,
        positionSec: status.positionSec,
      });
      void this.handleTrackEnded();
      return;
    }

    // Throttled position checkpoint.
    const now = Date.now();
    if (status.isPlaying && now - this.lastCheckpoint > CHECKPOINT_INTERVAL_MS) {
      this.lastCheckpoint = now;
      void this.checkpointPosition(status.positionSec);
    }

    this.patch({
      isPlaying: status.isPlaying,
      positionSec: status.positionSec,
      durationSec: status.durationSec ?? this.viewState.durationSec,
      state: this.machine.current,
    });
  }

  private async checkpointPosition(positionSec: number): Promise<void> {
    if (!this.queueRepo) return;
    try {
      await this.queueRepo.updateSession({ positionMs: Math.floor(positionSec * 1000) });
      logEvent('playback_checkpoint_saved', { positionSec });
    } catch (e) {
      logEvent('playback_checkpoint_failed', {
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private nextOperationId(): number {
    this.operationId += 1;
    this.activeOperationId = this.operationId;
    return this.operationId;
  }

  private isStale(opId: number): boolean {
    return opId !== this.activeOperationId;
  }

  async loadTrack(track: TrackRecord, autoplay: boolean, startPositionSec = 0): Promise<void> {
    const opId = this.nextOperationId();
    logEvent('track_load_requested', { trackId: track.id, autoplay });

    if (!this.machine.transition('load')) {
      logEvent('track_load_failed', {
        trackId: track.id,
        errorCode: 'INVALID_STATE',
        errorMessage: `Cannot load in state ${this.machine.current}`,
      });
      return;
    }
    this.patch({ state: this.machine.current });

    const source = await resolveSource(track);
    if (this.isStale(opId)) return; // superseded

    if (source.kind === 'missing' || !source.uri) {
      logEvent('track_load_failed', {
        trackId: track.id,
        layer: 'source_resolver',
        errorCode: source.failureReason ?? 'file_missing',
      });
      this.machine.transition('load_failed');
      this.patch({ state: this.machine.current });
      return;
    }

    this.machine.transition('load_succeeded');
    this.patch({ state: this.machine.current });

    try {
      await this.adapter.load(source.uri);
      if (this.isStale(opId)) {
        this.adapter.dispose();
        return;
      }
      this.machine.transition('load_succeeded');
      this.currentTrack = track;
      this.patch({
        currentTrack: track,
        durationSec: track.durationSec,
        positionSec: startPositionSec,
        state: this.machine.current,
      });

      if (startPositionSec > 0) {
        this.adapter.seekTo(startPositionSec);
      }

      // Update session with new current track.
      if (this.queueRepo) {
        const entries = await this.queueRepo.listEntries();
        const entry = entries.find((e) => e.trackId === track.id);
        if (entry) {
          await this.queueRepo.updateSession({
            currentEntryId: entry.id,
            positionMs: Math.floor(startPositionSec * 1000),
            desiredState: autoplay ? 'playing' : 'paused',
          });
        }
      }

      logEvent('track_load_success', { trackId: track.id });

      if (autoplay) {
        await this.play();
      }
    } catch (e) {
      if (this.isStale(opId)) return;
      logEvent('track_load_failed', {
        trackId: track.id,
        layer: 'native_player',
        errorCode: 'LOAD_FAILED',
        errorMessage: e instanceof Error ? e.message : String(e),
      });
      this.machine.transition('load_failed');
      this.patch({ state: this.machine.current });
    }
  }

  async play(): Promise<void> {
    logEvent('play_requested', { trackId: this.currentTrack?.id });
    if (!this.machine.transition('play')) return;
    this.adapter.play();
    // Native status will confirm; optimistically update for responsiveness.
    this.patch({ state: this.machine.current, isPlaying: true });
    if (this.queueRepo) {
      await this.queueRepo.updateSession({ desiredState: 'playing' });
    }
  }

  async pause(): Promise<void> {
    if (!this.machine.transition('pause')) return;
    this.adapter.pause();
    this.patch({ state: this.machine.current, isPlaying: false });
    if (this.queueRepo) {
      await this.queueRepo.updateSession({
        desiredState: 'paused',
        positionMs: Math.floor(this.viewState.positionSec * 1000),
      });
    }
    logEvent('playback_paused', {
      trackId: this.currentTrack?.id,
      positionSec: this.viewState.positionSec,
    });
  }

  async toggle(): Promise<void> {
    if (this.viewState.isPlaying) {
      await this.pause();
    } else {
      await this.play();
    }
  }

  async seekTo(seconds: number): Promise<void> {
    logEvent('seek_requested', {
      trackId: this.currentTrack?.id,
      positionSec: seconds,
    });
    if (!this.machine.transition('seek')) return;
    this.adapter.seekTo(seconds);
    this.patch({ positionSec: seconds });
    logEvent('seek_completed', { trackId: this.currentTrack?.id, positionSec: seconds });
  }

  async next(): Promise<void> {
    if (!this.queueRepo || !this.trackRepo) return;
    if (!this.machine.transition('next')) return;

    const session = await this.queueRepo.getSession();
    const entries = await this.queueRepo.listEntries();
    if (entries.length === 0) return;

    const ordered = session.shuffleEnabled
      ? [...entries].sort((a, b) => (a.shufflePosition ?? 0) - (b.shufflePosition ?? 0))
      : entries;

    const currentIdx = ordered.findIndex((e) => e.id === session.currentEntryId);
    let nextEntry = null;

    if (session.repeatMode === 'track' && this.currentTrack) {
      // Repeat-one on natural end replays; explicit next goes to next track.
      // For explicit next, follow normal progression.
    }

    if (currentIdx >= 0 && currentIdx < ordered.length - 1) {
      nextEntry = ordered[currentIdx + 1];
    } else if (session.repeatMode === 'queue' && ordered.length > 0) {
      nextEntry = ordered[0];
    }

    if (!nextEntry) {
      // End of queue with repeat off: stop.
      this.machine.transition('stop');
      this.adapter.dispose();
      this.patch({ state: 'idle', isPlaying: false, currentTrack: null });
      return;
    }

    const track = await this.trackRepo.getById(nextEntry.trackId);
    if (!track) {
      logEvent('track_load_failed', {
        trackId: nextEntry.trackId,
        errorCode: 'TRACK_NOT_FOUND',
      });
      return;
    }

    const wasPlaying = this.viewState.isPlaying;
    await this.loadTrack(track, wasPlaying);
  }

  async prev(): Promise<void> {
    if (!this.queueRepo || !this.trackRepo) return;
    // If more than 3 seconds in, restart the track.
    if (this.viewState.positionSec > 3) {
      await this.seekTo(0);
      return;
    }
    if (!this.machine.transition('prev')) return;

    const session = await this.queueRepo.getSession();
    const entries = await this.queueRepo.listEntries();
    if (entries.length === 0) return;

    const ordered = session.shuffleEnabled
      ? [...entries].sort((a, b) => (a.shufflePosition ?? 0) - (b.shufflePosition ?? 0))
      : entries;

    const currentIdx = ordered.findIndex((e) => e.id === session.currentEntryId);
    if (currentIdx <= 0) {
      await this.seekTo(0);
      return;
    }

    const prevEntry = ordered[currentIdx - 1];
    const track = await this.trackRepo.getById(prevEntry.trackId);
    if (!track) return;

    const wasPlaying = this.viewState.isPlaying;
    await this.loadTrack(track, wasPlaying);
  }

  private async handleTrackEnded(): Promise<void> {
    if (!this.queueRepo) return;
    const session = await this.queueRepo.getSession();

    if (session.repeatMode === 'track' && this.currentTrack) {
      // Replay the same track.
      await this.loadTrack(this.currentTrack, true);
      return;
    }

    // Normal progression (handles repeat-queue in next()).
    const wasPlaying = true; // natural completion implies was playing
    this.patch({ isPlaying: wasPlaying });
    await this.next();
  }

  /** Play a list of tracks from a starting index. Replaces the queue. */
  async playTracks(tracks: TrackRecord[], startIndex = 0): Promise<void> {
    if (!this.queueRepo || tracks.length === 0) return;
    const entries = await this.queueRepo.setQueue(tracks.map((t) => t.id));
    this.patch({ queueLength: entries.length });

    const startEntry = entries[Math.max(0, Math.min(startIndex, entries.length - 1))];
    const track = tracks.find((t) => t.id === startEntry.trackId);
    if (!track) return;

    await this.queueRepo.updateSession({ currentEntryId: startEntry.id });
    await this.loadTrack(track, true);
  }

  /** Get the current queue as track records in effective (shuffle-aware) order. */
  async getQueueTracks(): Promise<TrackRecord[]> {
    if (!this.queueRepo || !this.trackRepo) return [];
    const session = await this.queueRepo.getSession();
    const entries = await this.queueRepo.listEntries();
    const ordered = session.shuffleEnabled
      ? [...entries].sort((a, b) => (a.shufflePosition ?? 0) - (b.shufflePosition ?? 0))
      : entries;
    const tracks: TrackRecord[] = [];
    for (const e of ordered) {
      const t = await this.trackRepo.getById(e.trackId);
      if (t) tracks.push(t);
    }
    return tracks;
  }

  /** Get the index of the current track in the effective queue order. */
  async getCurrentQueueIndex(): Promise<number> {
    if (!this.queueRepo) return -1;
    const session = await this.queueRepo.getSession();
    const entries = await this.queueRepo.listEntries();
    const ordered = session.shuffleEnabled
      ? [...entries].sort((a, b) => (a.shufflePosition ?? 0) - (b.shufflePosition ?? 0))
      : entries;
    return ordered.findIndex((e) => e.id === session.currentEntryId);
  }

  async setRepeatMode(mode: RepeatMode): Promise<void> {
    if (!this.queueRepo) return;
    await this.queueRepo.updateSession({ repeatMode: mode });
    this.patch({ repeatMode: mode });
  }

  async toggleShuffle(): Promise<void> {
    if (!this.queueRepo) return;
    const session = await this.queueRepo.getSession();
    if (session.shuffleEnabled) {
      await this.queueRepo.clearShuffle();
      this.patch({ shuffleEnabled: false });
    } else {
      await this.queueRepo.applyShuffle(session.currentEntryId);
      this.patch({ shuffleEnabled: true });
    }
  }

  /** Handle audio interruption (phone call, etc.). */
  async handleInterruptionBegin(): Promise<void> {
    this.wasPlayingBeforeInterruption = this.viewState.isPlaying;
    if (this.machine.transition('interrupt_begin')) {
      this.adapter.pause();
      this.patch({ state: 'interrupted', isPlaying: false });
      await this.checkpointPosition(this.viewState.positionSec);
      logEvent('playback_interrupted', {
        trackId: this.currentTrack?.id,
        wasPlaying: this.wasPlayingBeforeInterruption,
      });
    }
  }

  async handleInterruptionEnd(shouldResume: boolean): Promise<void> {
    if (this.machine.current !== 'interrupted') return;
    this.machine.transition('interrupt_end');
    this.patch({ state: 'paused' });
    logEvent('playback_resumed', {
      trackId: this.currentTrack?.id,
      autoResumed: shouldResume && this.wasPlayingBeforeInterruption,
    });
    // Only auto-resume if the OS indicates it's appropriate AND we were playing.
    if (shouldResume && this.wasPlayingBeforeInterruption) {
      await this.play();
    }
  }
}

export const playbackController = new PlaybackController();

export function usePlayback(): PlaybackViewState {
  return useSyncExternalStore(
    playbackController.subscribe,
    playbackController.getSnapshot,
    playbackController.getSnapshot
  );
}
