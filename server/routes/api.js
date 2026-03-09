const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { postMessageToThread } = require('../google-chat');

const router = express.Router();

function getOrCreateConversation(visitorId) {
  const db = getDb();
  let row = db.prepare('SELECT id, thread_name FROM conversations WHERE visitor_id = ? ORDER BY created_at DESC LIMIT 1').get(visitorId);
  if (row) return row;
  const id = uuidv4();
  db.prepare('INSERT INTO conversations (id, visitor_id) VALUES (?, ?)').run(id, visitorId);
  return { id, thread_name: null };
}

router.get('/widget-settings', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM widget_settings').all();
  const settings = {};
  rows.forEach((r) => (settings[r.key] = r.value));
  const { delay_seconds, welcome_text, primary_color, position } = settings;
  res.json({
    delay_seconds: parseInt(delay_seconds || '3', 10),
    welcome_text: welcome_text || 'Hi! How can we help you today?',
    primary_color: primary_color || '#2563eb',
    position: position || 'bottom-right',
  });
});

router.post('/conversations', (req, res) => {
  const visitorId = req.body?.visitor_id || req.cookies?.chat_visitor_id || uuidv4();
  const { id, thread_name } = getOrCreateConversation(visitorId);
  res.cookie('chat_visitor_id', visitorId, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: false });
  res.json({ conversation_id: id, visitor_id: visitorId, thread_name });
});

router.get('/conversations/:id/messages', (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT id, conversation_id, sender_type, body, agent_email, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
    )
    .all(req.params.id);
  res.json({ messages: rows });
});

router.post('/conversations/:id/messages', async (req, res) => {
  const { id } = req.params;
  const body = (req.body?.body || req.body?.text || '').trim();
  if (!body) return res.status(400).json({ error: 'Message body required' });

  const db = getDb();
  const conv = db.prepare('SELECT id, thread_name FROM conversations WHERE id = ?').get(id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  db.prepare('INSERT INTO messages (conversation_id, sender_type, body) VALUES (?, ?, ?)').run(id, 'visitor', body);

  try {
    const created = await postMessageToThread(id, body, true);
    const threadName = created?.thread?.name || `spaces/${require('../google-chat').SPACE_ID}/threads/${id}`;
    if (!conv.thread_name) {
      db.prepare('UPDATE conversations SET thread_name = ? WHERE id = ?').run(threadName, id);
    }
  } catch (err) {
    console.error('Google Chat post failed:', err.message);
  }

  const row = db.prepare('SELECT id, conversation_id, sender_type, body, agent_email, created_at FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(id);
  req.app.get('wss')?.broadcastToConversation(id, { type: 'new_message', message: row });
  res.json({ message: row });
});

module.exports = router;
