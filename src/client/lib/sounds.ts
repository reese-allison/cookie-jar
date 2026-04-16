type SoundName = "noteAdd" | "notePull" | "noteDiscard" | "noteReturn" | "userJoin" | "userLeave";

interface SoundPack {
  name: string;
  sounds: Record<SoundName, string>;
}

const DEFAULT_PACK: SoundPack = {
  name: "default",
  sounds: {
    noteAdd: "/sounds/add.mp3",
    notePull: "/sounds/pull.mp3",
    noteDiscard: "/sounds/discard.mp3",
    noteReturn: "/sounds/return.mp3",
    userJoin: "/sounds/join.mp3",
    userLeave: "/sounds/leave.mp3",
  },
};

class SoundManager {
  private enabled = true;
  private volume = 0.5;
  private pack: SoundPack = DEFAULT_PACK;
  private cache = new Map<string, HTMLAudioElement>();

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

  setPack(pack: SoundPack): void {
    this.pack = pack;
    this.cache.clear();
  }

  play(sound: SoundName): void {
    if (!this.enabled) return;

    const url = this.pack.sounds[sound];
    if (!url) return;

    try {
      let audio = this.cache.get(url);
      if (!audio) {
        audio = new Audio(url);
        this.cache.set(url, audio);
      }
      audio.volume = this.volume;
      audio.currentTime = 0;
      audio.play().catch(() => {
        // Ignore autoplay failures — browser may block before user interaction
      });
    } catch {
      // Audio not available in this environment
    }
  }
}

export const soundManager = new SoundManager();
export type { SoundName, SoundPack };
