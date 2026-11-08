# 🏃 LariKuy!

Balapan platformer 2D multiplayer ala Fall Guys — lari, lompat, hindari rintangan, siapa duluan sampai finish!

* **6–8 pemain** per room, masuk pakai kode room 4 huruf
* **2 map panjang** side-scrolling (v0.2.0): host memilih map di lobby sebelum start
  * **Map 1 Klasik:** jurang, palu putar, platform bergerak, checkpoint, garis finish
  * **Map 2 Badai 🌪️:** jurang di posisi berbeda + bola raksasa yang menggelinding dari belakang, lantai es licin 🧊, pintu dorong buka-tutup 🚪, dan kipas angin 💨 — semua deterministik pakai jam server
* **Countdown 3-2-1-GO**, timer balapan, dan urutan finish ditentukan server
* Rintangan bergerak **deterministik pakai jam server**, jadi semua pemain melihat gerakan yang sama
* Bisa dimainkan di HP (tombol sentuh) maupun keyboard
* **Progress bar balapan** di atas layar: dot warna tiap pemain, penanda checkpoint & finish (v0.1.4)
* **Sound effect** synth Web Audio (tanpa file audio): lompat, jatuh, kena palu, checkpoint, countdown/GO, finish, klik — tombol mute 🔊/🔇 di HUD, preferensi tersimpan di localStorage (v0.1.4)
* **Mode Eliminasi 💀** (v0.2.0): multi-round, 2 pemain terlambat gugur tiap round sampai tersisa 1 juara — lihat bagian Mode Eliminasi di bawah
* **Mode Penonton 👁️** (v0.2.0): yang sudah finish / gugur otomatis menonton pemain yang masih balapan, kameranya mengikuti yang paling depan — lihat bagian Mode Penonton di bawah
* **Bot pengisi room 🤖** (v0.2.0): host bisa mengisi room dengan bot yang lari sendiri dari server — lihat bagian Bot di bawah
* **Skin / karakter 🎨** (v0.2.0): pilih warna (8 pilihan) & bentuk (Kotak / Bulat / Segitiga) di lobby sebelum masuk room, tersimpan otomatis di localStorage — lihat bagian Skin di bawah

## Teknologi

* **Server:** Node.js + Express + Socket.io (tanpa build step, tanpa database)
* **Client:** Phaser 3 (via CDN) + Socket.io client
* Bahasa UI: Indonesia

## Cara jalanin lokal

```bash
npm install
npm start
```

Lalu buka **http://localhost:3000** di browser.

> Port bisa diubah dengan variabel `PORT`, misal: `PORT=8080 npm start`

## Cara main

1. Isi nama kamu, pilih **warna** (8 pilihan) & **bentuk** karakter (⬛ Kotak / 🔵 Bulat / 🔺 Segitiga) di lobby — pilihan tersimpan otomatis di browser, jadi tidak perlu pilih ulang. Lalu **Buat Room** (dapat kode 4 huruf) atau **Gabung** pakai kode temanmu.
2. Bagikan kode room ke teman-temanmu (maks 8 pemain).
3. Host memilih map (**🗺️ Map 1 Klasik** / **🌪️ Map 2 Badai**) dan mode (**🏁 Balapan Sekali** / **💀 Eliminasi**) di panel room, lalu menekan **Mulai Balapan**. Tunggu countdown 3-2-1-GO!
4. Kontrol:
   * **Gerak:** `A` / `D` atau `←` / `→` (di HP: tombol ◀ ▶)
   * **Lompat:** `Spasi` / `W` / `↑` (di HP: tombol ⤒)
5. Jatuh ke jurang = kembali ke checkpoint terakhir. Kena palu putar = terpental!
6. Siapa duluan melewati garis finish 🏁 dia juaranya. Hasil akhir menampilkan urutan + waktu tiap pemain.

## Mode Eliminasi 💀 (v0.2.0)

Host memilih **💀 Eliminasi** di lobby sebelum start (event `setMode` `{mode: 'elimination'}` — hanya host, hanya saat lobby; server menolak mode selain `'race'`/`'elimination'`, non-host, dan di luar lobby). Mode tampil di panel room (`roomUpdate` `{mode}`) dan di HUD saat balapan.

Aturan (semua otoritatif di server, `server.js`):

* **Minimal 3 pemain** untuk memulai eliminasi. Kalau kurang, server menolak `startGame` dengan event `startError` `{message}` dan client menampilkannya sebagai toast. Mode Balapan Sekali tetap minimal 1 pemain seperti biasa.
* **Tiap round = 1 balapan penuh.** Round berakhir saat **semua pemain yang belum gugur sudah finish**, ATAU **timeout 75 detik** sejak `raceStarted` (timer di server; saat timeout, yang belum finish dianggap kalah).
* **2 pemain terlambat gugur** tiap round (diurutkan `finishTime`; yang belum finish saat timeout dianggap paling lambat, tiebreak = progress `x` terakhir — yang paling jauh di depan dianggap lebih cepat). Kalau pemain yang belum gugur tinggal **≤ 2 orang di awal round, hanya 1 yang gugur** (yang paling lambat), supaya final 1v1 masuk akal.
* **Map per round bergantian:** round ganjil = map pilihan host, round genap = map lainnya (misal host pilih Map 1 → Round 1 Map 1, Round 2 Map 2, Round 3 Map 1, dst.). Server yang menentukan map round berjalan dan broadcast lewat `roomUpdate`/`raceStarted` `{map, round}`; client membangun ulang dunia lewat `GameScene.buildWorld(mapId)` sebelum countdown berikutnya.
* **Jeda antar-round otomatis 4 detik** (dipilih otomatis, bukan tombol host — supaya tempo permainan tetap jalan tanpa menunggu host klik). Di jeda ini client menampilkan panel antar-round: siapa gugur 💀, siapa lolos ✅, dan map round berikutnya. Lalu server otomatis memulai round berikutnya (countdown → racing).
* **Juara:** ulangi sampai tersisa 1 pemain → server emit `eliminationFinished` `{champion: {id, name}, results}` dan client menampilkan panel juara + peringkat akhir. Kalau di final 2 orang keduanya finish, yang tercepat juara (yang paling lambat gugur di round final itu).
* **Pemain gugur = penonton:** `player.eliminated = true`, disertakan di `publicPlayers` + event `roundEnded` `{round, eliminated: [{id, name}], survivors: [{id, name}], results}`. Client menandai mereka 💀 di daftar pemain, menampilkan label HUD "💀 Kamu gugur — jadi penonton", dan **tidak mengizinkan gerak/lompat/kirim posisi** selama round berjalan. Kameranya mengikuti pemain yang masih balapan — lihat bagian Mode Penonton di bawah.
* **Disconnect:** pemain yang disconnect di tengah eliminasi dianggap gugur (dihapus dari survivors); host pindah ke pemain pertama yang tersisa dan eliminasi tetap jalan; kalau yang tersisa tinggal 1 karena disconnect, dia langsung juara.
* **Kembali ke lobby** (`backToLobby`, host) mereset semuanya: mode kembali ke `race` (default), round ke 1, dan semua pemain tidak lagi gugur.

## Mode Penonton 👁️ (v0.2.0)

Begitu kamu **sudah finish** (mode Balapan Sekali, selagi pemain lain masih balapan) atau **gugur** (mode Eliminasi), kamu otomatis jadi penonton — tidak perlu klik apa-apa.

**Cara kerja (semua client-side di `public/js/game.js`, tanpa perubahan server):**

* **Kamera mengikuti pemain lain:** saat masuk mode penonton, kamera Phaser (`cameras.main.startFollow`) pindah dari karaktermu sendiri ke pemain yang masih balapan dan **paling depan** (x terbesar; posisi diambil dari `progressMap` yang paling segar, fallback ke `x` terakhir `roomUpdate`). Karaktermu sendiri berhenti di tempat dan tidak bisa digerakkan lagi — guard gerak/kirim posisi (`!finished && !amEliminated`) tetap berlaku, dan `update()` tidak pernah mengembalikan kamera ke karakter sendiri selama mode penonton aktif.
* **Label HUD:** muncul `👁️ Nonton: <nama>` + tombol `⏭️ Ganti Tontonan` di HUD (elemen `#hudSpectate` / `#btnSpectateNext`, tampil hanya saat mode penonton aktif).
* **Ganti tontonan — 3 cara:**
  1. **Tombol `⏭️ Ganti Tontonan`** di HUD: pindah ke pemain aktif berikutnya, urut berdasarkan x (paling depan dulu), melingkar.
  2. **Klik dot / nama pemain di progress bar** atau **klik nama di daftar pemain** (`#playerList`): langsung menonton pemain itu — hanya pemain yang masih aktif yang bisa ditonton, klik di luar mode penonton atau ke pemain yang sudah finish/gugur diabaikan diam-diam.
  3. **Keyboard `←` / `→`**: ganti ke tontonan sebelumnya / berikutnya (tanpa repeat saat tombol ditahan; tidak bentrok dengan gerak karena penonton memang tidak bisa gerak).
* **Target finish / gugur / disconnect di tengah ditonton:** kamera otomatis pindah ke pemain aktif berikutnya (paling depan). Ini ditangani di `updateSpectator()` yang dipanggil tiap `roomUpdate`, `playerFinished`, `playerLeft`, dan `raceStarted` — target yang baru finish dicatat langsung di `playerFinished` supaya tidak perlu menunggu `roomUpdate` berikutnya.
* **Target belum ada spritenya / sprite dihapus:** target disimpan sebagai **ID** (`spectateTargetId`), bukan referensi sprite — kamera hanya follow lewat lookup `remoteSprites[id]` di `followSpectateTarget(id)`. Kalau sprite target belum ada (belum ada `playersMoved` darinya), kamera menunggu dan `updateRemote()` akan follow begitu sprite dibuat. Kalau sprite target dihapus (disconnect), `removeRemote()` langsung mengembalikan kamera ke karakter sendiri dulu supaya kamera tidak mengikuti sprite yang sudah dihancurkan, lalu `updateSpectator()` memilih target baru.
* **Tidak ada pemain aktif tersisa:** kamera kembali ke karakter sendiri; sesaat kemudian `raceFinished` / `eliminationFinished` menyusul dan panel hasil tampil seperti biasa.
* **Mode penonton berakhir** saat balapan/round selesai (`raceFinished`, `eliminationFinished`), saat jeda antar-round (`roundEnded` — kamera kembali ke karakter sendiri dulu, lalu menonton lagi begitu round baru mulai lewat `raceStarted`), dan saat kembali ke lobby (`backToLobby`).
* **Prasyarat server (sudah ada, tidak diubah):** server terus mengirim posisi pemain aktif ke penonton lewat `playersMoved` + `roomUpdate` (broadcast ke seluruh room, termasuk yang sudah finish), dan mengabaikan `move` dari pemain yang sudah finish/gugur (`server.js`: `if (player.finished || player.eliminated) return;`).

## Bot Pengisi Room 🤖 (v0.2.0)

Sendirian tapi mau balapan rame-rame? Host bisa mengisi room dengan bot.

**Cara pakai:** di panel room (lobby, hanya host), centang **🤖 Isi bot sampai 6 pemain**. Server langsung menambah bot sampai total pemain (manusia + bot) = 6. Hapus centang = semua bot dihapus. Bot juga dihapus saat kembali ke lobby (`backToLobby`), saat eliminasi berakhir, dan saat manusia terakhir disconnect (bot tidak pernah menahan room tetap hidup).

**Cara kerja (semua server-side, `server.js` — bukan di client host):**

* **Identitas:** nama bot jelas dari daftar tetap — `Bot Raka`, `Bot Sinta`, `Bot Budi`, `Bot Dewi`, `Bot Agus`, `Bot Maya`, `Bot Rudi`, `Bot Lina` (nama yang sudah dipakai manusia dilewati, tidak bentrok). Warna diambil dari warna yang belum dipakai, seperti pemain manusia. Di `publicPlayers`/`roomUpdate` bot punya field `isBot: true`; di daftar pemain, progress bar, label sprite Phaser, dan hasil akhir bot tampil dengan label 🤖.
* **Kontrol:** event baru `setFillBots` `{fill: boolean}` — hanya host, hanya saat lobby; di luar itu diabaikan. Server menyimpan `fillBots` dan broadcast lewat `roomUpdate` `{fillBots}` supaya checkbox di semua layar sinkron. Total pemain (manusia + bot) tetap maks 8.
* **Gerakan:** server men-tick bot **~10 Hz** (interval per room, hanya saat status `racing`; dihentikan saat finish/round berakhir/kembali ke lobby/room kosong). Tiap bot punya kecepatan lari sendiri **180–260 px/dtk**, diacak sekali saat dibuat dan tetap selama round. Bot bergerak ke kanan (`x` bertambah), `y` mengikuti tanah (`y=616`).
* **Lompat jurang:** server punya definisi segmen tanah per map (`MAP_GROUND`, sinkron dengan `MAPS` di `public/js/game.js`; checkpoint per map di `MAP_CHECKPOINT` — Map 1: 2400, Map 2: 2250). Saat ujung tanah di depan sudah dekat (<120 px) dan di depannya ada jurang, bot "melompat": `y` naik ke ~500 dan tetap di udara sampai mendarat di segmen tanah berikutnya, `x` terus maju melewati jurang.
* **Bisa dikalahkan:** tiap lompatan jurang punya peluang gagal **8%** — bot jatuh dan kembali ke checkpoint terakhir (start/checkpoint map aktif). Selain itu, tiap zona palu/pintu yang dilewati pertama kali di satu round (`MAP_HAZARDS` — Map 1: x 1500 & 2950; Map 2: x 1200, 2900 & 3400) punya peluang jatuh **5%** → kembali ke checkpoint. Bot tidak mensimulasikan fisika rintangan secara penuh; tujuannya bot bisa dikalahkan manusia, bukan mustahil dikalahkan.
* **Finish & eliminasi:** saat bot `x >= 4620` (finishX), server mencatat finish persis seperti pemain biasa (`finishTime`, `results`, emit `playerFinished` untuk bot itu) dan bot ikut menentukan akhir round/balapan. Di mode eliminasi bot dihitung sebagai pemain aktif (batas minimal 3 pemain, 2 gugur per round) — bot bisa gugur maupun juara seperti manusia.
* **Tampil di layar:** posisi bot di-broadcast lewat event `playersMoved` yang **sama** seperti pemain remote (id, name, color, colorHex, x, y, `isBot: true`) — client tidak butuh kode khusus selain label 🤖; sprite remote Phaser dan progress bar menampilkan bot otomatis. `roomUpdate` juga dikirim berkala ~1 detik selama balapan supaya `x` bot di daftar pemain tetap segar.
* **Host tetap manusia:** saat host disconnect, host pindah ke manusia pertama yang tersisa — tidak pernah ke bot. Kalau tidak ada manusia tersisa, room dihapus beserta bot dan intervalnya.

## Skin / Karakter 🎨 (v0.2.0)

Sebelum masuk room, pilih tampilan karaktermu di lobby — **8 warna** (merah, biru, hijau, kuning/oranye, ungu, pink, tosca, biru muda) dan **3 bentuk** (⬛ Kotak, 🔵 Bulat, 🔺 Segitiga).

**Cara pakai:** klik tombol bulat warna / tombol bentuk di lobby. Pilihan tersimpan di `localStorage` (`larikuy-color` = index warna 0–7, `larikuy-shape` = `'kotak'`/`'bulat'`/`'segitiga'`) dan langsung ditandai saat halaman dibuka lagi — tidak perlu pilih ulang.

**Cara kerja (client + server):**

* Client mengirim pilihan saat `createRoom`/`joinRoom` sebagai field opsional `{color, shape}`. Tanpa field itu (client lama) semuanya tetap jalan: server memberi warna pertama yang belum dipakai dan bentuk default `'kotak'`.
* **Validasi server** (`server.js`): `color` harus bilangan bulat 0–7 **dan belum dipakai** pemain lain di room itu — kalau sudah dipakai, server memberi warna lain yang belum dipakai (seperti dulu) dan mengabari client lewat `joinedRoom` `{colorHex, color, shape}`. `shape` harus salah satu dari `['kotak', 'bulat', 'segitiga']`, kalau tidak valid fallback ke `'kotak'`. Pilihan tersimpan per pemain (`player.color`, `player.shape`) dan di-broadcast lewat `roomUpdate` `players[]` (`{color, colorHex, shape}`) dan `playersMoved` (`{color, colorHex, shape}`).
* **Render client** (`public/js/game.js`): tekstur Phaser dibuat per kombinasi warna × bentuk — kunci `'player_<color>_<shape>'`, total **8 × 3 = 24 tekstur** (semua 36×48). Kotak = persegi membulat + mata, Bulat = lingkaran + mata, Segitiga = segitiga + mata. Pemain lokal memakai tekstur sesuai warna+bentuk akhir dari server; pemain remote/bot memakai tekstur sesuai `color`+`shape` dari data server (kalau bentuk berubah, tekstur sprite diganti; kombinasi yang belum ada teksturnya fallback ke kotak warna itu, tidak crash).
* **Bot** (Fitur 3) mendapat bentuk acak saat dibuat (`makeBot`), konsisten selama bot itu hidup, dan bentuknya ikut di-broadcast seperti pemain biasa.
* **Progress bar** tetap memakai warna pemain (`colorHex`) — tidak berubah, hanya ikut field baru di `roomUpdate`/`playersMoved`.

## Map (v0.2.0)

Layout map didefinisikan terpusat di `MAPS` pada `public/js/game.js` (server hanya tahu id + nama map, untuk validasi & broadcast). Panjang dunia dan garis finish sama di semua map (4800 px / x=4620).

| | Map 1 Klasik | Map 2 Badai 🌪️ |
|---|---|---|
| Checkpoint | x=2400 | x=2250 |
| Jurang | 6 segmen tanah | 6 segmen tanah di posisi berbeda |
| Rintangan khusus | — | Bola raksasa, lantai es, pintu dorong, kipas angin |

Rintangan Map 2 (semua deterministik dari `serverTime`, jadi sama di semua layar):

* **Bola raksasa:** menyapu map dari x=-400 dengan kecepatan 200 px/dtk, berulang tiap 28 detik; kena = terpental kuat (velocity ±520, -520). Rotasi bola mengikuti jarak gelinding (`x / radius`).
* **Lantai es 🧊:** segmen x 1800–2300 dan 3400–3900 (strip biru muda). Di atas es, akselerasi lambat (±18/frame) dan tanpa input pemain meluncur (velocity × 0,985/frame).
* **Pintu dorong 🚪:** di x=2900, siklus 4 detik (2 detik tertutup, 2 detik terbuka). Collider aktif hanya saat tertutup (processCallback Phaser); saat terbuka pintu tenggelam ke dalam tanah, lampu di atasnya hijau.
* **Kipas angin 💨:** zona x 4100–4400. Di dalamnya pemain didorong ke belakang (−160 velocity X/frame, jadi lari ke kanan tinggal 120 px/dtk) dan diangkat ke atas (lift, jatuh tertahan). Baling-baling berputar dari `serverTime`.

Host memilih map di lobby lewat event `setMap` `{map}` (hanya host, hanya saat lobby); server menyimpan `room.map` dan broadcast lewat `roomUpdate` `{map, mapName}`. Client me-rebuild layout lewat `GameScene.buildWorld(mapId)` — dipakai saat `create()`, saat map berubah di lobby, dan saat race dimulai. Tanpa field map (client/server lama), default Map 1.

## Struktur project

```
LariKuy-Game/
├── server.js              # Express + Socket.io: room, countdown, finish, broadcast posisi
├── package.json
├── public/
│   ├── index.html         # Lobby, HUD, tombol sentuh, hasil balapan
│   ├── css/style.css      # Tampilan ceria, responsif
│   └── js/game.js         # Phaser: scene balapan, physics, rintangan deterministik
└── README.md
```

## Cara kerja multiplayer (singkat)

* Client mengirim posisi `(x, y, vx, vy)` ke server ~20 kali/detik selama balapan.
* Server meneruskan posisi itu ke pemain lain di room yang sama.
* Pemain lain ditampilkan sebagai karakter warna berbeda + nama di atasnya.
* Palu putar & platform bergerak dihitung dari `serverTime` (jam server yang disinkronkan berkala), bukan dari jam lokal masing-masing — jadi gerakannya identik di semua layar.
* Finish: client melapor saat melewati garis finish, **server** yang mencatat urutan berdasarkan waktu server menerima laporan.

## Deploy ke Railway / Render (gratis buat prototype)

1. Push repo ini ke GitHub.
2. Di Railway (atau Render), buat project baru → **Deploy from GitHub Repo** → pilih repo `LariKuy-Game`.
3. Tidak perlu build command. Start command: `npm start`
4. Railway/Render otomatis memberi `PORT` — server sudah membaca `process.env.PORT`.
5. Buka URL yang diberikan, bagikan ke temanmu. Selesai!

> Catatan: hosting statis saja (Vercel/Netlify/GitHub Pages) **tidak cukup**, karena game ini butuh server Node.js yang jalan terus untuk Socket.io.

## Lisensi

MIT
