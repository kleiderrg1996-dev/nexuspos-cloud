const axios = require('axios');
const { getHardwareId, verifyLicense, getAppStatus, setOnlineLicense } = require('../src/utils/license');
const { loadSettings, saveSettings, getDataBasePath } = require('../src/utils/settings');
const fs = require('fs');
const path = require('path');

// URL del servidor de licencias (ajustar si cambia el dominio o ruta)
// Se usa /admin-licencias/api porque la app Node parece estar montada en esa ruta base
const LICENSE_API_URL = 'https://nexuspos.com.ve/admin-licencias/api/check-license';
const REDEEM_API_URL = 'https://nexuspos.com.ve/admin-licencias/api/redeem-token';

const getLicenseInfo = async (req, res) => {
    try {
        console.log('[LICENSE] Obteniendo info de licencia...');
        const hardwareId = getHardwareId();
        const appStatus = getAppStatus();
        console.log('[LICENSE] Info obtenida:', appStatus.status);

        res.json({
            hardwareId: hardwareId,
            status: appStatus.status,
            message: appStatus.message
        });
    } catch (error) {
        console.error('[LICENSE] Error en getLicenseInfo:', error);
        res.status(500).json({ error: 'Error interno obteniendo información de licencia.' });
    }
};

const activateLicense = async (req, res) => {
    const { licenseKey } = req.body;
    if (!licenseKey) return res.status(400).json({ error: 'Llave de licencia requerida.' });

    if (verifyLicense(licenseKey)) {
        const settings = loadSettings();
        settings.licenseKey = licenseKey;
        saveSettings(settings);
        res.json({ success: true, message: '¡NexusPOS Premium activado exitosamente!' });
    } else {
        res.status(400).json({ success: false, error: 'Llave de licencia inválida para este equipo o expirada.' });
    }
};

const redeemToken = async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token de activación requerido.' });

    try {
        const hardwareId = getHardwareId();

        // Llamar al servidor de licencias
        const response = await axios.post(REDEEM_API_URL, {
            token: token,
            hwid: hardwareId
        });

        if (response.data && response.data.success) {
            const { licenseKey } = response.data;

            // Guardar localmente
            const settings = loadSettings();
            settings.licenseKey = licenseKey;
            saveSettings(settings);

            res.json({
                success: true,
                message: response.data.message || '¡NexusPOS Premium activado exitosamente!',
                plan: response.data.plan,
                expDate: response.data.expDate
            });
        } else {
            res.status(400).json({
                success: false,
                error: response.data?.error || 'No se pudo canjear el token.'
            });
        }
    } catch (error) {
        console.error('Error redeeming token:', error.response?.data || error.message);
        const errorMsg = error.response?.data?.error || 'Error al conectar con el servidor de licencias.';
        res.status(error.response?.status || 500).json({ error: errorMsg });
    }
};

const syncLicenseContact = async (req, res) => {
    try {
        const { whatsapp, email } = req.body;
        console.log(`[LICENSE] Intento de sincronización de contacto: ${email || 'N/A'}, ${whatsapp || 'N/A'}`);

        res.json({
            success: true,
            message: 'Información de contacto recibida correctamente.'
        });
    } catch (error) {
        console.error('Error in syncLicenseContact:', error);
        res.status(500).json({ error: 'Error interno sincronizando contacto de licencia.' });
    }
};

module.exports = {
    getLicenseInfo,
    activateLicense,
    redeemToken,
    syncLicenseContact
};
