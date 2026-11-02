import {
  base64ToBytes,
  bytesToBase64,
  CHUNK_SAMPLES,
  downsample,
  durationMs,
  floatToPcm16,
  IN_RATE,
  liveUrl,
  MAX_BACKLOG,
  OUT_RATE,
  pcm16ToFloat,
  setupMessage,
  type LiveSession,
} from '@/data/live';

/**
 * How many times in a row a lost connection is tried again before the call
 * gives up, and how much longer each wait is: about 15 s in all, which rides
 * out a Wi-Fi handover. A session stays resumable for far longer than that.
 */
const REJOIN_TRIES = 5;
const REJOIN_STEP_MS = 1_500;
/** Move this long before Gemini cuts a connection it warned about. */
const CUT_MARGIN_MS = 2_000;

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
 * Gemini ends each connection after about ten minutes, so a long call is
 * several connections, each resuming the session from the last handle Gemini
 * gave. The Player should not notice: the microphone, the playback queue and
 * the transcript all carry straight on.
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
  { token, model, maxMs }: LiveSession,
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
  /** The latest point this session can be resumed from. */
  let handle: string | null = null;
  /** The first connection is up: the microphone is on and the greeting went out. */
  let started = false;
  /** This connection finished its setup, so it can take audio. */
  let ready = false;
  /** Mid-exchange: the Player is talking or The System is answering. */
  let busy = false;
  /** Gemini warned this connection is ending; move at the next quiet moment. */
  let leaving = false;
  let tries = 0;
  let backlog: unknown[] = [];
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let limitTimer: ReturnType<typeof setTimeout> | undefined;

  const finish = (error?: string) => {
    if (ended) return;
    ended = true;
    clearTimeout(leaveTimer);
    clearTimeout(retryTimer);
    clearTimeout(limitTimer);
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
      const message = { realtimeInput: { audio: { data: bytesToBase64(floatToPcm16(chunk)), mimeType: `audio/pcm;rate=${IN_RATE}` } } };
      if (ready) send(message);
      // Between two connections: held, so words said in the gap still arrive.
      else backlog = [...backlog.slice(1 - MAX_BACKLOG), message];
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

  /** One connection of the call. A replaced connection has nothing left to say. */
  function connect() {
    leaving = false;
    ready = false;
    busy = false;
    clearTimeout(leaveTimer);
    let failed = false;
    const socket = new WebSocket(liveUrl(token));
    ws = socket;
    socket.onmessage = (ev) => void onMessage(ev, socket);
    socket.onerror = () => {
      failed = true;
    };
    socket.onclose = (ev) => {
      if (ended || socket !== ws) return;
      ready = false;
      // With a handle there is a session to go back to, so a lost connection
      // need not end the call.
      if (handle && tries < REJOIN_TRIES) {
        retryTimer = setTimeout(connect, tries++ * REJOIN_STEP_MS);
      } else if (handle) {
        finish('The live call dropped and could not reconnect. Start a new one to keep talking.');
      } else if (failed) {
        finish('The live connection failed. Check your connection and try again.');
      } else {
        finish(ev.code === 1000 ? undefined : `The live call closed (${ev.code}${ev.reason ? `: ${ev.reason}` : ''}).`);
      }
    };
    socket.onopen = () => socket.send(JSON.stringify(setupMessage(model, handle)));
  }

  /** Leave a connection Gemini is about to end, for a new one on the same session. */
  function moveOn() {
    if (ended) return;
    if (!handle) {
      finish('The call reached its time limit. Start a new one to keep talking.');
      return;
    }
    const old = ws;
    connect();
    old?.close(1000);
  }

  async function onMessage(ev: MessageEvent, socket: WebSocket) {
    const text = typeof ev.data === 'string' ? ev.data : await (ev.data as Blob).text();
    if (socket !== ws) return;
    let msg: Record<string, any>;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }

    if (msg.setupComplete) {
      ready = true;
      tries = 0;
      // A resumed session: nothing to start, just catch up on the gap.
      if (started) {
        for (const message of backlog) send(message);
        backlog = [];
        return;
      }
      started = true;
      limitTimer = setTimeout(() => finish('The call reached its time limit. Start a new one to keep talking.'), maxMs);
      try {
        await startMicrophone();
      } catch (err) {
        const denied = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
        finish(
          denied
            ? 'Beerus needs the microphone for a live call. Allow it for this site, then try again.'
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

    if (msg.voiceActivity?.type === 'ACTIVITY_START') busy = true;

    const content = msg.serverContent;
    if (content) {
      if (content.modelTurn) busy = true;
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
      if (content.turnComplete) {
        busy = false;
        handlers.onTurnEnd();
        if (leaving) moveOn();
      }
    }

    if (msg.toolCall?.functionCalls) {
      busy = true;
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
      // A session resumed mid-tool came from before this call and never made it.
      if (socket === ws) send({ toolResponse: { functionResponses: responses } });
    }

    const update = msg.sessionResumptionUpdate;
    if (update?.resumable && update.newHandle) handle = update.newHandle;

    if (msg.goAway) {
      // Gemini ends connections, not the call. Move between exchanges, so
      // nothing is cut off, or just before the line goes if none comes.
      leaving = true;
      leaveTimer = setTimeout(moveOn, Math.max(0, (durationMs(msg.goAway.timeLeft) ?? 0) - CUT_MARGIN_MS));
      if (!busy) moveOn();
    }
  }

  handlers.onState('connecting');
  playCtx = new AudioContext({ sampleRate: OUT_RATE });
  // Browsers start audio contexts suspended until a gesture; this runs from one.
  void playCtx.resume().catch(() => {});

  connect();

  return { end: () => finish() };
}
