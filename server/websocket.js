const WebSocket = require('ws');

const conversationSockets = new Map();

function attach(server) {
  const wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const conversationId = url.searchParams.get('conversation_id');
    const role = url.searchParams.get('role') || 'visitor';
    if (!conversationId) {
      ws.close();
      return;
    }
    if (!conversationSockets.has(conversationId)) {
      conversationSockets.set(conversationId, new Set());
    }
    conversationSockets.get(conversationId).add(ws);
    ws.conversationId = conversationId;
    ws.role = role;

    ws.on('message', (raw) => {
      try {
        const payload = JSON.parse(raw.toString());
        if (!payload || !payload.type) return;
        if (payload.type === 'typing') {
          wss.broadcastToConversation(ws.conversationId, {
            type: 'typing',
            role: ws.role,
          });
        } else if (payload.type === 'composing') {
          wss.broadcastToConversation(ws.conversationId, {
            type: 'composing',
            role: ws.role,
            text: typeof payload.text === 'string' ? payload.text : '',
          });
        }
      } catch (_) {}
    });

    ws.on('close', () => {
      const set = conversationSockets.get(ws.conversationId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) conversationSockets.delete(ws.conversationId);
      }
    });
  });

  wss.broadcastToConversation = (conversationId, payload) => {
    const set = conversationSockets.get(conversationId);
    if (!set) return;
    const data = JSON.stringify(payload);
    set.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });
  };

  return wss;
}

module.exports = { attach };
