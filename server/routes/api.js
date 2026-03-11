const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { postMessageToThread } = require('../google-chat');

const router = express.Router();

function getOrCreateConversation(visitorId) {
  const db = getDb();
  let row = db.prepare('SELECT id, thread_name, display_number FROM conversations WHERE visitor_id = ? ORDER BY created_at DESC LIMIT 1').get(visitorId);
  if (row) return row;
  const id = uuidv4();
  const nextNum = db.prepare('SELECT COALESCE(MAX(display_number), 0) + 1 AS n FROM conversations').get();
  db.prepare('INSERT INTO conversations (id, visitor_id, display_number) VALUES (?, ?, ?)').run(id, visitorId, nextNum.n);
  return { id, thread_name: null, display_number: nextNum.n };
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
  let ooo_schedule = null;
  try {
    if (settings.ooo_schedule) ooo_schedule = JSON.parse(settings.ooo_schedule);
  } catch (_) {}
  let contact_form_fields = [];
  try {
    if (settings.contact_form_fields) contact_form_fields = JSON.parse(settings.contact_form_fields);
    if (!Array.isArray(contact_form_fields)) contact_form_fields = [];
  } catch (_) {}
  let agent_avatar_urls = {};
  try {
    if (settings.agent_avatar_urls) agent_avatar_urls = JSON.parse(settings.agent_avatar_urls);
    if (typeof agent_avatar_urls !== 'object') agent_avatar_urls = {};
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
    sound_enabled: settings.sound_enabled !== '0' && settings.sound_enabled !== 'false',
    agent_display_names: agent_display_names,
    followup_enabled: settings.followup_enabled === '1' || settings.followup_enabled === 'true',
    followup_delay_minutes: Math.max(1, parseInt(settings.followup_delay_minutes || '2', 10)),
    followup_title: settings.followup_title || "We'll get back to you",
    followup_message: settings.followup_message || 'Leave your name and email or phone so we can reach you.',
    followup_name_placeholder: settings.followup_name_placeholder || 'Name',
    followup_email_placeholder: settings.followup_email_placeholder || 'Email',
    followup_phone_placeholder: settings.followup_phone_placeholder || 'Phone',
    followup_submit_label: settings.followup_submit_label || 'Send',
    ooo_enabled: settings.ooo_enabled === '1' || settings.ooo_enabled === 'true',
    ooo_timezone: settings.ooo_timezone || 'America/Chicago',
    ooo_schedule: ooo_schedule,
    ooo_contact_form_delay_seconds: Math.max(0, parseInt(settings.ooo_contact_form_delay_seconds || '0', 10)),
    ooo_message: settings.ooo_message || "We're currently out of office. Leave your details and we'll get back to you.",
    contact_form_fields: contact_form_fields,
    agent_avatar_urls: agent_avatar_urls,
    waiting_status_text: settings.waiting_status_text || 'Waiting on team member',
    waiting_prompt_delay_seconds: Math.max(0, parseInt(settings.waiting_prompt_delay_seconds || '120', 10)),
    waiting_prompt_question: settings.waiting_prompt_question || 'Would you like to keep waiting or have someone contact you?',
    waiting_prompt_keep_label: settings.waiting_prompt_keep_label || 'Keep waiting',
    waiting_prompt_contact_label: settings.waiting_prompt_contact_label || 'Have someone contact me',
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
  let conv = db.prepare('SELECT id, thread_name, display_number FROM conversations WHERE id = ?').get(id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  if (!conv.display_number) {
    const nextNum = db.prepare('SELECT COALESCE(MAX(display_number), 0) + 1 AS n FROM conversations').get();
    db.prepare('UPDATE conversations SET display_number = ? WHERE id = ?').run(nextNum.n, id);
    conv = { ...conv, display_number: nextNum.n };
  }

  db.prepare('INSERT INTO messages (conversation_id, sender_type, body) VALUES (?, ?, ?)').run(id, 'visitor', body);

  try {
    if (!conv.thread_name) {
      const num = conv.display_number || 1;
      const label = `Website chat #${num}`;
      const created = await postMessageToThread(id, label, true);
      const threadName = created?.thread?.name || created?.threadName || `spaces/${require('../google-chat').SPACE_ID}/threads/${id}`;
      db.prepare('UPDATE conversations SET thread_name = ? WHERE id = ?').run(threadName, id);
      console.log('Chat: saved thread_name for', id, '->', threadName);
      await postMessageToThread(id, body, true);
    } else {
      await postMessageToThread(id, body, true);
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
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const name = (body.name || '').trim();
  const email = (body.email || '').trim();
  const phone = (body.phone || '').trim();
  const knownKeys = ['name', 'email', 'phone'];
  const extra = {};
  Object.keys(body).forEach((k) => {
    if (knownKeys.indexOf(k) === -1 && body[k] != null && String(body[k]).trim() !== '') {
      extra[k] = String(body[k]).trim();
    }
  });
  if (!email && !phone && Object.keys(extra).length === 0) return res.status(400).json({ error: 'Email, phone, or contact details required' });

  const db = getDb();
  let conv = db.prepare('SELECT id, thread_name, display_number FROM conversations WHERE id = ?').get(id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  if (!conv.display_number) {
    const nextNum = db.prepare('SELECT COALESCE(MAX(display_number), 0) + 1 AS n FROM conversations').get();
    db.prepare('UPDATE conversations SET display_number = ? WHERE id = ?').run(nextNum.n, id);
    conv = { ...conv, display_number: nextNum.n };
  }

  const contactExtraJson = Object.keys(extra).length > 0 ? JSON.stringify(extra) : null;
  db.prepare('UPDATE conversations SET contact_name = ?, contact_email = ?, contact_phone = ?, contact_extra = ? WHERE id = ?').run(name || null, email || null, phone || null, contactExtraJson, id);

  const prefix = conv.display_number ? `Website chat #${conv.display_number} — ` : '';
  const summaryParts = [prefix + 'Visitor left contact info:'];
  if (name) summaryParts.push('Name: ' + name);
  if (email) summaryParts.push('Email: ' + email);
  if (phone) summaryParts.push('Phone: ' + phone);
  Object.keys(extra).forEach((k) => summaryParts.push(k + ': ' + extra[k]));
  const summary = summaryParts.join('\n');

  try {
    await postMessageToThread(id, summary, true);
  } catch (err) {
    console.error('Google Chat contact post failed:', err.message);
  }

  res.json({ ok: true });
});

module.exports = router;
