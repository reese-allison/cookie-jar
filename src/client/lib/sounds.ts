type SoundName = "noteAdd" | "notePull" | "noteDiscard" | "noteReturn" | "userJoin" | "userLeave";

type SoundPack = Partial<Record<SoundName, string>>;

/**
 * Web Audio synthesis tuned to a warm paper/cafe theme. The synth is
 * composed from a few primitives:
 *
 *   - playNoise  : band-pass filtered noise for paper textures
 *   - playTone   : single pitched sine/triangle with an envelope
 *   - playBell   : additive bell synthesis (inharmonic partials with
 *                  staggered decays — this is what actually makes a sound
 *                  feel like a bell vs a pure tone)
 *   - playThud   : low sine + short noise transient for impacts
 *
 * Every sound mixes 2–4 primitives to land a specific physical moment
 * (paper landing, cork pop, crumple + bin, chime).
 */
class SoundManager {
  private enabled = true;
  private volume = 0.5;
  private customPack: SoundPack = {};
  private audioCache = new Map<string, HTMLAudioElement>();
  private audioCtx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private masterGain: GainNode | null = null;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
  isEnabled(): boolean {
    return this.enabled;
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.masterGain) this.masterGain.gain.value = this.volume;
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
    const url = this.customPack[sound];
    if (url) {
      this.playUrl(url);
      return;
    }
    try {
      this.playProcedural(sound);
    } catch {
      // Web Audio unavailable — fail silently
    }
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

  private getCtx(): AudioContext {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.audioCtx.destination);
    }
    return this.audioCtx;
  }

  private getMaster(): AudioNode {
    this.getCtx();
    // getCtx always sets masterGain; narrow for the type system.
    if (!this.masterGain) throw new Error("masterGain missing");
    return this.masterGain;
  }

  private getNoiseBuffer(): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const ctx = this.getCtx();
    const length = Math.floor(ctx.sampleRate * 1.5);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Pink-ish noise via simple one-pole filter on white noise
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = 0.97 * last + 0.03 * white;
      data[i] = last * 3;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  /** Short burst of filtered noise — paper / crumple textures. */
  private playNoise(
    opts: {
      duration: number;
      filterFreq: number;
      filterQ?: number;
      filterType?: BiquadFilterType;
      peakGain: number;
      attack?: number;
      release?: number;
      sweepTo?: number;
    },
    offset = 0,
  ): void {
    const ctx = this.getCtx();
    const start = ctx.currentTime + offset;
    const src = ctx.createBufferSource();
    src.buffer = this.getNoiseBuffer();

    const filter = ctx.createBiquadFilter();
    filter.type = opts.filterType ?? "bandpass";
    filter.frequency.setValueAtTime(opts.filterFreq, start);
    filter.Q.value = opts.filterQ ?? 1;
    if (opts.sweepTo) {
      filter.frequency.exponentialRampToValueAtTime(opts.sweepTo, start + opts.duration);
    }

    const gain = ctx.createGain();
    const peak = opts.peakGain;
    const attack = opts.attack ?? 0.005;
    const release = opts.release ?? opts.duration - attack;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + release);

    src.connect(filter).connect(gain).connect(this.getMaster());
    src.start(start);
    src.stop(start + opts.duration + 0.05);
  }

  /** Single pitched oscillator with an envelope — pops, ticks, swishes. */
  private playTone(
    opts: {
      freq: number;
      duration: number;
      type?: OscillatorType;
      peakGain: number;
      attack?: number;
      sweepTo?: number;
    },
    offset = 0,
  ): void {
    const ctx = this.getCtx();
    const start = ctx.currentTime + offset;
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? "sine";
    osc.frequency.setValueAtTime(opts.freq, start);
    if (opts.sweepTo) {
      osc.frequency.exponentialRampToValueAtTime(opts.sweepTo, start + opts.duration);
    }
    const gain = ctx.createGain();
    const attack = opts.attack ?? 0.005;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(opts.peakGain, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + opts.duration);

    osc.connect(gain).connect(this.getMaster());
    osc.start(start);
    osc.stop(start + opts.duration + 0.05);
  }

  /**
   * Additive bell synthesis. Partial ratios approximate a real bell (not
   * integer multiples!) which is what gives the sound its "metallic warmth"
   * instead of the boring cleanness of a pure sine. Higher partials decay
   * faster than the fundamental, like a physical bell ringing out.
   */
  private playBell(opts: {
    freq: number;
    duration: number;
    peakGain: number;
    offset?: number;
    partials?: Array<[ratio: number, amp: number, decay: number]>;
  }): void {
    const ctx = this.getCtx();
    const start = ctx.currentTime + (opts.offset ?? 0);
    const parts = opts.partials ?? [
      [1.0, 1.0, 1.0],
      [2.0, 0.5, 0.75], // octave
      [3.0, 0.3, 0.55],
      [4.16, 0.22, 0.4], // inharmonic partial — key to the bell timbre
      [5.43, 0.15, 0.3],
    ];
    for (const [ratio, amp, decay] of parts) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(opts.freq * ratio, start);

      const g = ctx.createGain();
      const peak = opts.peakGain * amp;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(peak, start + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, start + opts.duration * decay);

      osc.connect(g).connect(this.getMaster());
      osc.start(start);
      osc.stop(start + opts.duration + 0.05);
    }
  }

  /** Low impact — noise transient + body resonance. */
  private playThud(opts: {
    freq: number;
    duration: number;
    peakGain: number;
    offset?: number;
  }): void {
    this.playNoise(
      {
        duration: 0.05,
        filterFreq: 250,
        filterQ: 2,
        peakGain: opts.peakGain * 0.6,
        release: 0.04,
      },
      opts.offset ?? 0,
    );
    this.playTone(
      {
        freq: opts.freq,
        duration: opts.duration,
        type: "sine",
        peakGain: opts.peakGain,
        sweepTo: opts.freq * 0.5,
      },
      (opts.offset ?? 0) + 0.005,
    );
  }

  private playProcedural(sound: SoundName): void {
    switch (sound) {
      case "noteAdd": {
        // Folded paper dropped into a ceramic jar: quick paper whisper, then a
        // bright ceramic "tink" where it touches the rim, then a brief body
        // resonance. Total ~0.4s so it still feels snappy when tapped rapidly.
        // Paper whisper — brief, airy, descending
        this.playNoise({
          duration: 0.07,
          filterFreq: 5200,
          filterQ: 0.9,
          peakGain: 0.18,
          release: 0.06,
          sweepTo: 2400,
        });
        // Ceramic tink — short inharmonic bell so it has "clay" character
        this.playBell({
          freq: 1480,
          duration: 0.28,
          peakGain: 0.22,
          offset: 0.05,
          partials: [
            [1.0, 1.0, 1.0],
            [2.24, 0.42, 0.55],
            [3.57, 0.2, 0.35],
          ],
        });
        // Tiny body resonance — gives the jar weight without thumping
        this.playTone(
          {
            freq: 180,
            duration: 0.18,
            type: "sine",
            peakGain: 0.09,
            sweepTo: 120,
          },
          0.07,
        );
        return;
      }

      case "notePull": {
        // Paper sliding out + soft warm chime. Sweep downward (not up) so the
        // whisper feels like paper leaving the jar rather than squealing out,
        // and drop the bell an octave-ish to C5 to take the shrillness off.
        this.playNoise({
          duration: 0.22,
          filterFreq: 3200,
          filterQ: 2,
          peakGain: 0.13,
          sweepTo: 1400,
          release: 0.18,
        });
        this.playBell({
          freq: 523.25, // C5 — warm, welcoming, not piercing
          duration: 0.5,
          peakGain: 0.2,
          offset: 0.08,
          partials: [
            [1.0, 1.0, 1.0],
            [2.0, 0.4, 0.6],
            [3.0, 0.18, 0.4],
          ],
        });
        return;
      }

      case "noteDiscard": {
        // Crumple (layered noise with fast random amp) + hollow bin thud
        // First crinkle
        this.playNoise({
          duration: 0.1,
          filterFreq: 3500,
          filterQ: 4,
          peakGain: 0.28,
          sweepTo: 1200,
          release: 0.08,
        });
        // Second crinkle (offset gives crumple-like irregularity)
        this.playNoise(
          {
            duration: 0.08,
            filterFreq: 2000,
            filterQ: 5,
            peakGain: 0.24,
            release: 0.07,
            sweepTo: 900,
          },
          0.05,
        );
        // Bin thud
        this.playThud({
          freq: 150,
          duration: 0.25,
          peakGain: 0.42,
          offset: 0.15,
        });
        // Small metallic tick
        this.playTone(
          {
            freq: 1800,
            duration: 0.04,
            type: "sine",
            peakGain: 0.08,
          },
          0.16,
        );
        return;
      }

      case "noteReturn": {
        // Returning mirrors adding — same folded-paper-into-ceramic-jar
        // composition as noteAdd so both "going in" actions feel identical.
        this.playNoise({
          duration: 0.07,
          filterFreq: 5200,
          filterQ: 0.9,
          peakGain: 0.18,
          release: 0.06,
          sweepTo: 2400,
        });
        this.playBell({
          freq: 1480,
          duration: 0.28,
          peakGain: 0.22,
          offset: 0.05,
          partials: [
            [1.0, 1.0, 1.0],
            [2.24, 0.42, 0.55],
            [3.57, 0.2, 0.35],
          ],
        });
        this.playTone(
          {
            freq: 180,
            duration: 0.18,
            type: "sine",
            peakGain: 0.09,
            sweepTo: 120,
          },
          0.07,
        );
        return;
      }

      case "userJoin": {
        // Warm major-third bell chime (C5 + E5) — welcoming
        this.playBell({ freq: 523.25, duration: 0.7, peakGain: 0.24 }); // C5
        this.playBell({ freq: 659.25, duration: 0.85, peakGain: 0.22, offset: 0.09 }); // E5
        // A tiny noise shimmer for air
        this.playNoise(
          {
            duration: 0.08,
            filterFreq: 8000,
            filterQ: 2,
            peakGain: 0.05,
            release: 0.07,
          },
          0.02,
        );
        return;
      }

      case "userLeave": {
        // Descending major-third chime (E5 → C5), softer
        this.playBell({
          freq: 659.25,
          duration: 0.55,
          peakGain: 0.14,
          partials: [
            [1.0, 1.0, 1.0],
            [2.0, 0.4, 0.6],
            [3.0, 0.2, 0.4],
          ],
        });
        this.playBell({
          freq: 523.25,
          duration: 0.75,
          peakGain: 0.14,
          offset: 0.1,
          partials: [
            [1.0, 1.0, 1.2],
            [2.0, 0.35, 0.7],
          ],
        });
        return;
      }
    }
  }
}

export const soundManager = new SoundManager();
export type { SoundName, SoundPack };
