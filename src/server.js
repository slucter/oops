require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');

const requireAuth = require('./middleware/requireAuth');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const clientRoutes = require('./routes/clients');
const groupRoutes = require('./routes/groups');
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

// install.sh + file agent publik (tanpa login) — dipanggil lewat curl dari server client.
app.use(installRoutes);
app.use('/agent-files', express.static(path.join(__dirname, '..', 'agent'), { dotfiles: 'ignore', index: false }));

app.use(authRoutes);
app.use(requireAuth, dashboardRoutes);
app.use(requireAuth, clientRoutes);
app.use(requireAuth, groupRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server] unhandled error:', err);
  res.status(500).send('Terjadi kesalahan internal.');
});

const httpServer = app.listen(PORT, () => {
  console.log(`[server] sxops dashboard jalan di http://localhost:${PORT}`);
});

wsServer.attach(httpServer);
console.log('[server] WebSocket server siap di /agent');
