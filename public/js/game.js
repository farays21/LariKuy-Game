// LariKuy! — Client
// Phaser 3 (CDN) + Socket.io. Lobby pakai DOM, balapan pakai Phaser Arcade Physics.
// Rintangan bergerak DETERMINISTIK: gerakannya dihitung dari serverTime
// (jam server, disinkronkan berkala), jadi semua pemain melihat gerakan yang sama.

(function () {
  'use strict';

  // ---------- Konstanta dunia (harus cocok dengan server.js) ----------
  const WORLD_WIDTH = 4800;
  const WORLD_HEIGHT = 720;
  const GROUND_Y = 640;
  const FINISH_X = 4620;
  const START_X = 100;
  const MOVE_SEND_MS = 50; // kirim posisi ~20 Hz

  const COLORS = [0xff4757, 0x2e86ff, 0x2ed573, 0xffa502, 0xa55eea, 0xff6b81, 0x1dd1a1, 0x70a1ff];

  // ---------- Definisi map terpusat (v0.2.0) ----------
  // Satu-satunya tempat layout map ditulis; server hanya tahu id + nama
  // (lihat MAPS di server.js). Semua rintangan bergerak dihitung dari
  // serverTime, jadi identik di semua client.
  // ground: segmen tanah [x1,x2] (jurang = celah antar segmen)
  // checkpointX: checkpoint respawn; platforms: pijakan melayang [x,y]
  // hammers: {x,len,speed,phase} — palu putar
  // movers: {x,y,axis,amp,period,phase} — platform bergerak (sinus dari serverTime)
  // bumpers: [x,y]; ice: segmen es [x1,x2] (harus di dalam segmen tanah)
  // ball: {speed px/dtk, radius} — bola raksasa yang menyapu map berulang
  // doors: {x,width,height,period,closedMs} — pintu buka-tutup berkala
  // fan: {x1,x2,topY,pushX,lift} — zona angin (dorong ke belakang + angkat)
  const MAPS = {
    map1: {
      id: 'map1', name: 'Map 1 Klasik',
      ground: [[0, 900], [1020, 1820], [1940, 2620], [2740, 3440], [3560, 4280], [4400, 4800]],
      checkpointX: 2400,
      platforms: [[1250, 480], [2150, 460], [3150, 480], [4050, 460]],
      hammers: [
        { x: 1500, len: 140, speed: 1100, phase: 0 },
        { x: 2950, len: 160, speed: 900, phase: Math.PI },
      ],
      movers: [
        { x: 960, y: 540, axis: 'x', amp: 70, period: 1200, phase: 0 },
        { x: 3500, y: 540, axis: 'y', amp: 60, period: 1400, phase: 0 },
      ],
      bumpers: [[2250, 600], [3850, 600]],
      ice: [],
      ball: null,
      doors: [],
      fan: null,
    },
    map2: {
      id: 'map2', name: 'Map 2 Badai',
      // Jurang di posisi berbeda dari Map 1; finish tetap x=4620.
      ground: [[0, 700], [860, 1500], [1660, 2300], [2460, 3100], [3260, 3900], [4060, 4800]],
      checkpointX: 2250,
      platforms: [[1000, 480], [1900, 460], [2700, 480], [3600, 470]],
      hammers: [
        { x: 1200, len: 150, speed: 1000, phase: 0 },
        { x: 3400, len: 150, speed: 1200, phase: Math.PI },
      ],
      movers: [
        { x: 780, y: 540, axis: 'x', amp: 60, period: 1100, phase: 0 },
        { x: 3180, y: 540, axis: 'y', amp: 55, period: 1300, phase: Math.PI / 2 },
      ],
      bumpers: [[2100, 600], [4200, 600]],
      // Lantai es: di dalam segmen tanah [1660,2300] dan [3260,3900].
      ice: [[1800, 2300], [3400, 3900]],
      // Bola raksasa: sapu map dari x=-400 sampai 5200, kecepatan 200 px/dtk.
      ball: { speed: 200, radius: 34 },
      // Pintu dorong di x=2900: siklus 4 dtk (2 dtk tutup, 2 dtk buka).
      doors: [{ x: 2900, width: 36, height: 140, period: 4000, closedMs: 2000 }],
      // Kipas angin di ujung map: zona x 4100-4400, dorong ke kiri + angkat.
      fan: { x1: 4100, x2: 4400, topY: 380, pushX: 160, lift: 24 },
    },
  };

  // Helper DOM — HARUS didefinisikan paling atas: v0.1.4 sempat memanggil $()
  // di bagian progress bar SEBELUM $ didefinisikan, sehingga script mati
  // dengan ReferenceError dan socket tidak pernah connect (footer tetap merah).
  const $ = (id) => document.getElementById(id);

  // ---------- State client ----------
  const socket = io();
  let myId = null;
  let myColor = 0;
  let myShape = 'kotak';
  let myName = 'Pemain';
  let isHost = false;
  let roomCode = '';
  let roomStatus = 'lobby';
  let currentMapId = 'map1'; // map room saat ini; default Map 1
  let currentMode = 'race'; // 'race' = balapan sekali, 'elimination' = eliminasi
  let currentRound = 1;
  let amEliminated = false; // true kalau saya gugur di mode eliminasi (jadi penonton)
  let spectateTargetId = null; // id pemain yang sedang ditonton (mode penonton, Fitur 5)
  let lastPlayers = []; // daftar pemain terakhir dari roomUpdate (dipakai mode penonton)
  let raceStartServerTime = null;
  let serverTimeOffset = 0; // serverTime - Date.now()
  let finished = false;
  let finishSent = false;
  let checkpoint = { x: START_X, y: 500 };
  let scene = null; // GameScene aktif
  let remoteTargets = {}; // id -> {x,y,name,colorHex}

  function serverNow() { return Date.now() + serverTimeOffset; }
  function fmtTime(ms) { return (ms / 1000).toFixed(1) + ' dtk'; }

  // ---------- Pemilih skin (v0.2.0 Fitur 4): warna + bentuk ----------
  // Pilihan disimpan di localStorage ('larikuy-color' = index 0-7,
  // 'larikuy-shape' = 'kotak'/'bulat'/'segitiga') supaya tidak perlu
  // pilih ulang tiap buka halaman. Server boleh menimpa warna kalau
  // warna yang diminta sudah dipakai pemain lain di room itu — warna
  // AKHIR selalu dari joinedRoom (colorHex), bentuk dari joinedRoom.shape.
  const SKIN_SHAPES = ['kotak', 'bulat', 'segitiga'];
  const SHAPE_LABEL = { kotak: '⬛ Kotak', bulat: '🔵 Bulat', segitiga: '🔺 Segitiga' };
  let chosenColor = 0;
  let chosenShape = 'kotak';
  try {
    const savedColor = parseInt(localStorage.getItem('larikuy-color'), 10);
    if (Number.isInteger(savedColor) && savedColor >= 0 && savedColor < COLORS.length) chosenColor = savedColor;
    const savedShape = localStorage.getItem('larikuy-shape');
    if (SKIN_SHAPES.includes(savedShape)) chosenShape = savedShape;
  } catch (e) { /* localStorage tidak tersedia — pakai default */ }
  myShape = chosenShape;
  // Nama tekstur Phaser per kombinasi warna+bentuk: 'player_<color>_<shape>'.
  // Fallback ke kotak warna itu kalau kombinasi belum ada teksturnya.
  function playerTexture(color, shape) {
    const c = (Number.isInteger(color) && color >= 0 && color < COLORS.length) ? color : 0;
    const s = SKIN_SHAPES.includes(shape) ? shape : 'kotak';
    return 'player_' + c + '_' + s;
  }

  // ---------- SFX: synth Web Audio murni, tanpa file audio eksternal (v0.1.4) ----------
  // AudioContext hanya dibuat/di-resume setelah interaksi user pertama,
  // supaya tidak diblokir kebijakan autoplay browser.
  const SFX = (() => {
    let ctx = null;
    let muted = false;
    try { muted = localStorage.getItem('larikuy-muted') === '1'; } catch (e) { /* abaikan */ }
    function ensure() {
      if (!ctx) {
        try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
      }
      if (ctx && ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function tone(opts) {
      if (muted) return;
      const c = ensure();
      if (!c) return;
      const freq = opts.freq || 440, freqEnd = opts.freqEnd || null;
      const dur = opts.dur || 0.12, type = opts.type || 'sine';
      const vol = opts.vol != null ? opts.vol : 0.2, delay = opts.delay || 0;
      const t0 = c.currentTime + delay;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t0); o.stop(t0 + dur + 0.05);
    }
    return {
      isMuted() { return muted; },
      toggle() {
        muted = !muted;
        try { localStorage.setItem('larikuy-muted', muted ? '1' : '0'); } catch (e) { /* abaikan */ }
        return muted;
      },
      unlock() { ensure(); },
      click() { tone({ freq: 600, dur: 0.06, type: 'square', vol: 0.12 }); },
      jump() { tone({ freq: 300, freqEnd: 700, dur: 0.15, vol: 0.2 }); },
      fall() { tone({ freq: 500, freqEnd: 120, dur: 0.35, type: 'sawtooth', vol: 0.18 }); },
      hammer() {
        tone({ freq: 160, freqEnd: 60, dur: 0.2, type: 'square', vol: 0.22 });
        tone({ freq: 90, dur: 0.15, type: 'triangle', vol: 0.2, delay: 0.02 });
      },
      checkpoint() { tone({ freq: 880, dur: 0.12 }); tone({ freq: 1318, dur: 0.18, delay: 0.1 }); },
      count() { tone({ freq: 440, dur: 0.12, type: 'square', vol: 0.18 }); },
      go() { tone({ freq: 880, dur: 0.3, type: 'square', vol: 0.2 }); tone({ freq: 1320, dur: 0.3, delay: 0.02 }); },
      fanfare() { [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.18, delay: i * 0.12 })); },
      otherFinish() { tone({ freq: 988, dur: 0.15 }); tone({ freq: 1175, dur: 0.2, delay: 0.1 }); },
      boing() { tone({ freq: 200, freqEnd: 600, dur: 0.2, vol: 0.18 }); },
    };
  })();
  // Buka kunci audio saat interaksi pertama (klik / sentuh / tombol keyboard).
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
    window.addEventListener(ev, () => SFX.unlock(), { once: true, passive: true }));

  // ---------- Progress bar balapan (v0.1.4) ----------
  // DOM-only, ringan: hanya ubah style.left dot, jangan rebuild innerHTML.
  const progressDotsEl = $('progressDots');
  const progressMap = new Map(); // id -> {name, colorHex, x, finished, place}
  const progressEls = {}; // id -> dot element
  let lastProgressAt = 0;
  function progressPct(x) {
    return Math.max(0, Math.min(100, (((Number(x) || START_X) - START_X) / (FINISH_X - START_X)) * 100));
  }
  function updateProgressDot(id, data) {
    if (!progressDotsEl) return;
    const prev = progressMap.get(id) || {};
    const merged = {
      name: data.name != null ? data.name : prev.name,
      colorHex: data.colorHex != null ? data.colorHex : prev.colorHex,
      x: data.x != null ? data.x : prev.x,
      finished: data.finished != null ? data.finished : prev.finished,
      place: data.place != null ? data.place : prev.place,
      isBot: data.isBot != null ? data.isBot : prev.isBot,
    };
    progressMap.set(id, merged);
    let el = progressEls[id];
    if (!el) {
      el = document.createElement('div');
      el.className = 'progress-dot';
      // Mode penonton (Fitur 5): klik dot = tonton pemain itu (hanya yang
      // masih aktif & hanya saat jadi penonton; spectatePlayer mengabaikan
      // sisanya diam-diam).
      el.style.cursor = 'pointer';
      el.title = 'Klik untuk menonton pemain ini';
      el.addEventListener('click', () => spectatePlayer(id));
      const lab = document.createElement('span');
      lab.className = 'pname';
      el.appendChild(lab);
      progressDotsEl.appendChild(el);
      progressEls[id] = el;
    }
    el.style.left = progressPct(merged.x) + '%';
    el.style.background = merged.colorHex || '#999';
    el.classList.toggle('me', id === myId);
    el.classList.toggle('finished', !!merged.finished);
    el.firstChild.textContent = (merged.name || '').slice(0, 8) +
      (merged.isBot ? ' 🤖' : '') +
      (merged.finished && merged.place ? ' #' + merged.place : '') +
      (id === myId ? ' 👈' : '');
  }
  function pruneProgressDots(aliveIds) {
    Object.keys(progressEls).forEach((id) => {
      if (!aliveIds.has(id)) {
        progressEls[id].remove();
        delete progressEls[id];
        progressMap.delete(id);
      }
    });
  }
  function resetProgress() {
    progressMap.clear();
    Object.values(progressEls).forEach((el) => el.remove());
    Object.keys(progressEls).forEach((id) => delete progressEls[id]);
    lastProgressAt = 0;
  }
  function updateLocalProgress(now) {
    if (!scene || !scene.player || !myId) return;
    if (now - lastProgressAt < 100) return; // maks ~10 Hz, cukup untuk bar
    lastProgressAt = now;
    updateProgressDot(myId, {
      name: myName, colorHex: '#' + COLORS[myColor].toString(16).padStart(6, '0'),
      x: scene.player.x, finished,
    });
  }

  // ---------- DOM ----------
  const lobbyEl = $('lobby'), gameSectionEl = $('gameSection');
  const lobbyErrorEl = $('lobbyError'), roomInfoEl = $('roomInfo');
  const playerListEl = $('playerList'), resultsEl = $('results'), resultsListEl = $('resultsList');
  const countdownEl = $('countdown'), toastEl = $('toast');
  const mapPickerEl = $('mapPicker'), btnMap1El = $('btnMap1'), btnMap2El = $('btnMap2');
  const modePickerEl = $('modePicker'), btnModeRaceEl = $('btnModeRace'), btnModeElimEl = $('btnModeElim');
  const botPickerEl = $('botPicker'), chkFillBotsEl = $('chkFillBots');
  const modeLineEl = $('modeLine'), hudModeEl = $('hudMode');
  const roundPanelEl = $('roundPanel'), roundPanelTitleEl = $('roundPanelTitle');
  const roundPanelSubEl = $('roundPanelSub'), roundPanelListEl = $('roundPanelList');
  const roundPanelNextEl = $('roundPanelNext'), resultsTitleEl = $('resultsTitle');

  function showError(msg) { lobbyErrorEl.textContent = msg; lobbyErrorEl.hidden = false; }
  function showToast(msg, ms) {
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { toastEl.hidden = true; }, ms || 1800);
  }

  // ---------- Pemilih map (v0.2.0): hanya host, hanya saat lobby ----------
  function updateMapPicker(mapId) {
    if (btnMap1El) btnMap1El.classList.toggle('selected', mapId === 'map1');
    if (btnMap2El) btnMap2El.classList.toggle('selected', mapId === 'map2');
  }
  // Penanda checkpoint di progress bar ikut checkpoint map yang dipilih.
  function updateCheckpointMarker(mapId) {
    const def = MAPS[mapId] || MAPS.map1;
    const el = $('progressCheckpoint');
    if (el) el.style.left = (((def.checkpointX - START_X) / (FINISH_X - START_X)) * 100).toFixed(1) + '%';
  }
  // Terapkan map dari server: simpan, update UI, rebuild backdrop kalau berubah.
  function applyMap(mapId, status) {
    if (!mapId || !MAPS[mapId]) return;
    const changed = mapId !== currentMapId;
    currentMapId = mapId;
    updateMapPicker(mapId);
    updateCheckpointMarker(mapId);
    if (changed && scene && status === 'lobby') scene.showLobbyBackdrop();
  }

  // ---------- Pemilih mode (v0.2.0 Fitur 2): hanya host, hanya saat lobby ----------
  function modeLabel(mode) {
    return mode === 'elimination' ? '💀 Eliminasi' : '🏁 Balapan Sekali';
  }
  function updateModePicker(mode) {
    if (btnModeRaceEl) btnModeRaceEl.classList.toggle('selected', mode !== 'elimination');
    if (btnModeElimEl) btnModeElimEl.classList.toggle('selected', mode === 'elimination');
    if (modeLineEl) modeLineEl.textContent = 'Mode: ' + modeLabel(mode) +
      (mode === 'elimination' ? ' — 2 terlambat gugur tiap round, min. 3 pemain' : '');
  }
  // HUD mode/round: tampil saat balapan eliminasi; kalau saya gugur,
  // tampilkan label penonton (kamera mengikuti pemain lain ditangani
  // mode penonton di bawah — updateSpectator).
  function updateHudMode() {
    if (!hudModeEl) return;
    if (roomStatus === 'lobby') { hudModeEl.hidden = true; return; }
    if (currentMode === 'elimination') {
      hudModeEl.hidden = false;
      hudModeEl.textContent = amEliminated
        ? '💀 Kamu gugur — jadi penonton'
        : '💀 Eliminasi · Round ' + currentRound;
    } else {
      hudModeEl.hidden = false;
      hudModeEl.textContent = '🏁 Balapan Sekali';
    }
  }
  // Terapkan mode dari server: simpan + update UI.
  function applyMode(mode) {
    if (mode !== 'race' && mode !== 'elimination') return;
    currentMode = mode;
    updateModePicker(mode);
    updateHudMode();
  }

  // ---------- Mode Penonton (v0.2.0 Fitur 5) ----------
  // Pemain yang sudah finish (mode race) atau gugur (mode eliminasi)
  // otomatis jadi penonton: kamera Phaser mengikuti pemain yang masih
  // balapan, bukan karakternya sendiri yang diam. Semua keputusan di sini
  // client-side; server hanya perlu terus mengalirkan posisi pemain aktif
  // (roomUpdate/playersMoved) dan mengabaikan move dari yang sudah
  // finish/gugur — keduanya sudah begitu di server.js, jadi tidak ada
  // perubahan server untuk fitur ini.
  //
  // Aturan target:
  // - "Aktif" = belum finish (saat racing) DAN belum eliminated.
  //   Di luar racing (antar-round) flag finished sudah basi (baru direset
  //   saat round berikutnya mulai), jadi di sana yang dihitung hanya
  //   "belum eliminated" — tapi isSpectating() sendiri hanya true saat
  //   racing, jadi antar-round kamera kembali ke karakter sendiri.
  // - Target awal = pemain aktif paling depan (x terbesar; x diambil dari
  //   progressMap yang paling segar, fallback ke x terakhir roomUpdate).
  // - Target disimpan sebagai ID + lookup sprite tiap kali perlu
  //   (followSpectateTarget): sprite remote dibuat/dihapus dinamis, jadi
  //   kamera tidak pernah memegang referensi sprite yang sudah dihancurkan.
  //   Kalau sprite target belum ada (belum ada playersMoved darinya),
  //   kamera menunggu — updateRemote() akan follow begitu sprite dibuat.
  // - Kalau target finish/gugur/disconnect, updateSpectator() memilih
  //   pemain aktif berikutnya (paling depan); kalau tidak ada yang tersisa,
  //   kamera kembali ke pemain sendiri (raceFinished/eliminationFinished
  //   segera menyusul dan menampilkan hasil).
  function isSpectating() {
    return roomStatus === 'racing' && (finished || amEliminated);
  }
  function activeRacers() {
    const xOf = (p) => {
      const m = progressMap.get(p.id);
      return (m && m.x != null) ? m.x : (Number(p.x) || START_X);
    };
    return lastPlayers
      .filter((p) => p.id !== myId && !p.eliminated && (roomStatus !== 'racing' || !p.finished))
      .sort((a, b) => xOf(b) - xOf(a));
  }
  function spectateName(id) {
    const p = lastPlayers.find((q) => q.id === id);
    if (p) return p.name;
    const m = progressMap.get(id);
    return (m && m.name) || '?';
  }
  function updateSpectateHud() {
    const label = $('hudSpectate'), btn = $('btnSpectateNext');
    const show = isSpectating() && !!spectateTargetId;
    if (label) {
      label.hidden = !show;
      if (show) label.textContent = '👁️ Nonton: ' + spectateName(spectateTargetId);
    }
    if (btn) btn.hidden = !show;
  }
  // Terapkan target tontonan (id atau null = kembali ke diri sendiri).
  function applySpectateTarget(id) {
    spectateTargetId = id || null;
    if (scene) scene.followSpectateTarget(spectateTargetId);
    updateSpectateHud();
  }
  // Dipanggil setiap kali keadaan bisa berubah (roomUpdate, playerFinished,
  // playerLeft, raceStarted, roundEnded, raceFinished, dst.): masuk/keluar
  // mode penonton, pertahankan target kalau masih aktif, atau pilih baru.
  function updateSpectator() {
    if (!isSpectating()) {
      if (spectateTargetId) applySpectateTarget(null);
      else updateSpectateHud();
      return;
    }
    const actives = activeRacers();
    if (actives.length === 0) { applySpectateTarget(null); return; }
    if (spectateTargetId && actives.some((p) => p.id === spectateTargetId)) {
      applySpectateTarget(spectateTargetId); // target masih aktif — pertahankan
      return;
    }
    applySpectateTarget(actives[0].id); // target awal / pengganti = paling depan
  }
  // Ganti tontonan ke pemain aktif berikutnya (dir=+1) / sebelumnya (dir=-1),
  // urut berdasarkan x (paling depan dulu), melingkar. Dipakai tombol HUD
  // "⏭️ Ganti Tontonan" dan keyboard ←/→.
  function cycleSpectateTarget(dir) {
    if (!isSpectating()) return;
    const actives = activeRacers();
    if (actives.length === 0) return;
    let idx = actives.findIndex((p) => p.id === spectateTargetId);
    idx = (idx + dir + actives.length) % actives.length;
    applySpectateTarget(actives[idx].id);
    SFX.click();
  }
  // Tonton satu pemain tertentu (klik dot progress bar / nama di daftar
  // pemain). Hanya pemain aktif yang bisa ditonton; di luar mode penonton
  // atau target tidak aktif = diabaikan diam-diam.
  function spectatePlayer(id) {
    if (!isSpectating() || !id) return;
    if (!activeRacers().some((p) => p.id === id)) return;
    applySpectateTarget(id);
    SFX.click();
  }
  socket.on('connect', () => { $('connStatus').textContent = '🟢 terhubung'; });
  socket.on('disconnect', () => { $('connStatus').textContent = '🔴 terputus'; });
  socket.on('timeSync', (d) => { serverTimeOffset = d.serverTime - Date.now(); });
  socket.on('joinError', (d) => showError(d.message));

  socket.on('joinedRoom', (d) => {
    document.body.classList.add('in-game'); // sembunyikan header/footer: layar penuh buat game, tanpa scroll
    myId = d.playerId; roomCode = d.code; isHost = d.isHost;
    // Warna pemain dari server, supaya sprite + dot progress bar sama warnanya
    // (sebelumnya myColor tidak pernah diisi, jadi pemain lokal selalu merah).
    myColor = COLORS.findIndex((c) => '#' + c.toString(16).padStart(6, '0') === (d.colorHex || '').toLowerCase());
    if (myColor < 0) myColor = 0;
    // Bentuk AKHIR dari server (validasi server; fallback ke pilihan sendiri).
    myShape = SKIN_SHAPES.includes(d.shape) ? d.shape : chosenShape;
    serverTimeOffset = d.serverTime - Date.now();
    $('roomCode').textContent = roomCode;
    $('hudRoom').textContent = 'Room ' + roomCode;
    roomInfoEl.hidden = false;
    lobbyErrorEl.hidden = true;
    lobbyEl.hidden = true;
    gameSectionEl.hidden = false;
    resultsEl.hidden = true;
    resetProgress();
    updateProgressDot(d.playerId, { name: myName, colorHex: d.colorHex, x: START_X, finished: false });
    applyMap(d.map, 'lobby');
    applyMode(d.mode || 'race');
    if (d.round) currentRound = d.round;
    if (!window.__lariKuyGame) initPhaser();
    if (scene) scene.showLobbyBackdrop();
  });

  socket.on('roomUpdate', (d) => {
    roomStatus = d.status;
    lastPlayers = d.players; // sumber daftar pemain aktif untuk mode penonton
    if (d.serverTime) serverTimeOffset = d.serverTime - Date.now();
    if (d.mode) applyMode(d.mode);
    if (d.round) currentRound = d.round;
    // Status gugur saya = sumber kebenaran dari server (roomUpdate).
    const me = d.players.find((p) => p.id === myId);
    if (me) { amEliminated = !!me.eliminated; finished = !!me.finished; updateHudMode(); }
    renderPlayerList(d.players);
    $('hudPlayers').textContent = '👥 ' + d.players.length + '/8';
    roomInfoEl.hidden = d.status !== 'lobby';
    $('btnStart').hidden = !(isHost && d.status === 'lobby');
    $('waitHost').hidden = isHost || d.status !== 'lobby';
    mapPickerEl.hidden = !(isHost && d.status === 'lobby');
    modePickerEl.hidden = !(isHost && d.status === 'lobby');
    // Kontrol bot (Fitur 3): hanya host saat lobby; checkbox ikut state server.
    if (botPickerEl) botPickerEl.hidden = !(isHost && d.status === 'lobby');
    if (chkFillBotsEl && d.fillBots != null) chkFillBotsEl.checked = !!d.fillBots;
    applyMap(d.map, d.status);
    // Progress bar: posisi tiap pemain dari roomUpdate (otoritatif).
    d.players.forEach((p) => updateProgressDot(p.id, p));
    pruneProgressDots(new Set(d.players.map((p) => p.id)));
    // Hapus pemain remote yang sudah keluar.
    if (scene) scene.syncRemotePlayers(d.players);
    // Mode penonton: target bisa gugur/disconnect di roomUpdate ini,
    // atau saya sendiri yang baru finish/gugur.
    updateSpectator();
  });

  socket.on('countdown', (d) => {
    SFX.count();
    countdownEl.hidden = false;
    countdownEl.textContent = d.count;
  });

  socket.on('raceStarted', (d) => {
    SFX.go();
    roomStatus = 'racing'; // raceStarted = balapan jalan (jangan tunggu roomUpdate berikutnya)
    raceStartServerTime = d.serverTime;
    serverTimeOffset = d.serverTime - Date.now();
    // Map round ini (eliminasi: round genap = map lainnya) + nomor round.
    if (d.map) applyMap(d.map, 'racing');
    if (d.round) currentRound = d.round;
    if (d.mode) applyMode(d.mode);
    if (d.mode === 'race') amEliminated = false; // balapan sekali: tidak ada yang gugur
    finished = false; finishSent = false;
    checkpoint = { x: START_X, y: 500 };
    resetProgress();
    updateProgressDot(myId, { name: myName, colorHex: '#' + COLORS[myColor].toString(16).padStart(6, '0'), x: START_X, finished: false });
    countdownEl.textContent = 'GO! 🏁';
    setTimeout(() => { countdownEl.hidden = true; }, 600);
    if (roundPanelEl) roundPanelEl.hidden = true;
    if (resultsEl) resultsEl.hidden = true;
    if (scene) scene.startRace();
    // Mode penonton (eliminasi): yang gugur di round sebelumnya langsung
    // menonton lagi begitu round baru mulai.
    updateSpectator();
    showToast('Lari, Kuy! 🏃');
  });

  socket.on('playersMoved', (d) => {
    if (d.id === myId) return;
    remoteTargets[d.id] = { x: d.x, y: d.y, name: d.name, color: d.color, colorHex: d.colorHex, shape: d.shape, isBot: d.isBot };
    updateProgressDot(d.id, d);
    if (scene) scene.updateRemote(d.id, d);
  });

  socket.on('playerLeft', (d) => {
    delete remoteTargets[d.id];
    lastPlayers = lastPlayers.filter((p) => p.id !== d.id);
    if (scene) scene.removeRemote(d.id);
    // Kalau yang keluar adalah target tontonan, pindah ke pemain aktif lain.
    updateSpectator();
  });

  socket.on('playerFinished', (d) => {
    if (d.id === myId) { finished = true; SFX.fanfare(); } else SFX.otherFinish();
    // Catat finish di daftar lokal supaya mode penonton langsung tahu
    // targetnya sudah tidak aktif, tanpa menunggu roomUpdate berikutnya.
    const lp = lastPlayers.find((p) => p.id === d.id);
    if (lp) lp.finished = true;
    updateProgressDot(d.id, { x: FINISH_X, finished: true, place: d.place });
    showToast('🏁 ' + d.name + ' finish ke-' + d.place + ' (' + fmtTime(d.timeMs) + ')');
    // Saya baru finish (race) = masuk mode penonton; target tontonan yang
    // baru finish = pindah ke pemain aktif berikutnya.
    updateSpectator();
  });

  socket.on('raceFinished', (d) => {
    roomStatus = 'finished';
    (d.results || []).forEach((r) => updateProgressDot(r.id, { x: FINISH_X, finished: true, place: r.place }));
    if (resultsTitleEl) resultsTitleEl.textContent = '🏆 Hasil Balapan';
    resultsEl.hidden = false;
    resultsListEl.innerHTML = d.results.map((r) =>
      '<li><b>#' + r.place + ' ' + escapeHtml(r.name) + (r.isBot ? ' 🤖' : '') + '</b> — ' + fmtTime(r.timeMs) +
      (r.id === myId ? ' 👈 kamu' : '') + '</li>').join('') ||
      '<li>Belum ada yang finish.</li>';
    if (scene) scene.endRace();
    // Balapan selesai = mode penonton berakhir, panel hasil tampil.
    updateSpectator();
  });

  // ---------- Mode Eliminasi: akhir round & juara ----------
  socket.on('startError', (d) => showToast(d.message || 'Tidak bisa mulai 😢', 3000));

  socket.on('roundEnded', (d) => {
    roomStatus = 'betweenRounds';
    currentRound = d.nextRound || currentRound + 1;
    if (scene) scene.endRace();
    const iAmOut = (d.eliminated || []).some((p) => p.id === myId);
    if (iAmOut) {
      amEliminated = true;
      SFX.fall();
      showToast('💀 Kamu gugur di Round ' + d.round + ' — jadi penonton', 3500);
    } else {
      showToast('✅ Kamu lolos! Round ' + d.nextRound + ' dimulai sebentar lagi…', 3500);
    }
    updateHudMode();
    // Antar-round: mode penonton berhenti dulu (kamera kembali ke karakter
    // sendiri); yang gugur akan menonton lagi saat round baru mulai.
    updateSpectator();
    // Panel antar-round: siapa gugur, siapa lolos, map + round berikutnya.
    if (roundPanelEl) {
      roundPanelEl.hidden = false;
      if (roundPanelTitleEl) roundPanelTitleEl.textContent = '💀 Round ' + d.round + ' Selesai' +
        (d.reason === 'timeout' ? ' (waktu habis ⏱)' : '');
      if (roundPanelSubEl) {
        roundPanelSubEl.textContent = (d.eliminated || []).map((p) => p.name).join(', ') +
          ' gugur 💀 · ' + (d.survivors || []).length + ' pemain lolos ✅';
      }
      if (roundPanelListEl) {
        roundPanelListEl.innerHTML =
          (d.results || []).map((r) =>
            '<li><b>#' + r.place + ' ' + escapeHtml(r.name) + '</b> — ' +
            (r.timeMs != null ? fmtTime(r.timeMs) : 'belum finish ⏱') +
            ((d.eliminated || []).some((p) => p.id === r.id) ? ' 💀 gugur' : ' ✅ lolos') +
            (r.id === myId ? ' 👈 kamu' : '') + '</li>').join('');
      }
      if (roundPanelNextEl) {
        roundPanelNextEl.textContent = 'Round ' + d.nextRound + ' (' + (d.nextMapName || '') +
          ') dimulai otomatis sebentar lagi…';
      }
    }
  });

  socket.on('eliminationFinished', (d) => {
    roomStatus = 'finished';
    if (scene) scene.endRace();
    updateSpectator(); // mode penonton berakhir, panel juara tampil
    if (d.champion && d.champion.id === myId) SFX.fanfare(); else SFX.otherFinish();
    if (resultsTitleEl) resultsTitleEl.textContent = '🏆 Juara Eliminasi';
    resultsEl.hidden = false;
    if (roundPanelEl) roundPanelEl.hidden = true;
    resultsListEl.innerHTML =
      '<li><b>👑 Juara: ' + escapeHtml(d.champion ? d.champion.name : '?') + '</b>' +
      (d.champion && d.champion.id === myId ? ' 👈 kamu!' : '') + '</li>' +
      (d.results || []).map((r) =>
        '<li><b>#' + r.place + ' ' + escapeHtml(r.name) + '</b> — ' +
        (r.timeMs != null ? fmtTime(r.timeMs) : '—') +
        (r.id === myId ? ' 👈 kamu' : '') + '</li>').join('');
    showToast('👑 ' + (d.champion ? d.champion.name : '?') + ' juara Eliminasi!', 4000);
  });

  socket.on('backToLobby', () => {
    document.body.classList.remove('in-game');
    resetProgress();
    roomStatus = 'lobby';
    currentMode = 'race';
    currentRound = 1;
    amEliminated = false;
    if (chkFillBotsEl) chkFillBotsEl.checked = false; // bot dihapus server saat backToLobby
    updateModePicker('race');
    updateHudMode();
    updateSpectator(); // kembali ke lobby = keluar mode penonton
    resultsEl.hidden = true;
    if (roundPanelEl) roundPanelEl.hidden = true;
    gameSectionEl.hidden = true;
    lobbyEl.hidden = false;
    roomInfoEl.hidden = true;
    if (scene) scene.showLobbyBackdrop();
  });

  function renderPlayerList(players) {
    playerListEl.innerHTML = players.map((p) =>
      '<li data-player-id="' + p.id + '"' + (p.eliminated ? ' class="eliminated"' : '') + '><span class="dot" style="background:' + p.colorHex + '"></span>' +
      escapeHtml(p.name) + (p.isBot ? ' 🤖' : '') + (p.isHost ? ' 👑 host' : '') +
      (p.eliminated ? ' 💀 gugur' : (p.finished ? ' 🏁 ' + fmtTime(p.finishTime) : '')) + '</li>').join('');
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- Tombol ganti tontonan (v0.2.0 Fitur 5) + klik nama pemain ----------
  // (a) Tombol HUD "⏭️ Ganti Tontonan": pindah ke pemain aktif berikutnya.
  const btnSpectateNextEl = $('btnSpectateNext');
  if (btnSpectateNextEl) {
    btnSpectateNextEl.addEventListener('click', () => {
      SFX.unlock();
      cycleSpectateTarget(1);
    });
  }
  // (b) Klik nama di daftar pemain (#playerList): tonton pemain itu.
  // Delegasi di <ul> supaya tetap jalan walau renderPlayerList menulis
  // ulang innerHTML tiap roomUpdate.
  if (playerListEl) {
    playerListEl.addEventListener('click', (e) => {
      const t = e.target;
      const li = t && t.closest ? t.closest('li[data-player-id]') : null;
      if (li && li.getAttribute) spectatePlayer(li.getAttribute('data-player-id'));
    });
  }

  // ---------- Tombol mute (v0.1.4): preferensi tersimpan di localStorage ----------
  const btnMuteEl = $('btnMute');
  if (btnMuteEl) {
    btnMuteEl.textContent = SFX.isMuted() ? '🔇' : '🔊';
    btnMuteEl.addEventListener('click', () => {
      SFX.unlock();
      const muted = SFX.toggle();
      btnMuteEl.textContent = muted ? '🔇' : '🔊';
      if (!muted) SFX.click();
      showToast(muted ? '🔇 Suara dimatikan' : '🔊 Suara dinyalakan');
    });
  }

  // ---------- Pemilih skin di lobby (v0.2.0 Fitur 4) ----------
  // Tombol warna dibuat dari COLORS (8 warna server); tombol bentuk dari
  // SKIN_SHAPES. Klik = simpan ke localStorage + tandai yang dipilih.
  function buildSkinPicker() {
    const colorEl = $('colorPicker'), shapeEl = $('shapePicker');
    if (!colorEl || !shapeEl) return;
    COLORS.forEach((color, i) => {
      const hex = '#' + color.toString(16).padStart(6, '0');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'color-btn' + (i === chosenColor ? ' selected' : '');
      b.style.background = hex;
      b.title = 'Warna ' + (i + 1);
      b.setAttribute('aria-label', 'Warna ' + (i + 1));
      b.addEventListener('click', () => {
        chosenColor = i;
        try { localStorage.setItem('larikuy-color', String(i)); } catch (e) { /* abaikan */ }
        SFX.unlock(); SFX.click();
        Array.prototype.forEach.call(colorEl.children, (c, j) => c.classList.toggle('selected', j === i));
      });
      colorEl.appendChild(b);
    });
    SKIN_SHAPES.forEach((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn small shape-btn' + (s === chosenShape ? ' selected' : '');
      b.textContent = SHAPE_LABEL[s];
      b.addEventListener('click', () => {
        chosenShape = s;
        try { localStorage.setItem('larikuy-shape', s); } catch (e) { /* abaikan */ }
        SFX.unlock(); SFX.click();
        Array.prototype.forEach.call(shapeEl.children, (c) => c.classList.toggle('selected', c.textContent === SHAPE_LABEL[s]));
      });
      shapeEl.appendChild(b);
    });
  }
  buildSkinPicker();

  // ---------- Tombol lobby ----------
  $('btnCreate').addEventListener('click', () => {
    SFX.unlock(); SFX.click();
    myName = $('playerName').value.trim() || 'Pemain';
    socket.emit('createRoom', { name: myName, color: chosenColor, shape: chosenShape });
  });
  $('btnJoin').addEventListener('click', () => {
    SFX.unlock(); SFX.click();
    myName = $('playerName').value.trim() || 'Pemain';
    const code = $('roomCodeInput').value.trim().toUpperCase();
    if (!code) return showError('Masukkan kode room 4 huruf dulu!');
    socket.emit('joinRoom', { code, name: myName, color: chosenColor, shape: chosenShape });
  });
  $('btnCopyCode').addEventListener('click', () => {
    SFX.unlock(); SFX.click();
    if (navigator.clipboard) navigator.clipboard.writeText(roomCode);
    showToast('Kode room disalin: ' + roomCode);
  });
  $('btnStart').addEventListener('click', () => { SFX.unlock(); SFX.click(); socket.emit('startGame'); });
  // Pemilih map: pilihan dikirim ke server, server yang broadcast ke semua.
  if (btnMap1El) btnMap1El.addEventListener('click', () => {
    SFX.unlock(); SFX.click();
    if (isHost) socket.emit('setMap', { map: 'map1' });
  });
  if (btnMap2El) btnMap2El.addEventListener('click', () => {
    SFX.unlock(); SFX.click();
    if (isHost) socket.emit('setMap', { map: 'map2' });
  });
  // Kontrol bot: checkbox dikirim ke server, server yang menambah/menghapus bot.
  if (chkFillBotsEl) chkFillBotsEl.addEventListener('change', () => {
    SFX.unlock(); SFX.click();
    if (isHost) socket.emit('setFillBots', { fill: chkFillBotsEl.checked });
  });
  // Pemilih mode: pilihan dikirim ke server, server yang broadcast ke semua.
  if (btnModeRaceEl) btnModeRaceEl.addEventListener('click', () => {
    SFX.unlock(); SFX.click();
    if (isHost) socket.emit('setMode', { mode: 'race' });
  });
  if (btnModeElimEl) btnModeElimEl.addEventListener('click', () => {
    SFX.unlock(); SFX.click();
    if (isHost) socket.emit('setMode', { mode: 'elimination' });
  });
  $('btnAgain').addEventListener('click', () => {
    SFX.unlock(); SFX.click();
    if (isHost) socket.emit('backToLobby');
    else { document.body.classList.remove('in-game'); resetProgress(); amEliminated = false; currentMode = 'race'; currentRound = 1; resultsEl.hidden = true; if (roundPanelEl) roundPanelEl.hidden = true; gameSectionEl.hidden = true; lobbyEl.hidden = false; roomInfoEl.hidden = true; }
  });

  // ---------- Input (keyboard + sentuh) ----------
  const keys = { left: false, right: false, jump: false };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = true;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = true;
    if (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') { keys.jump = true; e.preventDefault(); }
    // Mode penonton (Fitur 5): ←/→ ganti tontonan (tanpa repeat saat tombol
    // ditahan). Tidak bentrok dengan gerak: penonton memang tidak bisa gerak.
    if (!e.repeat && isSpectating() && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      cycleSpectateTarget(e.code === 'ArrowLeft' ? -1 : 1);
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
    if (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') keys.jump = false;
  });
  function bindTouch(id, prop) {
    const el = $(id);
    const on = (e) => { e.preventDefault(); keys[prop] = true; };
    const off = (e) => { e.preventDefault(); keys[prop] = false; };
    el.addEventListener('touchstart', on, { passive: false });
    el.addEventListener('touchend', off);
    el.addEventListener('touchcancel', off);
    el.addEventListener('mousedown', on);
    el.addEventListener('mouseup', off);
    el.addEventListener('mouseleave', off);
  }
  bindTouch('touchLeft', 'left');
  bindTouch('touchRight', 'right');
  bindTouch('touchJump', 'jump');

  // ---------- Gambar karakter per bentuk (v0.2.0 Fitur 4) ----------
  // Semua digambar di kanvas 36x48 supaya ukuran sprite & physics sama.
  // Kotak = persegi membulat + mata (yang sudah ada), Bulat = lingkaran +
  // mata, Segitiga = segitiga + mata (mata tetap terlihat di dalam bentuk).
  function drawPlayerTexture(g, color, shape) {
    if (shape === 'bulat') {
      g.fillStyle(color, 1);
      g.fillCircle(18, 24, 17);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(12, 18, 5);
      g.fillCircle(24, 18, 5);
      g.fillStyle(0x222222, 1);
      g.fillCircle(13, 18, 2.5);
      g.fillCircle(25, 18, 2.5);
      g.fillStyle(0xffffff, 0.9);
      g.fillRoundedRect(11, 32, 14, 5, 2);
    } else if (shape === 'segitiga') {
      g.fillStyle(color, 1);
      g.fillTriangle(18, 2, 35, 46, 1, 46);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(13, 27, 4.5);
      g.fillCircle(23, 27, 4.5);
      g.fillStyle(0x222222, 1);
      g.fillCircle(14, 27, 2.2);
      g.fillCircle(24, 27, 2.2);
      g.fillStyle(0xffffff, 0.9);
      g.fillRoundedRect(13, 35, 10, 4, 2);
    } else { // kotak (default)
      g.fillStyle(color, 1);
      g.fillRoundedRect(0, 0, 36, 48, 10);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(12, 18, 5);
      g.fillCircle(24, 18, 5);
      g.fillStyle(0x222222, 1);
      g.fillCircle(13, 18, 2.5);
      g.fillCircle(25, 18, 2.5);
      g.fillStyle(0xffffff, 0.9);
      g.fillRoundedRect(10, 32, 16, 6, 3);
    }
  }

  // ---------- Phaser ----------
  function initPhaser() {
    const config = {
      type: Phaser.AUTO,
      parent: 'game-container',
      width: 960,
      height: 540,
      backgroundColor: '#87ceeb',
      physics: { default: 'arcade', arcade: { gravity: { y: 1200 }, debug: false } },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [GameScene],
    };
    window.__lariKuyGame = new Phaser.Game(config);
  }

  class GameScene extends Phaser.Scene {
    constructor() { super('GameScene'); }

    create() {
      scene = this;
      this.racing = false;
      this.lastSend = 0;
      this.hammerHitAt = 0;
      this.ballHitAt = 0;
      this.lastJumpSfxAt = 0;
      this.checkpointReached = false;
      this.remoteSprites = {}; // id -> {sprite, label}
      // State dunia (diisi buildWorld, dihancurkan tiap rebuild).
      this.worldObjs = [];
      this.worldColliders = [];
      this.builtMapId = null;
      this.mapDef = MAPS.map1;
      this.grounds = [];
      this.platforms = [];
      this.movers = [];
      this.hammers = [];
      this.bumpers = [];
      this.doorObjs = [];
      this.ballImg = null;
      this.fanImg = null;

      // --- Tekstur pemain per warna x bentuk (v0.2.0 Fitur 4): 8 warna x 3 bentuk = 24 tekstur ---
      // Kunci: 'player_<color>_<shape>' (lihat playerTexture). Semua 36x48.
      COLORS.forEach((color, i) => {
        SKIN_SHAPES.forEach((shape) => {
          const key = 'player_' + i + '_' + shape;
          if (this.textures.exists(key)) return;
          const g = this.make.graphics({ x: 0, y: 0, add: false });
          drawPlayerTexture(g, color, shape);
          g.generateTexture(key, 36, 48);
          g.destroy();
        });
      });

      // --- Tekstur platform bergerak (130x20 oranye) ---
      if (!this.textures.exists('mover')) {
        const g2 = this.make.graphics({ x: 0, y: 0, add: false });
        g2.fillStyle(0xff6b35, 1);
        g2.fillRoundedRect(0, 0, 130, 20, 8);
        g2.fillStyle(0xffffff, 0.9);
        g2.fillRoundedRect(8, 7, 114, 5, 2);
        g2.generateTexture('mover', 130, 20);
        g2.destroy();
      }

      // --- Tekstur bola raksasa (Map 2): lingkaran + jari-jari, diputar saat menggelinding ---
      if (!this.textures.exists('ball')) {
        const g3 = this.make.graphics({ x: 0, y: 0, add: false });
        g3.fillStyle(0x95a5a6, 1);
        g3.fillCircle(36, 36, 34);
        g3.lineStyle(4, 0x2c3e50, 1);
        g3.strokeCircle(36, 36, 34);
        g3.lineStyle(3, 0x2c3e50, 1);
        g3.beginPath();
        g3.moveTo(36, 2); g3.lineTo(36, 70);
        g3.moveTo(2, 36); g3.lineTo(70, 36);
        g3.moveTo(12, 12); g3.lineTo(60, 60);
        g3.moveTo(60, 12); g3.lineTo(12, 60);
        g3.closePath();
        g3.strokePath();
        g3.generateTexture('ball', 72, 72);
        g3.destroy();
      }

      // --- Tekstur kipas angin (Map 2): 4 baling-baling + hub ---
      if (!this.textures.exists('fan')) {
        const g4 = this.make.graphics({ x: 0, y: 0, add: false });
        g4.fillStyle(0x74b9ff, 1);
        g4.fillEllipse(40, 14, 26, 22);
        g4.fillEllipse(40, 66, 26, 22);
        g4.fillEllipse(14, 40, 22, 26);
        g4.fillEllipse(66, 40, 22, 26);
        g4.fillStyle(0x2c3e50, 1);
        g4.fillCircle(40, 40, 12);
        g4.lineStyle(3, 0x2c3e50, 1);
        g4.strokeCircle(40, 40, 38);
        g4.generateTexture('fan', 80, 80);
        g4.destroy();
      }

      // --- Langit, awan, bukit (hiasan, sama untuk semua map) ---
      this.add.rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 0x87ceeb).setOrigin(0).setDepth(-2);
      for (let i = 0; i < 14; i++) {
        const cx = 120 + i * 340, cy = 60 + (i % 3) * 50;
        this.add.ellipse(cx, cy, 120, 40, 0xffffff, 0.9);
        this.add.ellipse(cx + 40, cy + 10, 90, 32, 0xffffff, 0.9);
      }
      for (let i = 0; i < 10; i++) {
        this.add.ellipse(200 + i * 480, GROUND_Y + 4, 320, 90, 0x7ec850, 0.8);
      }

      // --- Pemain lokal (dibuat SEBELUM buildWorld, karena collider butuh player) ---
      // Tekstur sesuai warna+bentuk AKHIR dari server (myColor/myShape diisi
      // di handler joinedRoom, sebelum initPhaser dipanggil).
      this.player = this.physics.add.image(START_X, 500, playerTexture(myColor, myShape)).setDisplaySize(36, 48);
      this.player.setCollideWorldBounds(true);
      this.player.setDepth(5);
      this.nameLabel = this.add.text(START_X, 460, myName, {
        fontSize: '14px', color: '#fff', fontStyle: 'bold',
        backgroundColor: 'rgba(0,0,0,0.55)', padding: { x: 4, y: 2 },
      }).setOrigin(0.5).setDepth(6);

      // --- Dunia sesuai map room saat ini (default Map 1) ---
      this.buildWorld(currentMapId);

      this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      // BUG FIX v0.1.3: batas bawah world HARUS terbuka (checkCollisionDown=false).
      // Sebelumnya world bounds bawah menahan pemain di y max ~696, padahal
      // respawn dipicu di y > 780 — jadi pemain jatuh ke jurang malah mendarat
      // di lantai tak terlihat di dasar jurang dan tidak pernah respawn.
      this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT, true, true, true, false);
      this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
      this.cameras.main.setZoom(1);

      // Teks status saat belum mulai
      this.waitText = this.add.text(480, 200, 'Menunggu host memulai…', {
        fontSize: '26px', color: '#222', fontStyle: 'bold',
        backgroundColor: 'rgba(255,255,255,0.85)', padding: { x: 16, y: 10 },
      }).setOrigin(0.5).setScrollFactor(0);
    }

    // --- Bangun (ulang) layout dunia sesuai map (v0.2.0) ---
    // Menghancurkan semua objek dunia + collider lama, lalu membangun dari
    // MAPS[mapId]. Dipanggil saat create(), saat map berubah di lobby, dan
    // saat race dimulai. Kalau map yang diminta sudah dibangun, tidak ngapa-ngapain.
    buildWorld(mapId) {
      if (!this.player) return;
      const def = MAPS[mapId] || MAPS.map1;
      if (this.builtMapId === mapId && this.grounds) return;
      this.builtMapId = mapId;
      this.mapDef = def;
      (this.worldObjs || []).forEach((o) => o.destroy());
      (this.worldColliders || []).forEach((c) => c.destroy());
      this.worldObjs = [];
      this.worldColliders = [];
      this.grounds = [];
      this.platforms = [];
      this.movers = [];
      this.hammers = [];
      this.bumpers = [];
      this.doorObjs = [];
      this.ballImg = null;
      this.fanImg = null;
      const add = (o) => { this.worldObjs.push(o); return o; };

      // --- Tanah: segmen dengan jurang di antaranya ---
      def.ground.forEach(([x1, x2]) => {
        const w = x2 - x1, cx = x1 + w / 2;
        const rect = add(this.add.rectangle(cx, GROUND_Y + 40, w, 80, 0x8b5a2b));
        const top = add(this.add.rectangle(cx, GROUND_Y + 2, w, 12, 0x2ed573));
        this.physics.add.existing(rect, true);
        this.grounds.push(rect);
        top.setDepth(1);
      });

      // --- Lantai es (Map 2): strip biru muda di atas segmen tanah es ---
      (def.ice || []).forEach(([x1, x2]) => {
        const w = x2 - x1, cx = x1 + w / 2;
        add(this.add.rectangle(cx, GROUND_Y + 2, w, 12, 0x9fd8ff)).setDepth(1);
      });
      if ((def.ice || []).length) {
        add(this.add.text(def.ice[0][0] + 10, GROUND_Y - 40, '🧊 ES — LICIN!', { fontSize: '16px', color: '#0b5fa5', fontStyle: 'bold' }));
      }

      // --- Platform kecil melayang (pijakan ekstra) ---
      def.platforms.forEach(([x, y]) => {
        const p = add(this.add.rectangle(x, y, 140, 18, 0xffa502));
        this.physics.add.existing(p, true);
        this.platforms.push(p);
      });

      // --- Platform bergerak: di atas jurang, posisi dari serverTime (lihat update) ---
      def.movers.forEach((d) => {
        const m = add(this.physics.add.image(d.x, d.y, 'mover'));
        m.setImmovable(true);
        m.body.allowGravity = false;
        m.body.moves = true;
        m.def = d;
        this.movers.push(m);
      });

      // --- Palu putar (visual + knockback manual di update) ---
      def.hammers.forEach((d) => {
        const h = { x: d.x, y: GROUND_Y, len: d.len, speed: d.speed, phase: d.phase };
        h.pivot = add(this.add.circle(h.x, h.y, 14, 0x222222));
        h.bar = add(this.add.rectangle(h.x, h.y, h.len, 18, 0xff4757).setOrigin(0, 0.5));
        h.bar.setStrokeStyle(3, 0x222222);
        this.hammers.push(h);
      });

      // --- Bumper (bonus): bola yang memantulkan pemain ---
      def.bumpers.forEach(([x, y]) => {
        const b = add(this.add.circle(x, y, 26, 0xffd32a).setStrokeStyle(3, 0x222222));
        this.physics.add.existing(b, true);
        this.bumpers.push(b);
      });

      // --- Bola raksasa (Map 2): visual saja, posisi dihitung di update() ---
      if (def.ball) {
        this.ballImg = add(this.add.image(-400, GROUND_Y - def.ball.radius, 'ball').setDepth(4));
      }

      // --- Pintu dorong (Map 2): body dinamis immovable; buka/tutup di update() ---
      (def.doors || []).forEach((d) => {
        const door = add(this.add.rectangle(d.x, GROUND_Y - d.height / 2, d.width, d.height, 0xe74c3c));
        door.setDepth(-1); // saat terbuka (tenggelam) tertutup tanah di depannya
        this.physics.add.existing(door);
        door.body.setImmovable(true);
        door.body.allowGravity = false;
        door.def = d;
        door._closed = true;
        door._light = add(this.add.circle(d.x, GROUND_Y - d.height - 30, 10, 0xff0000));
        add(this.add.text(d.x - 14, GROUND_Y - d.height - 62, '🚪', { fontSize: '20px' }));
        this.doorObjs.push(door);
      });

      // --- Kipas angin (Map 2): zona tembus pandang + kipas di ujung kanan zona ---
      if (def.fan) {
        const f = def.fan;
        add(this.add.rectangle((f.x1 + f.x2) / 2, (f.topY + GROUND_Y) / 2, f.x2 - f.x1, GROUND_Y - f.topY, 0xadd8e6, 0.25));
        this.fanImg = add(this.add.image(f.x2 - 6, GROUND_Y - 55, 'fan').setDepth(3));
        add(this.add.text(f.x1 + 8, f.topY + 8, '💨 ◀◀◀ ANGIN!', { fontSize: '16px', color: '#0b5fa5', fontStyle: 'bold' }));
      }

      // --- Checkpoint & finish ---
      add(this.add.rectangle(def.checkpointX, GROUND_Y - 40, 8, 90, 0x2ed573));
      add(this.add.triangle(def.checkpointX, GROUND_Y - 110, 0, 0, 0, 30, 34, 15, 0x2ed573));
      add(this.add.text(def.checkpointX - 52, GROUND_Y - 150, '✅ CHECKPOINT', { fontSize: '16px', color: '#14532d', fontStyle: 'bold' }));
      add(this.add.rectangle(FINISH_X, GROUND_Y - 40, 8, 90, 0xff4757));
      add(this.add.triangle(FINISH_X, GROUND_Y - 110, 0, 0, 0, 30, 34, 15, 0xff4757));
      add(this.add.text(FINISH_X - 90, GROUND_Y - 150, '🏁 FINISH', { fontSize: '20px', color: '#7f1d1d', fontStyle: 'bold' }));
      add(this.add.text(60, GROUND_Y - 150, '▶ START — lari ke kanan!', { fontSize: '18px', color: '#333', fontStyle: 'bold' }));
      add(this.add.text(60, GROUND_Y - 185, '🗺️ ' + def.name, { fontSize: '16px', color: '#333', fontStyle: 'bold' }));

      // --- Collider pemain <-> dunia (dibuat ulang tiap buildWorld) ---
      this.worldColliders.push(this.physics.add.collider(this.player, this.grounds));
      this.worldColliders.push(this.physics.add.collider(this.player, this.platforms));
      this.worldColliders.push(this.physics.add.collider(this.player, this.movers));
      if (this.doorObjs.length) {
        // Pintu hanya menghalangi saat tertutup (processCallback per pintu).
        this.worldColliders.push(this.physics.add.collider(
          this.player, this.doorObjs, null, (pl, door) => !!door._closed, this));
      }
      this.worldColliders.push(this.physics.add.overlap(this.player, this.bumpers, (pl, b) => {
        pl.setVelocityY(-620);
        pl.setVelocityX(pl.x < b.x ? -260 : 260);
        SFX.boing();
        showToast('Boing! 🟡');
      }));
    }

    showLobbyBackdrop() {
      if (!this.player) return;
      this.buildWorld(currentMapId);
      this.racing = false;
      this.player.setPosition(START_X, 500).setVelocity(0, 0);
      if (this.waitText) this.waitText.setVisible(true);
    }

    startRace() {
      this.buildWorld(currentMapId);
      this.racing = true;
      finished = false; finishSent = false;
      this.checkpointReached = false;
      checkpoint = { x: START_X, y: 500 };
      if (this.player) this.player.setPosition(START_X, 500).setVelocity(0, 0);
      if (this.waitText) this.waitText.setVisible(false);
    }

    endRace() { this.racing = false; }

    // --- Pemain remote (termasuk bot): sprite sesuai warna+bentuk dari server ---
    // Bentuk disimpan per sprite; kalau berubah (misal data roomUpdate lebih
    // baru), tekstur diganti tanpa membuat sprite baru. Kombinasi yang belum
    // ada teksturnya fallback ke kotak warna itu (jangan crash).
    updateRemote(id, d) {
      const key = playerTexture(d.color, d.shape);
      const texKey = this.textures.exists(key) ? key : playerTexture(d.color, 'kotak');
      const isNew = !this.remoteSprites[id]; // sprite baru dibuat di bawah?
      if (!this.remoteSprites[id]) {
        const s = this.add.image(d.x, d.y, texKey).setDisplaySize(36, 48).setDepth(4);
        const label = this.add.text(d.x, d.y - 34, (d.isBot ? '🤖 ' : '') + d.name, {
          fontSize: '13px', color: '#fff', fontStyle: 'bold',
          backgroundColor: 'rgba(0,0,0,0.55)', padding: { x: 4, y: 2 },
        }).setOrigin(0.5).setDepth(5);
        this.remoteSprites[id] = { sprite: s, label, shape: d.shape };
      } else if (this.remoteSprites[id].shape !== d.shape) {
        this.remoteSprites[id].sprite.setTexture(texKey);
        this.remoteSprites[id].shape = d.shape;
      }
      const r = this.remoteSprites[id];
      r.targetX = d.x; r.targetY = d.y;
      r.label.setText((d.isBot ? '🤖 ' : '') + d.name);
      // Mode penonton (Fitur 5): target yang spritenya baru dibuat sekarang
      // (belum ada playersMoved darinya saat dipilih) langsung diikuti
      // kameranya. Kalau sprite sudah ada, kamera sudah mengikuti dari
      // applySpectateTarget — tidak perlu startFollow ulang tiap update.
      if (isNew && id === spectateTargetId) this.followSpectateTarget(id);
    }
    // --- Mode penonton (Fitur 5): kamera mengikuti pemain lain ---
    // Target disimpan sebagai ID di spectateTargetId (luar scene); di sini
    // hanya lookup sprite-nya. Kalau sprite belum ada, jangan follow null —
    // biarkan kamera seperti sekarang; updateRemote() akan follow begitu
    // sprite target dibuat.
    followSpectateTarget(id) {
      if (!id) { this.stopSpectating(); return; }
      const r = this.remoteSprites && this.remoteSprites[id];
      if (r && r.sprite) this.cameras.main.startFollow(r.sprite, true, 0.1, 0.1);
    }
    stopSpectating() {
      if (this.player) this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    }
    syncRemotePlayers(players) {
      if (!this.remoteSprites) return;
      const alive = new Set(players.map((p) => p.id));
      Object.keys(this.remoteSprites).forEach((id) => {
        if (id !== myId && !alive.has(id)) this.removeRemote(id);
      });
      // Bentuk remote bisa datang lewat roomUpdate (bot, pemain baru) —
      // samakan tekstur sprite yang sudah ada dengan data server terbaru.
      players.forEach((p) => {
        if (p.id === myId) return;
        const r = this.remoteSprites[p.id];
        if (r && r.shape !== p.shape) {
          const key = playerTexture(p.color, p.shape);
          r.sprite.setTexture(this.textures.exists(key) ? key : playerTexture(p.color, 'kotak'));
          r.shape = p.shape;
        }
      });
    }
    removeRemote(id) {
      const r = this.remoteSprites[id];
      if (r) { r.sprite.destroy(); r.label.destroy(); delete this.remoteSprites[id]; }
      // Kalau yang dihapus adalah target tontonan, jangan biarkan kamera
      // mengikuti sprite yang sudah dihancurkan — kembali ke diri sendiri
      // dulu; updateSpectator() (dari handler playerLeft/roomUpdate) akan
      // memilih target baru sesudah ini.
      if (id === spectateTargetId) this.stopSpectating();
    }

    update(time, delta) {
      if (!this.player) return;
      const p = this.player;
      const dt = Math.min(delta / 1000, 0.05);
      const t = serverNow(); // jam server — dasar semua gerakan deterministik
      const def = this.mapDef || MAPS.map1;

      // --- Platform bergerak (deterministik dari serverTime) ---
      this.movers.forEach((m) => {
        const d = m.def;
        const x = d.axis === 'x' ? d.x + Math.sin(t / d.period + d.phase) * d.amp : d.x;
        const y = d.axis === 'y' ? d.y + Math.sin(t / d.period + d.phase) * d.amp : d.y;
        // Kecepatan = selisih posisi target; arcade collision ikut membawa pemain yang berdiri di atasnya.
        m.setVelocity((x - m.x) * 10, (y - m.y) * 10);
      });

      // --- Palu putar (deterministik dari serverTime) ---
      this.hammers.forEach((h) => {
        const angle = (t / h.speed + h.phase) % (Math.PI * 2);
        h.bar.setRotation(angle);
        h.bar.setPosition(h.x, h.y);
        if (this.racing && !finished && !amEliminated) {
          const tipX = h.x + Math.cos(angle) * h.len;
          const tipY = h.y + Math.sin(angle) * h.len;
          // Jarak pemain ke segmen palu (pivot -> ujung)
          const d = distToSegment(p.x, p.y, h.x, h.y, tipX, tipY);
          if (d < 55 && time - this.hammerHitAt > 900) {
            this.hammerHitAt = time;
            const dir = p.x < h.x ? -1 : 1;
            p.setVelocity(dir * 420, -480);
            SFX.hammer();
            showToast('💥 Kena palu! Terpental!');
          }
        }
      });

      // --- Bola raksasa (Map 2): menyapu map dari belakang, posisi dari serverTime ---
      // x = -400 + (waktu sejak race dimulai * kecepatan), berulang tiap 5600 px.
      // Sama di semua client karena raceStartServerTime berasal dari server.
      if (this.ballImg && def.ball) {
        const raceT = raceStartServerTime ? Math.max(0, serverNow() - raceStartServerTime) : 0;
        const span = WORLD_WIDTH + 800;
        const bx = ((raceT * def.ball.speed / 1000) % span) - 400;
        const by = GROUND_Y - def.ball.radius;
        this.ballImg.setPosition(bx, by);
        this.ballImg.setRotation(bx / def.ball.radius); // menggelinding
        if (this.racing && !finished && !amEliminated) {
          const d = Math.hypot(p.x - bx, p.y - by);
          if (d < def.ball.radius + 26 && time - this.ballHitAt > 900) {
            this.ballHitAt = time;
            const dir = p.x < bx ? -1 : 1;
            p.setVelocity(dir * 520, -520);
            SFX.hammer();
            showToast('💥 Kena bola raksasa! Terpental!');
          }
        }
      }

      // --- Pintu dorong (Map 2): buka/tutup berkala dari serverTime ---
      // Siklus def.period ms: tertutup selama def.closedMs pertama, lalu terbuka.
      // Visual + body ikut state yang sama; collider memakai processCallback
      // (lihat buildWorld) jadi pintu terbuka benar-benar bisa dilewati.
      this.doorObjs.forEach((door) => {
        const d = door.def;
        const closed = (t % d.period) < d.closedMs;
        if (closed !== door._closed) {
          door._closed = closed;
          const y = closed ? GROUND_Y - d.height / 2 : GROUND_Y + d.height / 2 + 20;
          door.body.reset(door.x, y);
          door.setPosition(door.x, y);
          door.setFillStyle(closed ? 0xe74c3c : 0x2ed573);
          if (door._light) door._light.setFillStyle(closed ? 0xff0000 : 0x00ff00);
        }
      });

      // --- Kipas angin (Map 2): baling-baling berputar dari serverTime ---
      if (this.fanImg) this.fanImg.setRotation(t / 300);

      // --- Gerakan pemain lokal ---
      if (this.racing && !finished && !amEliminated) {
        const onGround = p.body.touching.down || p.body.blocked.down;
        // Lantai es: cek apakah pemain berdiri di atas segmen es map ini.
        const onIce = onGround && (def.ice || []).some(([a, b]) => p.x >= a && p.x <= b);
        if (onIce) {
          // Gesekan rendah: akselerasi lambat, dan tanpa input pemain meluncur
          // (velocity dipertahankan, hanya melambat pelan) — susah berhenti/belok.
          if (keys.left) p.setVelocityX(Math.max(p.body.velocity.x - 18, -280));
          else if (keys.right) p.setVelocityX(Math.min(p.body.velocity.x + 18, 280));
          else p.setVelocityX(p.body.velocity.x * 0.985);
        } else {
          if (keys.left) p.setVelocityX(-280);
          else if (keys.right) p.setVelocityX(280);
          else p.setVelocityX(0);
        }
        if (keys.jump && onGround) {
          p.setVelocityY(-560);
          // Suara lompat hanya saat benar-benar lompat dari tanah + cooldown
          // kecil, supaya tidak spam kalau tombol ditahan.
          if (time - this.lastJumpSfxAt > 200) { this.lastJumpSfxAt = time; SFX.jump(); }
        }

        // --- Kipas angin (Map 2): dorong ke belakang + angkat ke atas ---
        // Diterapkan SETELAH gerakan dasar, supaya angin mengurangi kecepatan
        // lari (280 - 160 = 120 px/dtk saat lari ke kanan) dan menahan jatuh.
        if (def.fan) {
          const f = def.fan;
          if (p.x >= f.x1 && p.x <= f.x2 && p.y > f.topY) {
            p.setVelocityX(p.body.velocity.x - f.pushX);
            if (p.body.velocity.y > -220) p.setVelocityY(p.body.velocity.y - f.lift);
          }
        }
      } else {
        p.setVelocityX(0);
      }

      // Label nama mengikuti pemain
      this.nameLabel.setPosition(p.x, p.y - 34);

      // --- Checkpoint (pakai checkpointX map yang aktif) ---
      if (this.racing && !this.checkpointReached && !amEliminated && p.x >= def.checkpointX) {
        this.checkpointReached = true;
        checkpoint = { x: def.checkpointX, y: 500 };
        SFX.checkpoint();
        showToast('✅ Checkpoint!');
      }

      // --- Jatuh ke jurang = respawn di checkpoint ---
      // Ambang WORLD_HEIGHT - 20 (y > 700): tanah di y=640, pemain berdiri
      // di y~616, jadi begitu y melewati 700 dia sudah pasti jatuh ke jurang
      // (bukan sekadar lompat). Respawn langsung, tidak perlu menunggu
      // jatuh sampai y > 780 di luar layar.
      if (p.y > WORLD_HEIGHT - 20) {
        p.setPosition(checkpoint.x, checkpoint.y).setVelocity(0, 0);
        SFX.fall();
        showToast('😵 Jatuh! Kembali ke checkpoint');
      }

      // --- Finish (server yang menentukan urutan) ---
      if (this.racing && !finished && !finishSent && !amEliminated && p.x >= FINISH_X) {
        finished = true; finishSent = true;
        p.setVelocity(0, 0);
        socket.emit('playerFinished', { x: p.x });
        $('hudPlace').textContent = '🏁 Finish!';
      }

      // --- Timer HUD ---
      if (raceStartServerTime) {
        const el = serverNow() - raceStartServerTime;
        $('hudTimer').textContent = '⏱ ' + (this.racing || finished ? fmtTime(Math.max(0, el)) : '0.0 dtk');
      }

      // --- Progress bar: dot pemain sendiri, maks ~10 Hz ---
      updateLocalProgress(time);

      // --- Kirim posisi ~20 Hz saat balapan ---
      if (this.racing && !finished && !amEliminated && time - this.lastSend > MOVE_SEND_MS) {
        this.lastSend = time;
        socket.emit('move', { x: Math.round(p.x), y: Math.round(p.y), vx: Math.round(p.body.velocity.x), vy: Math.round(p.body.velocity.y) });
      }

      // --- Haluskan gerakan pemain remote (lerp ke posisi terakhir) ---
      Object.values(this.remoteSprites).forEach((r) => {
        if (r.targetX === undefined) return;
        r.sprite.x += (r.targetX - r.sprite.x) * Math.min(1, dt * 12);
        r.sprite.y += (r.targetY - r.sprite.y) * Math.min(1, dt * 12);
        r.label.setPosition(r.sprite.x, r.sprite.y - 34);
      });
    }
  }

  function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx, cy = y1 + t * dy;
    return Math.hypot(px - cx, py - cy);
  }
})();
