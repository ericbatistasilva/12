export class SoundEngine {
  private ctx: AudioContext | null = null;
  private volume = 0.6;
  private muted = false;

  configure(volume: number, muted: boolean): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.muted = muted;
  }

  private ensureContext(): AudioContext | null {
    if (this.muted || this.volume <= 0) return null;
    if (typeof window === 'undefined') return null;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  playTone(
    freqStart: number,
    freqEnd: number,
    durationSec: number,
    type: OscillatorType = 'triangle',
    gainPeak = 0.14
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), now + durationSec);

    const effectiveGain = gainPeak * this.volume;
    gain.gain.setValueAtTime(Math.max(0.0001, effectiveGain), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + durationSec + 0.01);
  }

  playMine(): void {
    this.playTone(190, 75, 0.11, 'square', 0.12);
  }

  playPlace(): void {
    this.playTone(130, 250, 0.08, 'triangle', 0.14);
  }

  playJump(): void {
    this.playTone(170, 320, 0.1, 'sine', 0.11);
  }

  playStep(): void {
    this.playTone(115, 85, 0.05, 'triangle', 0.05);
  }

  playClick(): void {
    this.playTone(440, 520, 0.045, 'sine', 0.07);
  }

  dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
