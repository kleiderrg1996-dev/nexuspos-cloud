const crypto = require('crypto');
const { loadSettings } = require('./settings');

const HASH_SECRET = 'nexuspos-super-secreto-para-passwords-2024!';

function hashPassword(password) {
    if (!password) return null;
    return crypto.createHmac('sha256', HASH_SECRET).update(password).digest('hex');
}

function verifyPassword(inputPassword) {
    const settings = loadSettings();
    const storedHash = settings.adminPasswordHash;

    if (!storedHash) {
        console.log("Verificación omitida: No hay contraseña de administrador configurada.");
        return true;
    }
    
    if (!inputPassword) {
        console.log("Verificación fallida: Se requiere contraseña.");
        return false;
    }

    const inputHash = hashPassword(inputPassword);
    
    if (inputHash !== storedHash) {
        console.log("Verificación fallida: Contraseña incorrecta.");
        return false;
    }

    console.log("Verificación exitosa.");
    return true;
}

module.exports = {
    hashPassword,
    verifyPassword
};