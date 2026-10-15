import { File } from 'expo-file-system';
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';

/**
 * Talking to The System: turning a finished recording into something the
 * server can hear, and reading replies aloud.
 *
 * Push-to-talk, not a live stream — the clip goes up whole, Gemini hears
 * and answers it in one call, and the reply is spoken with the device's own
 * voice. Works in Expo Go and in the browser.
 */

export interface VoiceClip {
  mimeType: string;
  data: string;
}

/** Gemini's names for what each platform's recorder produces. */
function mimeFor(uri: string, fallback: string): string {
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'm4a':
    case 'mp4':
      return 'audio/m4a';
    case 'aac':
      return 'audio/aac';
    case 'wav':
      return 'audio/wav';
    case 'webm':
      return 'audio/webm';
    case 'ogg':
      return 'audio/ogg';
    case 'mp3':
      return 'audio/mp3';
    default:
      return fallback;
  }
}

/**
 * Read a finished recording as base64, then delete it — a voice note has
 * no business sitting in the cache once it has been heard.
 *
 * On the web the recorder hands back a blob: URL, so it is read through
 * fetch; on a phone it is a file, read with expo-file-system.
 */
export async function readClip(uri: string): Promise<VoiceClip> {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('could not read the recording'));
      reader.readAsDataURL(blob);
    });
    const comma = dataUrl.indexOf(',');
    return {
      // "audio/webm;codecs=opus" → "audio/webm": the codec suffix is not a type Gemini lists.
      mimeType: (blob.type || 'audio/webm').split(';')[0],
      data: dataUrl.slice(comma + 1),
    };
  }

  const file = new File(uri);
  const data = await file.base64();
  try {
    file.delete();
  } catch {
    // The cache is cleared by the system eventually; failing here is harmless.
  }
  return { mimeType: mimeFor(uri, 'audio/m4a'), data };
}

/**
 * Read a reply aloud. Anything already being said is cut off first, so a
 * new answer never queues behind an old one.
 */
export function speak(text: string, onDone?: () => void): void {
  const clean = text
    .replace(/[→←↑↓◆◇✓✗•]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return;
  void Speech.stop().finally(() => {
    Speech.speak(clean.slice(0, Speech.maxSpeechInputLength ?? 4000), {
      rate: 1.0,
      pitch: 0.95,
      onDone,
      onStopped: onDone,
      onError: () => onDone?.(),
    });
  });
}

export function stopSpeaking(): void {
  void Speech.stop().catch(() => {});
}
