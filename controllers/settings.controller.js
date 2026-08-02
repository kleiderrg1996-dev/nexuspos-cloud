const { db } = require('../src/database');
const { loadSettings, saveSettings, getDataBasePath } = require('../src/utils/settings');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { updateBCVRate } = require('../src/services/bcvUpdater');

const uploadsBasePath = path.join(getDataBasePath(), 'uploads');

const getRates = (req, res) => {
  try {
    const ratesList = db.prepare("SELECT key, value FROM settings WHERE key IN ('BCV', 'PARALELO', 'COP', 'CALC_METHOD', 'AUTO_BCV', 'IVA_PERCENTAGE', 'IVA_MODE')").all();
    const ratesObject = ratesList.reduce((obj, rate) => { obj[rate.key] = rate.value; return obj; }, {});
    res.json(ratesObject);
  } catch (error) {
    console.error('Error getting rates:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateRates = async (req, res) => {
  console.log('UpdateRates Payload:', req.body);
  const { BCV, PARALELO, COP, CALC_METHOD, AUTO_BCV, IVA_PERCENTAGE, IVA_MODE } = req.body;

  if (BCV === undefined || PARALELO === undefined || COP === undefined || CALC_METHOD === undefined) {
    return res.status(400).json({ error: 'Faltan datos obligatorios (BCV, Paralelo, COP o Método de Cálculo).' });
  }

  try {
    const fBCV = parseFloat(BCV);
    const fPARALELO = parseFloat(PARALELO);
    const fCOP = parseFloat(COP);
    const iCALC = parseInt(CALC_METHOD, 10);
    const bAUTO = (AUTO_BCV === true || AUTO_BCV === 'true' || AUTO_BCV === 1 || AUTO_BCV === '1') ? 1 : 0;
    const fIVA = IVA_PERCENTAGE !== undefined ? parseFloat(IVA_PERCENTAGE) : 16.0;
    const sIVA_MODE = (IVA_MODE === 'EXCLUDED') ? 'EXCLUDED' : 'INCLUDED';

    if (isNaN(fBCV) || isNaN(fPARALELO) || isNaN(fCOP) || isNaN(iCALC) || isNaN(fIVA)) {
      console.warn('Validación fallida - Valores no numéricos:', { fBCV, fPARALELO, fCOP, iCALC, fIVA });
      return res.status(400).json({ error: 'Las tasas e IVA deben ser números válidos.' });
    }

    if (![1, 2].includes(iCALC)) {
      return res.status(400).json({ error: 'Método de cálculo inválido.' });
    }

    // Usar una transacción para asegurar que todo se guarde o nada
    const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

    const transaction = db.transaction(() => {
      upsert.run('BCV', fBCV);
      upsert.run('PARALELO', fPARALELO);
      upsert.run('COP', fCOP);
      upsert.run('CALC_METHOD', iCALC);
      upsert.run('IVA_PERCENTAGE', fIVA);
      upsert.run('IVA_MODE', sIVA_MODE);
      upsert.run('AUTO_BCV', bAUTO);
    });

    transaction();

    let updatedMessage = 'Configuración actualizada con éxito.';
    let newBcvRate = null;

    if (bAUTO === 1) {
      try {
        console.log('Auto-update BCV habilitado. Consultando tasa inmediata...');
        await updateBCVRate();

        const updatedRow = db.prepare("SELECT value FROM settings WHERE key = 'BCV'").get();
        if (updatedRow) {
          newBcvRate = parseFloat(updatedRow.value);
          updatedMessage = `Configuración guardada. BCV actualizado a: ${newBcvRate}`;
        }
      } catch (bcvErr) {
        console.error('Error durante auto-update BCV:', bcvErr.message);
        // No fallamos el total solo por el auto-update si ya guardamos lo demás
        updatedMessage = 'Configuración guardada, pero falló la actualización automática del BCV.';
      }
    }

    res.json({
      message: updatedMessage,
      newBcvRate: newBcvRate
    });
  } catch (error) {
    console.error('CRITICAL Error updating rates:', error);
    res.status(500).json({ error: 'Error interno al procesar la actualización.', details: error.message });
  }
};

const getBusinessSettings = (req, res) => {
  try {
    res.json(loadSettings());
  } catch (error) {
    console.error('Error reading business settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateBusinessSettings = (req, res) => {
  const { businessName, logoPath, businessRif, businessAddress } = req.body;
  if (businessName === undefined) return res.status(400).json({ error: 'Missing businessName' });
  let newLogoWebPath = logoPath || "";
  if (req.file) {
    newLogoWebPath = `/uploads/${req.file.filename}`;
    console.log('Nuevo logo guardado, ruta web:', newLogoWebPath);
    if (logoPath && logoPath !== newLogoWebPath && logoPath.startsWith('/uploads/')) {
      const oldFileName = path.basename(logoPath);
      const oldFilePath = path.join(uploadsBasePath, oldFileName);
      if (fs.existsSync(oldFilePath)) {
        fs.unlink(oldFilePath, (err) => {
          if (err) console.error("Error borrando logo antiguo:", oldFilePath, err);
          else console.log("Logo antiguo borrado:", oldFilePath);
        });
      }
    }
  }
  try {
    const currentSettings = loadSettings();
    const newSettings = {
      ...currentSettings,
      businessName: businessName.trim(),
      businessRif: businessRif ? businessRif.trim() : currentSettings.businessRif,
      businessAddress: businessAddress ? businessAddress.trim() : currentSettings.businessAddress,
      logoPath: newLogoWebPath.trim()
    };
    if (saveSettings(newSettings)) res.json({ message: 'Business settings updated', settings: newSettings });
    else throw new Error('No se pudo guardar la configuración.');
  } catch (error) {
    console.error('Error saving business settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getPrintSettings = (req, res) => {
  try {
    const settings = loadSettings();
    res.json({
      printTicket: settings.printTicket,
      ticketSize: settings.ticketSize
    });
  } catch (error) {
    console.error('Error getting print settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updatePrintSettings = (req, res) => {
  const { printTicket, ticketSize } = req.body;

  if (printTicket === undefined || ticketSize === undefined) {
    return res.status(400).json({ error: 'Faltan datos (printTicket, ticketSize)' });
  }

  try {
    const currentSettings = loadSettings();
    const newSettings = {
      ...currentSettings,
      printTicket: (printTicket === true || printTicket === 'true'),
      ticketSize: parseInt(ticketSize, 10)
    };

    if (saveSettings(newSettings)) {
      res.json({ message: 'Configuración de impresión guardada.', settings: newSettings });
    } else {
      throw new Error('No se pudo guardar la configuración de impresión.');
    }
  } catch (error) {
    console.error('Error saving print settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getAdminPasswordStatus = (req, res) => {
  try {
    const settings = loadSettings();
    const enabled = !!(
      (typeof settings.adminPasswordHash === 'string' && settings.adminPasswordHash.trim() !== '') ||
      (typeof settings.adminPassword === 'string' && settings.adminPassword.trim() !== '')
    );
    res.json({ enabled });
  } catch (error) {
    console.error('Error getting admin password status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateAdminPassword = (req, res) => {
  const { adminPassword } = req.body;

  if (adminPassword === undefined) {
    return res.status(400).json({ error: 'Falta adminPassword en el cuerpo de la petición.' });
  }

  try {
    const currentSettings = loadSettings();
    const trimmed = String(adminPassword).trim();
    const newSettings = { ...currentSettings };

    let enabled = false;

    if (trimmed) {
      const hash = crypto.createHash('sha256').update(trimmed).digest('hex');
      newSettings.adminPasswordHash = hash;
      enabled = true;
    } else {
      if (Object.prototype.hasOwnProperty.call(newSettings, 'adminPasswordHash')) {
        delete newSettings.adminPasswordHash;
      }
      if (Object.prototype.hasOwnProperty.call(newSettings, 'adminPassword')) {
        delete newSettings.adminPassword;
      }
      enabled = false;
    }

    if (!saveSettings(newSettings)) {
      throw new Error('No se pudo guardar la contraseña de administrador.');
    }

    res.json({
      message: trimmed ? 'Contraseña de administrador actualizada.' : 'Contraseña de administrador eliminada.',
      enabled
    });
  } catch (error) {
    console.error('Error updating admin password:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};


const updateContactInfo = (req, res) => {
  const { clientPhone, clientEmail } = req.body;

  if (!clientPhone || !clientEmail) {
    return res.status(400).json({ error: 'Teléfono y correo son obligatorios' });
  }

  try {
    const currentSettings = loadSettings();
    const newSettings = {
      ...currentSettings,
      clientPhone: String(clientPhone).trim(),
      clientEmail: String(clientEmail).trim()
    };

    if (saveSettings(newSettings)) {
      res.json({ message: 'Información de contacto actualizada', success: true });
    } else {
      throw new Error('No se pudo guardar la información de contacto');
    }
  } catch (error) {
    console.error('Error updating contact info:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

module.exports = {
  getRates,
  updateRates,
  getBusinessSettings,
  updateBusinessSettings,
  getPrintSettings,
  updatePrintSettings,
  getAdminPasswordStatus,
  updateAdminPassword,
  updateContactInfo
};
