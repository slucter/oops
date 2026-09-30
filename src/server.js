require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');

const requireAuth = require('./middleware/requireAuth');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const clientRoutes = require('./routes/clients');
const groupRoutes = require('./routes/groups');
const settingsRoutes = require('./routes/settings');
const pushRoutes = require('./routes/push');
const installRoutes = require('./routes/install');
const wsServer = require('./ws/server');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET belum diset di .env');
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

// Username selalu tersedia di semua view (dipakai navbar), tanpa perlu
// diteruskan manual di tiap res.render().
app.use((req, res, next) => {
  res.locals.username = req.session ? req.session.username : null;
  next();
});

// install.sh + file agent publik (tanpa login) — dipanggil lewat curl dari server client.
app.use(installRoutes);
app.use('/agent-files', express.static(path.join(__dirname, '..', 'agent'), { dotfiles: 'ignore', index: false }));

// Service worker HARUS didaftarkan sebelum express.static, kalau tidak
// static yang menanganinya duluan dan header Service-Worker-Allowed tidak
// pernah terkirim. Header itu yang mengizinkan scope root, supaya push
// diterima untuk seluruh situs — bukan cuma path tempat file-nya berada.
app.get('/sw.js', (req, res) => {
  res.set('Service-Worker-Allowed', '/');
  res.set('Cache-Control', 'no-cache');
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, '..', 'public', 'sw.js'));
});

// Aset publik lain (ikon notifikasi, script client).
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));

app.use(authRoutes);
app.use(requireAuth, dashboardRoutes);
app.use(requireAuth, clientRoutes);
app.use(requireAuth, groupRoutes);
app.use(requireAuth, settingsRoutes);
app.use(requireAuth, pushRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.statusCode || err.status || 500;
  if (status >= 500) console.error('[server] unhandled error:', err);

  // Endpoint yang dipanggil dari JavaScript harus dijawab JSON, bukan
  // halaman HTML — kalau tidak, res.json() di sisi klien gagal parse dan
  // pesan errornya jadi membingungkan.
  const wantsJson = req.path.startsWith('/push/')
    || (req.get('accept') || '').includes('application/json');

  if (wantsJson) {
    return res.status(status).json({
      error: status === 400 ? 'Permintaan tidak valid.' : 'Terjadi kesalahan internal.',
    });
  }
  res.status(status).send('Terjadi kesalahan internal.');
});

const httpServer = app.listen(PORT, () => {
  console.log(`[server] Oops dashboard jalan di http://localhost:${PORT}`);
});

wsServer.attach(httpServer);
console.log('[server] WebSocket server siap di /agent');
