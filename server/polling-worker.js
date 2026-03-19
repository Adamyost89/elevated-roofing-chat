const { getDb } = require('./db');
const { listMessages, SPACE_ID } = require('./google-chat');

const POLL_MS = Math.max(1000, parseInt(process.env.CHAT_POLL_INTERVAL_MS || '2000', 10));
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
  if (!data || !Array.isArray(data.messages)) {
    if (!poll._loggedNoData) {
      poll._loggedNoData = true;
      console.log('Chat poll: list returned no data (403 or empty). Agent replies in Google Chat will not sync to the widget. Use Admin panel to reply instead.');
    }
    return;
  }
  poll._loggedNoData = false;

  // Google Chat list pagination may return oldest messages first.
  // Fetch additional pages so we can see new replies reliably.
  let messages = Array.isArray(data.messages) ? data.messages.slice() : [];
  let nextPageToken = data.nextPageToken || null;
  let pageGuard = 0;
  while (nextPageToken && pageGuard < 20) {
    pageGuard += 1;
    let page;
    try {
      page = await listMessages(100, nextPageToken);
    } catch (err) {
      console.error('Chat poll page list error:', err.message);
      break;
    }
    if (!page || !Array.isArray(page.messages) || page.messages.length === 0) break;
    messages = messages.concat(page.messages);
    nextPageToken = page.nextPageToken || null;
  }
  data.messages = messages;

  // Build a lightweight thread -> display_number map from bot starter messages.
  // This lets us recover mapping for older conversations missing thread_name.
  const threadToDisplayNumber = new Map();
  for (const m of data.messages) {
    const senderType = String(m.sender?.type || '').toUpperCase();
    if (senderType !== 'BOT') continue;
    const threadName = typeof m.thread === 'string' ? m.thread : (m.thread?.name || '');
    if (!threadName) continue;
    const text = String(m.text || m.argumentText || '').trim();
    const match = text.match(/website chat\s*#\s*(\d+)/i);
    if (!match) continue;
    const displayNumber = parseInt(match[1], 10);
    if (!Number.isFinite(displayNumber) || displayNumber <= 0) continue;
    if (!threadToDisplayNumber.has(threadName)) {
      threadToDisplayNumber.set(threadName, displayNumber);
    }
  }

  const humanCount = data.messages.filter((m) => String(m.sender?.type || '').toUpperCase() !== 'BOT').length;
  if (humanCount > 0 && data.messages[0]?.thread) {
    const sample = typeof data.messages[0].thread === 'string' ? data.messages[0].thread : data.messages[0].thread?.name;
    console.log('Chat poll:', data.messages.length, 'messages,', humanCount, 'from humans. Sample thread:', sample);
  }

  const db = getDb();
  const seenStmt = db.prepare('SELECT 1 FROM messages WHERE google_message_name = ? LIMIT 1');
  let synced = 0;
  const noMatchThreads = new Set();

  for (const msg of data.messages) {
    if (String(msg.sender?.type || '').toUpperCase() === 'BOT') continue;
    const name = msg.name;
    if (!name || lastKnownIds.has(name)) continue;

    const threadName = typeof msg.thread === 'string' ? msg.thread : (msg.thread?.name || '');
    if (!threadName) continue;

    const exists = seenStmt.get(name);
    if (exists) continue;

    const threadIdPart = (threadName.split('/threads/')[1] || '').split('/')[0] || '';
    let conv = db.prepare('SELECT id FROM conversations WHERE thread_name = ? OR id = ? OR thread_name LIKE ?').get(threadName, threadIdPart, '%/' + threadIdPart);
    if (!conv) {
      const inferredDisplayNumber = threadToDisplayNumber.get(threadName);
      if (inferredDisplayNumber) {
        conv = db.prepare('SELECT id FROM conversations WHERE display_number = ?').get(inferredDisplayNumber);
        if (conv) {
          db.prepare('UPDATE conversations SET thread_name = COALESCE(thread_name, ?) WHERE id = ?').run(threadName, conv.id);
          console.log('Chat poll: recovered thread mapping for conversation', conv.id, 'from display #', inferredDisplayNumber);
        }
      }
    }
    if (!conv) {
      noMatchThreads.add(threadName);
      continue;
    }
    const conversationId = conv.id;

    const text = (msg.text || msg.argumentText || '').trim();
    if (!text) continue;
    const agentEmail = msg.sender?.email || msg.sender?.name || null;

    db.prepare(
      'INSERT INTO messages (conversation_id, sender_type, body, agent_email, google_message_name) VALUES (?, ?, ?, ?, ?)'
    ).run(conversationId, 'agent', text, agentEmail, name);

    lastKnownIds.add(name);
    synced++;
    const row = db
      .prepare('SELECT id, conversation_id, sender_type, body, agent_email, created_at FROM messages WHERE google_message_name = ?')
      .get(name);
    if (row && wssRef) wssRef.broadcastToConversation(conversationId, { type: 'new_message', message: row });
  }

  if (synced > 0) console.log('Chat poll: synced', synced, 'agent message(s)');
  if (noMatchThreads.size > 0 && data.messages.some((m) => String(m.sender?.type || '').toUpperCase() !== 'BOT')) {
    const convsWithThread = db.prepare('SELECT id, thread_name FROM conversations WHERE thread_name IS NOT NULL').all();
    console.log('Chat poll: no conversation match for thread(s). Known thread_names:', convsWithThread.map((c) => c.thread_name).slice(0, 3));
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
