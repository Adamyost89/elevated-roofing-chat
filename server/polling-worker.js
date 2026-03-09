const { getDb } = require('./db');
const { listMessages, SPACE_ID } = require('./google-chat');

const POLL_MS = parseInt(process.env.CHAT_POLL_INTERVAL_MS || '15000', 10);
let wssRef = null;
let lastKnownIds = new Set();

function setWss(wss) {
  wssRef = wss;
}

async function poll() {
  let data;
  try {
    data = await listMessages(100);
  } catch (err) {
    console.error('Chat poll list error:', err.message);
    return;
  }
  if (!data || !data.messages) return;

  const db = getDb();
  const seenStmt = db.prepare('SELECT 1 FROM messages WHERE google_message_name = ? LIMIT 1');

  for (const msg of data.messages) {
    if (msg.sender?.type === 'BOT') continue;
    const name = msg.name;
    if (!name || lastKnownIds.has(name)) continue;

    const threadName = msg.thread?.name;
    if (!threadName) continue;

    const exists = seenStmt.get(name);
    if (exists) continue;

    const conv = db.prepare('SELECT id FROM conversations WHERE thread_name = ? OR id = ?').get(threadName, threadName.split('/threads/')[1] || '');
    if (!conv) continue;
    const conversationId = conv.id;

    const text = msg.text || msg.argumentText || '';
    const agentEmail = msg.sender?.email || msg.sender?.name || null;

    db.prepare(
      'INSERT INTO messages (conversation_id, sender_type, body, agent_email, google_message_name) VALUES (?, ?, ?, ?, ?)'
    ).run(conversationId, 'agent', text, agentEmail, name);

    lastKnownIds.add(name);
    const row = db
      .prepare('SELECT id, conversation_id, sender_type, body, agent_email, created_at FROM messages WHERE google_message_name = ?')
      .get(name);
    if (row && wssRef) wssRef.broadcastToConversation(conversationId, { type: 'new_message', message: row });
  }

  if (data.messages.length > 0) {
    const keep = new Set();
    data.messages.forEach((m) => {
      if (m.name) keep.add(m.name);
    });
    lastKnownIds = keep;
  }
}

function start() {
  poll();
  setInterval(poll, POLL_MS);
}

module.exports = { start, setWss };
