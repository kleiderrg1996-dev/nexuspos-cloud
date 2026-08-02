const { loadSettings, saveSettings } = require('../src/utils/settings');
const { hashPassword, verifyPassword } = require('../src/utils/auth');

const getAuthStatus = (req, res) => {
    try {
        const settings = loadSettings();
        res.json({
            isPasswordEnabled: !!settings.adminPasswordHash
        });
    } catch (error) {
        console.error('Error al obtener estado de autenticación:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
};

const setAdminPassword = (req, res) => {
    const { currentPassword, newPassword } = req.body;
    
    try {
        const settings = loadSettings();
        
        if (settings.adminPasswordHash) {
            const isVerified = verifyPassword(currentPassword);
            if (!isVerified) {
                return res.status(403).json({ error: 'La contraseña actual es incorrecta.' });
            }
        }

        const newHash = hashPassword(newPassword);
        
        const newSettings = {
            ...settings,
            adminPasswordHash: newHash
        };
        
        if (saveSettings(newSettings)) {
            const message = newHash ? 'Contraseña de administrador actualizada.' : 'Contraseña de administrador eliminada.';
            res.json({ success: true, message: message });
        } else {
            throw new Error('No se pudo guardar la configuración.');
        }

    } catch (error) {
        console.error('Error al establecer la contraseña:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
};

const verifyAdminPassword = (req, res) => {
    const { password } = req.body;

    if (!password) {
        return res.status(400).json({ error: 'Se requiere contraseña.' });
    }

    try {
        const isVerified = verifyPassword(password);
        if (isVerified) {
            res.json({ success: true, message: 'Verificación exitosa.' });
        } else {
            res.status(403).json({ error: 'Contraseña incorrecta.' });
        }
    } catch (error) {
        console.error('Error al verificar la contraseña:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
};

module.exports = {
    getAuthStatus,
    setAdminPassword,
    verifyAdminPassword
};