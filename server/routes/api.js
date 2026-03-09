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
  let agent_display_names = {};
  try {
    if (settings.agent_display_names) agent_display_names = JSON.parse(settings.agent_display_names);
  } catch (_) {}
  res.json({
    delay_seconds: parseInt(settings.delay_seconds || '3', 10),
    welcome_text: settings.welcome_text || 'Hi! How can we help you today?',
    primary_color: settings.primary_color || '#2563eb',
    position: settings.position || 'bottom-right',
    button_always_visible: settings.button_always_visible === '1' || settings.button_always_visible === 'true',
    chatbox_popup_delay_seconds: Math.max(0, parseInt(settings.chatbox_popup_delay_seconds || '10', 10)),
    button_style: settings.button_style || 'icon_only',
    button_label: settings.button_label || 'Chat',
    header_title: settings.header_title || 'Chat with us',
    input_placeholder: settings.input_placeholder || 'Type a message...',
    show_agent_name: settings.show_agent_name === '1' || settings.show_agent_name === 'true',
    agent_display_names: agent_display_names,
    followup_enabled: settings.followup_enabled === '1' || settings.followup_enabled === 'true',
    followup_delay_minutes: Math.max(1, parseInt(settings.followup_delay_minutes || '2', 10)),
    followup_title: settings.followup_title || "We'll get back to you",
    followup_message: settings.followup_message || 'Leave your name and email or phone so we can reach you.',
    followup_name_placeholder: settings.followup_name_placeholder || 'Name',
    followup_email_placeholder: settings.followup_email_placeholder || 'Email',
    followup_phone_placeholder: settings.followup_phone_placeholder || 'Phone',
    followup_submit_label: settings.followup_submit_label || 'Send',
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
    const threadName = created?.thread?.name || created?.threadName || `spaces/${require('../google-chat').SPACE_ID}/threads/${id}`;
    if (!conv.thread_name) {
      db.prepare('UPDATE conversations SET thread_name = ? WHERE id = ?').run(threadName, id);
      console.log('Chat: saved thread_name for', id, '->', threadName);
    }
  } catch (err) {
    console.error('Google Chat post failed:', err.message);
  }

  const row = db.prepare('SELECT id, conversation_id, sender_type, body, agent_email, created_at FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(id);
  if (row.sender_type === 'agent') {
    req.app.get('wss')?.broadcastToConversation(id, { type: 'new_message', message: row });
  }
  res.json({ message: row });
});

router.post('/conversations/:id/contact', async (req, res) => {
  const { id } = req.params;
  const name = (req.body?.name || '').trim();
  const email = (req.body?.email || '').trim();
  const phone = (req.body?.phone || '').trim();
  if (!email && !phone) return res.status(400).json({ error: 'Email or phone required' });

  const db = getDb();
  const conv = db.prepare('SELECT id, thread_name FROM conversations WHERE id = ?').get(id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  db.prepare('UPDATE conversations SET contact_name = ?, contact_email = ?, contact_phone = ? WHERE id = ?').run(name || null, email || null, phone || null, id);

  const summary = ['Visitor left contact info:'].concat(
    name ? ['Name: ' + name] : [],
    email ? ['Email: ' + email] : [],
    phone ? ['Phone: ' + phone] : []
  ).join('\n');

  try {
    await postMessageToThread(id, summary, true);
  } catch (err) {
    console.error('Google Chat contact post failed:', err.message);
  }

  res.json({ ok: true });
});

module.exports = router;
