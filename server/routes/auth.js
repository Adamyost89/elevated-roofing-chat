const express = require('express');
const passport = require('passport');

const router = express.Router();
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

router.get('/login', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get(
  '/callback',
  passport.authenticate('google', { failureRedirect: `${BASE_URL}/admin/?error=login_failed` }),
  (req, res) => {
    res.redirect(`${BASE_URL}/admin/`);
  }
);

router.post('/logout', (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.redirect(`${BASE_URL}/admin/`);
  });
});

router.get('/logout', (req, res) => {
  req.logout((err) => {
    res.redirect(`${BASE_URL}/admin/`);
  });
});

module.exports = router;
