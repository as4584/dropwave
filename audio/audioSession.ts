/**
 * Audio session configuration for iOS-first playback.
 *
 * Based on Expo and Apple documentation:
 * - playsInSilentMode: music must play with the Ring/Silent switch on.
 * - shouldPlayInBackground: continue when backgrounded / screen locked.
 * - interruptionMode: 'doNotMix' takes exclusive focus AND is required by
 *   Expo for setActiveForLockScreen to associate correctly.
 *
 * Do NOT use 'duckOthers' here: Crate uses it, but Expo's docs state
 * setActiveForLockScreen requires 'doNotMix'.
 */
import { setAudioModeAsync } from 'expo-audio';

export interface AudioSessionConfig {
  playsInSilentMode: boolean;
  shouldPlayInBackground: boolean;
  interruptionMode: 'doNotMix' | 'duckOthers' | 'mixWithOthers';
}

export const PRODUCTION_AUDIO_SESSION: AudioSessionConfig = {
  playsInSilentMode: true,
  shouldPlayInBackground: true,
  interruptionMode: 'doNotMix',
};

let configured = false;

export async function configureAudioSession(
  config: AudioSessionConfig = PRODUCTION_AUDIO_SESSION
): Promise<void> {
  // Try the full production configuration first.
  try {
    await setAudioModeAsync({
      playsInSilentMode: config.playsInSilentMode,
      shouldPlayInBackground: config.shouldPlayInBackground,
      interruptionMode: config.interruptionMode,
      shouldRouteThroughEarpiece: false,
      allowsRecording: false,
    });
    configured = true;
    return;
  } catch (e) {
    console.warn('[audio] Full audio session config failed, trying minimal:', e);
  }

  // Fallback: minimal configuration (just silent mode).
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'mixWithOthers',
    } as any);
    configured = true;
    return;
  } catch (e) {
    console.warn('[audio] Minimal audio session config failed, continuing without:', e);
  }

  // Last resort: continue without explicit configuration (like the old code).
  // expo-audio may handle it automatically.
  configured = false;
}

export function isAudioSessionConfigured(): boolean {
  return configured;
}

/** For tests: reset the configured flag. */
export function __resetForTests(): void {
  configured = false;
}
