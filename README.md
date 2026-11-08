# 🏃 LariKuy!

Balapan platformer 2D multiplayer ala Fall Guys — lari, lompat, hindari rintangan, siapa duluan sampai finish!

* **6–8 pemain** per room, masuk pakai kode room 4 huruf
* **1 map panjang** side-scrolling: jurang, palu putar, platform bergerak, checkpoint, garis finish
* **Countdown 3-2-1-GO**, timer balapan, dan urutan finish ditentukan server
* Rintangan bergerak **deterministik pakai jam server**, jadi semua pemain melihat gerakan yang sama
* Bisa dimainkan di HP (tombol sentuh) maupun keyboard

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

1. Isi nama kamu, lalu **Buat Room** (dapat kode 4 huruf) atau **Gabung** pakai kode temanmu.
2. Bagikan kode room ke teman-temanmu (maks 8 pemain).
3. Host menekan **Mulai Balapan**. Tunggu countdown 3-2-1-GO!
4. Kontrol:
   * **Gerak:** `A` / `D` atau `←` / `→` (di HP: tombol ◀ ▶)
   * **Lompat:** `Spasi` / `W` / `↑` (di HP: tombol ⤒)
5. Jatuh ke jurang = kembali ke checkpoint terakhir. Kena palu putar = terpental!
6. Siapa duluan melewati garis finish 🏁 dia juaranya. Hasil akhir menampilkan urutan + waktu tiap pemain.

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
