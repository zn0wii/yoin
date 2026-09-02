import { toAssetUrl } from "./assetUrl";

type Listener = () => void;

/**
 * Thin wrapper around an HTMLAudioElement + Web Audio AnalyserNode.
 *
 * We use <audio> for playback (native streaming, no need to buffer the
 * whole mp3 in memory) and tap it with an AnalyserNode purely to expose
 * frequency data for the 3D scene's visual feedback (platter wobble, etc).
 */
class AudioEngine {
  private audio: HTMLAudioElement;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private freqData: Uint8Array | null = null;
  private listeners = new Set<Listener>();
  private endedListeners = new Set<Listener>();
  private loadedPath: string | null = null;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.audio.addEventListener("timeupdate", () => this.emit());
    this.audio.addEventListener("loadedmetadata", () => this.emit());
    this.audio.addEventListener("ended", () => {
      this.emit();
      this.endedListeners.forEach((l) => l());
    });
  }

  /** Must be called after a user gesture (browser autoplay policy). */
  private ensureContext() {
    if (this.context) return;
    this.context = new AudioContext();
    this.sourceNode = this.context.createMediaElementSource(this.audio);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 64;
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.sourceNode.connect(this.analyser);
    this.analyser.connect(this.context.destination);
  }

  onUpdate(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onEnded(listener: Listener): () => void {
    this.endedListeners.add(listener);
    return () => this.endedListeners.delete(listener);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  async load(filePath: string) {
    if (this.loadedPath === filePath && this.audio.src) {
      this.audio.currentTime = 0;
      return;
    }
    const url = toAssetUrl(filePath);
    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error(`failed to load audio: ${url}`));
      };
      const cleanup = () => {
        this.audio.removeEventListener("canplay", onReady);
        this.audio.removeEventListener("error", onError);
      };
      this.audio.addEventListener("canplay", onReady);
      this.audio.addEventListener("error", onError);
      this.audio.src = url;
      this.audio.load();
    });
    this.loadedPath = filePath;
    this.audio.currentTime = 0;
  }

  async play() {
    this.ensureContext();
    if (this.context?.state === "suspended") {
      await this.context.resume();
    }
    await this.audio.play();
  }

  pause() {
    this.audio.pause();
  }

  seek(seconds: number) {
    const clamped = Math.max(0, Math.min(seconds, this.audio.duration || seconds));
    this.audio.currentTime = clamped;
  }

  seekBy(deltaSeconds: number) {
    this.seek(this.audio.currentTime + deltaSeconds);
  }

  get currentTime() {
    return this.audio.currentTime || 0;
  }

  get duration() {
    return this.audio.duration || 0;
  }

  get paused() {
    return this.audio.paused;
  }

  /** Average amplitude in [0, 1] for the current frame, or 0 if not playing. */
  getAmplitude(): number {
    if (!this.analyser || !this.freqData) return 0;
    this.analyser.getByteFrequencyData(this.freqData);
    let sum = 0;
    for (let i = 0; i < this.freqData.length; i++) sum += this.freqData[i];
    return sum / this.freqData.length / 255;
  }
}

export const audioEngine = new AudioEngine();
