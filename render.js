// render.js — Entry point for Render.com deployment
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const cors = require('cors');

if (process.platform !== 'win32') {
  const tmpData = path.join('/tmp', 'nexuspos-data');
  if (!fs.existsSync(tmpData)) fs.mkdirSync(tmpData, { recursive: true });
  process.env.NEXUS_DATA_DIR = tmpData;
  console.log(`[render.js] Data: ${tmpData}`);
}

const express = require('express');
const database = require('./src/database');
const { initializeDB } = require('./src/database');
const { getDataBasePath } = require('./src/utils/settings');
const printSettingsRoutes = require('./routes/printSettings.routes');
const { startScheduler } = require('./src/services/bcvUpdater');

// Initialize DB FIRST, then migrations
initializeDB();
require('./src/auto-migrate');

const app = express();
const PORT = process.env.PORT || 3050;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.nexuspos_token;
  const isApiRequest = req.xhr ||
    (req.headers.accept && req.headers.accept.includes('json')) ||
    (req.originalUrl && req.originalUrl.startsWith('/api/'));
  if (!token) {
    if (isApiRequest) return res.status(401).json({ error: 'No autorizado.' });
    return res.redirect('/login.html');
  }
  try {
    const user = database.db.prepare(
      'SELECT id, username, rol FROM usuarios WHERE current_session_token = ? AND activo = 1'
    ).get(token);
    if (!user) {
      res.clearCookie('nexuspos_token');
      if (isApiRequest) return res.status(401).json({ error: 'Sesión expirada.' });
      return res.redirect('/login.html');
    }
    req.userId = user.id;
    req.userRol = user.rol;
    next();
  } catch (e) {
    if (isApiRequest) return res.status(500).json({ error: 'Error de autenticación.' });
    return res.redirect('/login.html');
  }
}

app.use(express.static(path.join(__dirname, 'public')));
app.get('/mobile', (req, res) => res.sendFile(path.join(__dirname, 'public', 'mobile', 'index.html')));
app.get('/mobile/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'mobile', 'index.html')));

// PUBLIC ROUTES
app.use('/api/auth', require('./routes/auth.routes'));
app.post('/api/manage-users/login', require('./controllers/new_auth.controller').login);
app.get('/api/settings/business', require('./routes/settings.routes'));
app.get('/api/tunnel-url', (req, res) => res.json({ url: null }));
app.use('/api/sync', require('./routes/sync.routes'));

// AUTH MIDDLEWARE
app.use('/api', requireAuth);

// PROTECTED ROUTES
app.use('/api/manage-users', require('./routes/new_auth.routes'));
app.use('/api/products', require('./routes/product.routes'));
app.use('/api/categories', require('./routes/category.routes'));
app.use('/api/sales', require('./routes/sales.routes'));
app.use('/api/settings', require('./routes/settings.routes'));
app.use('/api/license', require('./routes/license.routes'));
app.use('/api/reports', require('./routes/reports.routes'));
app.use('/api/utils', require('./routes/utils.routes'));
app.use('/api/clients', require('./routes/client.routes'));
app.use('/api/backup', require('./routes/backup.routes'));
app.use('/api/suppliers', require('./routes/supplier.routes'));
app.use('/api/purchases', require('./routes/purchases.routes'));
app.use('/api/audit', require('./routes/audit.routes'));
app.use('/api/print-settings', printSettingsRoutes);
app.use('/api/presentations', require('./routes/presentation.routes'));
app.use('/api/kardex', require('./routes/kardex.routes'));
app.use('/api/ai', require('./routes/nexusAI.routes'));
app.use('/api/expenses', require('./routes/expenses.routes'));

app.get('/api/whoami', (req, res) => res.json({ rol: req.userRol || '' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok', platform: process.platform, port: PORT }));
app.get('/keepalive', (req, res) => res.json({ status: 'alive', ts: Date.now() }));
app.use('/api/*', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

app.get('*', (req, res) => {
  const filePath = path.join(__dirname, 'public', req.path);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return res.sendFile(filePath);
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

startScheduler();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`NexusPOS on Render.com — Port ${PORT}`);
});

module.exports = app;
