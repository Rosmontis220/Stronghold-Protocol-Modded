// Optional startup presentation: use verified local resources while the full snapshot is downloading.
import { audio } from './audio.js';

export function createPreloadEffects({ onState, win = window, audioSelected = true } = {}) {
  let settings = {};
  try { settings = JSON.parse(win.localStorage.getItem('sp.pref.settings') || '{}') || {}; } catch { /* defaults */ }
  audio.install();
  audio.setVolumes(settings);
  let startup = null;
  let readResource;
  let disposed = false;
  let cancelled = false;
  let requested = false;
  let unavailable = false;
  let fontCount = 0;
  const ready = new Set();
  const loadedFonts = new Set();
  const emit = () => {
    if (disposed) return;
    let music = 'loading';
    if (!audioSelected) music = 'skipped'; // the player chose not to download the audio set
    else if (unavailable || (startup && !startup.bgm)) music = 'unavailable';
    else if (audio.volumes.muted || audio.volumes.bgm === 0) music = 'muted';
    else if (requested) music = audio.ctx?.state === 'running' && audio.bgm ? 'playing' : 'ready';
    try { onState?.({ music, fonts: fontCount }); } catch { /* optional UI */ }
  };
  const timer = win.setInterval(emit, 250);
  emit();

  return {
    configure(index, read) {
      startup = index.startup || { bgm: null, fonts: [] };
      readResource = read;
      audio.setVolumes(settings);
      emit();
    },
    async resourceReady(file) {
      if (disposed) return;
      ready.add(file.url);
      const track = startup?.bgm;
      if (!requested && track && [track.intro, track.loop].filter(Boolean).every((url) => ready.has(url))) {
        requested = true;
        audio.playBgm('lobby');
        // Browsers allowing autoplay start now; others resume on the next user gesture.
        audio.unlock();
        emit();
        const loop = audio.buffers.get(track.loop);
        if (loop) loop.then((buffer) => { if (!buffer && !disposed) { unavailable = true; emit(); } });
      }
      for (const face of startup?.fonts || []) {
        if (face.url !== file.url || loadedFonts.has(face.url) || !win.FontFace) continue;
        loadedFonts.add(face.url);
        try {
          const response = await readResource(face.url);
          const font = new win.FontFace(face.family, await response.arrayBuffer(), { weight: String(face.weight), display: 'swap' });
          await font.load();
          if (cancelled) return;
          win.document.fonts.add(font);
          fontCount++;
          emit();
        } catch { /* font decoding must not block game startup */ }
      }
    },
    setMusicEnabled(enabled) {
      if (disposed) return;
      settings = { ...settings, muted: !enabled, bgm: audio.volumes.bgm || 0.6 };
      audio.setVolumes(settings);
      try { win.localStorage.setItem('sp.pref.settings', JSON.stringify(settings)); } catch { /* private browsing */ }
      if (enabled) audio.unlock();
      emit();
    },
    finish({ failed = false } = {}) {
      disposed = true;
      cancelled = failed;
      win.clearInterval(timer);
      if (failed) audio.playBgm(null);
      // The app continues with this singleton and the same playing loop.
    },
  };
}
