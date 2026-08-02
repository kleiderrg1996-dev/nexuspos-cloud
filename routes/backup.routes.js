const express = require('express');
const router = express.Router();
const { performCloudBackup, checkCloudStatus } = require('../src/utils/cloudBackup');

/**
 * POST /api/backup/cloud
 * Inicia un respaldo en la nube
 * 
 * Body: { token: "jwt_token_cloud" }
 */
router.post('/cloud', async (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({
            success: false,
            error: 'Token de Cloud Backup requerido'
        });
    }

    try {
        // Primero verificar que la suscripción esté activa
        const status = await checkCloudStatus(token);

        if (!status.active) {
            return res.status(402).json({
                success: false,
                error: 'Suscripción Cloud inactiva o expirada'
            });
        }

        // Realizar el respaldo
        const result = await performCloudBackup(token, (progress) => {
            // En una app real, usarías WebSockets o Server-Sent Events para progreso en tiempo real
            // Por ahora solo logueamos
            console.log(`Progreso respaldo: ${progress.progress}% - ${progress.message}`);
        });

        res.json({
            success: true,
            message: result.message,
            filename: result.filename,
            timestamp: result.timestamp
        });

    } catch (error) {
        console.error('Error en respaldo Cloud:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Error al realizar respaldo'
        });
    }
});

/**
 * GET /api/backup/cloud/status
 * Verifica el estado de la suscripción Cloud
 * 
 * Query: ?token=jwt_token_cloud
 */
router.get('/cloud/status', async (req, res) => {
    const token = req.query.token || req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(400).json({
            success: false,
            error: 'Token requerido'
        });
    }

    try {
        const status = await checkCloudStatus(token);
        res.json({
            success: true,
            ...status
        });
    } catch (error) {
        console.error('Error verificando estado Cloud:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/backup/cloud/save-token
 * Guarda el token Cloud en business-settings.json para respaldos automáticos
 */
router.post('/cloud/save-token', async (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ error: 'Token requerido' });
    }

    try {
        const { getDataBasePath } = require('../src/utils/settings');
        const settingsPath = require('path').join(getDataBasePath(), 'business-settings.json');
        const fs = require('fs');

        let settings = {};
        if (fs.existsSync(settingsPath)) {
            const content = fs.readFileSync(settingsPath, 'utf-8');
            settings = JSON.parse(content);
        }

        settings.cloudBackupToken = token;

        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

        res.json({ success: true, message: 'Token guardado para respaldos automáticos' });
    } catch (error) {
        console.error('Error guardando token Cloud:', error);
        res.status(500).json({ error: 'Error al guardar configuración' });
    }
});

/**
 * DELETE /api/backup/cloud/remove-token
 * Elimina el token Cloud de business-settings.json
 */
router.delete('/cloud/remove-token', async (req, res) => {
    try {
        const { getDataBasePath } = require('../src/utils/settings');
        const settingsPath = require('path').join(getDataBasePath(), 'business-settings.json');
        const fs = require('fs');

        if (fs.existsSync(settingsPath)) {
            const content = fs.readFileSync(settingsPath, 'utf-8');
            const settings = JSON.parse(content);

            delete settings.cloudBackupToken;

            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
        }

        res.json({ success: true, message: 'Token eliminado' });
    } catch (error) {
        console.error('Error eliminando token Cloud:', error);
        res.status(500).json({ error: 'Error al eliminar configuración' });
    }
});

/**
 * POST /api/backup/cloud/restore
 * Descarga un respaldo del servidor Cloud y restaura la base de datos local
 * 
 * Body: { token: "jwt_token", filename: "backup_xxx.db" }
 */
router.post('/cloud/restore', async (req, res) => {
    const { token, filename } = req.body;

    if (!token || !filename) {
        return res.status(400).json({ error: 'Token y filename requeridos' });
    }

    try {
        const { getDataBasePath } = require('../src/utils/settings');
        const fs = require('fs');
        const path = require('path');
        const https = require('https');
        const http = require('http');

        // URL del servidor cloud (Para desarrollo: BACKUP_SERVER_URL=http://localhost:4000)
        const CLOUD_URL = process.env.BACKUP_SERVER_URL || 'https://nexuspos.com.ve/respaldo';
        const downloadUrl = `${CLOUD_URL}/api/backup/download/${encodeURIComponent(filename)}`;

        const dbPath = path.join(getDataBasePath(), 'mi-tienda.db');
        const backupPath = path.join(getDataBasePath(), `mi-tienda-backup-${Date.now()}.db`);
        const tempPath = path.join(getDataBasePath(), 'temp', `restore-${Date.now()}.db`);

        // Crear carpeta temp si no existe
        const tempDir = path.dirname(tempPath);
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        console.log('🔄 Iniciando restauración de backup:', filename);

        // Paso 1: Descargar el archivo del servidor cloud
        const protocol = CLOUD_URL.startsWith('https') ? https : http;
        const url = new URL(downloadUrl);

        const downloadPromise = new Promise((resolve, reject) => {
            const fileStream = fs.createWriteStream(tempPath);

            const request = protocol.get({
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname,
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`Error descargando: ${response.statusCode}`));
                    return;
                }

                response.pipe(fileStream);

                fileStream.on('finish', () => {
                    fileStream.close();
                    resolve();
                });
            });

            request.on('error', reject);
            fileStream.on('error', reject);
        });

        await downloadPromise;
        console.log('✅ Archivo descargado:', tempPath);

        // Paso 2: Verificar que el archivo descargado es válido (al menos que exista y tenga tamaño)
        const stats = fs.statSync(tempPath);
        if (stats.size < 1000) {
            fs.unlinkSync(tempPath);
            return res.status(400).json({ error: 'El archivo descargado está vacío o es inválido' });
        }

        // Paso 3: Crear backup del archivo actual
        if (fs.existsSync(dbPath)) {
            fs.copyFileSync(dbPath, backupPath);
            console.log('✅ Backup del archivo actual creado:', backupPath);
        }

        // Paso 4: Cerrar la base de datos actual (CRÍTICO para Windows)
        try {
            const { closeDatabase } = require('../src/database');
            if (typeof closeDatabase === 'function') {
                closeDatabase();
                console.log('✅ Base de datos cerrada');
            } else {
                console.warn('⚠️ closeDatabase no es una función, chequea src/database.js');
            }
        } catch (e) {
            console.warn('⚠️ No se pudo cerrar la base de datos:', e.message);
        }

        // Paso 5: Reemplazar el archivo
        fs.copyFileSync(tempPath, dbPath);
        console.log('✅ Archivo de base de datos reemplazado');

        // Paso 6: Reabrir la conexión a la base de datos
        try {
            const { reopenDatabase } = require('../src/database');
            if (typeof reopenDatabase === 'function') {
                reopenDatabase();
                console.log('✅ Base de datos reabierta');
            }
        } catch (e) {
            console.warn('⚠️ No se pudo reabrir la base de datos:', e.message);
        }

        // Paso 7: Limpiar archivo temporal
        fs.unlinkSync(tempPath);

        res.json({
            success: true,
            message: 'Base de datos restaurada exitosamente. La aplicación está lista para usar.',
            backupCreated: backupPath,
            needsRestart: true // Señal para que el cliente solicite reinicio total
        });

    } catch (error) {
        console.error('❌ Error en restauración:', error);
        res.status(500).json({
            error: error.message || 'Error al restaurar backup',
            details: 'Verifica que el servidor de respaldo esté disponible'
        });
    }
});

module.exports = router;
