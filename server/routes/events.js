const express = require('express');
const { getDb } = require('../db');

const router = express.Router();

function parsePubSubMessage(body) {
  if (!body?.message?.data) return null;
  try {
    const data = Buffer.from(body.message.data, 'base64').toString('utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

router.post('/events', express.json(), (req, res) => {
  const envelope = parsePubSubMessage(req.body);
  if (!envelope) {
    return res.status(200).send();
  }

  const eventType = envelope?.eventType || envelope?.type;
  const data = envelope?.data || envelope;

  if (eventType !== 'google.workspace.chat.message.v1.created' && !data?.message) {
    return res.status(200).send();
  }

  const message = data.message || data;
  const spaceName = message.space?.name;
  const threadName = message.thread?.name;
  const sender = message.sender;
  const text = message.text || message.argumentText;

  if (sender?.type === 'BOT' || !threadName || !text) {
    return res.status(200).send();
  }

  const conversationId = threadName.split('/threads/')[1];
  if (!conversationId) return res.status(200).send();

  const db = getDb();
  const conv = db.prepare('SELECT id FROM conversations WHERE id = ?').get(conversationId);
  if (!conv) return res.status(200).send();

  const agentEmail = sender.email || sender.name || null;
  const googleMessageName = message.name || null;

  const insert = db.prepare(
    'INSERT INTO messages (conversation_id, sender_type, body, agent_email, google_message_name) VALUES (?, ?, ?, ?, ?)'
  );
  const result = insert.run(conversationId, 'agent', text, agentEmail, googleMessageName);
  const row = db.prepare('SELECT id, conversation_id, sender_type, body, agent_email, created_at FROM messages WHERE id = ?').get(result.lastInsertRowid);

  const wss = req.app.get('wss');
  if (wss) wss.broadcastToConversation(conversationId, { type: 'new_message', message: row });

  res.status(200).send();
});

module.exports = router;
