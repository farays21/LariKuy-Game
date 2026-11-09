# 🏃 LariKuy!

Balapan platformer 2D multiplayer ala Fall Guys — lari, lompat, hindari rintangan, siapa duluan sampai finish!

* **6–8 pemain** per room, masuk pakai kode room 4 huruf
* **4 map panjang** side-scrolling (v0.2.0 + v0.3.0 + v0.4.0): host memilih map di lobby sebelum start
  * **Map 1 Klasik:** jurang, palu putar, platform bergerak, checkpoint, garis finish
  * **Map 2 Badai 🌪️:** jurang di posisi berbeda + bola raksasa yang menggelinding dari belakang, lantai es licin 🧊, pintu dorong buka-tutup 🚪, dan kipas angin 💨 — semua deterministik pakai jam server
  * **Map 3 Angkasa 🌌** (v0.3.0): gravitasi ringan (lompat lebih tinggi & melayang), platform melayang, laser nyala-mati ⚡ — lihat bagian Map 3 di bawah
  * **Map 4 Maraton 🏃** (v0.4.0): map terpanjang (7200 px, finish x=7020), **2 checkpoint**, rintangan campuran dari semua map — lihat bagian Map 4 di bawah
* **Power-up ⚡🦘🛡️** (v0.3.0): item ngambang di tengah map — Speed Boost, Lompat Ganda, Perisai — lihat bagian Power-up di bawah
* **Chat room + emoji/taunt 💬😂** (v0.3.0): kirim pesan ke room + taunt cepat, emoji melayang di atas kepala karakter — lihat bagian Chat di bawah
* **Countdown 3-2-1-GO**, timer balapan, dan urutan finish ditentukan server
* Rintangan bergerak **deterministik pakai jam server**, jadi semua pemain melihat gerakan yang sama
* Bisa dimainkan di HP (tombol sentuh) maupun keyboard
* **Progress bar balapan** di atas layar: dot warna tiap pemain, penanda checkpoint & finish (v0.1.4)
* **Sound effect** synth Web Audio (tanpa file audio): lompat, jatuh, kena palu, checkpoint, countdown/GO, finish, klik — tombol mute 🔊/🔇 di HUD, preferensi tersimpan di localStorage (v0.1.4)
* **Mode Eliminasi 💀** (v0.2.0): multi-round, 2 pemain terlambat gugur tiap round sampai tersisa 1 juara — lihat bagian Mode Eliminasi di bawah
* **Mode Kejar-kejaran / Tag 🏃** (v0.5.0): 1 pengejar acak, yang disentuh jadi pengejar baru, 90 detik — paling sedikit jadi pengejar = menang — lihat bagian Mode Tag di bawah
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
3. Host memilih map (**🗺️ Map 1 Klasik** / **🌪️ Map 2 Badai** / **🌌 Map 3 Angkasa** / **🏃 Map 4 Maraton**) dan mode (**🏁 Balapan Sekali** / **💀 Eliminasi** / **🏃 Kejar-kejaran**) di panel room, lalu menekan **Mulai Balapan**. Tunggu countdown 3-2-1-GO!
4. Kontrol:
   * **Gerak:** `A` / `D` atau `←` / `→` (di HP: tombol ◀ ▶)
   * **Lompat:** `Spasi` / `W` / `↑` (di HP: tombol ⤒)
5. Jatuh ke jurang = kembali ke checkpoint terakhir. Kena palu putar / laser (saat nyala) = **mati, langsung respawn di checkpoint terakhir** (v0.3.1 — dulu hanya terpental; perisai 🛡️ tetap menahan 1x). Kena bola raksasa Map 2 = tetap terpental.
6. Siapa duluan melewati garis finish 🏁 dia juaranya. Hasil akhir menampilkan urutan + waktu tiap pemain.

## Power-up ⚡🦘🛡️ (v0.3.0)

Item power-up ngambang di tengah map, 3 titik per map (Map 4 Maraton: **5 titik**) — di atas tanah, bukan di atas jurang — posisi per map ada di `POWERUP_SPOTS` di `server.js` (client tidak menyimpan posisi sendiri; server yang broadcast lewat event `powerups`):

| Item | Efek | Durasi |
|---|---|---|
| ⚡ Speed Boost | Kecepatan lari x1,5 (280 → 420 px/dtk) | 3 detik |
| 🦘 Lompat Ganda | Bisa lompat 1x tambahan di udara | 5 detik |
| 🛡️ Perisai | Tahan 1x serangan (palu / bola raksasa / laser), lalu hilang | Sampai dipakai |

**Cara kerja (server otoritatif, `server.js`):**

* Server menyimpan state item per room (`room.powerups`: `{slot, x, y, type, active}`), di-spawn di awal tiap round (`initPowerups` di `startRound`) dan di-broadcast lewat event `powerups` `{powerups: [{slot, x, y, type, icon, active}]}` — juga dikirim ulang saat ada yang mengambil dan saat item respawn.
* Client mendeteksi pemain lokal mendekati item (< 90 px) lalu mengirim `powerupPickup` `{slot}` (dibatasi 1 klaim per slot per 500 ms). Server memvalidasi: item harus masih aktif **dan** posisi terakhir pemain (dari event `move` terakhir) harus dalam **140 px** dari item — klaim dari jauh / item yang sudah habis ditolak diam-diam (anti-curang sederhana).
* Item yang diambil hilang, lalu **respawn setelah 10 detik dengan jenis diacak** (timer server per item, dibersihkan saat round/lobby berakhir supaya tidak bocor).
* Efek diterapkan client untuk pemain lokal (kecepatan di `update()`, lompat ganda pakai edge detection tombol lompat + `airJumps` yang direset saat mendarat, perisai dicek di tiap serangan palu/bola/laser lewat `consumeShield()`). Efek pemain lain terlihat lewat ikon kecil di label sprite-nya (misal `⚡ Budi`) — dikirim lewat event `powerupTaken` `{slot, playerId, name, type, icon}`. Efek sendiri tampil di HUD (`#hudPowerup`, misal "⚡ Boost 3 dtk · 🛡️ Perisai").
* **Aturan hilang efek:** semua efek hilang saat jatuh/respawn ke checkpoint dan saat round baru dimulai. SFX baru (Web Audio, tanpa file): nada naik saat mengambil power-up, bunyi pecah saat perisai menahan serangan.
* **Bot mengabaikan power-up** (tidak mengambil item) — bot tetap jalan seperti biasa dan tidak merusak state power-up. Power-up jalan di semua map (1, 2, 3, 4) dan kedua mode (race & eliminasi).

## Chat Room + Emoji / Taunt 💬😂 (v0.3.0)

**Cara pakai:** setelah join room, panel chat ada di bawah canvas. Ketik pesan (maks 140 karakter) lalu Enter / tombol Kirim — pesan tampil dengan nama + warna pengirim. Klik tombol emoji (😂 💨 😭 🔥 👏 😎 🤣) untuk taunt cepat: taunt muncul sebagai pesan chat ("Budi: 😂") **dan** sebagai emoji melayang di atas kepala karakter pemain itu di Phaser selama ~2 detik, terlihat semua pemain di room.

**Cara kerja (server + client):**

* Event baru: `chatMessage` `{text}` (client → server) dan `chatMessage` `{id, name, colorHex, text, ts}` (server → room), `taunt` `{emoji}` (client → server) dan `taunt` `{playerId, name, colorHex, emoji}` (server → room). Server hanya broadcast ke **room yang sama** (`io.to(room.code)`), bukan ke room lain.
* **Riwayat:** server menyimpan maks **30 pesan terakhir per room** di memori (`room.chat`, tanpa database — hilang saat room kosong/dihapus). Pemain yang baru join menerima riwayat lewat event `chatHistory` `{messages}`.
* **Anti-spam:** rate-limit sederhana di server — maks **1 pesan/detik dan 1 taunt/detik per pemain** (kelebihan dibuang diam-diam). Panjang pesan dibatasi 140 karakter. Tidak ada filter kata kasar.
* **Taunt penonton:** penonton (sudah finish/gugur) tetap boleh chat & taunt; emoji taunt muncul di atas kepala **karakter si pemilik taunt sendiri** (bukan yang sedang ditonton) — karakter penonton tetap terlihat berdiri di map.
* **Tidak mengganggu gerak:** saat input chat fokus, keyboard tidak menggerakkan karakter (guard di handler `keydown` — Enter ditangani input-nya sendiri). Panel chat bisa dibuka/tutup (tombol 💬 Chat ▾/▸), log scroll internal (maks ~84 px), dan **diciutkan otomatis saat balapan** supaya canvas lega, lalu dibuka lagi saat balapan selesai. Layout tetap tanpa scroll (body overflow hidden).
* **Tertutup secara default (v0.3.2):** seperti `<details>` Cara Main di lobby — yang terlihat hanya header `💬 Chat ▸`, hemat ~150 px di HP. Pesan baru saat tertutup menaikkan **badge angka** di header (`💬 Chat ▸ • 3`); badge hilang begitu chat dibuka. Riwayat lama saat join tidak menaikkan badge.

## Map 3 "Angkasa" 🌌 (v0.3.0)

Tema luar angkasa, beda dari Map 1 Klasik & Map 2 Badai. Host memilih Map 3 di pemilih map yang sama (Map 1 / Map 2 / Map 3, default Map 1).

* **Gravitasi ringan:** `physics.world.gravity.y = 750` saat mapId = `map3` (map lain 1200) — lompat lebih tinggi (~209 px vs ~130 px) dan melayang lebih lama di udara. Jurang tetap bisa dilompati (celah maks 150 px).
* **Platform melayang:** 7 platform di udara (y 370–470) selain tanah datar — bisa dipijak sebagai jalan pintas / tempat aman.
* **Laser nyala-mati ⚡:** 3 laser vertikal (x 1100, 2600, 3400, dari y=380 sampai tanah), siklus **3 detik (1,5 dtk nyala, 1,5 dtk mati)** dari `serverTime` (deterministik, sama di semua layar). Kena laser saat nyala = **mati, langsung respawn di checkpoint terakhir** (v0.3.1 — dulu hanya terpental); perisai menahan 1x. Sama seperti kena palu putar: kena palu = mati + respawn checkpoint (bukan lagi terpental), perisai tetap menahan 1x. Bola raksasa Map 2 tidak berubah: kena = tetap terpental.
* **Layout:** tanah `[[0,650],[800,1400],[1550,2200],[2350,2950],[3100,3750],[3900,4800]]`, checkpoint x=1650 (v0.3.1 — dulu x=2200, tepat di ujung segmen tanah `[1550,2200]` sehingga bot respawn di tepi jurang, tidak memicu lompat, jatuh, respawn lagi, loop/stuck; 1650 ada di tengah segmen dan 250 px dari palu Map 3 di x=1900, di luar jangkauan palu), finish tetap x=4620, panjang dunia tetap 4800. Tanah berwarna abu-abu keunguan + bintang-bintang di langit.
* **Mode Eliminasi:** map bergantian per round mengikuti urutan **Map 1 → Map 2 → Map 3 → Map 4 → ulang** (round 1 = map pilihan host, lalu map berikutnya dalam urutan `MAP_ORDER`). Misal host pilih Map 1 → R1 Map 1, R2 Map 2, R3 Map 3, R4 Map 4, R5 Map 1, dst. (v0.2.0 hanya bergantian 2 map; v0.3.0 memakai `mapForRound` berbasis `MAP_ORDER`; v0.4.0 menambah Map 4 ke urutan.)
* **Power-up di Map 3:** 3 titik di x 950, 2000, 3200 (di atas tanah, jauh dari laser) — sama seperti map lain, respawn 10 detik.
* **Bot di Map 3:** bot memakai segmen tanah & checkpoint Map 3 yang sama (`MAP_GROUND`/`MAP_CHECKPOINT` di server), laser dihitung sebagai zona hazard (5% jatuh) seperti palu/pintu.

## Map 4 "Maraton" 🏃 (v0.4.0)

Map terpanjang — sekali lari penuh terasa seperti maraton. Host memilih Map 4 di pemilih map yang sama (Map 1 / 2 / 3 / 4, default Map 1).

* **Ukuran:** lebar dunia **7200 px** (Map 1-3: 4800 px), garis finish **x=7020** (Map 1-3: 4620), tinggi dunia tetap 720, gravitasi normal 1200, start tetap x=100.
* **Tanah:** 8 segmen `[[0,800],[960,1700],[1860,2600],[2760,3500],[3660,4400],[4560,5300],[5460,6200],[6360,7200]]` — celah jurang **160 px semua**, sudah terbukti bisa dilompati (celah maks Map 2).
* **Checkpoint ganda:** **2 checkpoint, x=2250 dan x=4900** — keduanya di **tengah segmen tanah** ([1860,2600] dan [4560,5300]), jauh dari hazard (pelajaran v0.3.1: checkpoint di ujung segmen bikin bot/manusia respawn di tepi jurang lalu jatuh berulang). **Aturan respawn checkpoint terakhir:** jatuh ke jurang / kena palu / kena laser = kembali ke **checkpoint terakhir yang sudah dilewati**, bukan selalu checkpoint 1. Di Map 1-3 (1 checkpoint) perilaku tetap sama seperti sebelumnya. Berlaku untuk manusia (client, `checkpointIdx`) maupun bot (server, `botRespawnX` di-update saat melewati checkpoint mana pun). Progress bar menampilkan **2 penanda ✅** di posisi % yang benar (dihitung dari finishX map aktif).
* **Rintangan campuran** (semua deterministik dari `serverTime`, seperti map lama): 2 palu putar (x 1500 & 5800), 2 platform bergerak, lantai es 🧊 [3800,4400], pintu dorong 🚪 x=3300 (siklus 4 dtk seperti Map 2), kipas angin 💨 zona x 6400-6700, 1 laser ⚡ x=5100 (siklus 3 dtk, 1,5 nyala / 1,5 mati seperti Map 3). **Tidak ada bola raksasa** (supaya tidak menumpuk). Ditambah 8 platform melayang + 3 bumper. Kena palu / laser saat nyala = **mati + respawn checkpoint terakhir** (v0.3.1); perisai 🛡️ tetap menahan 1x.
* **Power-up di Map 4:** **5 titik** di x 1200, 2400, 4200, 5000, 6600 (y=560) — semua di atas tanah, bukan jurang; respawn 10 detik seperti map lain.
* **Mode Eliminasi:** rotasi map jadi **Map 1 → Map 2 → Map 3 → Map 4 → ulang** (round 1 = map pilihan host). **Timeout round eliminasi di Map 4 = 110 detik** (map lain tetap 75 detik) — timeout dihitung dari map aktif saat race dimulai, dan dikirim ke client lewat field `roundTimeoutMs` di event `raceStarted` (bersama `width` dan `finishX` map aktif).
* **Bot di Map 4:** bot memakai segmen tanah, checkpoint ganda, dan finish Map 4 yang sama (`MAP_GROUND`/`MAP_CHECKPOINTS`/`MAP_FINISH` di server); hazard campuran dihitung seperti map lama (palu 30% mati, laser nyala 50% mati, pintu 5% jatuh — roll 1x per zona per round; es/kipas tidak ada efek khusus ke bot, seperti Map 2/3). Anti-stuck tetap berlaku.
* **Refactor per-map (v0.4.0):** lebar & finish tidak lagi hardcode 4800/4620 — tiap entri `MAPS` di `game.js` punya `width`, `finishX`, dan `checkpoints` (array); `checkpointX` lama dipertahankan sebagai alias (= `checkpoints[0]`). Di server, `MAP_CHECKPOINT` diganti `MAP_CHECKPOINTS` (array per map) + `MAP_FINISH`/`MAP_WIDTH`; `WORLD.finishX` hanya fallback default. Map 1-3 berperilaku persis seperti sebelumnya.

## Mode Kejar-kejaran / Tag 🏃 (v0.5.0)

Mode ke-3, bukan balapan: tidak ada garis finish dan tidak ada round eliminasi — 1 ronde tag saja per start. Host memilih **🏃 Kejar-kejaran** di lobby sebelum start (event `setMode` `{mode: 'tag'}` — hanya host, hanya saat lobby; server menolak mode selain `'race'`/`'elimination'`/`'tag'`, non-host, dan di luar lobby).

Aturan (semua otoritatif di server, `server.js`):

* **Minimal 3 pemain** untuk memulai Tag (manusia + bot dihitung). Kalau kurang, server menolak `startGame` dengan event `startError` `{message}`. Mode Balapan Sekali tetap minimal 1 pemain seperti biasa.
* **Durasi ronde 90 detik** (timer dihitung server, `TAG_DURATION_MS = 90000`). Sisa waktu tampil di HUD semua pemain (hitung mundur dari `tagEndsAt` yang dikirim di `raceStarted`).
* **1 pengejar acak di awal ronde** ("Si Kejar"), dipilih server dari pemain aktif saat race dimulai. Pengejar **lebih cepat +15%** dari pelari (`TAG_CHASER_SPEED_MULT = 1.15` — bot pengejar `botSpeed * 1.15`, manusia pengejar kecepatan lari × 1,15 di client).
* **Sentuh = tag:** server mengecek posisi tiap **100 ms** (`TAG_TICK_MS`): kalau jarak pengejar ke seorang pelari **|dx| < 55 px dan |dy| < 100 px** (`TAG_DIST_X` / `TAG_DIST_Y`), pelari itu JADI pengejar baru, pengejar lama jadi pelari. **Masa kebal 2 detik** setelah pergantian (`TAG_IMMUNITY_MS`) — tidak bisa langsung tag-balik. Pergantian di-broadcast lewat event `tagChanged` `{chaserId, chaserName, prevChaserId, prevChaserName, times, serverTime}`.
* **Cara menang:** server mencatat **total waktu tiap pemain jadi pengejar** (akumulasi detik, `tagTimes`). Saat timer 90 detik habis, pemenang = pemain dengan **total waktu jadi pengejar PALING SEDIKIT** (paling jago kabur). Hasil akhir diumumkan lewat event `tagFinished` `{results: [{id, name, colorHex, chaserMs, place, isBot, left}], winner, serverTime}` — results diurutkan dari waktu pengejar tersedikit. Pemain yang disconnect di tengah ronde: waktunya tetap dihitung sampai ia keluar, tapi **tidak bisa menang** (ditandai `left: true` di results).
* **Jatuh / kena palu / laser:** sama seperti mode lain — mati + respawn di checkpoint terakhir yang dilewati, **status pengejar/pelari tetap** (tidak berubah karena mati). Power-up tetap jalan di mode Tag (speed boost membantu kabur/kejar, perisai menahan palu/laser). Tidak ada garis finish: client tidak mengirim `playerFinished` di mode Tag dan server mengabaikannya.
* **Disconnect di tengah Tag:** kalau yang keluar adalah pengejar, server memilih pengejar baru acak dari pemain aktif yang tersisa (masa kebal 2 detik, broadcast `tagChanged`); kalau pemain aktif tersisa ≤ 1, ronde langsung berakhir (`tagFinished`).
* **Visual & HUD (client):** pengejar langsung kelihatan — emoji **👹** di atas label nama + tint merah di sprite-nya + outline merah di dot progress bar-nya; pelari tampil normal. HUD menampilkan **⏱ sisa waktu ronde**, **👹 nama pengejar saat ini**, dan total waktu kamu jadi pengejar sejauh ini. Progress bar di mode Tag berfungsi sebagai "peta posisi" (dot tetap bergerak mengikuti x, tanpa `#place`). SFX baru (Web Audio, tanpa file): bunyi saat pergantian pengejar; toast "😱 Budi jadi pengejar!" / "🏃 Kamu jadi pengejar, kejar mereka!".
* **Bot di mode Tag:** bot ikut main seperti manusia — bot pengejar **mengejar pelari aktif terdekat** (bergerak ke arah x-nya, lompat jurang seperti biasa), bot pelari **lari menjauh dari pengejar** (berbalik arah kalau mendekati ujung kiri map, x < 300, dan berbalik kalau mencapai ujung kanan/finish). Bot tetap kena hazard (palu 30% / laser nyala 50% mati, pintu 5% jatuh — roll 1x per zona per round) dan anti-stuck tetap berlaku. Bot bisa jadi pengejar maupun ditag.
* **Test:** durasi Tag bisa di-override hanya untuk test lewat env var `TAG_TEST_DURATION_MS` (default 90000; test memakai 15000) — perilaku produksi tetap 90 detik.

## Mode Eliminasi 💀 (v0.2.0)

Host memilih **💀 Eliminasi** di lobby sebelum start (event `setMode` `{mode: 'elimination'}` — hanya host, hanya saat lobby; server menolak mode selain `'race'`/`'elimination'`, non-host, dan di luar lobby). Mode tampil di panel room (`roomUpdate` `{mode}`) dan di HUD saat balapan.

Aturan (semua otoritatif di server, `server.js`):

* **Minimal 3 pemain** untuk memulai eliminasi. Kalau kurang, server menolak `startGame` dengan event `startError` `{message}` dan client menampilkannya sebagai toast. Mode Balapan Sekali tetap minimal 1 pemain seperti biasa.
* **Tiap round = 1 balapan penuh.** Round berakhir saat **semua pemain yang belum gugur sudah finish**, ATAU **timeout** sejak `raceStarted` (timer di server; saat timeout, yang belum finish dianggap kalah) — **75 detik di Map 1-3, 110 detik di Map 4** (v0.4.0; Map 4 lebih panjang). Timeout yang dipakai round itu dikirim ke client lewat field `roundTimeoutMs` di event `raceStarted`.
* **2 pemain terlambat gugur** tiap round (diurutkan `finishTime`; yang belum finish saat timeout dianggap paling lambat, tiebreak = progress `x` terakhir — yang paling jauh di depan dianggap lebih cepat). Kalau pemain yang belum gugur tinggal **≤ 2 orang di awal round, hanya 1 yang gugur** (yang paling lambat), supaya final 1v1 masuk akal.
* **Map per round bergantian (v0.4.0):** urutan Map 1 → Map 2 → Map 3 → Map 4 → ulang, dimulai dari map pilihan host (misal host pilih Map 1 → Round 1 Map 1, Round 2 Map 2, Round 3 Map 3, Round 4 Map 4, Round 5 Map 1, dst.). Server yang menentukan map round berjalan dan broadcast lewat `roomUpdate`/`raceStarted` `{map, round}`; client membangun ulang dunia lewat `GameScene.buildWorld(mapId)` sebelum countdown berikutnya.
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
* **Lompat jurang:** server punya definisi segmen tanah per map (`MAP_GROUND`, sinkron dengan `MAPS` di `public/js/game.js`; checkpoint per map di `MAP_CHECKPOINTS` — Map 1: [2400], Map 2: [2250], Map 3: [1650] (v0.3.1, dulu 2200 — tepat di ujung tanah sehingga bot stuck di loop respawn/jatuh), Map 4: [2250, 4900] (v0.4.0, checkpoint ganda — bot respawn ke checkpoint terakhir yang dilewati)). Saat ujung tanah di depan sudah dekat (<120 px) dan di depannya ada jurang, bot "melompat": `y` naik ke ~500 dan tetap di udara sampai mendarat di segmen tanah berikutnya, `x` terus maju melewati jurang. Pengaman anti-stuck (v0.3.1, server-side): bot yang posisi x-nya tidak bertambah >5 px selama 3 detik padahal race masih jalan dipaksa respawn kembali ke checkpoint (hanya mundur, tidak pernah teleport maju). Ditambah pertahanan tepi jurang: bot yang tepat di ujung segmen tanah langsung lompat ke segmen berikutnya.
* **Bisa dikalahkan:** tiap lompatan jurang punya peluang gagal **8%** — bot jatuh dan kembali ke checkpoint terakhir (start/checkpoint map aktif). Selain itu, tiap zona palu/pintu yang dilewati pertama kali di satu round (`MAP_HAZARDS` — Map 1: x 1500 & 2950; Map 2: x 1200, 2900 & 3400) punya peluang jatuh **5%** → kembali ke checkpoint. Bot tidak mensimulasikan fisika rintangan secara penuh; tujuannya bot bisa dikalahkan manusia, bukan mustahil dikalahkan.
* **Finish & eliminasi:** saat bot `x >= finishX` map aktif (4620 di Map 1-3, **7020 di Map 4**), server mencatat finish persis seperti pemain biasa (`finishTime`, `results`, emit `playerFinished` untuk bot itu) dan bot ikut menentukan akhir round/balapan. Di mode eliminasi bot dihitung sebagai pemain aktif (batas minimal 3 pemain, 2 gugur per round) — bot bisa gugur maupun juara seperti manusia.
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

Layout map didefinisikan terpusat di `MAPS` pada `public/js/game.js` (server hanya tahu id + nama map, untuk validasi & broadcast). Sejak v0.4.0 tiap map punya lebar & finish sendiri (`width`, `finishX`, `checkpoints`); Map 1-3 tetap 4800 px / x=4620, Map 4 Maraton 7200 px / x=7020.

| | Map 1 Klasik | Map 2 Badai 🌪️ | Map 3 Angkasa 🌌 (v0.3.0) | Map 4 Maraton 🏃 (v0.4.0) |
|---|---|---|---|---|
| Lebar / Finish | 4800 / x=4620 | 4800 / x=4620 | 4800 / x=4620 | **7200 / x=7020** |
| Checkpoint | x=2400 | x=2250 | x=1650 (v0.3.1, dulu 2200) | **x=2250 & x=4900** (ganda, respawn ke terakhir dilewati) |
| Jurang | 6 segmen tanah | 6 segmen tanah di posisi berbeda | 6 segmen tanah di posisi berbeda | **8 segmen tanah**, celah 160 px |
| Rintangan khusus | — | Bola raksasa, lantai es, pintu dorong, kipas angin | Laser nyala-mati, platform melayang | Palu, es, pintu, kipas, laser (campuran; tanpa bola) |
| Gravitasi | 1200 | 1200 | 750 (lebih ringan) | 1200 |
| Timeout eliminasi | 75 dtk | 75 dtk | 75 dtk | **110 dtk** |

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
