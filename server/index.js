require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const http = require('http');
const { getDb, initDb } = require('./db');
const { attach: attachWs } = require('./websocket');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');
const eventsRoutes = require('./routes/events');
const pollingWorker = require('./polling-worker');
const passport = require('./passport');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

initDb();

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(cookieParser(process.env.SESSION_SECRET || 'chat-secret'));
app.use(express.json());

const session = require('express-session');
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'chat-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);
app.use(passport.initialize());
app.use(passport.session());

app.use('/api', apiRoutes);
app.use('/auth', authRoutes);
app.use('/events', eventsRoutes);
app.use('/admin/api', adminRoutes);

const wss = attachWs(server);
app.set('wss', wss);
pollingWorker.setWss(wss);
pollingWorker.start();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => res.redirect(302, '/admin/'));

app.get('/health', (req, res) => res.json({ ok: true }));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Chat server listening on port ${PORT}`);
});
