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

app.use('/static', express.static(path.resolve(__dirname, 'static')));

const staticHandler = serveStatic(path.resolve(__dirname, 'document_root'));
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  staticHandler(req, res, () => {
    res.statusCode = 404;
    res.end('Not Found');
  });
});

const options = {
  key: fs.readFileSync(path.resolve(__dirname, 'certs/key2.pem')),
  cert: fs.readFileSync(path.resolve(__dirname, 'certs/cert2.pem')),
};

const server = https.createServer(options, app);

setupWebSocket(server);

const PORT = process.env.PORT || 23456;
server.listen(PORT, () => {
  console.log(`Server running on https://0.0.0.0:${PORT}`);
});
