import {
  base64ToBytes,
  bytesToBase64,
  CHUNK_SAMPLES,
  downsample,
  floatToPcm16,
  IN_RATE,
  liveUrl,
  OUT_RATE,
  pcm16ToFloat,
} from '@/data/live';

/**
 * A live voice call with The System, in the browser.
 *
 * The microphone streams to Gemini Live as 16 kHz PCM in 100 ms chunks; The
 * System's voice comes back as 24 kHz PCM and is queued for gapless
 * playback. When the Player talks over it, Gemini says so and the queue is
 * dropped at once, so it really stops. Tool calls (The System changing the
 * app) are handed to the caller, who checks and applies them and says what
 * happened.
 *
 * Web only: it needs getUserMedia, Web Audio and a raw WebSocket, none of
 * which Expo Go offers for live audio.
 */

export type LiveState = 'connecting' | 'listening' | 'speaking' | 'ended';

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LiveHandlers {
  onState: (state: LiveState) => void;
  onUserText: (text: string) => void;
  onModelText: (text: string) => void;
  /** The System finished its turn, or was interrupted. */
  onTurnEnd: () => void;
  /** Apply what The System asked for; the result goes back to it. */
  onToolCall: (call: ToolCall) => Promise<Record<string, unknown>>;
  /** The call is over. `error` is set when it ended badly. */
  onEnd: (error?: string) => void;
}

export interface LiveCall {
  end: () => void;
}

export function liveSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof WebSocket !== 'undefined' &&
    typeof AudioContext !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

/** Copies each block of microphone samples out of the audio thread. */
const CAPTURE_WORKLET = `
class Capture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('system-capture', Capture);
`;

export async function startLiveCall(
  token: string,
  model: string,
  handlers: LiveHandlers,
  /** What tells The System the call has opened, and why. */
  opening = '(The Player just opened a live voice call.)',
): Promise<LiveCall> {
  let ended = false;
  let ws: WebSocket | null = null;
  let stream: MediaStream | null = null;
  let micCtx: AudioContext | null = null;
  let playCtx: AudioContext | null = null;
  let node: AudioWorkletNode | null = null;
  const playing = new Set<AudioBufferSourceNode>();
  let playAt = 0;
  let pending = new Float32Array(0);

  const finish = (error?: string) => {
    if (ended) return;
    ended = true;
    node?.port.close();
    node?.disconnect();
    stream?.getTracks().forEach((t) => t.stop());
    stopPlayback();
    void micCtx?.close().catch(() => {});
    void playCtx?.close().catch(() => {});
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000);
    handlers.onState('ended');
    handlers.onEnd(error);
  };

  function stopPlayback() {
    for (const source of playing) {
      try {
        source.stop();
      } catch {
        // Already finished.
      }
    }
    playing.clear();
    playAt = 0;
  }

  function play(b64: string) {
    if (!playCtx || ended) return;
    const samples = pcm16ToFloat(base64ToBytes(b64));
    if (samples.length === 0) return;
    const buffer = playCtx.createBuffer(1, samples.length, OUT_RATE);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const source = playCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(playCtx.destination);
    // Back to back, so the chunks join into one unbroken voice.
    playAt = Math.max(playAt, playCtx.currentTime + 0.02);
    source.start(playAt);
    playAt += buffer.duration;
    playing.add(source);
    handlers.onState('speaking');
    source.onended = () => {
      playing.delete(source);
      if (playing.size === 0 && !ended) handlers.onState('listening');
    };
  }

  function send(message: unknown) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  function sendAudio(samples: Float32Array, rate: number) {
    const at16k = downsample(samples, rate, IN_RATE);
    const joined = new Float32Array(pending.length + at16k.length);
    joined.set(pending);
    joined.set(at16k, pending.length);
    let offset = 0;
    while (joined.length - offset >= CHUNK_SAMPLES) {
      const chunk = joined.subarray(offset, offset + CHUNK_SAMPLES);
      send({ realtimeInput: { audio: { data: bytesToBase64(floatToPcm16(chunk)), mimeType: `audio/pcm;rate=${IN_RATE}` } } });
      offset += CHUNK_SAMPLES;
    }
    pending = joined.slice(offset);
  }

  async function startMicrophone() {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    // Ask for 16 kHz so the browser resamples; Firefox refuses to mix a
    // microphone with a context at another rate, so fall back to its own
    // rate and resample in code.
    try {
      micCtx = new AudioContext({ sampleRate: IN_RATE });
      await attach(micCtx, stream);
    } catch {
      await micCtx?.close().catch(() => {});
      micCtx = new AudioContext();
      await attach(micCtx, stream);
    }
  }

  async function attach(ctx: AudioContext, media: MediaStream) {
    const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const source = ctx.createMediaStreamSource(media);
    node = new AudioWorkletNode(ctx, 'system-capture');
    node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
      if (!ended) sendAudio(ev.data, ctx.sampleRate);
    };
    source.connect(node);
  }

  async function onMessage(ev: MessageEvent) {
    const text = typeof ev.data === 'string' ? ev.data : await (ev.data as Blob).text();
    let msg: Record<string, any>;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }

    if (msg.setupComplete) {
      try {
        await startMicrophone();
      } catch (err) {
        const denied = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
        finish(
          denied
            ? 'The System needs the microphone for a live call. Allow it for this site, then try again.'
            : `The microphone could not start. ${err instanceof Error ? err.message : ''}`.trim(),
        );
        return;
      }
      handlers.onState('listening');
      // The System speaks first: a short greeting and the one next thing.
      send({
        clientContent: {
          turns: [{ role: 'user', parts: [{ text: opening }] }],
          turnComplete: true,
        },
      });
      return;
    }

    const content = msg.serverContent;
    if (content) {
      if (content.interrupted) {
        // The Player spoke over it: silence now, not after the queue drains.
        stopPlayback();
        handlers.onState('listening');
        handlers.onTurnEnd();
      }
      for (const part of content.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) play(part.inlineData.data);
      }
      if (content.inputTranscription?.text) handlers.onUserText(content.inputTranscription.text);
      if (content.outputTranscription?.text) handlers.onModelText(content.outputTranscription.text);
      if (content.turnComplete) handlers.onTurnEnd();
    }

    if (msg.toolCall?.functionCalls) {
      const responses = [];
      for (const call of msg.toolCall.functionCalls as { id: string; name: string; args?: Record<string, unknown> }[]) {
        let response: Record<string, unknown>;
        try {
          response = await handlers.onToolCall({ id: call.id, name: call.name, args: call.args ?? {} });
        } catch (err) {
          response = { error: err instanceof Error ? err.message : 'the change could not be applied' };
        }
        responses.push({ id: call.id, name: call.name, response });
      }
      send({ toolResponse: { functionResponses: responses } });
    }

    if (msg.goAway) {
      // Gemini ends long sessions; say so rather than going silent.
      setTimeout(() => finish('The call reached its time limit. Start a new one to keep talking.'), 1500);
    }
  }

  handlers.onState('connecting');
  playCtx = new AudioContext({ sampleRate: OUT_RATE });
  // Browsers start audio contexts suspended until a gesture; this runs from one.
  void playCtx.resume().catch(() => {});

  ws = new WebSocket(liveUrl(token));
  ws.onmessage = (ev) => void onMessage(ev);
  ws.onerror = () => finish('The live connection failed. Check your connection and try again.');
  ws.onclose = (ev) => {
    if (ended) return;
    finish(ev.code === 1000 ? undefined : `The live call closed (${ev.code}${ev.reason ? `: ${ev.reason}` : ''}).`);
  };
  // The token carries the setup (prompt, tools, voice); the model is the
  // only field needed here, and the token would override anything else.
  ws.onopen = () => send({ setup: { model: `models/${model}` } });

  return { end: () => finish() };
}
