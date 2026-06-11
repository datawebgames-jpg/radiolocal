const socket = io();
const audio = document.getElementById('audioPlayer');
let adScheduleTimer = null;
let currentAdText = '';
let currentAdBanner = '';

// ── Panel navigation ──────────────────────────────────────────
function showPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`panel-${name}`).classList.add('active');
  event.currentTarget.classList.add('active');
}

// ── Socket events ──────────────────────────────────────────────
socket.on('state_sync', state => {
  document.getElementById('stationNameAdmin').textContent = state.stationName;
  document.getElementById('stationNameInput').value = state.stationName;
  document.getElementById('listenersCount').textContent = state.listeners;
  setStatus(state.status);
  renderPlaylist(state.playlist);
  if (state.currentTrack) setNowPlaying(state.currentTrack, state.currentIndex);
});

socket.on('track_change', ({ track, index }) => {
  setNowPlaying(track, index);
  renderPlaylistHighlight(index);
});

socket.on('status_change', setStatus);

socket.on('listeners_count', n => {
  document.getElementById('listenersCount').textContent = n;
});

socket.on('playlist_update', renderPlaylist);

socket.on('station_name', name => {
  document.getElementById('stationNameAdmin').textContent = name;
});

socket.on('chat_history', msgs => {
  const el = document.getElementById('chatMessages');
  el.innerHTML = '';
  msgs.forEach(appendMsg);
});
socket.on('chat_message', appendMsg);

// ── Status ──────────────────────────────────────────────
function setStatus(status) {
  const dot = document.querySelector('.dot');
  const label = document.getElementById('statusLabel');
  dot.className = `dot ${status}`;
  label.textContent = status === 'off' ? 'Offline' : status === 'live' ? 'En Vivo' : 'On Air';
}

// ── Now Playing ──────────────────────────────────────────────
function setNowPlaying(track, index) {
  const el = document.getElementById('npTrackName');
  if (track) {
    el.textContent = track.name;
    audio.src = track.url;
    audio.play().catch(() => {});
  } else {
    el.textContent = '— nada —';
    audio.pause();
    audio.src = '';
  }
  renderPlaylistHighlight(index);
}

// ── Playlist ──────────────────────────────────────────────
let playlist = [];

function populateDeckSelects(pl) {
  ['A','B'].forEach(deck => {
    const sel = document.getElementById(`deck${deck}Select`);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">Elegir de playlist…</option>';
    pl.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.url;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });
    if (cur) sel.value = cur;
  });
}

function renderPlaylist(pl) {
  playlist = pl;
  populateDeckSelects(pl);
  const el = document.getElementById('playlistList');
  el.innerHTML = '';
  pl.forEach((track, i) => {
    const div = document.createElement('div');
    div.className = 'playlist-item';
    div.dataset.id = track.id;
    div.innerHTML = `
      <span class="pi-idx">${i + 1}</span>
      <span class="pi-name">${escHtml(track.name)}</span>
      <span class="pi-type">${track.type}</span>
      <button class="pi-del" onclick="deleteTrack('${track.id}',event)" title="Eliminar">✕</button>`;
    div.addEventListener('click', () => playTrack(i));
    el.appendChild(div);
  });
}

function renderPlaylistHighlight(index) {
  document.querySelectorAll('.playlist-item').forEach((el, i) => {
    el.classList.toggle('active', i === index);
  });
}

async function playTrack(index) {
  await fetch('/api/play', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ index }),
  });
}

async function stopRadio() {
  await fetch('/api/stop', { method: 'POST' });
}

function nextTrack() {
  socket.emit('next_track');
}

async function deleteTrack(id, e) {
  e.stopPropagation();
  await fetch(`/api/playlist/${id}`, { method: 'DELETE' });
}

// ── Upload ──────────────────────────────────────────────
const dropZone = document.getElementById('dropZone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  uploadFiles(e.dataTransfer.files);
});

async function uploadFiles(files) {
  const fd = new FormData();
  for (const f of files) fd.append('tracks', f);
  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.ok) showToast(`✅ ${data.added.length} archivo(s) subido(s)`);
}

function isYouTubeUrl(url) {
  return /youtube\.com\/(watch|live|shorts)|youtu\.be\//.test(url);
}

let ytInfoTimer = null;
async function onUrlInput(val) {
  clearTimeout(ytInfoTimer);
  const preview = document.getElementById('ytPreview');
  if (!isYouTubeUrl(val)) { preview.style.display = 'none'; return; }
  ytInfoTimer = setTimeout(async () => {
    try {
      const res = await fetch('/api/yt-info?url=' + encodeURIComponent(val));
      if (!res.ok) return;
      const data = await res.json();
      document.getElementById('ytTitle').textContent = data.title;
      document.getElementById('ytDur').textContent = data.duration
        ? `⏱ ${Math.floor(data.duration/60)}:${String(data.duration%60).padStart(2,'0')}`
        : '';
      document.getElementById('ytThumb').src = data.thumbnail || '';
      document.getElementById('urlName').value = data.title;
      preview.style.display = 'flex';
    } catch(e) {}
  }, 600);
}

async function addUrl() {
  const rawUrl = document.getElementById('urlInput').value.trim();
  const name = document.getElementById('urlName').value.trim();
  if (!rawUrl) return;

  // Si es YouTube → usar el proxy del servidor para que el browser pueda reproducirlo
  const url = isYouTubeUrl(rawUrl)
    ? `/api/yt-stream?url=${encodeURIComponent(rawUrl)}`
    : rawUrl;

  await fetch('/api/playlist/add-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, name: name || rawUrl }),
  });
  document.getElementById('urlInput').value = '';
  document.getElementById('urlName').value = '';
  document.getElementById('ytPreview').style.display = 'none';
}

// ── Live desde navegador ──────────────────────────────────────────────
let mediaRecorder = null;
let liveStream = null;
let meterCtx = null;
let meterAnalyser = null;
let meterAnim = null;

// Cargar dispositivos de audio disponibles
(async function loadAudioDevices() {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop()));
    const devices = await navigator.mediaDevices.enumerateDevices();
    const sel = document.getElementById('audioSource');
    sel.innerHTML = '';
    devices.filter(d => d.kind === 'audioinput').forEach(d => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || `Micrófono ${sel.options.length + 1}`;
      sel.appendChild(o);
    });
  } catch(e) {}
})();

async function startBrowserLive() {
  try {
    const deviceId = document.getElementById('audioSource').value;
    const bitrate = parseInt(document.getElementById('audioBitrate').value);

    const constraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true };
    liveStream = await navigator.mediaDevices.getUserMedia(constraints);

    // Medidor de nivel
    const audioCtx = new AudioContext();
    meterAnalyser = audioCtx.createAnalyser();
    meterAnalyser.fftSize = 256;
    audioCtx.createMediaStreamSource(liveStream).connect(meterAnalyser);
    drawMeter();

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/webm';

    mediaRecorder = new MediaRecorder(liveStream, { mimeType, audioBitsPerSecond: bitrate });
    mediaRecorder.ondataavailable = async (e) => {
      if (e.data.size > 0) {
        const buf = await e.data.arrayBuffer();
        socket.emit('live_audio_chunk', buf);
      }
    };
    mediaRecorder.start(250);

    await fetch('/api/live-browser', { method: 'POST' });

    document.getElementById('btnBrowserLive').style.display = 'none';
    document.getElementById('btnStopBrowserLive').style.display = '';
    showToast('🎙️ ¡Estás en el aire!');
  } catch(e) {
    showToast('Error: ' + e.message);
  }
}

function stopBrowserLive() {
  if (mediaRecorder) { mediaRecorder.stop(); mediaRecorder = null; }
  if (liveStream) { liveStream.getTracks().forEach(t => t.stop()); liveStream = null; }
  if (meterAnim) { cancelAnimationFrame(meterAnim); meterAnim = null; }
  document.getElementById('meterBar').style.width = '0%';
  document.getElementById('btnBrowserLive').style.display = '';
  document.getElementById('btnStopBrowserLive').style.display = 'none';
  stopRadio();
}

function drawMeter() {
  if (!meterAnalyser) return;
  const data = new Uint8Array(meterAnalyser.frequencyBinCount);
  meterAnalyser.getByteFrequencyData(data);
  const avg = data.reduce((a, b) => a + b, 0) / data.length;
  document.getElementById('meterBar').style.width = Math.min(100, avg * 2) + '%';
  meterAnim = requestAnimationFrame(drawMeter);
}

// ── Live externo (Icecast) ──────────────────────────────────────────────
async function goLive() {
  const streamUrl = document.getElementById('liveUrl').value.trim();
  await fetch('/api/live', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ streamUrl }),
  });
}

// ── Publicidades ──────────────────────────────────────────────
(function loadVoices() {
  function populate() {
    const sel = document.getElementById('adVoice');
    sel.innerHTML = '';
    const voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith('es'));
    const all = speechSynthesis.getVoices();
    const list = voices.length ? voices : all;
    list.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      sel.appendChild(opt);
    });
  }
  populate();
  speechSynthesis.addEventListener('voiceschanged', populate);
})();

document.getElementById('adRate').addEventListener('input', function() {
  document.getElementById('adRateLabel').textContent = `${this.value}x`;
});
document.getElementById('adPitch').addEventListener('input', function() {
  document.getElementById('adPitchLabel').textContent = this.value;
});

function buildUtterance(text) {
  const utt = new SpeechSynthesisUtterance(text);
  const selVoice = document.getElementById('adVoice').value;
  const voice = speechSynthesis.getVoices().find(v => v.name === selVoice);
  if (voice) utt.voice = voice;
  utt.lang = voice ? voice.lang : 'es-AR';
  utt.rate = parseFloat(document.getElementById('adRate').value);
  utt.pitch = parseFloat(document.getElementById('adPitch').value);
  return utt;
}

function previewAd() {
  const text = document.getElementById('adText').value.trim();
  if (!text) return;
  speechSynthesis.cancel();
  speechSynthesis.speak(buildUtterance(text));
}

function broadcastAd() {
  const text = document.getElementById('adText').value.trim();
  const banner = document.getElementById('adBanner').value.trim();
  if (!text && !banner) return;
  // Emitir a todos los oyentes vía socket
  socket.emit('ad_broadcast_admin', { text, banner });
  previewAd();
  showToast('📢 Publicidad emitida al aire');
}

// El servidor debe retransmitir ad_broadcast_admin → ad_broadcast a todos
// (lo manejamos agregando el listener en server.js vía evento)

let scheduleTimer = null;
function scheduleAd() {
  const mins = parseInt(document.getElementById('adInterval').value) || 30;
  if (scheduleTimer) clearInterval(scheduleTimer);
  scheduleTimer = setInterval(() => broadcastAd(), mins * 60 * 1000);
  document.getElementById('scheduleStatus').textContent =
    `⏱ Publicidad programada cada ${mins} minutos`;
  showToast(`⏱ Publicidad programada cada ${mins} min`);
}

function cancelSchedule() {
  if (scheduleTimer) { clearInterval(scheduleTimer); scheduleTimer = null; }
  document.getElementById('scheduleStatus').textContent = '';
  showToast('Programación cancelada');
}

// ── Ajustes ──────────────────────────────────────────────
async function saveStationName() {
  const name = document.getElementById('stationNameInput').value.trim();
  if (!name) return;
  await fetch('/api/station-name', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  showToast('✅ Nombre guardado');
}

// ── Chat ──────────────────────────────────────────────
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
  const text = document.getElementById('chatText').value.trim();
  if (!text) return;
  socket.emit('chat_message', { user: 'DJ', text, role: 'dj' });
  document.getElementById('chatText').value = '';
}

// ── Ad tabs ──────────────────────────────────────────────
function switchAdTab(name, btn) {
  document.querySelectorAll('.ad-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.ad-tab-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('adtab-' + name).classList.add('active');
}

// ── Ad file upload / record / library ──────────────────────────────────────────────
let adRecorder = null, adRecordStream = null, adRecordChunks = [];

async function uploadAdFile(file) {
  if (!file) return;
  const name = document.getElementById('adFileName').value.trim() || file.name.replace(/\.[^/.]+$/, '');
  const fd = new FormData();
  fd.append('ad_file', file);
  fd.append('name', name);
  const res = await fetch('/api/ads/upload', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.ok) { showToast('✅ Publicidad subida: ' + data.ad.name); loadAdLibrary(); }
  else showToast('Error: ' + data.error);
}

async function toggleRecordAd() {
  const btn = document.getElementById('btnRecordAd');
  const status = document.getElementById('recordAdStatus');
  if (adRecorder) {
    adRecorder.stop();
    return;
  }
  adRecordChunks = [];
  adRecordStream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(e => { showToast('Error mic: ' + e.message); return null; });
  if (!adRecordStream) return;
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  adRecorder = new MediaRecorder(adRecordStream, { mimeType: mime });
  adRecorder.ondataavailable = e => { if (e.data.size > 0) adRecordChunks.push(e.data); };
  adRecorder.onstop = async () => {
    adRecordStream.getTracks().forEach(t => t.stop());
    adRecordStream = null; adRecorder = null;
    btn.textContent = '⏺ Grabar voz';
    status.textContent = 'Procesando…';
    const blob = new Blob(adRecordChunks, { type: mime });
    const name = document.getElementById('adFileName').value.trim() || 'grabacion_' + Date.now();
    const fd = new FormData();
    fd.append('ad_file', blob, name + '.webm');
    fd.append('name', name);
    const res = await fetch('/api/ads/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.ok) { showToast('✅ Grabación guardada'); loadAdLibrary(); status.textContent = ''; }
    else status.textContent = 'Error: ' + data.error;
  };
  adRecorder.start(100);
  btn.textContent = '⏹ Detener grabación';
  status.textContent = '🔴 Grabando…';
}

async function loadAdLibrary() {
  const res = await fetch('/api/ads');
  const ads = await res.json();
  const el = document.getElementById('adLibrary');
  if (!el) return;
  el.innerHTML = '';
  if (!ads.length) { el.innerHTML = '<div style="color:var(--muted);font-size:.85rem">No hay publicidades cargadas.</div>'; return; }
  ads.forEach(ad => {
    const div = document.createElement('div');
    div.className = 'playlist-item';
    div.innerHTML = `
      <span class="pi-idx">${ad.type === 'video' ? '🎬' : '🔊'}</span>
      <span class="pi-name">${escHtml(ad.name)}</span>
      <button class="btn-secondary" style="padding:3px 10px;font-size:.78rem" onclick="playAdNow('${ad.id}')">📢 Emitir</button>
      <button class="pi-del" onclick="deleteAd('${ad.id}',event)" title="Eliminar">✕</button>`;
    el.appendChild(div);
  });
}

async function playAdNow(id) {
  await fetch('/api/ads/play/' + id, { method: 'POST' });
  showToast('📢 Publicidad enviada al aire');
}

async function deleteAd(id, e) {
  e.stopPropagation();
  await fetch('/api/ads/' + id, { method: 'DELETE' });
  loadAdLibrary();
}

socket.on('ads_update', () => loadAdLibrary());

let adRotationTimer = null, adRotationIndex = 0;
async function startAdRotation() {
  stopAdRotation();
  const mins = parseInt(document.getElementById('adFileInterval').value) || 30;
  const res = await fetch('/api/ads');
  const ads = await res.json();
  if (!ads.length) { showToast('No hay publicidades en la biblioteca'); return; }
  adRotationTimer = setInterval(async () => {
    const freshRes = await fetch('/api/ads');
    const freshAds = await freshRes.json();
    if (!freshAds.length) return;
    adRotationIndex = adRotationIndex % freshAds.length;
    await fetch('/api/ads/play/' + freshAds[adRotationIndex].id, { method: 'POST' });
    adRotationIndex++;
  }, mins * 60 * 1000);
  document.getElementById('adRotationStatus').textContent = `⏱ Rotando cada ${mins} min`;
  showToast(`⏱ Rotación cada ${mins} min activada`);
}

function stopAdRotation() {
  if (adRotationTimer) { clearInterval(adRotationTimer); adRotationTimer = null; }
  const el = document.getElementById('adRotationStatus');
  if (el) el.textContent = '';
}

// ── AI TTS ──────────────────────────────────────────────
const TTS_VOICES = {
  elevenlabs: [
    { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam (masculino neutro)' },
    { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella (femenino suave)' },
    { id: 'VR6AewLTigWG4xSOukaG', label: 'Arnold (masculino profundo)' },
    { id: 'MF3mGyEYCl7XYWbV9V6O', label: 'Elli (femenino joven)' },
    { id: 'TxGEqnHWrfWFTfGW9XjX', label: 'Josh (masculino cálido)' },
  ],
  azure: [
    { id: 'es-AR-TomasNeural',       label: '🇦🇷 Tomás (argentino masculino)',   lang: 'es-AR' },
    { id: 'es-AR-ElenaNeural',       label: '🇦🇷 Elena (argentina femenino)',    lang: 'es-AR' },
    { id: 'pt-BR-FranciscaNeural',   label: '🇧🇷 Francisca (brasileña fem.)',   lang: 'pt-BR' },
    { id: 'pt-BR-AntonioNeural',     label: '🇧🇷 Antonio (brasileño masc.)',    lang: 'pt-BR' },
    { id: 'es-MX-DaliaNeural',       label: '🇲🇽 Dalia (mexicana femenino)',    lang: 'es-MX' },
    { id: 'es-ES-AlvaroNeural',      label: '🇪🇸 Álvaro (español masculino)',   lang: 'es-ES' },
  ],
};

function updateTTSVoices() {
  const provider = document.getElementById('ttsProvider').value;
  const sel = document.getElementById('ttsVoice');
  sel.innerHTML = '';
  TTS_VOICES[provider].forEach(v => {
    const o = document.createElement('option');
    o.value = v.id; o.textContent = v.label; o.dataset.lang = v.lang || '';
    sel.appendChild(o);
  });
  const link = document.getElementById('ttsKeyLink');
  const regionRow = document.getElementById('ttsRegionRow');
  if (provider === 'elevenlabs') {
    link.href = 'https://elevenlabs.io'; link.textContent = 'Obtener API key gratis (10k chars/mes) →';
    regionRow.style.display = 'none';
  } else {
    link.href = 'https://azure.microsoft.com/free/cognitive-services/'; link.textContent = 'Obtener API key Azure gratis →';
    regionRow.style.display = '';
  }
  const saved = localStorage.getItem('ttsApiKey_' + provider);
  if (saved) document.getElementById('ttsApiKey').value = saved;
  else document.getElementById('ttsApiKey').value = '';
}

function saveTTSKey() {
  const provider = document.getElementById('ttsProvider').value;
  localStorage.setItem('ttsApiKey_' + provider, document.getElementById('ttsApiKey').value);
}

async function callTTS(text) {
  const provider = document.getElementById('ttsProvider').value;
  const apiKey   = document.getElementById('ttsApiKey').value.trim();
  const voiceEl  = document.getElementById('ttsVoice');
  const voiceId  = voiceEl.value;
  const language = voiceEl.selectedOptions[0]?.dataset.lang || 'es-AR';
  const region   = document.getElementById('ttsRegion')?.value || 'eastus';
  const status   = document.getElementById('ttsStatus');

  if (!apiKey) { showToast('Ingresá tu API key primero'); return null; }
  status.textContent = '⏳ Generando audio con IA…';
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, provider, apiKey, voiceId, language, region }),
    });
    if (!res.ok) { const err = await res.json(); status.textContent = '❌ ' + (err.error || res.status); return null; }
    const blob = await res.blob();
    status.textContent = '✅ Audio generado';
    return URL.createObjectURL(blob);
  } catch(e) { status.textContent = '❌ ' + e.message; return null; }
}

async function previewTTS() {
  const text = document.getElementById('ttsText').value.trim();
  if (!text) return;
  const url = await callTTS(text);
  if (url) new Audio(url).play();
}

async function broadcastTTS() {
  const text = document.getElementById('ttsText').value.trim();
  if (!text) return;
  const url = await callTTS(text);
  if (!url) return;
  // Subir el audio generado como ad temporal y emitirlo
  const blob = await fetch(url).then(r => r.blob());
  const name = 'tts_' + Date.now();
  const fd = new FormData();
  fd.append('ad_file', blob, name + '.mp3');
  fd.append('name', 'TTS: ' + text.slice(0, 40));
  const res = await fetch('/api/ads/upload', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.ok) {
    await fetch('/api/ads/play/' + data.ad.id, { method: 'POST' });
    showToast('📢 Voz IA emitida al aire');
    loadAdLibrary();
  }
}

// ── Screen share / webcam ──────────────────────────────────────────────
let screenStream = null, screenRecorder = null, rtmpRecorder = null;

const RTMP_BASES = {
  tiktok:  'rtmps://live-push.tiktok.com/live/',
  youtube: 'rtmp://a.rtmp.youtube.com/live2/',
  twitch:  'rtmp://live.twitch.tv/live/',
  custom:  '',
};

function updateRtmpUrl() {
  const plat = document.getElementById('rtmpPlatform').value;
  document.getElementById('rtmpCustomWrap').style.display = plat === 'custom' ? '' : 'none';
}

async function startScreenShare() {
  const src = document.getElementById('streamSourceSel').value;
  const height = parseInt(document.getElementById('streamQuality').value);
  try {
    let stream;
    if (src === 'screen' || src === 'window') {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { height }, audio: true });
    } else if (src === 'camera') {
      stream = await navigator.mediaDevices.getUserMedia({ video: { height }, audio: true });
    } else {
      const [cam, scr] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ video: { height }, audio: true }),
        navigator.mediaDevices.getDisplayMedia({ video: { height }, audio: false }),
      ]);
      // merge tracks
      stream = new MediaStream([...cam.getTracks(), ...scr.getVideoTracks()]);
    }
    screenStream = stream;
    const preview = document.getElementById('adminPreview');
    preview.srcObject = stream;
    preview.style.display = 'block';

    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus' : 'video/webm';
    screenRecorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_500_000 });
    screenRecorder.ondataavailable = async e => {
      if (e.data.size > 0) {
        const buf = await e.data.arrayBuffer();
        socket.emit('video_chunk', buf);
        if (rtmpRecorder) socket.emit('rtmp_chunk', buf);
      }
    };
    screenRecorder.start(500);

    document.getElementById('btnStartStream').style.display = 'none';
    document.getElementById('btnStopStream').style.display = '';
    showToast('📺 Transmisión de video iniciada');

    stream.getVideoTracks()[0].addEventListener('ended', stopScreenShare);
  } catch(e) {
    if (e.name !== 'NotAllowedError') showToast('Error: ' + e.message);
  }
}

function stopScreenShare() {
  if (screenRecorder) { screenRecorder.stop(); screenRecorder = null; }
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
  document.getElementById('adminPreview').style.display = 'none';
  document.getElementById('adminPreview').srcObject = null;
  document.getElementById('btnStartStream').style.display = '';
  document.getElementById('btnStopStream').style.display = 'none';
  socket.emit('screen_share_stop');
  showToast('Transmisión de video detenida');
}

async function startRtmp() {
  const plat = document.getElementById('rtmpPlatform').value;
  const key  = document.getElementById('rtmpKey').value.trim();
  let rtmpUrl;
  if (plat === 'custom') {
    rtmpUrl = document.getElementById('rtmpCustomUrl').value.trim();
  } else {
    if (!key) { showToast('Ingresá tu stream key'); return; }
    rtmpUrl = RTMP_BASES[plat] + key;
  }
  if (!rtmpUrl) { showToast('URL RTMP inválida'); return; }
  const res = await fetch('/api/rtmp/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rtmpUrl }),
  });
  const data = await res.json();
  if (!data.ok) { showToast('Error RTMP: ' + (data.error || '')); return; }
  rtmpRecorder = true;
  document.getElementById('btnRtmpStart').style.display = 'none';
  document.getElementById('btnRtmpStop').style.display = '';
  document.getElementById('rtmpStatus').textContent = '🔴 Restreaming a ' + plat;
  showToast('🔴 Restream iniciado');
}

async function stopRtmp() {
  await fetch('/api/rtmp/stop', { method: 'POST' });
  rtmpRecorder = null;
  document.getElementById('btnRtmpStart').style.display = '';
  document.getElementById('btnRtmpStop').style.display = 'none';
  document.getElementById('rtmpStatus').textContent = '';
  showToast('Restream detenido');
}

socket.on('rtmp_status', on => {
  if (!on) { rtmpRecorder = null; document.getElementById('btnRtmpStart').style.display = ''; document.getElementById('btnRtmpStop').style.display = 'none'; }
});

async function saveMPToken() {
  const token = document.getElementById('mpToken').value;
  await fetch('/api/mp-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
}

function saveDonateSettings() {
  saveMPToken();
  showToast('✅ Config de donaciones guardada');
}

// Inicializar al cargar
document.addEventListener('DOMContentLoaded', () => {
  updateTTSVoices();
  loadAdLibrary();
  updateRtmpUrl();
  // TikTok pre-seleccionado
  const plat = document.getElementById('rtmpPlatform');
  if (plat) plat.value = 'tiktok';
  // Mostrar webhook URL
  fetch('/api/server-info').then(r => r.json()).then(info => {
    const ip = info.ips[0] || 'TU-IP';
    const el = document.getElementById('webhookUrl');
    if (el) el.textContent = `http://${ip}:${info.port}/api/mp-webhook`;
  }).catch(() => {});
});

// ── Monitor toggle (sin eco en la bandeja admin) ──────────────────────────────
let monitorEnabled = false;
function toggleMonitor() {
  monitorEnabled = !monitorEnabled;
  audio.muted = !monitorEnabled;
  const btn = document.getElementById('btnMonitor');
  btn.textContent = monitorEnabled ? '🔊 Monitor: ON' : '🔇 Monitor: OFF';
  btn.classList.toggle('monitor-on', monitorEnabled);
}

// ── DJ Mixer ──────────────────────────────────────────────────────────────────
let djCtx = null, djDest = null, djMasterGain = null, djMonitorGain = null;
let deckAEl = null, deckBEl = null;
let deckAGain = null, deckBGain = null;
let deckAVolGain = null, deckBVolGain = null;
let djRecorder = null;
let djLocalMicStream = null, djLocalMicNode = null;
let djRemoteMicEl = null, djRemoteMicGain = null;
let djRemoteMse = null, djRemoteMseBuf = null, djRemoteMseQueue = [];
let djCrossfadeTimer = null;

function initDJContext() {
  if (djCtx) return;
  djCtx = new AudioContext({ latencyHint: 'playback', sampleRate: 44100 });
  djDest = djCtx.createMediaStreamDestination();
  djMasterGain = djCtx.createGain();
  djMonitorGain = djCtx.createGain();
  djMonitorGain.gain.value = 0; // auriculares off por defecto

  djMasterGain.connect(djDest);          // → broadcast
  djMasterGain.connect(djMonitorGain);
  djMonitorGain.connect(djCtx.destination); // → auriculares del DJ

  // Deck A
  deckAEl = new Audio(); deckAEl.crossOrigin = 'anonymous';
  const srcA = djCtx.createMediaElementSource(deckAEl);
  deckAVolGain = djCtx.createGain(); deckAVolGain.gain.value = 1;
  deckAGain    = djCtx.createGain(); deckAGain.gain.value = 1;
  srcA.connect(deckAVolGain); deckAVolGain.connect(deckAGain); deckAGain.connect(djMasterGain);

  // Deck B
  deckBEl = new Audio(); deckBEl.crossOrigin = 'anonymous';
  const srcB = djCtx.createMediaElementSource(deckBEl);
  deckBVolGain = djCtx.createGain(); deckBVolGain.gain.value = 1;
  deckBGain    = djCtx.createGain(); deckBGain.gain.value = 0;
  srcB.connect(deckBVolGain); deckBVolGain.connect(deckBGain); deckBGain.connect(djMasterGain);

  // Mic remoto (se alimenta por MSE)
  djRemoteMicEl = document.createElement('audio');
  djRemoteMicEl.crossOrigin = 'anonymous';
  document.body.appendChild(djRemoteMicEl);
  const srcRemote = djCtx.createMediaElementSource(djRemoteMicEl);
  djRemoteMicGain = djCtx.createGain(); djRemoteMicGain.gain.value = 0;
  srcRemote.connect(djRemoteMicGain); djRemoteMicGain.connect(djMasterGain);

  // Mostrar URL del servidor para el mic remoto
  fetch('/api/server-info').then(r => r.json()).then(info => {
    const url = info.ips[0] ? `http://${info.ips[0]}:${info.port}/remote-mic.html` : '';
    document.getElementById('remoteMicUrl').textContent = url ? `Abrir en otra PC: ${url}` : '';
  }).catch(() => {});
}

function loadDeckFromSelect(deck) {
  const sel = document.getElementById(`deck${deck}Select`);
  const opt = sel.options[sel.selectedIndex];
  if (!opt || !opt.value) return;
  loadDeck(deck, opt.value, opt.textContent);
}

function loadDeckFromUrl(deck) {
  const url = document.getElementById(`deck${deck}Url`).value.trim();
  if (!url) return;
  loadDeck(deck, url, url);
}

function loadDeck(deck, url, name) {
  initDJContext();
  if (djCtx.state === 'suspended') djCtx.resume();
  const el = deck === 'A' ? deckAEl : deckBEl;
  el.src = url;
  el.load();
  document.getElementById(`deck${deck}Name`).textContent = name || url;
  document.getElementById(`deck${deck}PlayBtn`).textContent = '▶ Play';
}

function toggleDeck(deck) {
  initDJContext();
  if (djCtx.state === 'suspended') djCtx.resume();
  const el = deck === 'A' ? deckAEl : deckBEl;
  const btn = document.getElementById(`deck${deck}PlayBtn`);
  if (el.paused) { el.play().catch(() => {}); btn.textContent = '⏸ Pause'; }
  else            { el.pause();                 btn.textContent = '▶ Play'; }
}

function cueDeck(deck) {
  const el = deck === 'A' ? deckAEl : deckBEl;
  el.currentTime = 0;
  el.pause();
  document.getElementById(`deck${deck}PlayBtn`).textContent = '▶ Play';
}

function setDeckVol(deck, v) {
  initDJContext();
  (deck === 'A' ? deckAVolGain : deckBVolGain).gain.value = parseFloat(v);
}

function setDeckPitch(deck, v) {
  const el = deck === 'A' ? deckAEl : deckBEl;
  el.playbackRate = parseFloat(v);
  document.getElementById(`deck${deck}PitchVal`).textContent = parseFloat(v).toFixed(2);
}

function updateDJCrossfade(val) {
  initDJContext();
  const pos = parseInt(val) / 100;
  deckAGain.gain.value = Math.cos(pos * Math.PI / 2);
  deckBGain.gain.value = Math.cos((1 - pos) * Math.PI / 2);
}

function autoCrossfade(fromVal, toVal, durationMs = 3000) {
  if (djCrossfadeTimer) clearInterval(djCrossfadeTimer);
  initDJContext();
  const slider = document.getElementById('djCrossfader');
  const steps = 60, stepMs = durationMs / steps;
  let step = 0;
  djCrossfadeTimer = setInterval(() => {
    step++;
    const t = step / steps;
    const val = fromVal + (toVal - fromVal) * t;
    slider.value = val;
    updateDJCrossfade(val);
    if (step >= steps) { clearInterval(djCrossfadeTimer); djCrossfadeTimer = null; }
  }, stepMs);
}

function toggleDJMonitor() {
  initDJContext();
  const isOn = djMonitorGain.gain.value > 0;
  djMonitorGain.gain.value = isOn ? 0 : 1;
  const btn = document.getElementById('btnDJMonitor');
  btn.textContent = isOn ? '🔇 Auriculares: OFF' : '🔊 Auriculares: ON';
}

async function startDJBroadcast() {
  initDJContext();
  if (djCtx.state === 'suspended') await djCtx.resume();
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  djRecorder = new MediaRecorder(djDest.stream, { mimeType: mime, audioBitsPerSecond: 128000 });
  djRecorder.ondataavailable = async e => {
    if (e.data.size > 0) socket.emit('live_audio_chunk', await e.data.arrayBuffer());
  };
  djRecorder.start(250);
  await fetch('/api/live-browser', { method: 'POST' });
  document.getElementById('btnDJBroadcast').style.display = 'none';
  document.getElementById('btnDJStop').style.display = '';
  showToast('🎛️ Mesa DJ al aire!');
}

function stopDJBroadcast() {
  if (djRecorder) { djRecorder.stop(); djRecorder = null; }
  document.getElementById('btnDJBroadcast').style.display = '';
  document.getElementById('btnDJStop').style.display = 'none';
  stopRadio();
}

// Mic local en el mezclador DJ
async function toggleDJLocalMic(on) {
  initDJContext();
  if (on) {
    try {
      djLocalMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const src = djCtx.createMediaStreamSource(djLocalMicStream);
      djLocalMicNode = djCtx.createGain(); djLocalMicNode.gain.value = 1;
      src.connect(djLocalMicNode); djLocalMicNode.connect(djMasterGain);
    } catch(e) {
      showToast('Error mic: ' + e.message);
      document.getElementById('chkLocalMic').checked = false;
    }
  } else {
    if (djLocalMicStream) { djLocalMicStream.getTracks().forEach(t => t.stop()); djLocalMicStream = null; }
  }
}

// Mic remoto en el mezclador DJ (recibe chunks vía socket → MSE)
function toggleDJRemoteMic(on) {
  initDJContext();
  djRemoteMicGain.gain.value = on ? 1 : 0;
  if (on) {
    setupDJRemoteMSE();
  } else {
    djRemoteMse = null; djRemoteMseBuf = null; djRemoteMseQueue = [];
    djRemoteMicEl.pause(); djRemoteMicEl.src = '';
  }
}

function setupDJRemoteMSE() {
  djRemoteMse = new MediaSource();
  djRemoteMicEl.src = URL.createObjectURL(djRemoteMse);
  djRemoteMse.addEventListener('sourceopen', () => {
    const mime = 'audio/webm;codecs=opus';
    if (!MediaSource.isTypeSupported(mime)) return;
    djRemoteMseBuf = djRemoteMse.addSourceBuffer(mime);
    djRemoteMseBuf.mode = 'sequence';
    djRemoteMseBuf.addEventListener('updateend', flushDJRemoteMSE);
    flushDJRemoteMSE();
  });
  djRemoteMicEl.play().catch(() => {});
}

function flushDJRemoteMSE() {
  if (!djRemoteMseBuf || djRemoteMseBuf.updating || djRemoteMseQueue.length === 0) return;
  try {
    const chunk = djRemoteMseQueue.shift();
    djRemoteMseBuf.appendBuffer(chunk instanceof ArrayBuffer ? chunk : chunk.buffer);
  } catch(e) {}
}

socket.on('remote_mic_chunk', chunk => {
  if (!document.getElementById('chkRemoteMic').checked) return;
  djRemoteMseQueue.push(chunk);
  flushDJRemoteMSE();
});

socket.on('remote_mic_status', connected => {
  const dot = document.getElementById('remoteMicDot');
  const ind = document.getElementById('remoteMicIndicator');
  if (dot) dot.style.color = connected ? '#4ade80' : '#666';
  if (ind) ind.style.display = connected ? 'block' : 'none';
  initDJContext(); // carga la URL del servidor al conectar
});

// ── Utils ──────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, {
    position:'fixed', bottom:'24px', right:'24px', background:'#222228',
    color:'#f0f0f0', border:'1px solid #2a2a32', borderRadius:'8px',
    padding:'10px 18px', fontSize:'0.88rem', zIndex:'9999',
    boxShadow:'0 4px 20px rgba(0,0,0,.4)', opacity:'1', transition:'opacity .4s',
  });
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 2800);
}
