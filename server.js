require('dotenv').config();

const https = require('https');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const serveStatic = require('serve-static');
const { setupWebSocket } = require('./ws/index');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/config', require('./routes/config'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/sessions', require('./routes/hiding'));
app.use('/api/sessions', require('./routes/search'));
app.use('/api/sessions', require('./routes/routes'));
app.use('/api/sessions', require('./routes/summary'));
app.use('/api/dogs', require('./routes/dogs'));
app.use('/api/log', require('./routes/log'));
app.use('/api/notifications', require('./routes/notifications'));

app.use('/static/avatars', express.static(path.resolve(__dirname, 'data', 'avatars')));
app.use('/static', express.static(path.resolve(__dirname, 'static')));

const staticHandler = serveStatic(path.resolve(__dirname, 'document_root'));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  staticHandler(req, res, () => {
    res.statusCode = 404;
    res.end('Not Found');
  });
});

const options = {
  key: fs.readFileSync(path.resolve(__dirname, 'certs/key.pem')),
  cert: fs.readFileSync(path.resolve(__dirname, 'certs/cert.pem')),
};

const server = https.createServer(options, app);

setupWebSocket(server);

const { q } = require('./db/queries');
function cleanupOldSessions() {
  const old = q.findOldSessions.all();
  for (const s of old) {
    q.deleteSessionMembers.run(s.id);
    q.deleteHidingSessions.run(s.id);
    q.deleteSearchSessions.run(s.id);
    q.deleteAssignedRoutes.run(s.id);
    q.deleteSession.run(s.id);
  }
  if (old.length) console.log(`Cleaned up ${old.length} old session(s)`);
}
setInterval(cleanupOldSessions, 60 * 60 * 1000);
cleanupOldSessions();

const PORT = process.env.PORT || 22334;
server.listen(PORT, () => {
  console.log(`Server running on https://0.0.0.0:${PORT}`);
});
