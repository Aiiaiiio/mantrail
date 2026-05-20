const sessionClients = new Map();

function addClient(ws, userId, sessionId, role) {
  if (!sessionClients.has(sessionId)) {
    sessionClients.set(sessionId, new Map());
  }
  const clients = sessionClients.get(sessionId);

  if (clients.has(userId)) {
    const existing = clients.get(userId);
    try { existing.ws.close(); } catch (e) {}
    clients.delete(userId);
  }

  clients.set(userId, { ws, userId, sessionId, role });
}

function removeClient(ws) {
  for (const [sessionId, clients] of sessionClients.entries()) {
    for (const [userId, client] of clients.entries()) {
      if (client.ws === ws) {
        clients.delete(userId);
        if (clients.size === 0) {
          sessionClients.delete(sessionId);
        }
        return { userId, sessionId };
      }
    }
  }
  return null;
}

function broadcastToSession(sessionId, message, excludeUserId = null) {
  const clients = sessionClients.get(sessionId);
  if (!clients) return;

  const payload = JSON.stringify(message);
  for (const [userId, client] of clients.entries()) {
    if (excludeUserId && userId === excludeUserId) continue;
    try {
      client.ws.send(payload);
    } catch (e) {
      console.error('WS send error:', e.message);
    }
  }
}

function broadcastToSessionExceptRole(sessionId, message, excludeUserId, excludeRole) {
  const clients = sessionClients.get(sessionId);
  if (!clients) return;

  const payload = JSON.stringify(message);
  for (const [userId, client] of clients.entries()) {
    if (excludeUserId && userId === excludeUserId) continue;
    if (client.role === excludeRole) continue;
    try {
      client.ws.send(payload);
    } catch (e) {
      console.error('WS send error:', e.message);
    }
  }
}

function sendToUser(userId, message) {
  const payload = JSON.stringify(message);
  for (const [, clients] of sessionClients.entries()) {
    const client = clients.get(userId);
    if (client) {
      try {
        client.ws.send(payload);
      } catch (e) {
        console.error('WS send error:', e.message);
      }
    }
  }
}

function getClientInfo(ws) {
  for (const [, clients] of sessionClients.entries()) {
    for (const [, client] of clients.entries()) {
      if (client.ws === ws) return client;
    }
  }
  return null;
}

module.exports = { sessionClients, addClient, removeClient, broadcastToSession, broadcastToSessionExceptRole, sendToUser, getClientInfo };
