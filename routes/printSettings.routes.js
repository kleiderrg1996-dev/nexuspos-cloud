// routes/printSettings.routes.js
const express = require('express');
const router = express.Router();

const { loadSettings, saveSettings } = require('../src/utils/settings');

// Normalizamos lo que se envía al frontend
function toPrintSettings(settings) {
  return {
    printMode: settings.printMode || 'preview',
    printTicket: settings.printTicket !== false, // default true
    printerName: settings.printerName || '',
    printCopies: (typeof settings.printCopies === 'number' && settings.printCopies > 0)
      ? settings.printCopies
      : 1,
    ticketSize: typeof settings.ticketSize === 'number' ? settings.ticketSize : 80,
    printHeader: settings.printHeader || '',
    printFooter: settings.printFooter || ''
  };
}

// GET /api/print-settings
router.get('/', (req, res) => {
  try {
    const settings = loadSettings(); // <-- lee business-settings.json
    return res.json(toPrintSettings(settings));
  } catch (error) {
    console.error('Error en GET /api/print-settings:', error);
    return res.status(500).json({ error: 'Error al cargar configuración de impresión' });
  }
});

// POST /api/print-settings
router.post('/', (req, res) => {
  try {
    const current = loadSettings();

    const {
      printMode,
      printTicket,
      printerName,
      printCopies,
      ticketSize,
      printHeader,
      printFooter
    } = req.body || {};

    const newSettings = {
      ...current,
      printMode: printMode === 'direct' ? 'direct' : 'preview',
      printTicket: typeof printTicket === 'boolean'
        ? printTicket
        : current.printTicket,

      printerName: typeof printerName === 'string'
        ? printerName
        : current.printerName,

      printCopies: Number(printCopies) > 0
        ? Number(printCopies)
        : (current.printCopies || 1),

      ticketSize: Number(ticketSize) === 58 ? 58 : 80,

      printHeader: typeof printHeader === 'string'
        ? printHeader
        : current.printHeader,

      printFooter: typeof printFooter === 'string'
        ? printFooter
        : current.printFooter
    };

    saveSettings(newSettings); // <-- guarda en business-settings.json

    return res.json({
      success: true,
      settings: toPrintSettings(newSettings)
    });
  } catch (error) {
    console.error('Error en POST /api/print-settings:', error);
    return res.status(500).json({ success: false, error: 'Error al guardar configuración de impresión' });
  }
});

module.exports = router;
