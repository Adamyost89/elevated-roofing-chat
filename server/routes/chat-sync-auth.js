const express = require('express');
const { google } = require('googleapis');
const { getDb } = require('../db');

const router = express.Router();
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const CHAT_SYNC_SCOPE = 'https://www.googleapis.com/auth/chat.messages.readonly';

router.get('/chat-sync', (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.redirect(BASE_URL + '/admin/?error=login_first');
  }
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    BASE_URL + '/auth/chat-sync/callback'
  );
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['profile', 'email', CHAT_SYNC_SCOPE],
    state: 'chat_sync',
  });
  res.redirect(url);
});

router.get('/chat-sync/callback', async (req, res) => {
  if (req.query.error) {
    return res.redirect(BASE_URL + '/admin/?chat_sync=denied');
  }
  const { code } = req.query;
  if (!code) {
    return res.redirect(BASE_URL + '/admin/?chat_sync=error');
  }
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    BASE_URL + '/auth/chat-sync/callback'
  );
  try {
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      console.error('Chat sync: no refresh_token in response. User may need to consent again.');
      return res.redirect(BASE_URL + '/admin/?chat_sync=error');
    }
    const email = (req.user && req.user.emails && req.user.emails[0]) ? req.user.emails[0].value : (req.user?.email || '');
    const db = getDb();
    db.prepare(
      'INSERT INTO chat_sync_credentials (id, refresh_token, email, created_at) VALUES (1, ?, ?, datetime(\'now\')) ON CONFLICT(id) DO UPDATE SET refresh_token = excluded.refresh_token, email = excluded.email, created_at = excluded.created_at'
    ).run(tokens.refresh_token || '', email);
    res.redirect(BASE_URL + '/admin/?chat_sync=ok');
  } catch (err) {
    console.error('Chat sync token exchange failed:', err.message);
    res.redirect(BASE_URL + '/admin/?chat_sync=error');
  }
});

module.exports = router;
