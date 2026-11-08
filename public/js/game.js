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
  const CHECKPOINT_X = 2400;
  const START_X = 100;
  const MOVE_SEND_MS = 50; // kirim posisi ~20 Hz

  const COLORS = [0xff4757, 0x2e86ff, 0x2ed573, 0xffa502, 0xa55eea, 0xff6b81, 0x1dd1a1, 0x70a1ff];

  // ---------- State client ----------
  const socket = io();
  let myId = null;
  let myColor = 0;
  let myName = 'Pemain';
  let isHost = false;
  let roomCode = '';
  let roomStatus = 'lobby';
  let raceStartServerTime = null;
  let serverTimeOffset = 0; // serverTime - Date.now()
  let finished = false;
  let finishSent = false;
  let checkpoint = { x: START_X, y: 500 };
  let scene = null; // GameScene aktif
  let remoteTargets = {}; // id -> {x,y,name,colorHex}

  function serverNow() { return Date.now() + serverTimeOffset; }
  function fmtTime(ms) { return (ms / 1000).toFixed(1) + ' dtk'; }

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const lobbyEl = $('lobby'), gameSectionEl = $('gameSection');
  const lobbyErrorEl = $('lobbyError'), roomInfoEl = $('roomInfo');
  const playerListEl = $('playerList'), resultsEl = $('results'), resultsListEl = $('resultsList');
  const countdownEl = $('countdown'), toastEl = $('toast');

  function showError(msg) { lobbyErrorEl.textContent = msg; lobbyErrorEl.hidden = false; }
  function showToast(msg, ms) {
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { toastEl.hidden = true; }, ms || 1800);
  }

  // ---------- Socket.io ----------
  socket.on('connect', () => { $('connStatus').textContent = '🟢 terhubung'; });
  socket.on('disconnect', () => { $('connStatus').textContent = '🔴 terputus'; });
  socket.on('timeSync', (d) => { serverTimeOffset = d.serverTime - Date.now(); });
  socket.on('joinError', (d) => showError(d.message));

  socket.on('joinedRoom', (d) => {
    myId = d.playerId; roomCode = d.code; isHost = d.isHost;
    serverTimeOffset = d.serverTime - Date.now();
    $('roomCode').textContent = roomCode;
    $('hudRoom').textContent = 'Room ' + roomCode;
    roomInfoEl.hidden = false;
    lobbyErrorEl.hidden = true;
    lobbyEl.hidden = true;
    gameSectionEl.hidden = false;
    resultsEl.hidden = true;
    if (!window.__lariKuyGame) initPhaser();
    if (scene) scene.showLobbyBackdrop();
  });

  socket.on('roomUpdate', (d) => {
    roomStatus = d.status;
    if (d.serverTime) serverTimeOffset = d.serverTime - Date.now();
    renderPlayerList(d.players);
    $('hudPlayers').textContent = '👥 ' + d.players.length + '/8';
    $('btnStart').hidden = !(isHost && d.status === 'lobby');
    $('waitHost').hidden = isHost || d.status !== 'lobby';
    // Hapus pemain remote yang sudah keluar.
    if (scene) scene.syncRemotePlayers(d.players);
  });

  socket.on('countdown', (d) => {
    countdownEl.hidden = false;
    countdownEl.textContent = d.count;
  });

  socket.on('raceStarted', (d) => {
    raceStartServerTime = d.serverTime;
    serverTimeOffset = d.serverTime - Date.now();
    finished = false; finishSent = false;
    checkpoint = { x: START_X, y: 500 };
    countdownEl.textContent = 'GO! 🏁';
    setTimeout(() => { countdownEl.hidden = true; }, 600);
    if (scene) scene.startRace();
    showToast('Lari, Kuy! 🏃');
  });

  socket.on('playersMoved', (d) => {
    if (d.id === myId) return;
    remoteTargets[d.id] = { x: d.x, y: d.y, name: d.name, color: d.color, colorHex: d.colorHex };
    if (scene) scene.updateRemote(d.id, d);
  });

  socket.on('playerLeft', (d) => {
    delete remoteTargets[d.id];
    if (scene) scene.removeRemote(d.id);
  });

  socket.on('playerFinished', (d) => {
    showToast('🏁 ' + d.name + ' finish ke-' + d.place + ' (' + fmtTime(d.timeMs) + ')');
  });

  socket.on('raceFinished', (d) => {
    roomStatus = 'finished';
    resultsEl.hidden = false;
    resultsListEl.innerHTML = d.results.map((r) =>
      '<li><b>#' + r.place + ' ' + escapeHtml(r.name) + '</b> — ' + fmtTime(r.timeMs) +
      (r.id === myId ? ' 👈 kamu' : '') + '</li>').join('') ||
      '<li>Belum ada yang finish.</li>';
    if (scene) scene.endRace();
  });

  socket.on('backToLobby', () => {
    roomStatus = 'lobby';
    resultsEl.hidden = true;
    gameSectionEl.hidden = true;
    lobbyEl.hidden = false;
    roomInfoEl.hidden = true;
    if (scene) scene.showLobbyBackdrop();
  });

  function renderPlayerList(players) {
    playerListEl.innerHTML = players.map((p) =>
      '<li><span class="dot" style="background:' + p.colorHex + '"></span>' +
      escapeHtml(p.name) + (p.isHost ? ' 👑 host' : '') +
      (p.finished ? ' 🏁 ' + fmtTime(p.finishTime) : '') + '</li>').join('');
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- Tombol lobby ----------
  $('btnCreate').addEventListener('click', () => {
    myName = $('playerName').value.trim() || 'Pemain';
    socket.emit('createRoom', { name: myName });
  });
  $('btnJoin').addEventListener('click', () => {
    myName = $('playerName').value.trim() || 'Pemain';
    const code = $('roomCodeInput').value.trim().toUpperCase();
    if (!code) return showError('Masukkan kode room 4 huruf dulu!');
    socket.emit('joinRoom', { code, name: myName });
  });
  $('btnCopyCode').addEventListener('click', () => {
    if (navigator.clipboard) navigator.clipboard.writeText(roomCode);
    showToast('Kode room disalin: ' + roomCode);
  });
  $('btnStart').addEventListener('click', () => socket.emit('startGame'));
  $('btnAgain').addEventListener('click', () => {
    if (isHost) socket.emit('backToLobby');
    else { resultsEl.hidden = true; gameSectionEl.hidden = true; lobbyEl.hidden = false; roomInfoEl.hidden = true; }
  });

  // ---------- Input (keyboard + sentuh) ----------
  const keys = { left: false, right: false, jump: false };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = true;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = true;
    if (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') { keys.jump = true; e.preventDefault(); }
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
      this.checkpointReached = false;
      this.remoteSprites = {}; // id -> {sprite, label}

      // --- Tekstur pemain per warna (kotak ceria + mata) ---
      COLORS.forEach((color, i) => {
        if (this.textures.exists('player_' + i)) return;
        const g = this.make.graphics({ x: 0, y: 0, add: false });
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
        g.generateTexture('player_' + i, 36, 48);
        g.destroy();
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

      // --- Langit, awan, bukit (hiasan) ---
      this.add.rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 0x87ceeb).setOrigin(0).setDepth(-2);
      for (let i = 0; i < 14; i++) {
        const cx = 120 + i * 340, cy = 60 + (i % 3) * 50;
        this.add.ellipse(cx, cy, 120, 40, 0xffffff, 0.9);
        this.add.ellipse(cx + 40, cy + 10, 90, 32, 0xffffff, 0.9);
      }
      for (let i = 0; i < 10; i++) {
        this.add.ellipse(200 + i * 480, GROUND_Y + 4, 320, 90, 0x7ec850, 0.8);
      }

      // --- Tanah: segmen dengan jurang di antaranya (rintangan #1) ---
      // Segmen: [0,900] [1020,1820] [1940,2620] [2740,3440] [3560,4280] [4400,4800]
      // Disimpan sebagai array body statis (bukan staticGroup, supaya tidak dobel-add).
      this.grounds = [];
      const segments = [[0, 900], [1020, 1820], [1940, 2620], [2740, 3440], [3560, 4280], [4400, 4800]];
      segments.forEach(([x1, x2]) => {
        const w = x2 - x1, cx = x1 + w / 2;
        const rect = this.add.rectangle(cx, GROUND_Y + 40, w, 80, 0x8b5a2b);
        const top = this.add.rectangle(cx, GROUND_Y + 2, w, 12, 0x2ed573);
        this.physics.add.existing(rect, true);
        this.grounds.push(rect);
        top.setDepth(1);
      });
      // Platform kecil melayang (pijakan ekstra)
      this.platforms = [];
      [[1250, 480], [2150, 460], [3150, 480], [4050, 460]].forEach(([x, y]) => {
        const p = this.add.rectangle(x, y, 140, 18, 0xffa502);
        this.physics.add.existing(p, true);
        this.platforms.push(p);
      });

      // --- Platform bergerak (rintangan #3): di atas jurang ---
      // #1 melintas jurang 900-1020 (gerak horizontal), #2 di atas jurang 3440-3560 (gerak vertikal)
      this.movers = [];
      const m1 = this.physics.add.image(960, 540, 'mover');
      const m2 = this.physics.add.image(3500, 540, 'mover');
      [m1, m2].forEach((m) => {
        m.setImmovable(true);
        m.body.allowGravity = false;
        m.body.moves = true;
        this.movers.push(m);
      });

      // --- Palu putar / sweeper (rintangan #2): visual + knockback manual ---
      this.hammers = [
        { x: 1500, y: GROUND_Y, len: 140, speed: 1100, phase: 0 },
        { x: 2950, y: GROUND_Y, len: 160, speed: 900, phase: Math.PI },
      ];
      this.hammers.forEach((h) => {
        h.pivot = this.add.circle(h.x, h.y, 14, 0x222222);
        h.bar = this.add.rectangle(h.x, h.y, h.len, 18, 0xff4757).setOrigin(0, 0.5);
        h.bar.setStrokeStyle(3, 0x222222);
      });

      // --- Bumper (bonus): bola yang memantulkan pemain ---
      this.bumpers = [];
      [[2250, 600], [3850, 600]].forEach(([x, y]) => {
        const b = this.add.circle(x, y, 26, 0xffd32a).setStrokeStyle(3, 0x222222);
        this.physics.add.existing(b, true);
        this.bumpers.push(b);
      });

      // --- Checkpoint & finish ---
      this.add.rectangle(CHECKPOINT_X, GROUND_Y - 40, 8, 90, 0x2ed573);
      const flag1 = this.add.triangle(CHECKPOINT_X, GROUND_Y - 110, 0, 0, 0, 30, 34, 15, 0x2ed573);
      this.add.text(CHECKPOINT_X - 52, GROUND_Y - 150, '✅ CHECKPOINT', { fontSize: '16px', color: '#14532d', fontStyle: 'bold' });
      this.add.rectangle(FINISH_X, GROUND_Y - 40, 8, 90, 0xff4757);
      this.add.triangle(FINISH_X, GROUND_Y - 110, 0, 0, 0, 30, 34, 15, 0xff4757);
      this.add.text(FINISH_X - 90, GROUND_Y - 150, '🏁 FINISH', { fontSize: '20px', color: '#7f1d1d', fontStyle: 'bold' });
      this.add.text(60, GROUND_Y - 150, '▶ START — lari ke kanan!', { fontSize: '18px', color: '#333', fontStyle: 'bold' });

      // --- Pemain lokal ---
      this.player = this.physics.add.image(START_X, 500, 'player_' + myColor).setDisplaySize(36, 48);
      this.player.setCollideWorldBounds(true);
      this.player.setDepth(5);
      this.nameLabel = this.add.text(START_X, 460, myName, {
        fontSize: '14px', color: '#fff', fontStyle: 'bold',
        backgroundColor: 'rgba(0,0,0,0.55)', padding: { x: 4, y: 2 },
      }).setOrigin(0.5).setDepth(6);

      this.physics.add.collider(this.player, this.grounds);
      this.physics.add.collider(this.player, this.platforms);
      this.physics.add.collider(this.player, this.movers);
      this.physics.add.overlap(this.player, this.bumpers, (pl, b) => {
        pl.setVelocityY(-620);
        pl.setVelocityX(pl.x < b.x ? -260 : 260);
        showToast('Boing! 🟡');
      });

      this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
      this.cameras.main.setZoom(1);

      // Teks status saat belum mulai
      this.waitText = this.add.text(480, 200, 'Menunggu host memulai…', {
        fontSize: '26px', color: '#222', fontStyle: 'bold',
        backgroundColor: 'rgba(255,255,255,0.85)', padding: { x: 16, y: 10 },
      }).setOrigin(0.5).setScrollFactor(0);
    }

    showLobbyBackdrop() {
      if (!this.player) return;
      this.racing = false;
      this.player.setPosition(START_X, 500).setVelocity(0, 0);
      if (this.waitText) this.waitText.setVisible(true);
    }

    startRace() {
      this.racing = true;
      finished = false; finishSent = false;
      this.checkpointReached = false;
      checkpoint = { x: START_X, y: 500 };
      if (this.player) this.player.setPosition(START_X, 500).setVelocity(0, 0);
      if (this.waitText) this.waitText.setVisible(false);
    }

    endRace() { this.racing = false; }

    // --- Pemain remote ---
    updateRemote(id, d) {
      if (!this.remoteSprites[id]) {
        const s = this.add.image(d.x, d.y, 'player_' + d.color).setDisplaySize(36, 48).setDepth(4);
        const label = this.add.text(d.x, d.y - 34, d.name, {
          fontSize: '13px', color: '#fff', fontStyle: 'bold',
          backgroundColor: 'rgba(0,0,0,0.55)', padding: { x: 4, y: 2 },
        }).setOrigin(0.5).setDepth(5);
        this.remoteSprites[id] = { sprite: s, label };
      }
      const r = this.remoteSprites[id];
      r.targetX = d.x; r.targetY = d.y;
      r.label.setText(d.name);
    }
    syncRemotePlayers(players) {
      if (!this.remoteSprites) return;
      const alive = new Set(players.map((p) => p.id));
      Object.keys(this.remoteSprites).forEach((id) => {
        if (id !== myId && !alive.has(id)) this.removeRemote(id);
      });
    }
    removeRemote(id) {
      const r = this.remoteSprites[id];
      if (r) { r.sprite.destroy(); r.label.destroy(); delete this.remoteSprites[id]; }
    }

    update(time, delta) {
      if (!this.player) return;
      const p = this.player;
      const dt = Math.min(delta / 1000, 0.05);
      const t = serverNow(); // jam server — dasar semua gerakan deterministik

      // --- Platform bergerak (deterministik dari serverTime) ---
      const targets = [
        { m: this.movers[0], x: 960 + Math.sin(t / 1200) * 70, y: 540 },
        { m: this.movers[1], x: 3500, y: 540 + Math.sin(t / 1400) * 60 },
      ];
      targets.forEach(({ m, x, y }) => {
        // Kecepatan = selisih posisi target; arcade collision ikut membawa pemain yang berdiri di atasnya.
        m.setVelocity((x - m.x) * 10, (y - m.y) * 10);
      });

      // --- Palu putar (deterministik dari serverTime) ---
      this.hammers.forEach((h) => {
        const angle = (t / h.speed + h.phase) % (Math.PI * 2);
        h.bar.setRotation(angle);
        h.bar.setPosition(h.x, h.y);
        if (this.racing && !finished) {
          const tipX = h.x + Math.cos(angle) * h.len;
          const tipY = h.y + Math.sin(angle) * h.len;
          // Jarak pemain ke segmen palu (pivot -> ujung)
          const d = distToSegment(p.x, p.y, h.x, h.y, tipX, tipY);
          if (d < 55 && time - this.hammerHitAt > 900) {
            this.hammerHitAt = time;
            const dir = p.x < h.x ? -1 : 1;
            p.setVelocity(dir * 420, -480);
            showToast('💥 Kena palu! Terpental!');
          }
        }
      });

      // --- Gerakan pemain lokal ---
      if (this.racing && !finished) {
        const onGround = p.body.touching.down || p.body.blocked.down;
        if (keys.left) p.setVelocityX(-280);
        else if (keys.right) p.setVelocityX(280);
        else p.setVelocityX(0);
        if (keys.jump && onGround) p.setVelocityY(-560);
      } else {
        p.setVelocityX(0);
      }

      // Label nama mengikuti pemain
      this.nameLabel.setPosition(p.x, p.y - 34);

      // --- Checkpoint ---
      if (this.racing && !this.checkpointReached && p.x >= CHECKPOINT_X) {
        this.checkpointReached = true;
        checkpoint = { x: CHECKPOINT_X, y: 500 };
        showToast('✅ Checkpoint!');
      }

      // --- Jatuh ke jurang = respawn di checkpoint ---
      if (p.y > WORLD_HEIGHT + 60) {
        p.setPosition(checkpoint.x, checkpoint.y).setVelocity(0, 0);
        showToast('😵 Jatuh! Kembali ke checkpoint');
      }

      // --- Finish (server yang menentukan urutan) ---
      if (this.racing && !finished && !finishSent && p.x >= FINISH_X) {
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

      // --- Kirim posisi ~20 Hz saat balapan ---
      if (this.racing && !finished && time - this.lastSend > MOVE_SEND_MS) {
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
