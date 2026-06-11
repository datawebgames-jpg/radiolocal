const socket = io();

// ── Audio elements para crossfade ──────────────────────────────────────────────
const audioA = document.getElementById('audioPlayer');
const audioB = document.getElementById('audioPlayerB');

let audioCtx = null, analyser = null, masterGain = null;
let srcA = null, srcB = null, gainA = null, gainB = null;
let activeEl = audioA, inactiveEl = audioB;
let activeGain = null, inactiveGain = null;
let isPlaying = false;
let currentTrackUrl = null;
let liveMode = false;
const XFADE_SEC = 2.5;

function setupAudioContext() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 128;
  masterGain = audioCtx.createGain();
  masterGain.gain.value = parseFloat(document.getElementById('volume').value);

  srcA = audioCtx.createMediaElementSource(audioA);
  srcB = audioCtx.createMediaElementSource(audioB);
  gainA = audioCtx.createGain(); gainA.gain.value = 1;
  gainB = audioCtx.createGain(); gainB.gain.value = 0;

  srcA.connect(gainA); gainA.connect(analyser);
  srcB.connect(gainB); gainB.connect(analyser);
  analyser.connect(masterGain);
  masterGain.connect(audioCtx.destination);

  activeGain = gainA;
  inactiveGain = gainB;
}

function setVolume(v) {
  if (masterGain) masterGain.gain.value = parseFloat(v);
}

function loadInitialTrack(url) {
  if (!url) return;
  currentTrackUrl = url;
  activeEl.src = url;
  activeEl.load();
}

function crossfadeTo(url) {
  if (!url) return;
  currentTrackUrl = url;

  if (!isPlaying) {
    activeEl.src = url;
    activeEl.load();
    return;
  }

  setupAudioContext();
  inactiveEl.src = url;
  inactiveEl.load();

  const now = audioCtx.currentTime;
  activeGain.gain.cancelScheduledValues(now);
  inactiveGain.gain.cancelScheduledValues(now);
  activeGain.gain.setValueAtTime(activeGain.gain.value, now);
  inactiveGain.gain.setValueAtTime(0, now);
  activeGain.gain.linearRampToValueAtTime(0, now + XFADE_SEC);
  inactiveGain.gain.linearRampToValueAtTime(1, now + XFADE_SEC);

  inactiveEl.play().catch(() => {});

  setTimeout(() => {
    activeEl.pause();
    activeEl.src = '';
    [activeEl, inactiveEl] = [inactiveEl, activeEl];
    [activeGain, inactiveGain] = [inactiveGain, activeGain];
  }, (XFADE_SEC + 0.5) * 1000);
}

async function togglePlay() {
  if (!currentTrackUrl && !liveMode) return;
  setupAudioContext();
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  if (isPlaying) {
    activeEl.pause();
    inactiveEl.pause();
    isPlaying = false;
    setPlayingUI(false);
  } else {
    if (liveMode && !mse) setupMSE(false);
    await activeEl.play().catch(() => {});
    isPlaying = true;
    setPlayingUI(true);
  }
}

function setPlayingUI(playing) {
  const btn = document.getElementById('btnPlay');
  btn.textContent = playing ? '⏸ Pausar' : '▶ Escuchar';
  btn.classList.toggle('playing', playing);
  document.getElementById('coverArt').classList.toggle('spinning', playing);
  const hint = document.getElementById('streamHint');
  if (hint) hint.style.display = (!playing && (liveMode || currentTrackUrl)) ? 'block' : 'none';
}

function onTrackEnded() { socket.emit('next_track'); }
audioA.addEventListener('ended', onTrackEnded);
audioB.addEventListener('ended', onTrackEnded);

// ── Visualizer ──────────────────────────────────────────────
const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');

function drawVisualizer() {
  requestAnimationFrame(drawVisualizer);
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  if (!analyser || !isPlaying) {
    ctx.strokeStyle = 'rgba(230,57,70,0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x < W; x++) {
      const y = H / 2 + Math.sin(x * 0.04 + Date.now() * 0.002) * 6;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    return;
  }

  const bufLen = analyser.frequencyBinCount;
  const data = new Uint8Array(bufLen);
  analyser.getByteFrequencyData(data);
  const barW = W / bufLen * 1.8;
  data.forEach((v, i) => {
    const pct = v / 255;
    const barH = pct * H * 0.85;
    const hue = pct * 30;
    ctx.fillStyle = `hsla(${hue},80%,55%,0.85)`;
    ctx.fillRect(i * (barW + 1), H - barH, barW, barH);
  });
}
drawVisualizer();

// ── Socket events ──────────────────────────────────────────────
socket.on('state_sync', state => {
  document.getElementById('stationName').textContent = state.stationName;
  document.title = state.stationName;
  document.getElementById('listenersCount').textContent = state.listeners;
  updateStatus(state.status);
  if (state.currentTrack) {
    document.getElementById('trackName').textContent = state.currentTrack.name;
    if (state.currentTrack.url && !state.currentTrack.url.includes('/api/yt-stream')) {
      loadInitialTrack(state.currentTrack.url);
    } else {
      // relay o yt-stream: llegan chunks via socket
      liveMode = true;
    }
  }
});

socket.on('track_change', ({ track }) => {
  if (!track) {
    document.getElementById('trackName').textContent = '— Sin señal —';
    teardownMSE();
    liveMode = false;
    activeEl.pause(); inactiveEl.pause();
    isPlaying = false;
    setPlayingUI(false);
    return;
  }

  document.getElementById('trackName').textContent = track.name;

  const isLiveTrack = !track.url || track.type === 'relay' || track.type === 'browser-live';

  if (isLiveTrack) {
    // Relay o en vivo: resetear MSE para la nueva pista, chunks llegarán via socket
    teardownMSE();
    liveMode = true;
    // Si estaba escuchando, los chunks nuevos van a reactivar el audio automáticamente
  } else {
    teardownMSE();
    liveMode = false;
    crossfadeTo(track.url);
  }
});

socket.on('status_change', updateStatus);

socket.on('listeners_count', n => {
  document.getElementById('listenersCount').textContent = n;
});

socket.on('station_name', name => {
  document.getElementById('stationName').textContent = name;
  document.title = name;
});

socket.on('ad_broadcast', ({ text, banner }) => {
  if (banner) {
    document.getElementById('adContent').textContent = banner;
    const el = document.getElementById('adBanner');
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 20000);
  }
  if (text && 'speechSynthesis' in window) {
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'es-AR';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utt);
  }
});

socket.on('ad_play', (ad) => {
  if (ad.type === 'video') {
    const v = document.getElementById('adVideo');
    v.src = ad.url;
    v.style.display = 'block';
    v.play().catch(() => {});
    v.onended = () => { v.style.display = 'none'; v.src = ''; };
  } else {
    const a = new Audio(ad.url);
    a.play().catch(() => {});
  }
  if (ad.name) {
    document.getElementById('adContent').textContent = '📢 ' + ad.name;
    document.getElementById('adBanner').style.display = 'block';
    setTimeout(() => { document.getElementById('adBanner').style.display = 'none'; }, 25000);
  }
});

// ── MSE para audio en vivo / relay ──────────────────────────────────────────────
let mse = null, mseSrcBuf = null, mseQueue = [], mseReady = false;

function setupMSE(autoplay = false) {
  if (!window.MediaSource || mse) return;
  liveMode = true;
  setupAudioContext();
  audioCtx.resume().catch(() => {});
  gainA.gain.cancelScheduledValues(audioCtx.currentTime);
  gainB.gain.cancelScheduledValues(audioCtx.currentTime);
  gainA.gain.value = 1; gainB.gain.value = 0;
  activeEl = audioA; inactiveEl = audioB;
  activeGain = gainA; inactiveGain = gainB;
  inactiveEl.pause(); inactiveEl.src = '';

  mse = new MediaSource();
  audioA.src = URL.createObjectURL(mse);

  mse.addEventListener('sourceopen', () => {
    const mime = 'audio/webm;codecs=opus';
    if (!MediaSource.isTypeSupported(mime)) return;
    mseSrcBuf = mse.addSourceBuffer(mime);
    mseSrcBuf.mode = 'sequence';
    mseSrcBuf.addEventListener('updateend', () => {
      flushMSEQueue();
      // Intentar play después de que haya datos reales en el buffer
      if (autoplay && audioA.paused && audioA.readyState >= 2) {
        audioA.play().then(() => {
          isPlaying = true;
          setPlayingUI(true);
        }).catch(() => {});
      }
    });
    mseReady = true;
    flushMSEQueue();
  });
}

function flushMSEQueue() {
  if (!mseSrcBuf || mseSrcBuf.updating || mseQueue.length === 0) return;
  try {
    const chunk = mseQueue.shift();
    const buf = chunk instanceof ArrayBuffer ? chunk : (ArrayBuffer.isView(chunk) ? chunk.buffer : chunk);
    mseSrcBuf.appendBuffer(buf);
  } catch(e) {
    if (e.name === 'QuotaExceededError' && mseSrcBuf.buffered.length > 0) {
      try {
        const end = mseSrcBuf.buffered.end(mseSrcBuf.buffered.length - 1);
        mseSrcBuf.remove(mseSrcBuf.buffered.start(0), end - 5);
      } catch(_) {}
    }
  }
}

function teardownMSE() {
  mse = null; mseSrcBuf = null; mseQueue = []; mseReady = false;
  audioA.pause();
  audioA.src = '';
}

// El browser tiene suficientes datos para reproducir
audioA.addEventListener('canplay', () => {
  if (isPlaying && liveMode && audioA.paused) {
    audioA.play().catch(() => {});
  }
});

// Si el audio se tranca esperando datos, reintenta
audioA.addEventListener('waiting', () => {
  if (isPlaying && liveMode) {
    setTimeout(() => { if (audioA.paused && isPlaying) audioA.play().catch(() => {}); }, 500);
  }
});

socket.on('live_audio_chunk', (chunk) => {
  if (!mse) setupMSE(isPlaying);
  const buf = chunk instanceof ArrayBuffer ? chunk : (ArrayBuffer.isView(chunk) ? chunk.buffer : chunk);
  mseQueue.push(buf);
  flushMSEQueue();
});

socket.on('browser_live_stop', () => {
  teardownMSE();
  liveMode = false;
  isPlaying = false;
  setPlayingUI(false);
});

// ── Publicidad audio por chunks (relay) ──────────────────────────────────────────────
let adMse = null, adMseBuf = null, adMseQueue = [], adEl = null;

socket.on('ad_audio_chunk', (chunk) => {
  const buf = chunk instanceof ArrayBuffer ? chunk : (ArrayBuffer.isView(chunk) ? chunk.buffer : chunk);
  if (!adMse) {
    adMse = new MediaSource();
    adEl = new Audio();
    adEl.src = URL.createObjectURL(adMse);
    adMse.addEventListener('sourceopen', () => {
      const mime = 'audio/webm;codecs=opus';
      if (!MediaSource.isTypeSupported(mime)) return;
      adMseBuf = adMse.addSourceBuffer(mime);
      adMseBuf.mode = 'sequence';
      adMseBuf.addEventListener('updateend', () => {
        if (adEl && adEl.paused) adEl.play().catch(() => {});
        flushAdMSE();
      });
      flushAdMSE();
    });
    adEl.addEventListener('canplay', () => { adEl.play().catch(() => {}); });
    adEl.onended = () => { adMse = null; adMseBuf = null; adMseQueue = []; adEl = null; };
  }
  adMseQueue.push(buf);
  flushAdMSE();
});

function flushAdMSE() {
  if (!adMseBuf || adMseBuf.updating || adMseQueue.length === 0) return;
  try { adMseBuf.appendBuffer(adMseQueue.shift()); } catch(e) {}
}

// ── Pantalla compartida / webcam ──────────────────────────────────────────────
let screenMse = null, screenBuf = null, screenQueue = [];

socket.on('video_chunk', (chunk) => {
  const wrap = document.getElementById('screenShareWrap');
  const vid  = document.getElementById('screenVideo');
  if (!screenMse) {
    wrap.style.display = 'block';
    screenMse = new MediaSource();
    vid.src = URL.createObjectURL(screenMse);
    screenMse.addEventListener('sourceopen', () => {
      const mime = 'video/webm;codecs=vp8,opus';
      if (!MediaSource.isTypeSupported(mime)) return;
      screenBuf = screenMse.addSourceBuffer(mime);
      screenBuf.mode = 'sequence';
      screenBuf.addEventListener('updateend', flushScreen);
      flushScreen();
    });
    vid.play().catch(() => {});
  }
  screenQueue.push(chunk);
  flushScreen();
});

function flushScreen() {
  if (!screenBuf || screenBuf.updating || screenQueue.length === 0) return;
  try {
    const c = screenQueue.shift();
    screenBuf.appendBuffer(c instanceof ArrayBuffer ? c : c.buffer);
  } catch(e) {}
}

socket.on('screen_share_stop', () => {
  document.getElementById('screenShareWrap').style.display = 'none';
  const vid = document.getElementById('screenVideo');
  vid.pause(); vid.src = '';
  screenMse = null; screenBuf = null; screenQueue = [];
});

// ── UI helpers ──────────────────────────────────────────────
function updateStatus(status) {
  const badge = document.getElementById('onAirBadge');
  const btn = document.getElementById('btnPlay');
  const hint = document.getElementById('streamHint');
  if (status === 'off') {
    badge.textContent = '● OFF';
    badge.classList.remove('on');
    btn.disabled = true;
    if (hint) hint.style.display = 'none';
  } else {
    badge.textContent = status === 'live' ? '● EN VIVO' : '● ON AIR';
    badge.classList.add('on');
    btn.disabled = false;
    if (hint && !isPlaying) hint.style.display = 'block';
  }
}

// ── Chat ──────────────────────────────────────────────
socket.on('chat_history', msgs => {
  const el = document.getElementById('chatMessages');
  el.innerHTML = '';
  msgs.forEach(appendMsg);
});
socket.on('chat_message', appendMsg);

function appendMsg(msg) {
  const el = document.getElementById('chatMessages');
  const isDJ = msg.role === 'dj';
  const div = document.createElement('div');
  div.className = `chat-msg${isDJ ? ' dj' : ''}`;
  const time = new Date(msg.ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  div.innerHTML = `
    <div class="meta"><span class="user ${isDJ ? 'dj' : ''}">${escHtml(msg.user)}${isDJ ? ' 🎙️' : ''}</span> · ${time}</div>
    <div class="text">${escHtml(msg.text)}</div>`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function sendChat() {
  const user = document.getElementById('chatUser').value.trim() || 'Anónimo';
  const text = document.getElementById('chatText').value.trim();
  if (!text) return;
  socket.emit('chat_message', { user, text, role: 'listener' });
  document.getElementById('chatText').value = '';
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Donaciones ──────────────────────────────────────────────
let qrGenerated = false;
function openDonate() {
  document.getElementById('donateModal').style.display = 'flex';
  if (!qrGenerated && window.QRCode) {
    new QRCode(document.getElementById('donateQR'), {
      text: 'https://link.mercadopago.com.ar/danielmfaggi',
      width: 160, height: 160, colorDark: '#e63946', colorLight: '#18181c',
    });
    qrGenerated = true;
  }
}
function closeDonate() { document.getElementById('donateModal').style.display = 'none'; }
function copyAlias() {
  navigator.clipboard.writeText('danielmfaggi').then(() => {
    document.getElementById('copyHint').textContent = '✅';
    setTimeout(() => { document.getElementById('copyHint').textContent = '📋'; }, 2000);
  });
}

socket.on('donation_received', ({ donorName, amount, currency }) => {
  const el  = document.getElementById('donationAlert');
  const msg = document.getElementById('donationAlertMsg');
  if (!el) return;
  let text = '¡Gracias por ayudar a mantener la radio on!';
  if (donorName && amount) text = `¡${donorName} donó $${amount} ${currency}! ${text}`;
  else if (donorName)      text = `¡${donorName} hizo una donación! ${text}`;
  msg.textContent = text;
  el.style.display = 'flex';
  el.classList.add('show');
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.style.display = 'none'; }, 600);
  }, 7000);
});
