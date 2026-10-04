// Short synthesized board sounds (Web Audio), so the package ships no audio files.

export type SoundKind = "move" | "capture" | "check" | "illegal" | "end";

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** A wooden "clack": a short filtered noise burst. */
function clack(a: AudioContext, gain: number, freq: number) {
  const len = Math.floor(a.sampleRate * 0.05);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = 1.2;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(a.destination);
  src.start();
}

function tone(a: AudioContext, freq: number, start: number, dur: number, gain = 0.12, type: OscillatorType = "sine") {
  const osc = a.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = a.createGain();
  const t = a.currentTime + start;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Play a board sound. Does nothing where Web Audio is unavailable. */
export function playSound(kind: SoundKind): void {
  const a = audio();
  if (!a) return;
  switch (kind) {
    case "move":
      clack(a, 0.9, 1800);
      break;
    case "capture":
      clack(a, 1.4, 1100);
      clack(a, 0.6, 2600);
      break;
    case "check":
      clack(a, 0.9, 1800);
      tone(a, 880, 0.03, 0.12);
      tone(a, 1175, 0.13, 0.16);
      break;
    case "illegal":
      tone(a, 150, 0, 0.14, 0.1, "square");
      break;
    case "end":
      tone(a, 523, 0, 0.5);
      tone(a, 659, 0.08, 0.5);
      tone(a, 784, 0.16, 0.6);
      break;
  }
}
