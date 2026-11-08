// LariKuy! — Server
// Node.js + Express + Socket.io. Tanpa build step, tanpa database.
// Tanggung jawab server:
//  - Melayani file statis (public/)
//  - Room 4 huruf, maks 8 pemain per room
//  - Countdown 3-2-1-GO, penentuan urutan finish (otoritatif, pakai jam server)
//  - Broadcast posisi pemain ke semua anggota room
//  - Jam server (serverTime) untuk rintangan bergerak yang deterministik:
//    semua client menghitung gerakan palu/platform dari serverTime yang sama,
//    jadi gerakannya identik di semua layar, bukan dihitung lokal masing-masing.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 8;
const WORLD = { width: 4800, finishX: 4620 };

// Warna karakter, satu per pemain (dipakai juga client untuk sprite).
const COLORS = [
  0xff4757, // merah
  0x2e86ff, // biru
  0x2ed573, // hijau
  0xffa502, // kuning/oranye
  0xa55eea, // ungu
  0xff6b81, // pink
  0x1dd1a1, // tosca
  0x70a1ff, // biru muda
];
const COLOR_HEX = COLORS.map((c) => '#' + c.toString(16).padStart(6, '0'));

// rooms: Map<code, Room>
// Room = { code, status: 'lobby'|'countdown'|'racing'|'finished',
//          players: Map<socketId, Player>, results: [], raceStart: number|null,
//          countdownTimer: Timeout|null, syncTimer: Interval|null }
// Player = { id, name, color, x, y, vx, vy, finished, finishTime, isHost }
const rooms = new Map();

function makeCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? makeCode() : code;
}

function publicPlayers(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id, name: p.name, color: p.color, colorHex: COLOR_HEX[p.color],
    x: p.x, y: p.y, finished: p.finished, finishTime: p.finishTime, isHost: p.isHost,
  }));
}

function broadcastRoom(room) {
  io.to(room.code).emit('roomUpdate', {
    code: room.code,
    status: room.status,
    players: publicPlayers(room),
    results: room.results,
    serverTime: Date.now(),
  });
}

function cleanupRoomIfEmpty(room) {
  if (room.players.size === 0) {
    if (room.countdownTimer) clearTimeout(room.countdownTimer);
    if (room.syncTimer) clearInterval(room.syncTimer);
    rooms.delete(room.code);
  }
}

function finishRace(room) {
  room.status = 'finished';
  if (room.syncTimer) { clearInterval(room.syncTimer); room.syncTimer = null; }
  io.to(room.code).emit('raceFinished', {
    results: room.results,
    serverTime: Date.now(),
  });
  broadcastRoom(room);
}

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.get('/api/rooms', (_req, res) => res.json(
  [...rooms.values()].map((r) => ({ code: r.code, status: r.status, players: r.players.size }))
));

io.on('connection', (socket) => {
  let room = null;
  let player = null;

  // Kirim jam server saat connect, dipakai client untuk sinkronisasi rintangan.
  socket.emit('timeSync', { serverTime: Date.now() });

  socket.on('createRoom', ({ name }) => {
    const cleanName = String(name || 'Pemain').trim().slice(0, 16) || 'Pemain';
    const code = makeCode();
    room = { code, status: 'lobby', players: new Map(), results: [], raceStart: null, countdownTimer: null, syncTimer: null };
    rooms.set(code, room);
    player = { id: socket.id, name: cleanName, color: 0, x: 100, y: 500, vx: 0, vy: 0, finished: false, finishTime: null, isHost: true };
    room.players.set(socket.id, player);
    socket.join(code);
    socket.emit('joinedRoom', { code, playerId: socket.id, colorHex: COLOR_HEX[0], isHost: true, serverTime: Date.now() });
    broadcastRoom(room);
  });

  socket.on('joinRoom', ({ code, name }) => {
    const cleanCode = String(code || '').trim().toUpperCase();
    const cleanName = String(name || 'Pemain').trim().slice(0, 16) || 'Pemain';
    const target = rooms.get(cleanCode);
    if (!target) return socket.emit('joinError', { message: 'Kode room tidak ditemukan. Cek lagi ya!' });
    if (target.status !== 'lobby') return socket.emit('joinError', { message: 'Room ini sudah mulai balapan. Coba room lain!' });
    if (target.players.size >= MAX_PLAYERS) return socket.emit('joinError', { message: 'Room sudah penuh (maks 8 pemain).' });

    room = target;
    const usedColors = new Set([...room.players.values()].map((p) => p.color));
    let color = 0;
    while (usedColors.has(color) && color < COLORS.length) color++;
    player = { id: socket.id, name: cleanName, color, x: 100, y: 500, vx: 0, vy: 0, finished: false, finishTime: null, isHost: false };
    room.players.set(socket.id, player);
    socket.join(room.code);
    socket.emit('joinedRoom', { code: room.code, playerId: socket.id, colorHex: COLOR_HEX[color], isHost: false, serverTime: Date.now() });
    broadcastRoom(room);
  });

  socket.on('startGame', () => {
    if (!room || !player || !player.isHost) return;
    if (room.status !== 'lobby') return;
    if (room.players.size < 1) return;
    room.status = 'countdown';
    room.results = [];
    for (const p of room.players.values()) {
      p.x = 100; p.y = 500; p.vx = 0; p.vy = 0; p.finished = false; p.finishTime = null;
    }
    broadcastRoom(room);

    // Countdown 3-2-1-GO, tiap hitungan 800 ms, lalu race dimulai.
    const counts = [3, 2, 1];
    counts.forEach((n, i) => {
      setTimeout(() => {
        if (room && room.status === 'countdown') io.to(room.code).emit('countdown', { count: n, serverTime: Date.now() });
      }, i * 800);
    });
    room.countdownTimer = setTimeout(() => {
      if (!room || room.status !== 'countdown') return;
      room.status = 'racing';
      room.raceStart = Date.now();
      io.to(room.code).emit('raceStarted', { serverTime: room.raceStart });
      // Kirim jam server tiap 1 detik selama balapan, supaya client tetap sinkron.
      room.syncTimer = setInterval(() => {
        if (room) io.to(room.code).emit('timeSync', { serverTime: Date.now() });
      }, 1000);
      broadcastRoom(room);
    }, counts.length * 800);
  });

  // Posisi pemain, dikirim client ~20 Hz. Server teruskan ke anggota room lain.
  socket.on('move', (data) => {
    if (!room || !player || room.status !== 'racing') return;
    if (player.finished) return;
    player.x = Number(data.x) || player.x;
    player.y = Number(data.y) || player.y;
    player.vx = Number(data.vx) || 0;
    player.vy = Number(data.vy) || 0;
    socket.to(room.code).emit('playersMoved', {
      id: player.id, name: player.name, color: player.color,
      colorHex: COLOR_HEX[player.color], x: player.x, y: player.y, vx: player.vx, vy: player.vy,
    });
  });

  // Finish: urutan ditentukan SERVER berdasarkan waktu server menerima laporan.
  // Client hanya boleh melapor kalau x-nya sudah melewati garis finish.
  socket.on('playerFinished', (data) => {
    if (!room || !player || room.status !== 'racing' || player.finished) return;
    if (Number(data.x) < WORLD.finishX - 60) return; // anti-curang sederhana
    player.finished = true;
    player.finishTime = Date.now() - room.raceStart;
    room.results.push({
      id: player.id, name: player.name, colorHex: COLOR_HEX[player.color],
      place: room.results.length + 1, timeMs: player.finishTime,
    });
    io.to(room.code).emit('playerFinished', {
      id: player.id, name: player.name,
      place: room.results.length, timeMs: player.finishTime,
    });
    broadcastRoom(room);
    if (room.results.length >= room.players.size) finishRace(room);
  });

  // Pemain kembali ke lobby untuk balapan ulang.
  socket.on('backToLobby', () => {
    if (!room || !player || !player.isHost) return;
    if (room.countdownTimer) clearTimeout(room.countdownTimer);
    if (room.syncTimer) { clearInterval(room.syncTimer); room.syncTimer = null; }
    room.status = 'lobby';
    room.results = [];
    room.raceStart = null;
    for (const p of room.players.values()) {
      p.x = 100; p.y = 500; p.finished = false; p.finishTime = null;
    }
    io.to(room.code).emit('backToLobby', { serverTime: Date.now() });
    broadcastRoom(room);
  });

  socket.on('disconnect', () => {
    if (!room || !player) return;
    const wasHost = player.isHost;
    const wasRacing = room.status === 'racing';
    room.players.delete(socket.id);
    socket.to(room.code).emit('playerLeft', { id: socket.id, name: player.name });
    if (room.players.size > 0) {
      if (wasHost) {
        // Host pindah ke pemain pertama yang tersisa.
        const next = [...room.players.values()][0];
        next.isHost = true;
      }
      // Kalau semua pemain yang tersisa sudah finish, tutup balapan.
      if (wasRacing && room.players.size > 0 &&
          [...room.players.values()].every((p) => p.finished)) {
        finishRace(room);
      } else {
        broadcastRoom(room);
      }
    }
    cleanupRoomIfEmpty(room);
    room = null;
    player = null;
  });
});

server.listen(PORT, () => {
  console.log(`LariKuy! jalan di http://localhost:${PORT}`);
});
