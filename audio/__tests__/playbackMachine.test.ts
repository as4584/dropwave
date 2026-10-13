/**
 * Unit tests for the playback state machine.
 *
 * These are pure logic tests: no native modules, no SQLite, no network.
 * Run with: npx jest audio/__tests__/playbackMachine.test.ts
 * (Or integrate with your preferred test runner.)
 */
import { PlaybackStateMachine } from '../playbackMachine';

describe('PlaybackStateMachine', () => {
  let machine: PlaybackStateMachine;

  beforeEach(() => {
    machine = new PlaybackStateMachine();
  });

  test('starts in idle', () => {
    expect(machine.current).toBe('idle');
  });

  test('idle -> resolving on load', () => {
    expect(machine.transition('load')).toBe('resolving');
    expect(machine.current).toBe('resolving');
  });

  test('rejects play from idle', () => {
    expect(machine.transition('play')).toBeNull();
    expect(machine.current).toBe('idle');
  });

  test('full happy path: load -> play -> pause -> play -> next', () => {
    machine.transition('load');
    expect(machine.current).toBe('resolving');

    machine.transition('load_succeeded');
    expect(machine.current).toBe('loading');

    machine.transition('load_succeeded');
    expect(machine.current).toBe('ready');

    machine.transition('play');
    expect(machine.current).toBe('playing');

    machine.transition('pause');
    expect(machine.current).toBe('paused');

    machine.transition('play');
    expect(machine.current).toBe('playing');

    machine.transition('next');
    expect(machine.current).toBe('resolving');
  });

  test('seek valid in playing and paused, invalid in idle', () => {
    expect(machine.transition('seek')).toBeNull();

    machine.transition('load');
    machine.transition('load_succeeded');
    machine.transition('load_succeeded');
    machine.transition('play');

    expect(machine.transition('seek')).toBe('playing');

    machine.transition('pause');
    expect(machine.transition('seek')).toBe('paused');
  });

  test('interruption: playing -> interrupted -> paused', () => {
    machine.transition('load');
    machine.transition('load_succeeded');
    machine.transition('load_succeeded');
    machine.transition('play');
    expect(machine.current).toBe('playing');

    machine.transition('interrupt_begin');
    expect(machine.current).toBe('interrupted');

    // Cannot play directly from interrupted; must go through interrupt_end.
    expect(machine.transition('play')).toBeNull();

    machine.transition('interrupt_end');
    expect(machine.current).toBe('paused');
  });

  test('track ended -> ended state', () => {
    machine.transition('load');
    machine.transition('load_succeeded');
    machine.transition('load_succeeded');
    machine.transition('play');
    machine.transition('track_ended');
    expect(machine.current).toBe('ended');
  });

  test('error recovery: error -> load -> resolving', () => {
    machine.transition('load');
    machine.transition('load_failed');
    expect(machine.current).toBe('error');

    machine.transition('load');
    expect(machine.current).toBe('resolving');
  });

  test('can() reflects valid commands', () => {
    expect(machine.can('load')).toBe(true);
    expect(machine.can('play')).toBe(false);

    machine.transition('load');
    machine.transition('load_succeeded');
    machine.transition('load_succeeded');
    expect(machine.can('play')).toBe(true);
    expect(machine.can('pause')).toBe(false);
  });

  test('stop resets to idle from any state', () => {
    const states: Array<['load' | 'play' | 'pause', string]> = [
      ['load', 'resolving'],
      ['play', 'playing'],
      ['pause', 'paused'],
    ];
    // Build up to playing, then stop.
    machine.transition('load');
    machine.transition('load_succeeded');
    machine.transition('load_succeeded');
    machine.transition('play');
    expect(machine.transition('stop')).toBe('idle');
  });
});
