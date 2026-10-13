/**
 * Playback state machine: explicit states and valid transitions.
 *
 * The UI never guesses. Commands go through the controller, which uses this
 * machine to reject invalid operations (e.g. pause when idle).
 */
export type PlaybackState =
  | 'idle'
  | 'resolving'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'interrupted'
  | 'ended'
  | 'error';

export type PlaybackCommand =
  | 'load'
  | 'play'
  | 'pause'
  | 'toggle'
  | 'seek'
  | 'next'
  | 'prev'
  | 'stop'
  | 'interrupt_begin'
  | 'interrupt_end'
  | 'track_ended'
  | 'load_failed'
  | 'load_succeeded'
  | 'play_failed';

const TRANSITIONS: Record<PlaybackState, Partial<Record<PlaybackCommand, PlaybackState>>> = {
  idle: {
    load: 'resolving',
  },
  resolving: {
    load: 'resolving', // superseded load restarts resolution
    load_succeeded: 'loading',
    load_failed: 'error',
    stop: 'idle',
  },
  loading: {
    load: 'resolving',
    load_succeeded: 'ready',
    load_failed: 'error',
    stop: 'idle',
  },
  ready: {
    load: 'resolving',
    play: 'playing',
    toggle: 'playing',
    stop: 'idle',
  },
  playing: {
    load: 'resolving',
    pause: 'paused',
    toggle: 'paused',
    seek: 'playing',
    next: 'resolving',
    prev: 'resolving',
    track_ended: 'ended',
    interrupt_begin: 'interrupted',
    play_failed: 'error',
    stop: 'idle',
  },
  paused: {
    load: 'resolving',
    play: 'playing',
    toggle: 'playing',
    seek: 'paused',
    next: 'resolving',
    prev: 'resolving',
    stop: 'idle',
  },
  buffering: {
    load: 'resolving',
    load_succeeded: 'playing',
    load_failed: 'error',
    pause: 'paused',
    stop: 'idle',
  },
  interrupted: {
    interrupt_end: 'paused', // resume only via explicit play
    load: 'resolving',
    stop: 'idle',
  },
  ended: {
    load: 'resolving',
    play: 'playing', // repeat-one: replay
    next: 'resolving',
    stop: 'idle',
  },
  error: {
    load: 'resolving',
    stop: 'idle',
  },
};

export class PlaybackStateMachine {
  private state: PlaybackState = 'idle';

  get current(): PlaybackState {
    return this.state;
  }

  /** Returns the next state if the command is valid, or null if rejected. */
  transition(command: PlaybackCommand): PlaybackState | null {
    const next = TRANSITIONS[this.state][command];
    if (!next) return null;
    this.state = next;
    return next;
  }

  /** Force a state (for recovery paths). Use sparingly. */
  force(state: PlaybackState): void {
    this.state = state;
  }

  reset(): void {
    this.state = 'idle';
  }

  can(command: PlaybackCommand): boolean {
    return TRANSITIONS[this.state][command] !== undefined;
  }
}
