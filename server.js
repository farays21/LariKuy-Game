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
const ROUND_TIMEOUT_MS = 75000; // timeout 1 round eliminasi (75 detik sejak raceStarted)
const NEXT_ROUND_DELAY_MS = 4000; // jeda antar-round eliminasi (otomatis, 4 detik)

// Map yang tersedia (metadata server; layout lengkap ada di public/js/game.js).
// Server hanya perlu tahu id + nama untuk validasi pilihan host & broadcast.
const MAPS = {
  map1: { name: 'Map 1 Klasik' },
  map2: { name: 'Map 2 Badai' },
  map3: { name: 'Map 3 Angkasa' },
};
// Urutan map di mode Eliminasi: round 1 = map pilihan host, lalu lanjut
// ke map berikutnya dalam urutan ini, berulang (Map 1 -> 2 -> 3 -> 1 ...).
const MAP_ORDER = ['map1', 'map2', 'map3'];

// Segmen tanah per map (server-side, SINKRON dengan MAPS di public/js/game.js).
// Dipakai bot untuk tahu di mana jurang berada. Checkpoint = respawn bot.
const MAP_GROUND = {
  map1: [[0, 900], [1020, 1820], [1940, 2620], [2740, 3440], [3560, 4280], [4400, 4800]],
  map2: [[0, 700], [860, 1500], [1660, 2300], [2460, 3100], [3260, 3900], [4060, 4800]],
  map3: [[0, 650], [800, 1400], [1550, 2200], [2350, 2950], [3100, 3750], [3900, 4800]],
};
const MAP_CHECKPOINT = { map1: 2400, map2: 2250, map3: 2200 };
// Zona rintangan (x palu / pintu / laser) per map — bot kadang "jatuh" di sini (5%).
const MAP_HAZARDS = { map1: [1500, 2950], map2: [1200, 2900, 3400], map3: [1100, 2600, 3400] };

// ---------- Power-up (v0.3.0) ----------
// Jenis: speed (⚡ boost 3 dtk), double (🦘 lompat ganda 5 dtk),
// shield (🛡️ tahan 1x serangan). Posisi per map SINKRON dengan client
// (POWERUP_SPOTS di game.js hanya untuk referensi — server yang broadcast
// posisi + jenis lewat event 'powerups', jadi client tidak perlu tahu).
const POWERUP_TYPES = ['speed', 'double', 'shield'];
const POWERUP_ICON = { speed: '⚡', double: '🦘', shield: '🛡️' };
const POWERUP_SPOTS = {
  map1: [{ x: 1200, y: 560 }, { x: 2400, y: 560 }, { x: 3600, y: 560 }],
  map2: [{ x: 1200, y: 560 }, { x: 2250, y: 560 }, { x: 3600, y: 560 }],
  map3: [{ x: 950, y: 560 }, { x: 2000, y: 560 }, { x: 3200, y: 560 }],
};
const POWERUP_RESPAWN_MS = 10000; // item yang diambil respawn (jenis diacak) setelah 10 dtk
const POWERUP_PICKUP_DIST = 140; // toleransi jarak pemain-item (px) saat validasi pickup
function randomPowerupType() { return POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)]; }
function initPowerups(room) {
  clearPowerupTimers(room);
  room.powerups = (POWERUP_SPOTS[room.map] || POWERUP_SPOTS.map1).map((s, i) => ({
    slot: i, x: s.x, y: s.y, type: randomPowerupType(), active: true,
  }));
}
function publicPowerups(room) {
  return (room.powerups || []).map((p) => ({
    slot: p.slot, x: p.x, y: p.y, type: p.type, icon: POWERUP_ICON[p.type], active: p.active,
  }));
}
function broadcastPowerups(room) {
  io.to(room.code).emit('powerups', { powerups: publicPowerups(room) });
}
function clearPowerupTimers(room) {
  if (room.powerupTimers) { room.powerupTimers.forEach(clearTimeout); room.powerupTimers = []; }
}

// ---------- Chat + taunt (v0.3.0) ----------
// Riwayat chat hanya di memori per room (tanpa database): maks 30 pesan
// terakhir, hilang saat room kosong/dihapus. Rate-limit 1 pesan/detik dan
// 1 taunt/detik per pemain supaya tidak spam.
const CHAT_MAX_LEN = 140;
const CHAT_RATE_MS = 1000;
const CHAT_HISTORY = 30;
const TAUNTS = ['😂', '💨', '😭', '🔥', '👏', '😎', '🤣', '😮', '👍', '💀'];
function pushChat(room, msg) {
  room.chat.push(msg);
  if (room.chat.length > CHAT_HISTORY) room.chat.splice(0, room.chat.length - CHAT_HISTORY);
}
const GROUND_Y_BOT = 616; // y bot saat berlari di tanah (tanah y=640, sprite 48px)
const BOT_TICK_MS = 100; // tick bot ~10 Hz
const BOT_FILL_TARGET = 6; // checkbox "isi bot" mengisi sampai total 6 pemain
const BOT_NAMES = ['Raka', 'Sinta', 'Budi', 'Dewi', 'Agus', 'Maya', 'Rudi', 'Lina'];
const BOT_JUMP_AHEAD_PX = 120; // mulai lompat saat ujung tanah < 120 px di depan
const BOT_FALL_PER_GAP = 0.08; // 8% lompatan jurang gagal -> kembali ke checkpoint
const BOT_FALL_PER_HAZARD = 0.05; // 5% jatuh saat melewati zona palu/pintu

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

// Bentuk karakter (v0.2.0 Fitur 4): dipilih client di lobby, disimpan per pemain.
const SHAPES = ['kotak', 'bulat', 'segitiga'];
const DEFAULT_SHAPE = 'kotak';
function validShape(s) {
  return SHAPES.includes(s) ? s : DEFAULT_SHAPE;
}
// Warna yang diminta client, kalau valid (0-7) dan belum dipakai di room ini.
// Kalau tidak valid / sudah dipakai -> warna pertama yang belum dipakai (seperti dulu).
function pickColor(room, wanted) {
  const used = new Set([...room.players.values()].map((p) => p.color));
  if (Number.isInteger(wanted) && wanted >= 0 && wanted < COLORS.length && !used.has(wanted)) return wanted;
  return freeColor(room);
}

// rooms: Map<code, Room>
// Room = { code, status: 'lobby'|'countdown'|'racing'|'betweenRounds'|'finished',
//          players: Map<socketId, Player>, results: [], raceStart: number|null,
//          countdownTimer: Timeout|null, syncTimer: Interval|null,
//          mode: 'race'|'elimination', round: number, baseMap: string,
//          roundTimer: Timeout|null, nextRoundTimer: Timeout|null,
//          elimHistory: [{round, eliminated: [playerId]}] }
// Player = { id, name, color, x, y, vx, vy, finished, finishTime, isHost, eliminated,
//            isBot?, botSpeed?, botRespawnX?, botJumpTargetX?, botFallAt?, botHazards? }
const rooms = new Map();

// Map round eliminasi (v0.3.0): round 1 = map pilihan host (baseMap),
// lalu lanjut ke map berikutnya dalam MAP_ORDER, berulang
// (misal host pilih Map 1 -> R1 Map 1, R2 Map 2, R3 Map 3, R4 Map 1, ...).
function mapForRound(room) {
  const baseIdx = MAP_ORDER.indexOf(room.baseMap);
  const start = baseIdx >= 0 ? baseIdx : 0;
  return MAP_ORDER[(start + room.round - 1) % MAP_ORDER.length];
}
function activePlayers(room) {
  return [...room.players.values()].filter((p) => !p.eliminated);
}
function clearRoundTimers(room) {
  if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }
  if (room.nextRoundTimer) { clearTimeout(room.nextRoundTimer); room.nextRoundTimer = null; }
}

function makeCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? makeCode() : code;
}

function publicPlayers(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id, name: p.name, color: p.color, colorHex: COLOR_HEX[p.color],
    shape: p.shape || DEFAULT_SHAPE,
    x: p.x, y: p.y, finished: p.finished, finishTime: p.finishTime, isHost: p.isHost,
    eliminated: !!p.eliminated, isBot: !!p.isBot,
  }));
}

function broadcastRoom(room) {
  io.to(room.code).emit('roomUpdate', {
    code: room.code,
    status: room.status,
    players: publicPlayers(room),
    results: room.results,
    serverTime: Date.now(),
    map: room.map,
    mapName: MAPS[room.map] ? MAPS[room.map].name : MAPS.map1.name,
    mode: room.mode,
    round: room.round,
    fillBots: !!room.fillBots,
  });
}

// ---------- Bot pengisi room (v0.2.0 Fitur 3, server-side) ----------
// Bot adalah Player biasa (isBot:true) di room.players: dihitung di batas
// 8 pemain, di roomUpdate/playersMoved, di finish, dan di eliminasi.
// Bot TIDAK punya socket; gerakannya di-tick server ~10 Hz saat racing.
function stopBotTimer(room) {
  if (room.botTimer) { clearInterval(room.botTimer); room.botTimer = null; }
}
function startBotTimer(room) {
  stopBotTimer(room);
  room.botTickCount = 0;
  room.botTimer = setInterval(() => tickBots(room), BOT_TICK_MS);
}
function freeColor(room) {
  const used = new Set([...room.players.values()].map((p) => p.color));
  for (let c = 0; c < COLORS.length; c++) if (!used.has(c)) return c;
  return 0;
}
function makeBot(room) {
  const takenNames = new Set([...room.players.values()].map((p) => p.name));
  const base = BOT_NAMES.find((n) => !takenNames.has('Bot ' + n)) || ('Bot' + (room.botSeq + 1));
  const color = freeColor(room);
  room.botSeq = (room.botSeq || 0) + 1;
  const id = 'bot-' + room.code + '-' + room.botSeq + '-' + Date.now().toString(36);
  // Kecepatan lari 180-260 px/dtk, diacak sekali saat dibuat, tetap selama round.
  const speed = 180 + Math.random() * 80;
  return {
    id, name: 'Bot ' + base, color, shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
    x: 100, y: 500, vx: 0, vy: 0,
    finished: false, finishTime: null, isHost: false, eliminated: false,
    isBot: true, botSpeed: speed, botRespawnX: 100,
    botJumpTargetX: null, botFallAt: null, botHazards: new Set(),
  };
}
function addBots(room, target) {
  while (room.players.size < Math.min(target, MAX_PLAYERS)) {
    const bot = makeBot(room);
    room.players.set(bot.id, bot);
  }
}
function removeAllBots(room) {
  for (const p of [...room.players.values()]) {
    if (p.isBot) {
      room.players.delete(p.id);
      io.to(room.code).emit('playerLeft', { id: p.id, name: p.name });
    }
  }
  room.fillBots = false;
}
function botResetForRound(bot) {
  bot.x = 100; bot.y = 500; bot.vx = 0; bot.vy = 0;
  bot.finished = false; bot.finishTime = null;
  bot.botRespawnX = 100; bot.botJumpTargetX = null; bot.botFallAt = null;
  bot.botHazards = new Set();
}
function botRespawn(bot) {
  bot.x = bot.botRespawnX; bot.y = GROUND_Y_BOT; bot.vx = 0; bot.vy = 0;
  bot.botJumpTargetX = null; bot.botFallAt = null;
}
function tickBots(room) {
  if (!rooms.has(room.code) || room.status !== 'racing') { stopBotTimer(room); return; }
  const ground = MAP_GROUND[room.map] || MAP_GROUND.map1;
  const checkpointX = MAP_CHECKPOINT[room.map] || MAP_CHECKPOINT.map1;
  const hazards = MAP_HAZARDS[room.map] || MAP_HAZARDS.map1;
  const bots = [...room.players.values()].filter((p) => p.isBot && !p.finished && !p.eliminated);
  for (const bot of bots) {
    if (room.status !== 'racing') return; // balapan bisa berakhir di tengah tick
    const prevX = bot.x;
    // Checkpoint: sekali melewati checkpoint map aktif, respawn pindah ke sana.
    if (bot.x >= checkpointX) bot.botRespawnX = checkpointX;
    // Tentukan segmen tanah tempat bot berdiri.
    const seg = ground.find(([a, b]) => bot.x >= a && bot.x <= b);
    const segIdx = seg ? ground.indexOf(seg) : -1;
    // Lompat jurang: ujung tanah di depan sudah dekat (<120 px) dan masih
    // ada segmen berikutnya -> lompat (y naik ke ~500) dan tetap di udara
    // sampai mendarat di segmen berikutnya (target = awal segmen + 10 px,
    // jadi lompatan selalu cukup jauh melewati jurang selebar apa pun);
    // 8% lompatan gagal.
    if (seg && segIdx < ground.length - 1 && !bot.botJumpTargetX && !bot.botFallAt) {
      const distToEnd = seg[1] - bot.x;
      if (distToEnd < BOT_JUMP_AHEAD_PX && distToEnd > 0) {
        if (Math.random() < BOT_FALL_PER_GAP) bot.botFallAt = seg[1];
        else bot.botJumpTargetX = ground[segIdx + 1][0] + 10;
      }
    }
    bot.x += bot.botSpeed * (BOT_TICK_MS / 1000);
    bot.vx = bot.botSpeed; bot.vy = 0;
    if (bot.botJumpTargetX && bot.x >= bot.botJumpTargetX) bot.botJumpTargetX = null; // mendarat
    bot.y = bot.botJumpTargetX ? 500 : GROUND_Y_BOT;
    // Lompatan gagal: begitu mencapai ujung tanah, jatuh -> checkpoint.
    if (bot.botFallAt && bot.x >= bot.botFallAt) { botRespawn(bot); }
    // Bot di luar segmen tanah tanpa sedang melompat = jatuh ke jurang.
    else if (!bot.botJumpTargetX) {
      const onGround = ground.some(([a, b]) => bot.x >= a && bot.x <= b);
      if (!onGround && bot.x > 0) botRespawn(bot);
    }
    // Rintangan lain: tiap zona palu/pintu yang dilewati pertama kali di
    // round ini, 5% bot "jatuh" -> kembali ke checkpoint.
    for (const hz of hazards) {
      if (prevX < hz && bot.x >= hz && !bot.botHazards.has(hz)) {
        bot.botHazards.add(hz);
        if (Math.random() < BOT_FALL_PER_HAZARD) { botRespawn(bot); break; }
      }
    }
    // Finish bot = finish pemain biasa (otoritatif server).
    if (bot.x >= WORLD.finishX) {
      bot.x = WORLD.finishX;
      recordFinish(room, bot);
      continue;
    }
    io.to(room.code).emit('playersMoved', {
      id: bot.id, name: bot.name, color: bot.color, colorHex: COLOR_HEX[bot.color],
      shape: bot.shape || DEFAULT_SHAPE,
      x: Math.round(bot.x), y: Math.round(bot.y), vx: Math.round(bot.vx), vy: 0, isBot: true,
    });
  }
  // roomUpdate berkala (~1 dtk) supaya x bot di daftar/progress bar tetap segar.
  room.botTickCount = (room.botTickCount || 0) + 1;
  if (room.botTickCount % 10 === 0) broadcastRoom(room);
}

// Mencatat finish satu pemain (manusia via event, bot via tick) + menutup
// round/balapan kalau semua pemain aktif sudah finish.
function recordFinish(room, p) {
  if (!room || room.status !== 'racing' || p.finished || p.eliminated) return;
  p.finished = true;
  p.finishTime = Date.now() - room.raceStart;
  room.results.push({
    id: p.id, name: p.name, colorHex: COLOR_HEX[p.color],
    place: room.results.length + 1, timeMs: p.finishTime, isBot: !!p.isBot,
  });
  io.to(room.code).emit('playerFinished', {
    id: p.id, name: p.name,
    place: room.results.length, timeMs: p.finishTime,
  });
  broadcastRoom(room);
  const active = activePlayers(room);
  if (active.length > 0 && active.every((q) => q.finished)) {
    if (room.mode === 'elimination') endRound(room, 'finished');
    else finishRace(room);
  }
}

function cleanupRoomIfEmpty(room) {
  if (room.players.size === 0) {
    if (room.countdownTimer) clearTimeout(room.countdownTimer);
    if (room.syncTimer) clearInterval(room.syncTimer);
    stopBotTimer(room);
    clearRoundTimers(room);
    clearPowerupTimers(room);
    rooms.delete(room.code);
  }
}

function finishRace(room) {
  room.status = 'finished';
  if (room.syncTimer) { clearInterval(room.syncTimer); room.syncTimer = null; }
  stopBotTimer(room);
  clearRoundTimers(room);
  clearPowerupTimers(room);
  io.to(room.code).emit('raceFinished', {
    results: room.results,
    serverTime: Date.now(),
  });
  broadcastRoom(room);
}

// ---------- Mode Eliminasi (multi-round) ----------
// Aturan (lihat README bagian Mode Eliminasi):
// - Tiap round = 1 balapan penuh; round berakhir saat semua pemain aktif
//   finish, atau timeout 75 detik sejak raceStarted.
// - 2 pemain terlambat gugur per round (finishTime; yang belum finish saat
//   timeout dianggap paling lambat, tiebreak progress x terakhir).
//   Kalau pemain aktif tinggal <= 2 di awal round, hanya 1 yang gugur.
// - Round berikutnya mulai OTOMATIS setelah jeda 4 detik.
// - Tersisa 1 pemain -> juara (eliminationFinished).
function endRound(room, reason) {
  if (room.status !== 'racing') return;
  if (room.syncTimer) { clearInterval(room.syncTimer); room.syncTimer = null; }
  stopBotTimer(room);
  clearRoundTimers(room);
  const active = activePlayers(room);
  if (active.length === 0) {
    // Tidak ada lagi pemain aktif (misal semua disconnect kecuali yang
    // sudah gugur): tutup game tanpa juara, host bisa backToLobby.
    room.status = 'finished';
    broadcastRoom(room);
    return;
  }
  // Urutan dari tercepat ke terlambat: yang finish diurutkan finishTime,
  // yang belum finish (timeout) di belakang, diurutkan progress x menurun.
  const finishers = active.filter((p) => p.finished).sort((a, b) => a.finishTime - b.finishTime);
  const nonFinishers = active.filter((p) => !p.finished).sort((a, b) => b.x - a.x);
  const ranked = [...finishers, ...nonFinishers]; // tercepat -> terlambat
  const elimCount = active.length <= 2 ? 1 : 2;
  const eliminated = ranked.slice(-elimCount); // paling lambat
  const survivors = ranked.slice(0, ranked.length - elimCount);
  eliminated.forEach((p) => { p.eliminated = true; });
  room.elimHistory.push({ round: room.round, eliminated: eliminated.map((p) => p.id) });
  const pub = (p) => ({ id: p.id, name: p.name });
  const results = ranked.map((p, i) => ({
    id: p.id, name: p.name, colorHex: COLOR_HEX[p.color],
    place: i + 1, timeMs: p.finished ? p.finishTime : null,
  }));
  room.results = results;

  if (survivors.length <= 1) {
    // Juara: satu-satunya yang tersisa (atau yang tercepat bila final 2
    // orang sama-sama finish — survivors.length 1 di sini karena yang
    // paling lambat sudah gugur; bila keduanya finish, juara = tercepat).
    const champion = survivors[0] || ranked[0];
    declareChampion(room, champion);
    return;
  }
  room.status = 'betweenRounds';
  const nextRound = room.round + 1;
  // Map round berikutnya = map berikutnya dalam MAP_ORDER (1 -> 2 -> 3 -> 1 ...).
  const baseIdx = MAP_ORDER.indexOf(room.baseMap);
  const nextMap = MAP_ORDER[((baseIdx >= 0 ? baseIdx : 0) + nextRound - 1) % MAP_ORDER.length];
  io.to(room.code).emit('roundEnded', {
    round: room.round,
    reason,
    eliminated: eliminated.map(pub),
    survivors: survivors.map(pub),
    results,
    nextRound,
    nextMap,
    nextMapName: MAPS[nextMap].name,
    serverTime: Date.now(),
  });
  broadcastRoom(room);
  // Round berikutnya otomatis setelah jeda singkat.
  room.nextRoundTimer = setTimeout(() => {
    if (!room || room.status !== 'betweenRounds') return;
    room.round = nextRound;
    startRound(room);
  }, NEXT_ROUND_DELAY_MS);
}

// Ranking akhir eliminasi: juara #1, lalu pemain yang gugur di round
// paling akhir menempati peringkat berikutnya (di dalam satu round,
// yang lebih cepat gugur = peringkat lebih tinggi).
function eliminationRanking(room, champion) {
  const ranking = [champion];
  const elimByRound = [...room.elimHistory].reverse();
  for (const entry of elimByRound) {
    // entry.eliminated tersimpan urutan tercepat -> terlambat di dalam
    // round itu (lihat endRound: slice dari ranking tercepat->terlambat),
    // jadi langsung dipakai apa adanya: yang lebih cepat gugur = peringkat
    // lebih tinggi.
    const players = entry.eliminated
      .map((id) => room.players.get(id))
      .filter(Boolean);
    ranking.push(...players);
  }
  return ranking.map((p, i) => ({
    id: p.id, name: p.name, colorHex: COLOR_HEX[p.color],
    place: i + 1, timeMs: p.finished ? p.finishTime : null,
  }));
}

function declareChampion(room, champion) {
  room.status = 'finished';
  if (room.syncTimer) { clearInterval(room.syncTimer); room.syncTimer = null; }
  stopBotTimer(room);
  clearRoundTimers(room);
  clearPowerupTimers(room);
  if (room.countdownTimer) { clearTimeout(room.countdownTimer); room.countdownTimer = null; }
  const results = eliminationRanking(room, champion);
  room.results = results;
  io.to(room.code).emit('eliminationFinished', {
    champion: { id: champion.id, name: champion.name },
    results,
    serverTime: Date.now(),
  });
  broadcastRoom(room);
  // Eliminasi berakhir: bot dihapus (host bisa isi lagi dari lobby).
  removeAllBots(room);
  broadcastRoom(room);
}

// Memulai satu round (balapan sekali maupun eliminasi): reset posisi
// pemain AKTIF, countdown 3-2-1-GO, lalu racing + timer timeout round
// (hanya mode eliminasi).
function startRound(room) {
  room.status = 'countdown';
  room.results = [];
  room.map = room.mode === 'elimination' ? mapForRound(room) : room.baseMap;
  for (const p of activePlayers(room)) {
    p.x = 100; p.y = 500; p.vx = 0; p.vy = 0; p.finished = false; p.finishTime = null;
    if (p.isBot) botResetForRound(p);
  }
  broadcastRoom(room);

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
    io.to(room.code).emit('raceStarted', {
      serverTime: room.raceStart, map: room.map,
      mapName: MAPS[room.map].name, round: room.round, mode: room.mode,
    });
    // Power-up (v0.3.0): spawn item di awal tiap round, broadcast ke semua.
    initPowerups(room);
    broadcastPowerups(room);
    room.syncTimer = setInterval(() => {
      if (room) io.to(room.code).emit('timeSync', { serverTime: Date.now() });
    }, 1000);
    startBotTimer(room); // bot mulai bergerak saat racing
    if (room.mode === 'elimination') {
      room.roundTimer = setTimeout(() => {
        if (room && room.status === 'racing') endRound(room, 'timeout');
      }, ROUND_TIMEOUT_MS);
    }
    broadcastRoom(room);
  }, counts.length * 800);
}

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.get('/api/rooms', (_req, res) => res.json(
  [...rooms.values()].map((r) => ({ code: r.code, status: r.status, players: r.players.size, map: r.map, mode: r.mode, round: r.round }))
));

io.on('connection', (socket) => {
  let room = null;
  let player = null;

  // Kirim jam server saat connect, dipakai client untuk sinkronisasi rintangan.
  socket.emit('timeSync', { serverTime: Date.now() });

  socket.on('createRoom', ({ name, map, color, shape }) => {
    const cleanName = String(name || 'Pemain').trim().slice(0, 16) || 'Pemain';
    const code = makeCode();
    room = { code, status: 'lobby', players: new Map(), results: [], raceStart: null, countdownTimer: null, syncTimer: null, map: MAPS[map] ? map : 'map1', baseMap: MAPS[map] ? map : 'map1', mode: 'race', round: 1, roundTimer: null, nextRoundTimer: null, elimHistory: [], fillBots: false, botTimer: null, botSeq: 0, botTickCount: 0, chat: [], powerups: [], powerupTimers: [] };
    rooms.set(code, room);
    player = { id: socket.id, name: cleanName, color: pickColor(room, color), shape: validShape(shape), x: 100, y: 500, vx: 0, vy: 0, finished: false, finishTime: null, isHost: true, eliminated: false, isBot: false };
    room.players.set(socket.id, player);
    socket.join(code);
    socket.emit('joinedRoom', { code, playerId: socket.id, colorHex: COLOR_HEX[player.color], color: player.color, shape: player.shape, isHost: true, serverTime: Date.now(), map: room.map, mapName: MAPS[room.map].name, mode: room.mode, round: room.round });
    socket.emit('chatHistory', { messages: room.chat });
    broadcastRoom(room);
  });

  socket.on('joinRoom', ({ code, name, color, shape }) => {
    const cleanCode = String(code || '').trim().toUpperCase();
    const cleanName = String(name || 'Pemain').trim().slice(0, 16) || 'Pemain';
    const target = rooms.get(cleanCode);
    if (!target) return socket.emit('joinError', { message: 'Kode room tidak ditemukan. Cek lagi ya!' });
    if (target.status !== 'lobby') return socket.emit('joinError', { message: 'Room ini sudah mulai balapan. Coba room lain!' });
    if (target.players.size >= MAX_PLAYERS) return socket.emit('joinError', { message: 'Room sudah penuh (maks 8 pemain).' });

    room = target;
    player = { id: socket.id, name: cleanName, color: pickColor(room, color), shape: validShape(shape), x: 100, y: 500, vx: 0, vy: 0, finished: false, finishTime: null, isHost: false, eliminated: false, isBot: false };
    room.players.set(socket.id, player);
    socket.join(room.code);
    socket.emit('joinedRoom', { code: room.code, playerId: socket.id, colorHex: COLOR_HEX[player.color], color: player.color, shape: player.shape, isHost: false, serverTime: Date.now(), map: room.map, mapName: MAPS[room.map].name, mode: room.mode, round: room.round });
    socket.emit('chatHistory', { messages: room.chat || [] });
    broadcastRoom(room);
  });

  // Host memilih map di lobby (hanya host, hanya saat lobby).
  // Map tidak valid / bukan host / bukan lobby = diabaikan diam-diam.
  socket.on('setMap', ({ map }) => {
    if (!room || !player || !player.isHost) return;
    if (room.status !== 'lobby') return;
    if (!MAPS[map]) return;
    room.map = map;
    room.baseMap = map; // map pilihan host = map round ganjil eliminasi
    broadcastRoom(room);
  });

  // Host memilih mode di lobby (hanya host, hanya saat lobby).
  // Mode tidak valid / bukan host / bukan lobby = diabaikan diam-diam.
  socket.on('setMode', ({ mode }) => {
    if (!room || !player || !player.isHost) return;
    if (room.status !== 'lobby') return;
    if (mode !== 'race' && mode !== 'elimination') return;
    room.mode = mode;
    broadcastRoom(room);
  });

  // Host mengisi bot di lobby (hanya host, hanya saat lobby).
  // fill=true: tambah bot sampai total 6 pemain; fill=false: hapus semua bot.
  socket.on('setFillBots', ({ fill }) => {
    if (!room || !player || !player.isHost) return;
    if (room.status !== 'lobby') return;
    if (fill) { room.fillBots = true; addBots(room, BOT_FILL_TARGET); }
    else removeAllBots(room);
    broadcastRoom(room);
  });

  socket.on('startGame', () => {
    if (!room || !player || !player.isHost) return;
    if (room.status !== 'lobby') return;
    if (room.players.size < 1) return;
    // Mode eliminasi butuh minimal 3 pemain aktif.
    if (room.mode === 'elimination' && room.players.size < 3) {
      return socket.emit('startError', { message: 'Mode Eliminasi butuh minimal 3 pemain! Ajak temanmu dulu 💀' });
    }
    room.round = 1;
    room.elimHistory = [];
    for (const p of room.players.values()) p.eliminated = false;
    startRound(room);
  });

  // Posisi pemain, dikirim client ~20 Hz. Server teruskan ke anggota room lain.
  socket.on('move', (data) => {
    if (!room || !player || room.status !== 'racing') return;
    if (player.finished || player.eliminated) return;
    player.x = Number(data.x) || player.x;
    player.y = Number(data.y) || player.y;
    player.vx = Number(data.vx) || 0;
    player.vy = Number(data.vy) || 0;
    socket.to(room.code).emit('playersMoved', {
      id: player.id, name: player.name, color: player.color,
      colorHex: COLOR_HEX[player.color], shape: player.shape || DEFAULT_SHAPE,
      x: player.x, y: player.y, vx: player.vx, vy: player.vy,
      isBot: false,
    });
  });

  // Finish: urutan ditentukan SERVER berdasarkan waktu server menerima laporan.
  // Client hanya boleh melapor kalau x-nya sudah melewati garis finish.
  socket.on('playerFinished', (data) => {
    if (!room || !player || room.status !== 'racing' || player.finished || player.eliminated) return;
    if (Number(data.x) < WORLD.finishX - 60) return; // anti-curang sederhana
    recordFinish(room, player);
  });

  // ---------- Power-up: klaim item (v0.3.0) ----------
  // Server otoritatif: item harus aktif DAN posisi terakhir pemain (dari
  // 'move' terakhir) harus dalam 140 px dari item. Klaim kedua untuk item
  // yang sama (sudah tidak aktif) ditolak diam-diam. Item respawn (jenis
  // diacak) 10 detik setelah diambil.
  socket.on('powerupPickup', (data) => {
    if (!room || !player || room.status !== 'racing') return;
    if (player.finished || player.eliminated || player.isBot) return;
    const pu = (room.powerups || []).find((p) => p.slot === Number(data && data.slot));
    if (!pu || !pu.active) return;
    const dist = Math.hypot(player.x - pu.x, player.y - pu.y);
    if (dist > POWERUP_PICKUP_DIST) return;
    pu.active = false;
    io.to(room.code).emit('powerupTaken', {
      slot: pu.slot, playerId: player.id, name: player.name,
      type: pu.type, icon: POWERUP_ICON[pu.type],
    });
    broadcastPowerups(room);
    const t = setTimeout(() => {
      if (!rooms.has(room.code) || !room.powerups) return;
      const p2 = room.powerups.find((p) => p.slot === pu.slot);
      if (!p2 || p2.active) return;
      p2.type = randomPowerupType();
      p2.active = true;
      broadcastPowerups(room);
    }, POWERUP_RESPAWN_MS);
    room.powerupTimers = room.powerupTimers || [];
    room.powerupTimers.push(t);
  });

  // ---------- Chat room + taunt (v0.3.0) ----------
  // Chat hanya di-broadcast ke room yang sama (bukan room lain), maks 140
  // karakter, rate-limit 1 pesan/detik per pemain (kelebihan dibuang diam-diam).
  // Penonton (finish/gugur) tetap boleh chat & taunt.
  socket.on('chatMessage', (data) => {
    if (!room || !player) return;
    const now = Date.now();
    if (player.lastChatAt && now - player.lastChatAt < CHAT_RATE_MS) return;
    const clean = String((data && data.text) || '').trim().slice(0, CHAT_MAX_LEN);
    if (!clean) return;
    player.lastChatAt = now;
    const msg = { id: player.id, name: player.name, colorHex: COLOR_HEX[player.color], text: clean, ts: now };
    pushChat(room, msg);
    io.to(room.code).emit('chatMessage', msg);
  });

  // Taunt cepat: emoji harus dari daftar yang diizinkan, rate-limit
  // 1 taunt/detik. Taunt di-broadcast 2 jalur: event 'taunt' (bubble emoji
  // di atas kepala karakter di Phaser) + pesan chat biasa ("Budi: 😂").
  socket.on('taunt', (data) => {
    if (!room || !player) return;
    const emoji = data && data.emoji;
    if (!TAUNTS.includes(emoji)) return;
    const now = Date.now();
    if (player.lastTauntAt && now - player.lastTauntAt < CHAT_RATE_MS) return;
    player.lastTauntAt = now;
    io.to(room.code).emit('taunt', {
      playerId: player.id, name: player.name, colorHex: COLOR_HEX[player.color], emoji,
    });
    const msg = { id: player.id, name: player.name, colorHex: COLOR_HEX[player.color], text: emoji, ts: now };
    pushChat(room, msg);
    io.to(room.code).emit('chatMessage', msg);
  });

  // Pemain kembali ke lobby untuk balapan ulang.
  // Reset: mode kembali ke 'race' (default), round ke 1, semua pemain
  // tidak lagi gugur, map kembali ke pilihan host (baseMap).
  socket.on('backToLobby', () => {
    if (!room || !player || !player.isHost) return;
    if (room.countdownTimer) clearTimeout(room.countdownTimer);
    if (room.syncTimer) { clearInterval(room.syncTimer); room.syncTimer = null; }
    stopBotTimer(room);
    clearRoundTimers(room);
    clearPowerupTimers(room);
    removeAllBots(room); // kembali ke lobby = hapus SEMUA bot
    room.status = 'lobby';
    room.results = [];
    room.raceStart = null;
    room.mode = 'race';
    room.round = 1;
    room.elimHistory = [];
    room.map = room.baseMap;
    for (const p of room.players.values()) {
      p.x = 100; p.y = 500; p.finished = false; p.finishTime = null; p.eliminated = false;
    }
    io.to(room.code).emit('backToLobby', { serverTime: Date.now() });
    broadcastRoom(room);
  });

  socket.on('disconnect', () => {
    if (!room || !player) return;
    const wasHost = player.isHost;
    const wasRacing = room.status === 'racing';
    const wasInElimGame = room.mode === 'elimination' &&
      ['countdown', 'racing', 'betweenRounds'].includes(room.status);
    room.players.delete(socket.id);
    socket.to(room.code).emit('playerLeft', { id: socket.id, name: player.name });
    // Kalau tidak ada lagi manusia, hapus room (bot tidak boleh menahan room).
    const humansLeft = [...room.players.values()].filter((p) => !p.isBot);
    if (humansLeft.length === 0) {
      if (room.countdownTimer) clearTimeout(room.countdownTimer);
      if (room.syncTimer) clearInterval(room.syncTimer);
      stopBotTimer(room);
      clearRoundTimers(room);
      clearPowerupTimers(room);
      rooms.delete(room.code);
      room = null;
      player = null;
      return;
    }
    if (room.players.size > 0) {
      if (wasHost) {
        // Host pindah ke MANUSIA pertama yang tersisa (jangan jadikan bot host).
        humansLeft[0].isHost = true;
      }
      if (wasInElimGame) {
        // Disconnect di tengah eliminasi = gugur. Kalau tinggal 1 pemain
        // aktif, dia langsung juara; kalau semua aktif sudah finish,
        // tutup round-nya.
        const active = activePlayers(room);
        if (active.length === 1) {
          declareChampion(room, active[0]);
        } else if (wasRacing && active.length > 0 && active.every((p) => p.finished)) {
          endRound(room, 'finished');
        } else {
          broadcastRoom(room);
        }
      } else if (wasRacing && room.players.size > 0 &&
          [...room.players.values()].every((p) => p.finished)) {
        // Kalau semua pemain yang tersisa sudah finish, tutup balapan.
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
