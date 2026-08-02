const fs = require('fs');
const path = require('path');
const { getDataBasePath } = require('./settings');
const FormData = require('form-data');

/**
 * MÓDULO DE RESPALDO EN LA NUBE
 * 
 * Este módulo maneja:
 * - Copia de la base de datos activa
 * - Compresión del archivo
 * - Subida al servidor de respaldo remoto
 */

// URL del servidor de respaldo
// Para desarrollo local, usar: BACKUP_SERVER_URL=http://localhost:4000
const BACKUP_SERVER_URL = process.env.BACKUP_SERVER_URL || 'https://nexuspos.com.ve/respaldo';

/**
 * Crea una copia temporal de la base de datos para el respaldo
 * @returns {Promise<string>} Ruta del archivo copiado
 */
async function createDatabaseCopy() {
    return new Promise((resolve, reject) => {
        const dbPath = path.join(getDataBasePath(), 'mi-tienda.db');

        if (!fs.existsSync(dbPath)) {
            return reject(new Error('Base de datos no encontrada'));
        }

        // Crear carpeta temporal si no existe
        const tempDir = path.join(getDataBasePath(), 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Nombre del archivo temporal con timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const tempFileName = `backup_${timestamp}.db`;
        const tempFilePath = path.join(tempDir, tempFileName);

        try {
            // Copiar el archivo
            fs.copyFileSync(dbPath, tempFilePath);
            console.log('✅ Copia de base de datos creada:', tempFilePath);
            resolve(tempFilePath);
        } catch (error) {
            console.error('❌ Error al copiar base de datos:', error);
            reject(error);
        }
    });
}

/**
 * Sube el archivo de respaldo al servidor Cloud
 * @param {string} filePath - Ruta del archivo a subir
 * @param {string} token - Token de autenticación
 * @param {Function} onProgress - Callback para progreso (0-100)
 * @returns {Promise<Object>} Respuesta del servidor
 */
async function uploadBackupToCloud(filePath, token, onProgress) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(filePath)) {
            return reject(new Error('Archivo no encontrado'));
        }

        if (!token) {
            return reject(new Error('Token de autenticación requerido'));
        }

        const form = new FormData();

        form.append('backup_file', fs.createReadStream(filePath));

        const options = {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                ...form.getHeaders()
            }
        };

        const protocol = BACKUP_SERVER_URL.startsWith('https') ? require('https') : require('http');
        const url = new URL(`${BACKUP_SERVER_URL}/api/backup/upload`);

        const req = protocol.request({
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname,
            ...options
        }, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    if (res.statusCode === 200) {
                        resolve(response);
                    } else {
                        reject(new Error(response.error || 'Error al subir respaldo'));
                    }
                } catch (e) {
                    reject(new Error('Respuesta inválida del servidor'));
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        // Simular progreso (en una implementación real usarías 'progress-stream' o similar)
        let uploadedBytes = 0;
        const totalBytes = fs.statSync(filePath).size;

        form.on('data', (chunk) => {
            uploadedBytes += chunk.length;
            const progress = Math.round((uploadedBytes / totalBytes) * 100);
            if (onProgress) onProgress(progress);
        });

        form.pipe(req);
    });
}

/**
 * Limpia archivos temporales de respaldo
 * @param {string} filePath - Ruta del archivo a eliminar
 */
function cleanupTempFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log('🧹 Archivo temporal eliminado:', filePath);
        }
    } catch (error) {
        console.warn('⚠️ No se pudo eliminar archivo temporal:', error.message);
    }
}

/**
 * Proceso completo de respaldo
 * @param {string} token - Token de autenticación Cloud
 * @param {Function} onProgress - Callback para progreso
 * @returns {Promise<Object>} Resultado del respaldo
 */
async function performCloudBackup(token, onProgress) {
    let tempFilePath = null;

    try {
        // Paso 1: Crear copia
        if (onProgress) onProgress({ step: 1, message: 'Copiando base de datos...', progress: 10 });
        tempFilePath = await createDatabaseCopy();

        // Paso 2: Subir al servidor
        if (onProgress) onProgress({ step: 2, message: 'Subiendo a la nube...', progress: 30 });

        const result = await uploadBackupToCloud(tempFilePath, token, (uploadProgress) => {
            // Progreso de subida va del 30% al 90%
            const totalProgress = 30 + Math.round(uploadProgress * 0.6);
            if (onProgress) onProgress({ step: 2, message: 'Subiendo...', progress: totalProgress });
        });

        // Paso 3: Limpiar
        if (onProgress) onProgress({ step: 3, message: 'Finalizando...', progress: 95 });
        cleanupTempFile(tempFilePath);

        if (onProgress) onProgress({ step: 3, message: 'Respaldo completado', progress: 100 });

        return {
            success: true,
            message: 'Respaldo guardado exitosamente en la nube',
            filename: result.filename,
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        // Limpiar en caso de error
        if (tempFilePath) cleanupTempFile(tempFilePath);

        throw new Error(`Error en respaldo: ${error.message}`);
    }
}

/**
 * Verifica si el token Cloud es válido
 * @param {string} token - Token a verificar
 * @returns {Promise<Object>} Estado de la suscripción
 */
async function checkCloudStatus(token) {
    return new Promise((resolve, reject) => {
        if (!token) {
            return reject(new Error('Token no proporcionado'));
        }

        const protocol = BACKUP_SERVER_URL.startsWith('https') ? require('https') : require('http');
        const url = new URL(`${BACKUP_SERVER_URL}/api/backup/status`);

        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        };

        const req = protocol.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    if (res.statusCode === 200) {
                        resolve(response);
                    } else {
                        reject(new Error(response.error || 'Error al verificar estado'));
                    }
                } catch (e) {
                    reject(new Error('Respuesta inválida del servidor'));
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

module.exports = {
    performCloudBackup,
    checkCloudStatus,
    createDatabaseCopy,
    uploadBackupToCloud,
    cleanupTempFile
};
