type SoundName = "noteAdd" | "notePull" | "noteDiscard" | "noteReturn" | "userJoin" | "userLeave";

type SoundPack = Partial<Record<SoundName, string>>;

// Procedural sound definitions: frequency, duration, type, volume envelope
interface ToneParams {
  freq: number;
  duration: number;
  type: OscillatorType;
  ramp?: number;
}

const PROCEDURAL_SOUNDS: Record<SoundName, ToneParams> = {
  noteAdd: { freq: 520, duration: 0.15, type: "sine", ramp: 800 },
  notePull: { freq: 440, duration: 0.25, type: "triangle", ramp: 300 },
  noteDiscard: { freq: 200, duration: 0.2, type: "sawtooth" },
  noteReturn: { freq: 600, duration: 0.12, type: "sine", ramp: 400 },
  userJoin: { freq: 880, duration: 0.1, type: "sine", ramp: 1200 },
  userLeave: { freq: 330, duration: 0.15, type: "sine", ramp: 200 },
};

class SoundManager {
  private enabled = true;
  private volume = 0.5;
  private customPack: SoundPack = {};
  private audioCache = new Map<string, HTMLAudioElement>();
  private audioCtx: AudioContext | null = null;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  getVolume(): number {
    return this.volume;
  }

  setCustomPack(pack: SoundPack): void {
    this.customPack = pack;
    this.audioCache.clear();
  }

  clearCustomPack(): void {
    this.customPack = {};
    this.audioCache.clear();
  }

  play(sound: SoundName): void {
    if (!this.enabled) return;

    // Try custom sound URL first
    const url = this.customPack[sound];
    if (url) {
      this.playUrl(url);
      return;
    }

    // Fall back to procedural sound
    this.playProcedural(sound);
  }

  private playUrl(url: string): void {
    try {
      let audio = this.audioCache.get(url);
      if (!audio) {
        audio = new Audio(url);
        this.audioCache.set(url, audio);
      }
      audio.volume = this.volume;
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } catch {
      // Audio not available
    }
  }

  private playProcedural(sound: SoundName): void {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new AudioContext();
      }
      const ctx = this.audioCtx;
      const params = PROCEDURAL_SOUNDS[sound];

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = params.type;
      osc.frequency.setValueAtTime(params.freq, ctx.currentTime);
      if (params.ramp) {
        osc.frequency.exponentialRampToValueAtTime(params.ramp, ctx.currentTime + params.duration);
      }

      gain.gain.setValueAtTime(this.volume * 0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + params.duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + params.duration);
    } catch {
      // Web Audio not available
    }
  }
}

export const soundManager = new SoundManager();
export type { SoundName, SoundPack };
