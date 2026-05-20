const { WebSocketServer } = require('ws');
const url = require('url');
const { verifyToken } = require('../middleware/auth');
const { q } = require('../db/queries');
const { addClient, removeClient, broadcastToSession, broadcastToSessionExceptRole, sendToUser, getClientInfo, sessionClients } = require('./sessions');

function broadcastPathWaypoint(sessionId, msg, senderUserId) {
  const clients = sessionClients.get(sessionId);
  if (!clients) return;

  const payload = JSON.stringify(msg);
  const isHiding = msg.pathType === 'hiding';

  for (const [userId, client] of clients.entries()) {
    if (userId === senderUserId) continue;
    if (isHiding && client.role === 'dog_handler') continue;
    try {
      client.ws.send(payload);
    } catch (e) {
      console.error('WS send error:', e.message);
    }
  }
}

function setupWebSocket(server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    const params = new URLSearchParams(url.parse(req.url).query);
    const token = params.get('token');

    if (!token) {
      ws.close(4001, 'No token');
      return;
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (e) {
      ws.close(4001, 'Invalid token');
      return;
    }

    ws.userId = decoded.userId;

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);

        switch (data.type) {
          case 'join_session': {
            const session = q.findSessionById.get(data.sessionId);
            if (!session) {
              ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
              return;
            }

            const member = q.findMember.get(session.id, ws.userId);
            if (!member) {
              ws.send(JSON.stringify({ type: 'error', message: 'Not a member' }));
              return;
            }

            ws.sessionId = session.id;
            ws.role = member.role;
            addClient(ws, ws.userId, session.id, member.role);

            const members = q.findSessionMembers.all(session.id);
            broadcastToSession(session.id, {
              type: 'member_joined',
              userId: ws.userId,
              members,
            });

            const hiding = q.findActiveHidingBySession.get(session.id, 'hiding');
            const hidden = q.findActiveHidingBySession.get(session.id, 'hidden');
            const search = q.findActiveSearchBySession.get(session.id);

            ws.send(JSON.stringify({
              type: 'session_state',
              session,
              members,
              hiding: hiding || null,
              hidden: hidden || null,
              search: search || null,
            }));
            break;
          }

          case 'location_update': {
            if (!ws.sessionId) {
              ws.send(JSON.stringify({ type: 'error', message: 'Join a session first' }));
              return;
            }

            const locMsg = {
              type: 'location_update',
              userId: ws.userId,
              lat: data.lat,
              lng: data.lng,
              name: data.name || decoded.name,
              avatar_url: data.avatar_url || decoded.avatar_url || '',
            };

            if (ws.role === 'lost_person') {
              broadcastToSessionExceptRole(ws.sessionId, locMsg, ws.userId, 'dog_handler');
            } else {
              broadcastToSession(ws.sessionId, locMsg);
            }

            ws.send(JSON.stringify(locMsg));
            ws.send(JSON.stringify({ type: 'location_ack', userId: ws.userId }));
            break;
          }

          case 'path_waypoint': {
            if (!ws.sessionId) return;

            const clientInfo = getClientInfo(ws);
            if (!clientInfo) return;

            const isHiding = data.pathType === 'hiding';
            const isSearch = data.pathType === 'search';

            if (isHiding && ws.role !== 'lost_person') return;
            if (isSearch && ws.role !== 'dog_handler') return;

            const msg = {
              type: 'path_waypoint',
              userId: ws.userId,
              pathType: data.pathType,
              lat: data.lat,
              lng: data.lng,
              timestamp: data.timestamp,
            };

            broadcastPathWaypoint(ws.sessionId, msg, ws.userId);

            ws.send(JSON.stringify({ type: 'path_ack', userId: ws.userId, pathType: data.pathType }));
            break;
          }

          case 'role_changed': {
            if (!ws.sessionId) return;
            ws.role = data.role;

            const clientInfo = getClientInfo(ws);
            if (clientInfo) {
              clientInfo.role = data.role;
            }

            broadcastToSession(ws.sessionId, {
              type: 'role_changed',
              userId: ws.userId,
              role: data.role,
            });
            break;
          }

          default:
            ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
        }
      } catch (e) {
        console.error('WS message error:', e.message);
      }
    });

    ws.on('close', () => {
      const info = removeClient(ws);
      if (info) {
        broadcastToSession(info.sessionId, {
          type: 'member_left',
          userId: info.userId,
        });
      }
    });

    ws.send(JSON.stringify({ type: 'connected', userId: ws.userId }));
  });
}

module.exports = { setupWebSocket };
