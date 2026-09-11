# ⚡ Telegram Multi-Account Manager (Web Dashboard)

Aplikasi manajemen dan otomasi multi-akun Telegram berbasis **FastAPI** dan **Telethon** dengan antarmuka web modern (*Dark Mode Glassmorphism*). Dirancang khusus untuk mengelola puluhan hingga ribuan (100 - 1.000+) akun Telegram dengan performa tinggi, aman dari pemblokiran (*anti-ban safe delays*), dan enkripsi data tingkat militer.

---

## 🚀 Fitur Unggulan

### 1. 📱 Multi-Metode Login & Manajemen Akun
* **Login Nomor HP Bertahap**: Wizard terpandu (Input Nomor -> Kirim OTP -> Dukungan Kata Sandi 2FA).
* **Login QR Code**: Scan via aplikasi Telegram di ponsel dengan timer live *countdown* 30 detik & auto-polling.
* **Bulk Login**: Masukkan banyak nomor telepon sekaligus dalam format daftar baris.
* **Import StringSession**: Tempel *StringSession* Telethon langsung tanpa perlu scan QR atau minta kode OTP.
* **Auto-Reconnect & Multi-Client Pool**: Kelola banyak sesi Telegram secara efisien tanpa boros memori.

### 2. 🛡️ Keamanan & Backup Data
* **Enkripsi Simetris Fernet (32-byte)**: Seluruh string sesi Telegram dienkripsi secara aman saat disimpan di database SQLite.
* **Autentikasi Dashboard Terproteksi**: Password di-hash menggunakan `bcrypt` dengan JWT Bearer Token.
* **Export Cadangan (Backup)**: Unduh seluruh sesi terdekripsi kapan saja dalam format `.json` atau `.txt`.

### 3. 🩺 Pemeriksa Kesehatan Akun (@SpamBot)
* Terintegrasi langsung dengan `@SpamBot` resmi Telegram.
* Deteksi status otomatis per akun atau massal:
  * 🟢 **Clean**: Akun normal dan bebas dari batasan.
  * 🟡 **Limited**: Akun terkena limit / bisu dari Telegram.
  * 🔴 **Banned / Deactivated**: Akun terblokir atau telah hangus.

### 4. ⚙️ Otomasi Massal
* **🚀 Join Grup Massal**:
  * Mendukung tautan grup publik (`@username`, `t.me/...`) maupun tautan undangan privat (`+hash`, `joinchat`).
  * Proteksi *Safe Delay* antar akun untuk mencegah `FloodWaitError` Telegram.
* **👤 Profil Manager Massal**:
  * Ubah Nama Depan, Nama Belakang, dan Bio/About (maks 70 karakter) ke banyak akun sekaligus.
  * Upload foto profil avatar baru ke seluruh akun terpilih secara otomatis.
* **🧹 Bersihkan Chat & Akun (Account Cleaner)**:
  * Keluar dari semua grup (*public & private supergroups*).
  * Keluar dari semua channel siaran (*broadcast channels*).
  * Hapus seluruh dialog chat bot.
  * Opsi hapus percakapan pribadi (PM).
  * Slider pengaturan jeda waktu per chat dan batas dialog yang diperiksa.

### 5. ⚡ Skalabilitas Tinggi (100 – 1.000+ Akun)
* **Paginasi Database & UI**: Memuat 20, 50, atau 100 akun per halaman secara instan menggunakan `LIMIT & OFFSET` SQLite.
* **Real-Time Search & Filter**: Pencarian instan berdasarkan nomor telepon, nama, atau username dengan fitur debounce.
* **Filter Status**: Filter cepat akun online vs offline.
* **Smart Quick Select**: Tombol pintas `[Pilih Semua]`, `[Batal]`, dan `[Online Saja]` di setiap menu aksi massal.

---

## 🛠️ Tech Stack

* **Backend**: Python 3.11+, [FastAPI](https://fastapi.tiangolo.com/), [Telethon](https://github.com/LonamiWebs/Telethon) (Telegram MTProto Client).
* **Database**: SQLite dengan async driver [aiosqlite](https://github.com/omnilib/aiosqlite).
* **Keamanan**: [Cryptography (Fernet)](https://cryptography.io/), [bcrypt](https://github.com/pyca/bcrypt), [PyJWT](https://pyjwt.readthedocs.io/).
* **Frontend**: Vanilla HTML5, CSS3 (*Custom Glassmorphism Design System*), JavaScript ES6+ (*Modular & Event-Driven*).

---

## 📂 Struktur Direktori

```text
Project Tampung/
├── config.py                 # Pengaturan environment & konfigurasi aplikasi
├── main.py                   # Entry point FastAPI & route mounting
├── requirements.txt          # Dependensi Python
├── database/
│   ├── db.py                 # SQLite database engine async & table initializer
│   └── models.py             # Model User & TelegramAccount (CRUD, pagination, search)
├── routes/
│   ├── auth.py               # Endpoint autentikasi admin (register, login, me)
│   ├── accounts.py           # Endpoint manajemen akun, join grup, cleaner, profil
│   └── telegram.py           # Endpoint wizard login telepon, QR, & bulk
├── services/
│   ├── auth_service.py       # Hashing bcrypt & JWT generator
│   ├── client_manager.py     # Singleton pool manager untuk Telethon clients
│   └── encryption.py         # Enkripsi & dekripsi Fernet untuk StringSession
├── static/
│   ├── css/style.css         # Desain glassmorphism dark-mode
│   └── js/
│       ├── app.js            # Inisialisasi token & toast notifications
│       ├── accounts.js       # Logika render akun, pagination, search & filter
│       └── telegram-login.js # Logika login phone, QR, bulk, join, clean, & profil
└── templates/
    ├── index.html            # Dashboard utama (7 tab alat)
    ├── login.html            # Halaman masuk
    └── register.html         # Halaman pendaftaran admin
```

---

## ⚙️ Panduan Instalasi & Menjalankan

### 1. Prasyarat
* Python 3.10 atau versi lebih baru terinstal di komputer.
* Kredensial Telegram API (`API_ID` & `API_HASH`) dari [my.telegram.org](https://my.telegram.org).

### 2. Kloning / Buka Folder Proyek
```bash
cd "e:\Project Tampung"
```

### 3. Buat Virtual Environment (Opsional tapi Direkomendasikan)
```bash
python -m venv venv
# Windows:
venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate
```

### 4. Install Dependensi
```bash
pip install -r requirements.txt
```

### 5. Konfigurasi File `.env`
Buka atau buat file `.env` di root direktori dengan isi berikut:
```env
# Telegram API Credentials (Dapatkan dari https://my.telegram.org)
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=abcdef1234567890abcdef1234567890

# JWT Authentication
SECRET_KEY=ganti_dengan_random_secret_string_anda_disini

# Kunci Enkripsi Sesi Akun (32-byte Base64 Fernet Key)
# Anda bisa generate via Python: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
ENCRYPTION_KEY=ganti_dengan_fernet_key_anda=

# Database
DATABASE_PATH=data/telegram_dashboard.db
```

### 6. Jalankan Server
```bash
python main.py
```

Buka browser dan akses:
👉 **`http://localhost:8000`**

Daftarkan akun admin pertama Anda di halaman registrasi, lalu masuk ke dashboard!

---

## 🌐 Cara Akses Publik / Deploy Gratis (Tanpa Beli VPS)

Jika Anda ingin mengakses dashboard ini dari HP atau komputer lain di luar jaringan WiFi rumah secara gratis:

### Opsi 1: Cloudflare Tunnel (Sangat Direkomendasikan - 100% Gratis & Aman)
1. Download `cloudflared` dari [developers.cloudflare.com](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/).
2. Jalankan perintah cepat di terminal (saat `python main.py` aktif):
   ```bash
   cloudflared tunnel --url http://localhost:8000
   ```
3. Cloudflare akan memberikan domain HTTPS gratis (misal: `https://contoh-random.trycloudflare.com`) yang bisa langsung dibuka dari HP mana saja.

### Opsi 2: ngrok
1. Daftar di [ngrok.com](https://ngrok.com) dan unduh CLI-nya.
2. Jalankan:
   ```bash
   ngrok http 8000
   ```

---

## ⚠️ Tips Keamanan & Pencegahan Ban Telegram

1. **Gunakan Safe Delay**:
   Saat menjalankan *Join Grup Massal* atau *Bersihkan Chat*, berikan jeda minimal 2–5 detik antar akun. Jangan menyetel jeda 0 detik agar Telegram tidak mendeteksi spamming.
2. **Periksa Kesehatan Berkala**:
   Gunakan tombol `🛡️ Cek Status Akun` secara berkala untuk memantau status akun di `@SpamBot`.
3. **Backup Sesi Anda**:
   Gunakan tombol `💾 Export ▾` untuk mencadangkan *StringSession* ke file JSON/TXT sebelum melakukan aksi besar.

---

## 📄 Lisensi
Hak Cipta © 2026. Dikembangkan untuk penggunaan pribadi dan otomasi produktivitas multi-akun Telegram.
