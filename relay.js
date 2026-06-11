const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5e6 });

const PORT = process.env.PORT || 8001;
const BROADCASTER_SECRET = process.env.BROADCASTER_SECRET || 'pampa-secret-2025';

let broadcaster = null;
let listenersCount = 0;
const chatHistory = [];

// Estado cacheado para nuevos oyentes
const relayState = {
  stationName: 'Radio Pampa AR',
  status: 'off',
  currentTrack: null,
  playlist: [],
  listeners: 0,
};

// Buffer de chunks desde el inicio de la pista actual (para oyentes que se unen tarde)
let trackChunks = [];
let trackChunksSize = 0;
const MAX_TRACK_BUFFER = 6 * 1024 * 1024; // 6 MB ≈ ~6 min a 128kbps

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  const isBroadcaster = socket.handshake.auth?.secret === BROADCASTER_SECRET;

  if (isBroadcaster) {
    if (broadcaster) broadcaster.disconnect(true);
    broadcaster = socket;
    console.log('📡 Broadcaster (PC casa) conectado');

    // Informar al broadcaster cuántos oyentes hay
    broadcaster.emit('listeners_count', listenersCount);

    // Broadcaster → listeners: chunks de audio
    socket.on('broadcast_chunk', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (trackChunksSize < MAX_TRACK_BUFFER) {
        trackChunks.push(buf);
        trackChunksSize += buf.length;
      }
      socket.broadcast.emit('live_audio_chunk', buf);
    });

    // Broadcaster → listeners: eventos de estado
    socket.on('relay_event', ({ event, data }) => {
      if (event === 'track_change') {
        relayState.currentTrack = data?.track ?? null;
        // Reset buffer al cambiar pista
        trackChunks = [];
        trackChunksSize = 0;
      }
      if (event === 'status_change') relayState.status = data;
      if (event === 'station_name') relayState.stationName = data;
      if (event === 'playlist_update') relayState.playlist = data;
      if (event === 'browser_live_stop') {
        relayState.status = 'off';
        relayState.currentTrack = null;
        trackChunks = [];
        trackChunksSize = 0;
      }
      socket.broadcast.emit(event, data);
    });

    // Broadcaster → listeners: cualquier emit directo (ad_broadcast, ad_play, donation, etc.)
    socket.on('relay_broadcast', ({ event, data }) => {
      socket.broadcast.emit(event, data);
    });

    socket.on('disconnect', () => {
      broadcaster = null;
      relayState.status = 'off';
      relayState.currentTrack = null;
      trackChunks = [];
      trackChunksSize = 0;
      io.emit('status_change', 'off');
      io.emit('track_change', { track: null, index: -1 });
      console.log('📡 Broadcaster desconectado');
    });

  } else {
    // Oyente
    listenersCount++;
    relayState.listeners = listenersCount;
    io.emit('listeners_count', listenersCount);
    if (broadcaster) broadcaster.emit('listeners_count', listenersCount);

    // Sincronizar estado al conectar
    socket.emit('state_sync', { ...relayState });
    socket.emit('chat_history', chatHistory.slice(-50));

    // Si hay pista activa, enviar chunks acumulados para que entre desde el inicio
    if (relayState.status !== 'off' && trackChunks.length > 0) {
      for (const chunk of trackChunks) {
        socket.emit('live_audio_chunk', chunk);
      }
    }

    socket.on('chat_message', (data) => {
      const msg = {
        id: Date.now(),
        user: (data.user || 'Anónimo').slice(0, 20),
        text: (data.text || '').slice(0, 300),
        ts: new Date().toISOString(),
        role: 'listener',
      };
      chatHistory.push(msg);
      if (chatHistory.length > 200) chatHistory.shift();
      io.emit('chat_message', msg);
      if (broadcaster) broadcaster.emit('chat_message', msg);
    });

    socket.on('next_track', () => {
      if (broadcaster) broadcaster.emit('listener_next_track');
    });

    socket.on('disconnect', () => {
      listenersCount = Math.max(0, listenersCount - 1);
      relayState.listeners = listenersCount;
      io.emit('listeners_count', listenersCount);
      if (broadcaster) broadcaster.emit('listeners_count', listenersCount);
    });
  }
});

server.listen(PORT, () => {
  console.log(`🔁 Radio Pampa AR — Relay corriendo en puerto ${PORT}`);
});
