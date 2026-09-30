require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');

const requireAuth = require('./middleware/requireAuth');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const serverRoutes = require('./routes/servers');
const scheduler = require('./scheduler');

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

app.use(authRoutes);
app.use(requireAuth, dashboardRoutes);
app.use(requireAuth, serverRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.name === 'MulterError') {
    return res.status(400).render('server-form', {
      server: null,
      servers: [],
      error: `Upload gagal: ${err.message}`,
    });
  }
  console.error('[server] unhandled error:', err);
  res.status(500).send('Terjadi kesalahan internal.');
});

app.listen(PORT, () => {
  console.log(`[server] sxops dashboard jalan di http://localhost:${PORT}`);
  scheduler.start();
});
