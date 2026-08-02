// controllers/printSettings.controller.js
const { loadSettings, saveSettings } = require('../src/utils/settings');

const getPrintSettings = (req, res) => {
  try {
    const s = loadSettings();
    res.json({
      printMode: s.printMode || 'preview',
      printCopies: s.printCopies || 1,
      ticketHeader: s.ticketHeader || '',
      ticketFooter: s.ticketFooter || '',
      ticketPrinter: s.ticketPrinter || '',
      printTicket: s.printTicket !== false,  // default true
      ticketSize: s.ticketSize || 80
    });
  } catch (err) {
    console.error('Error al obtener configuración de impresión:', err);
    res.status(500).json({ error: 'No se pudo leer la configuración de impresión.' });
  }
};

const updatePrintSettings = (req, res) => {
  try {
    const body = req.body || {};

    const current = loadSettings();

    const updated = {
      ...current,
      printMode: body.printMode === 'direct' ? 'direct' : 'preview',
      printCopies: Math.max(1, parseInt(body.printCopies, 10) || 1),
      ticketHeader: body.ticketHeader ?? current.ticketHeader ?? '',
      ticketFooter: body.ticketFooter ?? current.ticketFooter ?? '',
      ticketPrinter: body.ticketPrinter ?? current.ticketPrinter ?? '',
      printTicket: !!body.printTicket,
      ticketSize: Number(body.ticketSize) === 58 ? 58 : 80
    };

    saveSettings(updated);
    res.json({ success: true, settings: updated });
  } catch (err) {
    console.error('Error al guardar configuración de impresión:', err);
    res.status(500).json({ error: 'No se pudo guardar la configuración de impresión.' });
  }
};

module.exports = {
  getPrintSettings,
  updatePrintSettings
};
