const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const IS_WIN  = process.platform === 'win32';
const YT_DLP  = process.env.YT_DLP_PATH  || (IS_WIN ? path.join(__dirname, 'yt-dlp.exe') : 'yt-dlp');
const FFMPEG  = process.env.FFMPEG_PATH  || (IS_WIN
  ? 'C:\\Users\\dataw\\AppData\\Local\\Microsoft\\WinGet\\Packages\\yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-N-124716-g054dffd133-win64-gpl\\bin\\ffmpeg.exe'
  : 'ffmpeg');
const ADS_DIR = path.join(__dirname, 'public', 'ads');
if (!fs.existsSync(ADS_DIR)) fs.mkdirSync(ADS_DIR, { recursive: true });

// Estado de ads
let adsList = [];
let adScheduleTimer = null;
let rtmpProc = null;

function loadAdsFromDisk() {
  adsList = fs.readdirSync(ADS_DIR)
    .filter(f => /\.(mp3|ogg|wav|m4a|mp4|webm)$/i.test(f))
    .map(f => ({ id: f, name: f.replace(/\.[^/.]+$/, ''), url: `/ads/${f}`, type: f.match(/\.(mp4|webm)$/i) ? 'video' : 'audio' }));
}
loadAdsFromDisk();

function isYouTubeUrl(url) {
  return /youtube\.com\/(watch|live|shorts)|youtu\.be\//.test(url);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 8001;
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');

// Estado global de la radio
const radioState = {
  status: 'off',        // 'off' | 'playing' | 'live'
  currentTrack: null,
  playlist: [],
  currentIndex: -1,
  listeners: 0,
  stationName: 'Mi Radio Local',
  streamUrl: '',
  mpAccessToken: '',
};

// Cargar playlist desde archivos subidos al arrancar
function loadExistingTracks() {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const files = fs.readdirSync(UPLOADS_DIR).filter(f => /\.(mp3|ogg|wav|flac|m4a)$/i.test(f));
  radioState.playlist = files.map(f => ({
    id: Date.now() + Math.random(),
    name: f.replace(/\.[^/.]+$/, ''),
    file: f,
    type: 'upload',
    url: `/uploads/${f}`,
  }));
}
loadExistingTracks();

// Multer para subida de audio
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, safe);
  },
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// ── API REST ──────────────────────────────────────────────
app.get('/api/state', (req, res) => res.json(radioState));

app.post('/api/upload', upload.array('tracks'), (req, res) => {
  const added = req.files.map(f => {
    const track = {
      id: Date.now() + Math.random(),
      name: f.originalname.replace(/\.[^/.]+$/, ''),
      file: f.filename,
      type: 'upload',
      url: `/uploads/${f.filename}`,
    };
    if (!radioState.playlist.find(t => t.file === f.filename)) {
      radioState.playlist.push(track);
    }
    return track;
  });
  io.emit('playlist_update', radioState.playlist);
  res.json({ ok: true, added });
});

app.post('/api/playlist/add-url', (req, res) => {
  const { url, name } = req.body;
  if (!url) return res.status(400).json({ error: 'url requerida' });
  const track = { id: Date.now(), name: name || url, url, type: 'url' };
  radioState.playlist.push(track);
  io.emit('playlist_update', radioState.playlist);
  res.json({ ok: true, track });
});

app.delete('/api/playlist/:id', (req, res) => {
  radioState.playlist = radioState.playlist.filter(t => String(t.id) !== req.params.id);
  io.emit('playlist_update', radioState.playlist);
  res.json({ ok: true });
});

app.post('/api/play', (req, res) => {
  const { index } = req.body;
  if (index >= 0 && index < radioState.playlist.length) {
    radioState.currentIndex = index;
    radioState.currentTrack = radioState.playlist[index];
    radioState.status = 'playing';
    io.emit('track_change', { track: radioState.currentTrack, index });
    io.emit('status_change', radioState.status);
  }
  res.json({ ok: true });
});

app.post('/api/stop', (req, res) => {
  radioState.status = 'off';
  radioState.currentTrack = null;
  io.emit('status_change', radioState.status);
  io.emit('track_change', { track: null, index: -1 });
  io.emit('browser_live_stop');
  res.json({ ok: true });
});

// Modo En Vivo desde el navegador (sin Icecast)
app.post('/api/live-browser', (req, res) => {
  radioState.status = 'live';
  radioState.streamUrl = 'browser';
  radioState.currentTrack = { name: '🎙️ En Vivo — Directo', url: null, type: 'browser-live' };
  io.emit('status_change', radioState.status);
  io.emit('track_change', { track: radioState.currentTrack, index: -1 });
  res.json({ ok: true });
});

app.post('/api/live', (req, res) => {
  const { streamUrl } = req.body;
  radioState.status = 'live';
  radioState.streamUrl = streamUrl || '';
  // Usar proxy interno si la URL apunta a Icecast para evitar CORS
  const proxyUrl = streamUrl ? `/api/stream-proxy?url=${encodeURIComponent(streamUrl)}` : streamUrl;
  radioState.currentTrack = { name: 'En Vivo', url: proxyUrl, type: 'live' };
  io.emit('status_change', radioState.status);
  io.emit('track_change', { track: radioState.currentTrack, index: -1 });
  res.json({ ok: true });
});

// Stream de audio de YouTube proxeado por el servidor (usa yt-dlp)
app.get('/api/yt-stream', (req, res) => {
  const url = req.query.url;
  if (!url || !isYouTubeUrl(url)) return res.status(400).send('URL de YouTube inválida');

  res.setHeader('Content-Type', 'audio/webm');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');

  const proc = spawn(YT_DLP, [
    '--no-playlist', '-f', 'bestaudio',
    '--no-part', '-o', '-', url,
  ]);

  proc.stdout.pipe(res);
  req.on('close', () => proc.kill());
  proc.stderr.on('data', d => console.error('[yt-dlp]', d.toString().trim()));
  proc.on('error', err => { if (!res.headersSent) res.status(500).send(err.message); });
});

// Info de un video de YouTube (título, duración) via yt-dlp
app.get('/api/yt-info', (req, res) => {
  const url = req.query.url;
  if (!url || !isYouTubeUrl(url)) return res.status(400).json({ error: 'URL inválida' });

  const proc = spawn(YT_DLP, [
    '--no-playlist', '--print', '%(title)s\n%(duration)s\n%(thumbnail)s', url,
  ]);

  let output = '';
  proc.stdout.on('data', d => { output += d.toString(); });
  proc.stderr.on('data', d => console.error('[yt-dlp info]', d.toString().trim()));
  proc.on('close', code => {
    if (code !== 0) return res.status(500).json({ error: 'yt-dlp falló' });
    const [title, duration, thumbnail] = output.trim().split('\n');
    res.json({ title, duration: parseInt(duration) || 0, thumbnail });
  });
  proc.on('error', err => res.status(500).json({ error: err.message }));
});

// Proxy de stream Icecast → evita CORS en el navegador
app.get('/api/stream-proxy', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('url requerida');

  const parsed = new URL(targetUrl);
  const proto = parsed.protocol === 'https:' ? require('https') : require('http');

  const proxyReq = proto.get(targetUrl, proxyRes => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    proxyRes.pipe(res);
    req.on('close', () => proxyReq.destroy());
  });

  proxyReq.on('error', err => {
    if (!res.headersSent) res.status(502).send('No se pudo conectar al stream: ' + err.message);
  });
});

// ── Mercado Pago webhook ──────────────────────────────────────────────
app.post('/api/mp-webhook', express.json(), async (req, res) => {
  res.sendStatus(200); // MP espera respuesta rápida
  const { action, data } = req.body || {};
  if (!action || !data?.id) return;
  if (!['payment.created', 'payment.updated'].includes(action)) return;

  // Intentar obtener detalles del pago si hay access token configurado
  let donorName = null, amount = null, currency = 'ARS';
  const mpToken = process.env.MP_ACCESS_TOKEN || radioState.mpAccessToken;
  if (mpToken) {
    try {
      const r = await fetch(`https://api.mercadopago.com/v1/payments/${data.id}`, {
        headers: { Authorization: `Bearer ${mpToken}` },
      });
      if (r.ok) {
        const payment = await r.json();
        if (payment.status !== 'approved') return;
        amount    = payment.transaction_amount;
        currency  = payment.currency_id || 'ARS';
        donorName = payment.payer?.first_name || null;
      }
    } catch(e) {}
  }

  io.emit('donation_received', { donorName, amount, currency });
});

app.get('/api/server-info', (req, res) => {
  const os = require('os');
  const ips = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  res.json({ port: PORT, ips });
});

// ── Ads management ──────────────────────────────────────────────
const adStorage = multer.diskStorage({
  destination: ADS_DIR,
  filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')),
});
const adUpload = multer({ storage: adStorage, limits: { fileSize: 200 * 1024 * 1024 } });

app.get('/api/ads', (req, res) => res.json(adsList));

app.post('/api/ads/upload', adUpload.single('ad_file'), (req, res) => {
  const f = req.file;
  if (!f) return res.status(400).json({ error: 'No file' });
  const ad = { id: f.filename, name: req.body.name || f.filename.replace(/\.[^/.]+$/, ''), url: `/ads/${f.filename}`, type: f.mimetype.startsWith('video') ? 'video' : 'audio' };
  adsList.push(ad);
  io.emit('ads_update', adsList);
  res.json({ ok: true, ad });
});

app.delete('/api/ads/:id', (req, res) => {
  const ad = adsList.find(a => a.id === req.params.id);
  if (ad) {
    try { fs.unlinkSync(path.join(ADS_DIR, ad.id)); } catch(e) {}
    adsList = adsList.filter(a => a.id !== req.params.id);
    io.emit('ads_update', adsList);
  }
  res.json({ ok: true });
});

// Broadcast an ad to all listeners
app.post('/api/ads/play/:id', (req, res) => {
  const ad = adsList.find(a => a.id === req.params.id);
  if (!ad) return res.status(404).json({ error: 'Ad not found' });
  io.emit('ad_play', ad);
  res.json({ ok: true });
});

app.use('/ads', express.static(ADS_DIR));

// ── AI TTS proxy (ElevenLabs / Azure) ──────────────────────────────────────────────
app.post('/api/tts', async (req, res) => {
  const { text, provider, apiKey, voiceId, region, language } = req.body;
  if (!text) return res.status(400).json({ error: 'text requerido' });
  try {
    let audioData;
    if (provider === 'elevenlabs') {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId || 'pNInz6obpgDQGcFmaJgB'}`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.45, similarity_boost: 0.80 } }),
      });
      if (!r.ok) return res.status(r.status).json({ error: await r.text() });
      audioData = Buffer.from(await r.arrayBuffer());
      res.setHeader('Content-Type', 'audio/mpeg');
    } else if (provider === 'azure') {
      const reg = region || 'eastus';
      const lang = language || 'es-AR';
      const voice = voiceId || 'es-AR-TomasNeural';
      const ssml = `<speak version='1.0' xml:lang='${lang}'><voice name='${voice}'>${text.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</voice></speak>`;
      const r = await fetch(`https://${reg}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': apiKey, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-160kbitrate-mono-mp3' },
        body: ssml,
      });
      if (!r.ok) return res.status(r.status).json({ error: await r.text() });
      audioData = Buffer.from(await r.arrayBuffer());
      res.setHeader('Content-Type', 'audio/mpeg');
    } else {
      return res.status(400).json({ error: 'provider inválido (elevenlabs | azure)' });
    }
    res.send(audioData);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ── RTMP restream (TikTok / YouTube Live / etc) ──────────────────────────────────────────────
app.post('/api/rtmp/start', (req, res) => {
  const { rtmpUrl } = req.body;
  if (!rtmpUrl) return res.status(400).json({ error: 'rtmpUrl requerida' });
  if (rtmpProc) return res.status(409).json({ error: 'Ya hay un stream activo' });

  rtmpProc = spawn(FFMPEG, [
    '-re', '-f', 'webm', '-i', 'pipe:0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '2500k', '-maxrate', '2500k', '-bufsize', '5000k',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
    '-f', 'flv', rtmpUrl,
  ]);
  rtmpProc.stderr.on('data', d => process.stdout.write('[ffmpeg] ' + d));
  rtmpProc.on('close', () => { rtmpProc = null; io.emit('rtmp_status', false); });
  io.emit('rtmp_status', true);
  res.json({ ok: true });
});

app.post('/api/rtmp/stop', (req, res) => {
  if (rtmpProc) { rtmpProc.kill('SIGKILL'); rtmpProc = null; }
  io.emit('rtmp_status', false);
  res.json({ ok: true });
});

app.post('/api/station-name', (req, res) => {
  const { name } = req.body;
  if (name) { radioState.stationName = name; io.emit('station_name', name); }
  res.json({ ok: true });
});

app.post('/api/mp-token', (req, res) => {
  const { token } = req.body;
  if (token !== undefined) radioState.mpAccessToken = token;
  res.json({ ok: true });
});

// ── Socket.io ──────────────────────────────────────────────
const chatHistory = [];

io.on('connection', socket => {
  radioState.listeners++;
  io.emit('listeners_count', radioState.listeners);

  // Sincronizar estado al nuevo oyente
  socket.emit('state_sync', radioState);
  socket.emit('chat_history', chatHistory.slice(-50));

  socket.on('chat_message', data => {
    const msg = {
      id: Date.now(),
      user: (data.user || 'Anónimo').slice(0, 20),
      text: (data.text || '').slice(0, 300),
      ts: new Date().toISOString(),
      role: data.role || 'listener',  // 'listener' | 'dj'
    };
    chatHistory.push(msg);
    if (chatHistory.length > 200) chatHistory.shift();
    io.emit('chat_message', msg);
  });

  // Admin emite publicidad → retransmitir a todos los oyentes
  socket.on('ad_broadcast_admin', data => {
    io.emit('ad_broadcast', { text: data.text || '', banner: data.banner || '' });
  });

  // Relay de audio en vivo desde el browser del admin → todos los oyentes
  socket.on('live_audio_chunk', (chunk) => {
    socket.broadcast.emit('live_audio_chunk', chunk);
  });

  // Relay de video (pantalla / webcam) → oyentes
  socket.on('video_chunk', (chunk) => {
    socket.broadcast.emit('video_chunk', chunk);
  });
  socket.on('screen_share_stop', () => {
    io.emit('screen_share_stop');
  });

  // Pipe de chunks al proceso ffmpeg para RTMP
  socket.on('rtmp_chunk', (chunk) => {
    if (rtmpProc && rtmpProc.stdin.writable) {
      try { rtmpProc.stdin.write(Buffer.from(chunk)); } catch(e) {}
    }
  });

  // Relay de micrófono remoto → admin (y re-broadcast si está activo)
  socket.on('remote_mic_chunk', (chunk) => {
    socket.broadcast.emit('remote_mic_chunk', chunk);
  });

  socket.on('remote_mic_identify', () => {
    socket.isRemoteMic = true;
    io.emit('remote_mic_status', true);
  });

  socket.on('next_track', () => {
    if (radioState.playlist.length === 0) return;
    radioState.currentIndex = (radioState.currentIndex + 1) % radioState.playlist.length;
    radioState.currentTrack = radioState.playlist[radioState.currentIndex];
    radioState.status = 'playing';
    io.emit('track_change', { track: radioState.currentTrack, index: radioState.currentIndex });
    io.emit('status_change', radioState.status);
  });

  socket.on('disconnect', () => {
    radioState.listeners = Math.max(0, radioState.listeners - 1);
    io.emit('listeners_count', radioState.listeners);
    if (socket.isRemoteMic) io.emit('remote_mic_status', false);
  });
});

server.listen(PORT, () => {
  console.log(`🎙️  Radio Local corriendo en http://localhost:${PORT}`);
  console.log(`📻  Admin en http://localhost:${PORT}/admin.html`);
});
