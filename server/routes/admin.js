const express = require('express');
const { getDb } = require('../db');
const { postMessageToThread } = require('../google-chat');

const router = express.Router();

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

router.get('/me', (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  res.json({
    email: req.user?.emails?.[0]?.value || req.user?.email,
    name: req.user?.displayName || req.user?.name,
  });
});

router.get('/conversations', requireAuth, (req, res) => {
  const db = getDb();
  const list = db
    .prepare(
      `SELECT c.id, c.visitor_id, c.created_at, c.thread_name,
        (SELECT body FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message,
        (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message_at,
        (SELECT agent_email FROM messages WHERE conversation_id = c.id AND sender_type = 'agent' ORDER BY id DESC LIMIT 1) AS last_reply_by,
        (SELECT created_at FROM messages WHERE conversation_id = c.id AND sender_type = 'agent' ORDER BY id DESC LIMIT 1) AS last_reply_at
      FROM conversations c
      ORDER BY CASE WHEN last_message_at IS NULL THEN 0 ELSE 1 END DESC, last_message_at DESC, c.created_at DESC`
    )
    .all();
  res.json({ conversations: list });
});

router.get('/conversations/:id', requireAuth, (req, res) => {
  const db = getDb();
  const conv = db.prepare('SELECT id, visitor_id, created_at, thread_name FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Not found' });
  const messages = db
    .prepare('SELECT id, conversation_id, sender_type, body, agent_email, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
    .all(req.params.id);
  res.json({ ...conv, messages });
});

router.post('/conversations/:id/reply', requireAuth, async (req, res) => {
  const { id } = req.params;
  const body = (req.body?.body || req.body?.text || '').trim();
  if (!body) return res.status(400).json({ error: 'Message body required' });

  const db = getDb();
  const conv = db.prepare('SELECT id FROM conversations WHERE id = ?').get(id);
  if (!conv) return res.status(404).json({ error: 'Not found' });

  const agentEmail = req.user?.emails?.[0]?.value || req.user?.email || 'admin';

  db.prepare('INSERT INTO messages (conversation_id, sender_type, body, agent_email) VALUES (?, ?, ?, ?)').run(id, 'agent', body, agentEmail);

  try {
    await postMessageToThread(id, body, false);
  } catch (err) {
    console.error('Google Chat post reply failed:', err.message);
  }

  const row = db.prepare('SELECT id, conversation_id, sender_type, body, agent_email, created_at FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(id);
  req.app.get('wss')?.broadcastToConversation(id, { type: 'new_message', message: row });
  res.json({ message: row });
});

router.get('/widget-settings', requireAuth, (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM widget_settings').all();
  const settings = {};
  rows.forEach((r) => (settings[r.key] = r.value));
  res.json(settings);
});

router.put('/widget-settings', requireAuth, (req, res) => {
  const db = getDb();
  const allowed = ['delay_seconds', 'welcome_text', 'primary_color', 'position'];
  const update = db.prepare('INSERT INTO widget_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const key of allowed) {
    if (req.body[key] !== undefined) update.run(key, String(req.body[key]));
  }
  const rows = db.prepare('SELECT key, value FROM widget_settings').all();
  const settings = {};
  rows.forEach((r) => (settings[r.key] = r.value));
  res.json(settings);
});

module.exports = router;
