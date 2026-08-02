// controllers/utils.controller.js
const os = require('os');
const qrcode = require('qrcode');

const getLocalIp = async (req, res) => {
  try {
    // 1) Intentar leer el puerto desde el query (?port=XXXX), si lo mandas desde el frontend
    let port = req.query.port;

    // 2) Si no vino en query, intentar sacarlo del encabezado Host (ej: "192.168.1.10:3057")
    if (!port) {
      const host = req.headers.host || ''; // ej: "192.168.1.10:3057" o "localhost:3057"
      const parts = host.split(':');
      if (parts.length === 2) {
        port = parts[1];
      }
    }

    // 3) Si aún no hay puerto, usar la variable global (si la configuras en main.js / server.js)
    if (!port && global.dynamicPort) {
      port = String(global.dynamicPort);
    }

    // 4) Fallback final a 3050 si no se pudo deducir nada
    if (!port) {
      port = '3050';
    }

    const interfaces = os.networkInterfaces();
    const urls = [];
    let firstUrl = null;

    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          const url = `http://${net.address}:${port}`;
          urls.push(url);
          if (!firstUrl) firstUrl = url;
        }
      }
    }

    if (firstUrl) {
      const qrCodeDataURL = await qrcode.toDataURL(firstUrl);
      res.json({ success: true, urls, qrCodeDataURL, tunnelUrl: global.tunnelUrl || null });
    } else {
      res.json({
        success: false,
        urls: [],
        qrCodeDataURL: null,
        tunnelUrl: global.tunnelUrl || null,
        message: 'No se encontró IP local.'
      });
    }
  } catch (error) {
    console.error('Error al generar QR o IP:', error);
    res.status(500).json({
      success: false,
      urls: [],
      qrCodeDataURL: null,
      tunnelUrl: global.tunnelUrl || null,
      error: error.message
    });
  }
};

const getServerTime = (req, res) => {
  try {
    const now = new Date();
    res.json({
      iso: now.toISOString(),
      local: now.toLocaleString('es-VE'),
      raw: now
    });
  } catch (error) {
    console.error('Error al obtener la hora del servidor:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

module.exports = {
  getLocalIp,
  getServerTime
};
