import { useSyncExternalStore } from 'react';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import type { Track } from './library';
import { resolveTrackUri } from './library';

export interface PlayerSnapshot {
  track: Track | null;
  queue: Track[];
  index: number;
  isPlaying: boolean;
  isLoaded: boolean;
  positionSec: number;
  durationSec: number | null;
  shuffle: boolean;
  version: number;
}

const emptySnapshot: PlayerSnapshot = {
  track: null,
  queue: [],
  index: -1,
  isPlaying: false,
  isLoaded: false,
  positionSec: 0,
  durationSec: null,
  shuffle: false,
  version: 0,
};

class PlayerStore {
  private player: AudioPlayer | null = null;
  private snapshot: PlayerSnapshot = { ...emptySnapshot };
  private listeners = new Set<() => void>();
  private loadingId: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): PlayerSnapshot => this.snapshot;

  private emit() {
    this.snapshot = { ...this.snapshot, version: this.snapshot.version + 1 };
    this.listeners.forEach((fn) => fn());
  }

  private patch(p: Partial<PlayerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...p };
    this.emit();
  }

  async init() {
    // expo-audio handles audio mode automatically; nothing to configure.
  }

  private startPolling() {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      if (!this.player) return;
      try {
        const positionSec = this.player.currentTime ?? 0;
        const durationSec = this.player.duration ?? this.snapshot.durationSec;
        const isPlaying = !!this.player.playing;
        const isLoaded = this.player.isLoaded ?? true;
        if (
          positionSec !== this.snapshot.positionSec ||
          durationSec !== this.snapshot.durationSec ||
          isPlaying !== this.snapshot.isPlaying ||
          isLoaded !== this.snapshot.isLoaded
        ) {
          this.patch({ positionSec, durationSec, isPlaying, isLoaded });
        }
        // Detect end of track: playing stopped at duration.
        if (
          isLoaded &&
          durationSec != null &&
          durationSec > 0 &&
          positionSec >= durationSec - 0.3 &&
          !isPlaying &&
          this.snapshot.isPlaying
        ) {
          void this.next();
        }
      } catch {
        // player was removed; ignore
      }
    }, 500);
  }

  private stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async unload() {
    this.stopPolling();
    if (this.player) {
      try {
        this.player.remove();
      } catch {
        // already removed
      }
      this.player = null;
    }
  }

  async playTracks(tracks: Track[], startIndex = 0) {
    if (tracks.length === 0) return;
    const index = Math.max(0, Math.min(startIndex, tracks.length - 1));
    this.patch({ queue: tracks, index });
    await this.loadCurrent(true);
  }

  private async loadCurrent(autoplay: boolean) {
    const { queue, index } = this.snapshot;
    const track = queue[index] ?? null;
    if (!track) {
      await this.unload();
      this.patch({ track: null, isPlaying: false, isLoaded: false, positionSec: 0, durationSec: null });
      return;
    }
    const loadId = track.id;
    this.loadingId = loadId;
    await this.unload();
    this.patch({
      track,
      isLoaded: false,
      isPlaying: false,
      positionSec: 0,
      durationSec: track.durationSec,
    });
    try {
      const uri = resolveTrackUri(track);
      if (!uri) {
        this.patch({ isLoaded: false, isPlaying: false });
        return;
      }
      const player = createAudioPlayer(uri);
      if (this.loadingId !== loadId) {
        // a newer load started while we were creating; drop this one
        try {
          player.remove();
        } catch {
          // ignore
        }
        return;
      }
      this.player = player;
      this.startPolling();
      this.patch({ isLoaded: true });
      if (autoplay) {
        player.play();
        this.patch({ isPlaying: true });
      }
    } catch {
      this.patch({ isLoaded: false, isPlaying: false });
    }
  }

  async toggle() {
    if (!this.player) {
      if (this.snapshot.track) await this.loadCurrent(true);
      return;
    }
    if (this.snapshot.isPlaying) {
      this.player.pause();
      this.patch({ isPlaying: false });
    } else {
      this.player.play();
      this.patch({ isPlaying: true });
    }
  }

  async play() {
    if (this.player && !this.snapshot.isPlaying) {
      this.player.play();
      this.patch({ isPlaying: true });
    } else if (!this.player && this.snapshot.track) {
      await this.loadCurrent(true);
    }
  }

  async pause() {
    if (this.player && this.snapshot.isPlaying) {
      this.player.pause();
      this.patch({ isPlaying: false });
    }
  }

  async next() {
    const { queue, index, shuffle } = this.snapshot;
    if (queue.length === 0) return;
    let nextIndex: number;
    if (shuffle && queue.length > 1) {
      do {
        nextIndex = Math.floor(Math.random() * queue.length);
      } while (nextIndex === index);
    } else {
      nextIndex = (index + 1) % queue.length;
    }
    this.patch({ index: nextIndex });
    await this.loadCurrent(true);
  }

  async prev() {
    const { queue, index } = this.snapshot;
    if (queue.length === 0) return;
    // if more than 3 seconds in, restart the track instead
    if (this.snapshot.positionSec > 3) {
      await this.seekTo(0);
      return;
    }
    const prevIndex = (index - 1 + queue.length) % queue.length;
    this.patch({ index: prevIndex });
    await this.loadCurrent(true);
  }

  async seekTo(seconds: number) {
    if (this.player && this.snapshot.isLoaded) {
      try {
        this.player.seekTo(Math.max(0, seconds));
      } catch {
        // seek failed; ignore
      }
    }
  }

  toggleShuffle() {
    this.patch({ shuffle: !this.snapshot.shuffle });
  }
}

export const player = new PlayerStore();

export function usePlayer(): PlayerSnapshot {
  return useSyncExternalStore(player.subscribe, player.getSnapshot, player.getSnapshot);
}
