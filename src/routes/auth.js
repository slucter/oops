const express = require('express');
const { verifyCredentials } = require('../services/userStore');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = verifyCredentials(username || '', password || '');

  if (!user) {
    return res.status(401).render('login', { error: 'Username atau password salah.' });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).render('login', { error: 'Terjadi kesalahan, coba lagi.' });
    req.session.userId = user.id;
    req.session.username = user.username;
    res.redirect('/');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
