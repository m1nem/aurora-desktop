import { invoke } from "@tauri-apps/api/core";

export interface NativeAudioState {
  is_playing: boolean;
  position: number;
  duration: number;
  ended: boolean;
  path: string | null;
}

export interface TrackMetadataForRpc {
  title: string;
  artist: string;
  duration?: number;
}

type Listener = (ev?: any) => void;

function decodeFileUrlToPath(src: string): string {
  try {
    const parsed = new URL(src);
    let decoded = decodeURIComponent(parsed.pathname);
    // Tauri convertFileSrc on Linux produces http://asset.localhost/%2Fhome%2F... -> //home/...
    if (/^\/\/+/.test(decoded) && !/^\/\/[a-zA-Z0-9.-]+\//.test(decoded)) {
      decoded = decoded.replace(/^\/+/, "/");
    }
    // Windows drive letter (/C:/...) -> C:/...
    if (/^\/[a-zA-Z]:\//.test(decoded)) {
      decoded = decoded.slice(1);
    }
    return decoded;
  } catch {
    return src;
  }
}

class NativeAudioController {
  private _src = "";
  private _loadedPath = "";
  private _playGeneration = 0;
  private _currentTime = 0;
  private _duration = 0;
  private _volume = 1;
  private _muted = false;
  private _paused = true;
  private _ended = false;
  private _loop = false;
  private _playbackRate = 1;
  private _pollTimer: number | null = null;
  private _listeners: Map<string, Set<Listener>> = new Map();
  private _inlineHandlers: Map<string, Listener | null> = new Map();
  private _fallbackAudio: HTMLAudioElement | null = null;
  private _meta: TrackMetadataForRpc = { title: "Aurora", artist: "" };

  public autoplay = false;
  public controls = false;
  public defaultMuted = false;
  public defaultPlaybackRate = 1;
  public preload = "auto";
  public crossOrigin: string | null = null;
  public error: MediaError | null = null;

  public get readyState(): number {
    return this._src ? 4 : 0;
  }

  public get networkState(): number {
    return this._src ? 1 : 0;
  }

  public get seeking(): boolean {
    return false;
  }

  public get ended(): boolean {
    return this._ended;
  }

  public get currentSrc(): string {
    return this._src;
  }

  public get loop(): boolean {
    return this._loop;
  }

  public set loop(val: boolean) {
    this._loop = Boolean(val);
    if (this._fallbackAudio) this._fallbackAudio.loop = this._loop;
  }

  public get playbackRate(): number {
    return this._playbackRate;
  }

  public set playbackRate(val: number) {
    this._playbackRate = Number.isFinite(val) && val > 0 ? val : 1;
    if (this._fallbackAudio) this._fallbackAudio.playbackRate = this._playbackRate;
  }

  public get buffered() {
    const dur = this._duration || 0;
    return {
      length: dur > 0 ? 1 : 0,
      start: (_i: number) => 0,
      end: (_i: number) => dur,
    };
  }

  public get seekable() {
    const dur = this._duration || 0;
    return {
      length: dur > 0 ? 1 : 0,
      start: (_i: number) => 0,
      end: (_i: number) => dur,
    };
  }

  public get played() {
    const cur = this._currentTime || 0;
    return {
      length: cur > 0 ? 1 : 0,
      start: (_i: number) => 0,
      end: (_i: number) => cur,
    };
  }

  private setInlineHandler(event: string, fn: Listener | null) {
    const prev = this._inlineHandlers.get(event);
    if (prev) this.removeEventListener(event, prev);
    this._inlineHandlers.set(event, fn);
    if (fn) this.addEventListener(event, fn);
  }

  public get onplay() { return this._inlineHandlers.get("play") ?? null; }
  public set onplay(fn: Listener | null) { this.setInlineHandler("play", fn); }

  public get onpause() { return this._inlineHandlers.get("pause") ?? null; }
  public set onpause(fn: Listener | null) { this.setInlineHandler("pause", fn); }

  public get onended() { return this._inlineHandlers.get("ended") ?? null; }
  public set onended(fn: Listener | null) { this.setInlineHandler("ended", fn); }

  public get ontimeupdate() { return this._inlineHandlers.get("timeupdate") ?? null; }
  public set ontimeupdate(fn: Listener | null) { this.setInlineHandler("timeupdate", fn); }

  public get onloadedmetadata() { return this._inlineHandlers.get("loadedmetadata") ?? null; }
  public set onloadedmetadata(fn: Listener | null) { this.setInlineHandler("loadedmetadata", fn); }

  public get onloadeddata() { return this._inlineHandlers.get("loadeddata") ?? null; }
  public set onloadeddata(fn: Listener | null) { this.setInlineHandler("loadeddata", fn); }

  public get oncanplay() { return this._inlineHandlers.get("canplay") ?? null; }
  public set oncanplay(fn: Listener | null) { this.setInlineHandler("canplay", fn); }

  public get oncanplaythrough() { return this._inlineHandlers.get("canplaythrough") ?? null; }
  public set oncanplaythrough(fn: Listener | null) { this.setInlineHandler("canplaythrough", fn); }

  public get onwaiting() { return this._inlineHandlers.get("waiting") ?? null; }
  public set onwaiting(fn: Listener | null) { this.setInlineHandler("waiting", fn); }

  public get onplaying() { return this._inlineHandlers.get("playing") ?? null; }
  public set onplaying(fn: Listener | null) { this.setInlineHandler("playing", fn); }

  public get onseeking() { return this._inlineHandlers.get("seeking") ?? null; }
  public set onseeking(fn: Listener | null) { this.setInlineHandler("seeking", fn); }

  public get onseeked() { return this._inlineHandlers.get("seeked") ?? null; }
  public set onseeked(fn: Listener | null) { this.setInlineHandler("seeked", fn); }

  public get onvolumechange() { return this._inlineHandlers.get("volumechange") ?? null; }
  public set onvolumechange(fn: Listener | null) { this.setInlineHandler("volumechange", fn); }

  public get ondurationchange() { return this._inlineHandlers.get("durationchange") ?? null; }
  public set ondurationchange(fn: Listener | null) { this.setInlineHandler("durationchange", fn); }

  public get onerror() { return this._inlineHandlers.get("error") ?? null; }
  public set onerror(fn: Listener | null) { this.setInlineHandler("error", fn); }

  public canPlayType(_type: string): CanPlayTypeResult {
    return "probably";
  }

  public fastSeek(time: number): void {
    this.currentTime = time;
  }

  public setAttribute(name: string, value: string): void {
    if (name === "src") {
      this.src = value;
    }
  }

  public removeAttribute(name: string): void {
    if (name === "src") {
      this.src = "";
    }
  }

  public getAttribute(name: string): string | null {
    if (name === "src") {
      return this._src || null;
    }
    return null;
  }

  public setTrackMetadata(meta: TrackMetadataForRpc) {
    this._meta = meta;
    if (meta.duration && meta.duration > 0 && this._duration <= 0) {
      this._duration = meta.duration;
    }
  }

  private isWebAudioUrl(src: string): boolean {
    return /^https?:\/\/(?!asset\.localhost)/i.test(src) || /^blob:/i.test(src) || /^data:/i.test(src);
  }

  private async resolveNativePath(src: string): Promise<string> {
    if (
      /^https?:\/\/asset\.localhost\//i.test(src) ||
      /^asset:\/\/localhost\//i.test(src) ||
      /^file:\/\//i.test(src)
    ) {
      return decodeFileUrlToPath(src);
    }
    if (src.startsWith("/api/media/")) {
      try {
        const resolved = await invoke<{ url: string; filePath: string | null }>(
          "resolve_media_url",
          { url: src }
        );
        if (resolved?.filePath) return resolved.filePath;
      } catch {}
    }
    return src;
  }

  public get src(): string {
    return this._src;
  }

  public set src(value: string) {
    const next = value || "";
    if (this._src === next) return;

    this._playGeneration += 1;
    this.stopPolling();

    this._src = next;
    this._loadedPath = "";
    this._currentTime = 0;
    this._ended = false;
    this._paused = true;
    this.error = null;
    this._duration = this._meta.duration || 0;

    if (!next) {
      invoke("audio_stop").catch(() => {});
      if (this._fallbackAudio) {
        this._fallbackAudio.pause();
        this._fallbackAudio.removeAttribute("src");
        this._fallbackAudio.load();
      }
      return;
    }

    if (this.isWebAudioUrl(next)) {
      invoke("audio_stop").catch(() => {});
      if (!this._fallbackAudio) {
        this._fallbackAudio = new Audio();
        this._fallbackAudio.addEventListener("timeupdate", () => {
          this._currentTime = this._fallbackAudio?.currentTime || 0;
          if (this._fallbackAudio?.duration && Number.isFinite(this._fallbackAudio.duration)) {
            this._duration = this._fallbackAudio.duration;
          }
          this.emit("timeupdate");
        });
        this._fallbackAudio.addEventListener("loadedmetadata", () => {
          if (this._fallbackAudio?.duration && Number.isFinite(this._fallbackAudio.duration)) {
            this._duration = this._fallbackAudio.duration;
          }
          this.emit("loadedmetadata");
          this.emit("canplay");
        });
        this._fallbackAudio.addEventListener("ended", () => {
          this._paused = true;
          this._ended = true;
          this.emit("ended");
        });
        this._fallbackAudio.addEventListener("error", () => {
          this.error = this._fallbackAudio?.error ?? null;
          this.emit("error");
        });
      }
      this._fallbackAudio.src = next;
      this._fallbackAudio.loop = this._loop;
      this._fallbackAudio.muted = this._muted;
      this._fallbackAudio.volume = this._volume;
      this._fallbackAudio.load();
    } else {
      if (this._fallbackAudio) {
        this._fallbackAudio.pause();
        this._fallbackAudio.removeAttribute("src");
      }
      invoke("audio_stop").catch(() => {});
      queueMicrotask(() => {
        if (this._src === next) {
          this.emit("loadedmetadata");
          this.emit("canplay");
        }
      });
    }
  }

  public get currentTime(): number {
    return this._currentTime;
  }

  public set currentTime(val: number) {
    const target = Math.max(0, Number.isFinite(val) ? val : 0);
    this._currentTime = target;
    this._ended = false;
    this.emit("seeking");

    if (this.isWebAudioUrl(this._src) && this._fallbackAudio) {
      this._fallbackAudio.currentTime = target;
    } else if (this._src && this._loadedPath) {
      invoke("audio_seek", { positionSecs: target }).catch(() => {});
    }

    this.emit("seeked");
    this.emit("timeupdate");
  }

  public get duration(): number {
    return this._duration;
  }

  public get paused(): boolean {
    return this._paused;
  }

  public get volume(): number {
    return this._volume;
  }

  public set volume(val: number) {
    this._volume = Math.max(0, Math.min(1, val));
    const effective = this._muted ? 0 : this._volume;
    if (this.isWebAudioUrl(this._src) && this._fallbackAudio) {
      this._fallbackAudio.volume = effective;
    } else {
      invoke("audio_set_volume", { volume: effective }).catch(() => {});
    }
    this.emit("volumechange");
  }

  public get muted(): boolean {
    return this._muted;
  }

  public set muted(val: boolean) {
    this._muted = Boolean(val);
    const effective = this._muted ? 0 : this._volume;
    if (this.isWebAudioUrl(this._src) && this._fallbackAudio) {
      this._fallbackAudio.muted = this._muted;
    } else {
      invoke("audio_set_volume", { volume: effective }).catch(() => {});
    }
    this.emit("volumechange");
  }

  public async play(): Promise<void> {
    if (!this._src) return;
    const gen = ++this._playGeneration;

    if (this.isWebAudioUrl(this._src) && this._fallbackAudio) {
      this._fallbackAudio.muted = this._muted;
      this._fallbackAudio.volume = this._volume;
      await this._fallbackAudio.play();
      if (gen !== this._playGeneration) return;
      this._paused = false;
      this._ended = false;
      this.emit("play");
      this.emit("playing");
      return;
    }

    const path = await this.resolveNativePath(this._src);
    if (gen !== this._playGeneration) return;

    if (this._loadedPath === path && !this._ended) {
      await invoke("audio_resume");
      if (gen !== this._playGeneration) return;
      this._paused = false;
      this.startPolling();
      this.emit("play");
      this.emit("playing");
      return;
    }

    const seekOffset = this._currentTime;
    const dur = await invoke<number>("audio_play", {
      path,
      volume: this._muted ? 0 : this._volume,
      durationHint: this._meta.duration || null,
    });

    if (gen !== this._playGeneration) {
      invoke("audio_stop").catch(() => {});
      return;
    }

    this._loadedPath = path;
    if (dur && Number.isFinite(dur) && dur > 0) {
      this._duration = dur;
    }

    this._paused = false;
    this._ended = false;

    if (seekOffset > 0.1) {
      this._currentTime = seekOffset;
      await invoke("audio_seek", { positionSecs: seekOffset }).catch(() => {});
    } else {
      this._currentTime = 0;
    }

    this.emit("loadedmetadata");
    this.emit("loadeddata");
    this.emit("durationchange");
    this.emit("canplay");
    this.emit("canplaythrough");
    this.emit("play");
    this.emit("playing");
    this.startPolling();
  }

  public pause(): void {
    this._playGeneration += 1;
    if (this.isWebAudioUrl(this._src) && this._fallbackAudio) {
      this._fallbackAudio.pause();
    } else {
      invoke("audio_pause").catch(() => {});
    }
    this._paused = true;
    this.stopPolling();
    this.emit("pause");
  }

  public load(): void {}

  public addEventListener(event: string, listener: Listener): void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(listener);
  }

  public removeEventListener(event: string, listener: Listener): void {
    this._listeners.get(event)?.delete(listener);
  }

  public dispatchEvent(_event: Event): boolean {
    return true;
  }

  private emit(event: string): void {
    const ev = { type: event, target: this, currentTarget: this };
    this._listeners.get(event)?.forEach((fn) => {
      try {
        fn(ev);
      } catch (e) {
        console.error("[NativeAudio] Listener error:", e);
      }
    });
  }

  private startPolling(): void {
    this.stopPolling();
    this._pollTimer = window.setInterval(async () => {
      try {
        const st = await invoke<NativeAudioState>("audio_get_state");
        if (this._paused) return;

        if (Number.isFinite(st.position) && st.position >= 0) {
          this._currentTime = st.position;
        }
        if (st.duration > 0 && Math.abs(st.duration - this._duration) > 0.05) {
          this._duration = st.duration;
          this.emit("durationchange");
        }
        this.emit("timeupdate");

        if (st.ended) {
          if (this._loop) {
            this._currentTime = 0;
            this._ended = true;
            await this.play();
            return;
          }
          this._paused = true;
          this._ended = true;
          this._loadedPath = "";
          this.stopPolling();
          this.emit("ended");
        }
      } catch {}
    }, 200);
  }

  private stopPolling(): void {
    if (this._pollTimer !== null) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }
}

export const nativeAudio = new NativeAudioController();
