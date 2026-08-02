// src/utils/license.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { machineIdSync } = require('node-machine-id');
const { loadSettings } = require('./settings');
const { getDataBasePath } = require('./settings');

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArSbe7D2VBD+mf6XIsKT/
xhUJlC6MxiqT8xwvc0YBOXDk8SCGT7o0115vhSPpflHQPbfXdgW1Xtq+qKNOok4S
aLuPg9+zbCzQVERGn+Ds7qaOkGtNKAqYouVVdtu3rXC2JPhrQJBf32wx6I4ZoNxe
+Ji+fxIHK6VOeBBx15W3JP1E2OykJYBnjN5ZGISUX0+YrN6lgnBJa15/QEnacCI4
xjyzEIY8oTdVZW5kaRXMK1Hxucj30idww89g1lNbsJ1WIpsYYsyeHsgtHHY0tf26
MRaxc36danUNM95QbIW9tq5Y7NZqdo/ZX6+geuxWmyhbsfvFUOVSnYnYlv+M+Hud
hQIDAQAB
-----END PUBLIC KEY-----`;

const TRIAL_SECRET_KEY = 'nexuspos-secreto-hmac-2024-v1';
const TRIAL_DURATION_HOURS = 999999; // Prácticamente infinito

// 🧠 Ruta legacy (como estaba antes)
const legacyTrialFilePath = path.join(getDataBasePath(), 'sys.dat');

// 🧠 Nueva ruta camuflada: uploads/.sys/init.dat
function resolveTrialFilePath() {
  const basePath = getDataBasePath();
  const uploadsBasePath = path.join(basePath, 'uploads');
  const hiddenDir = path.join(uploadsBasePath, '.sys');
  const newTrialFilePath = path.join(hiddenDir, 'init.dat');

  try {
    // Asegurar carpeta uploads/.sys
    if (!fs.existsSync(uploadsBasePath)) {
      fs.mkdirSync(uploadsBasePath, { recursive: true });
    }
    if (!fs.existsSync(hiddenDir)) {
      fs.mkdirSync(hiddenDir, { recursive: true });
    }

    // Migrar archivo viejo sys.dat -> init.dat si existe y aún no hay init.dat
    if (!fs.existsSync(newTrialFilePath) && fs.existsSync(legacyTrialFilePath)) {
      try {
        const legacyData = fs.readFileSync(legacyTrialFilePath);
        fs.writeFileSync(newTrialFilePath, legacyData);
        // opcional: puedes borrar el viejo sys.dat si quieres
        // fs.unlinkSync(legacyTrialFilePath);
        console.log('Migrado sys.dat a uploads/.sys/init.dat');
      } catch (e) {
        console.error('Error migrando sys.dat a init.dat:', e.message);
      }
    }
  } catch (e) {
    console.error('Error preparando carpeta de prueba:', e.message);
  }

  return newTrialFilePath;
}

// 👇 Siempre que necesitemos el archivo, resolvemos la ruta actual
function getTrialFilePath() {
  return resolveTrialFilePath();
}

let hardwareId = null;

const FALLBACK_ID_FILE = 'device.id';

function getFallbackHardwareId() {
  try {
    const filePath = path.join(getDataBasePath(), FALLBACK_ID_FILE);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8').trim();
    }
    // Generate new if not exists
    const newId = crypto.randomUUID();
    fs.writeFileSync(filePath, newId, 'utf8');
    return newId;
  } catch (e) {
    console.error('Error gestionando ID de respaldo:', e);
    return 'error-fatal-id';
  }
}

function getHardwareId() {
  if (!hardwareId) {
    // 1. Try Original
    try {
      hardwareId = machineIdSync({ original: true });
    } catch (error) {
      console.warn('Fallo obteniendo HWID Original:', error.message);

      // 2. Try Hashed
      try {
        hardwareId = machineIdSync({ original: false });
      } catch (error2) {
        console.warn('Fallo obteniendo HWID Hashed:', error2.message);

        // 3. Use/Generate File-based Fallback
        hardwareId = getFallbackHardwareId();
      }
    }
  }
  return hardwareId;
}

function verifyLicense(licenseKey) {
  if (!licenseKey || PUBLIC_KEY.includes('PEGA AQUÍ')) {
    console.error('Verificación fallida: La llave pública no ha sido configurada.');
    return false;
  }

  const parts = licenseKey.split('.');
  if (parts.length !== 2) {
    console.error('Error de formato: La licencia no tiene el formato payload.signature.');
    return false;
  }

  const [payloadBase64, signatureBase64] = parts;
  let payload;

  try {
    const payloadJson = Buffer.from(payloadBase64, 'base64').toString('utf8');
    payload = JSON.parse(payloadJson);
  } catch (error) {
    console.error('Error al decodificar la licencia (payload inválido):', error.message);
    return false;
  }

  if (!payload.hwid || !payload.exp) {
    console.error('Error de formato: La licencia no contiene hwid o exp.');
    return false;
  }

  try {
    // SECURITY UPDATE: Check Original, Hashed, AND Fallback HWIDs
    let localHardwareId;
    try {
      localHardwareId = machineIdSync({ original: true });
    } catch (e) { localHardwareId = 'error'; }

    let localHardwareIdHashed;
    try {
      localHardwareIdHashed = machineIdSync({ original: false });
    } catch (e) { localHardwareIdHashed = 'error'; }

    let localHardwareIdFallback = getFallbackHardwareId();

    // Use RSA-SHA256 explicitly
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(JSON.stringify(payload));
    const signatureBuffer = Buffer.from(signatureBase64, 'base64');
    const isSignatureValid = verifier.verify(PUBLIC_KEY, signatureBuffer);

    if (!isSignatureValid) {
      console.error('Verificación fallida: La firma de la licencia es inválida (Clave Pública incorrecta o datos alterados).');
      return false;
    }

    // Allow match on either ID variant
    // Also strip localized chars from comparison if needed, but usually equality is fine
    // Allow match on any ID variant
    if (payload.hwid !== localHardwareId &&
      payload.hwid !== localHardwareIdHashed &&
      payload.hwid !== localHardwareIdFallback) {
      console.error(`Verificación fallida: HWID mismatch. Licencia: ${payload.hwid} | Local: ${localHardwareId} / ${localHardwareIdHashed} / ${localHardwareIdFallback}`);
      return false;
    }

    const [year, month, day] = payload.exp.split('-').map(Number);
    const expDate = new Date(year, month - 1, day, 23, 59, 59);
    const today = new Date();

    if (today > expDate) {
      console.error(`Verificación fallida: La licencia expiró el ${payload.exp}.`);
      return false;
    }

    // console.log(`Licencia válida. Expira el: ${payload.exp}`);
    return true;
  } catch (error) {
    console.error('Error durante la verificación de la licencia:', error.message);
    return false;
  }
}

function writeTrialData(data) {
  try {
    const trialFilePath = getTrialFilePath();
    const dataString = JSON.stringify(data);
    const hmac = crypto.createHmac('sha256', TRIAL_SECRET_KEY).update(dataString).digest('hex');
    const saveObject = { data, hmac };
    const base64Data = Buffer.from(JSON.stringify(saveObject)).toString('base64');
    fs.writeFileSync(trialFilePath, base64Data);
    return true;
  } catch (e) {
    console.error("Error al escribir archivo de prueba:", e);
    return false;
  }
}

function readTrialData() {
  try {
    const trialFilePath = getTrialFilePath();
    if (!fs.existsSync(trialFilePath)) {
      return null;
    }

    const base64Data = fs.readFileSync(trialFilePath, 'utf8');
    const saveDataJson = Buffer.from(base64Data, 'base64').toString('utf8');
    const saveObject = JSON.parse(saveDataJson);

    if (!saveObject.data || !saveObject.hmac) {
      console.error('Archivo de prueba corrupto: Faltan datos o hmac.');
      return null;
    }

    const dataString = JSON.stringify(saveObject.data);
    const expectedHmac = crypto.createHmac('sha256', TRIAL_SECRET_KEY).update(dataString).digest('hex');

    if (saveObject.hmac !== expectedHmac) {
      console.error('Archivo de prueba manipulado: El HMAC no coincide.');
      return null;
    }

    return saveObject.data;
  } catch (e) {
    console.error("Error al leer/decodificar archivo de prueba:", e.message);
    return null;
  }
}

function checkTrialStatus() {
  const settings = loadSettings();
  const licenseKey = settings.licenseKey;

  if (verifyLicense(licenseKey)) {
    return { active: true, message: 'Licencia activada correctamente.' };
  }

  // Si no hay licencia, check trial (3 días = 72 horas)
  const trialData = readTrialData();
  if (!trialData) {
    const firstRun = new Date();
    writeTrialData({ firstRun: firstRun.toISOString(), lastRun: firstRun.toISOString() });
    return { active: true, message: 'Periodo de prueba iniciado (3 días).' };
  }

  const firstRunDate = new Date(trialData.firstRun);
  const now = new Date();
  const diffHours = (now - firstRunDate) / (1000 * 60 * 60);

  if (diffHours > 72) {
    return { active: false, message: 'Periodo de prueba expirado.' };
  }

  const daysLeft = Math.ceil(3 - (diffHours / 24));
  return { active: true, message: `Días de prueba restantes: ${daysLeft}` };
}

// Guarda el estado de la licencia online de forma segura
function setOnlineLicense(isActive) {
  let data = readTrialData();
  const now = new Date();

  // If reading fails because of corruption, try to reset if we are activating?
  // But safer to respect null
  if (!data) {
    // Attempt to recover if we are setting Active=true? 
    // Risky, might bypass trial.
    // For now, assume trial file exists.
    data = { firstRun: now.toISOString(), lastRun: now.toISOString() };
  }

  // Agregamos/Actualizamos el campo de licencia online
  if (isActive) {
    data.onlineLicense = {
      active: true,
      activationDate: now.toISOString(),
      lastCheck: now.toISOString()
    };
  } else {
    // Only delete if it exists
    if (data.onlineLicense) delete data.onlineLicense;
  }

  writeTrialData(data);
  return true;
}

function getAppStatus() {
  const settings = loadSettings();
  const licenseKey = settings.licenseKey;

  if (verifyLicense(licenseKey)) {
    try {
      const parts = licenseKey.split('.');
      const payload = JSON.parse(Buffer.from(parts[0], 'base64').toString('utf8'));

      let planType = payload.plan || 'PREMIUM';
      let message = `NexusPOS ${planType}`;

      // Si es vitalicia, mostrar permanente
      if (payload.exp === '2099-12-31' || payload.isLifetime) {
        message += ' - Licencia Vitalicia';
      } else {
        message += ` - Activo (Expira: ${payload.exp})`;
      }

      return {
        status: 'LICENSED',
        message: message,
        plan: planType,
        expDate: payload.exp
      };
    } catch (e) {
      return { status: 'LICENSED', message: 'NexusPOS Premium - Activado' };
    }
  }

  const trial = checkTrialStatus();
  if (trial.active) {
    return { status: 'TRIAL', message: trial.message };
  }

  return { status: 'EXPIRED', message: 'Licencia Expirada' };
}

module.exports = {
  getHardwareId,
  verifyLicense,
  getAppStatus,
  setOnlineLicense
};
