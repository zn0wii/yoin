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
  /** Playback window [start, end) in file-absolute seconds — CUE tracks
   *  share one file, so playback is clipped to the current track's span. */
  private windowStart = 0;
  private windowEnd = Number.POSITIVE_INFINITY;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.audio.volume = 0.8;
    // The asset protocol (convertFileSrc) is served from a different origin
    // than the page (e.g. http://asset.localhost vs https://tauri.localhost on
    // Windows), so the media must be fetched in CORS mode — otherwise it is
    // treated as tainted and createMediaElementSource feeds silence into the
    // graph (playback advances but nothing is heard). Tauri's asset protocol
    // echoes the window origin in Access-Control-Allow-Origin, which is
    // exactly what anonymous CORS mode needs.
    this.audio.crossOrigin = "anonymous";
    this.audio.addEventListener("timeupdate", () => {
      // Mid-file track end (CUE): emulate the native "ended" event at the
      // window boundary so the store advances to the next track.
      if (
        Number.isFinite(this.windowEnd) &&
        this.audio.currentTime >= this.windowEnd - 0.02
      ) {
        this.audio.pause();
        this.endedListeners.forEach((l) => l());
      }
      this.emit();
    });
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

  /** Clip playback (and the seek/time views below) to [start, end). */
  setWindow(start: number, end: number) {
    this.windowStart = Math.max(0, start);
    this.windowEnd = Math.max(this.windowStart, end);
  }

  async load(filePath: string) {
    if (this.loadedPath === filePath && this.audio.src) {
      this.audio.currentTime = this.windowStart;
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
    this.audio.currentTime = this.windowStart;
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
    const dur = this.duration;
    const target = this.windowStart + Math.max(0, Math.min(seconds, dur));
    const fileDur = this.audio.duration;
    this.audio.currentTime = Number.isFinite(fileDur)
      ? Math.min(target, fileDur)
      : target;
  }

  seekBy(deltaSeconds: number) {
    this.seek(this.currentTime + deltaSeconds);
  }

  /** Position within the current track (window-relative). */
  get currentTime() {
    return Math.max(0, (this.audio.currentTime || 0) - this.windowStart);
  }

  /** Duration of the current track (window clipped to the file). */
  get duration() {
    const fileDur = this.audio.duration || 0;
    const end = Number.isFinite(this.windowEnd)
      ? Math.min(this.windowEnd, fileDur || this.windowEnd)
      : fileDur;
    return Math.max(0, end - this.windowStart);
  }

  /** Raw duration of the loaded file, unclipped by the track window
   *  (0 while unknown) — used to derive CUE sibling durations. */
  get fileDuration() {
    const d = this.audio.duration;
    return Number.isFinite(d) && d > 0 ? d : 0;
  }

  get paused() {
    return this.audio.paused;
  }

  get volume() {
    return this.audio.volume;
  }

  setVolume(value: number) {
    this.audio.volume = Math.min(1, Math.max(0, value));
    this.emit();
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
