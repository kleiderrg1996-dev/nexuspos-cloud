const database = require('../src/database');
const { hashPassword } = require('../src/utils/auth');
const crypto = require('crypto');

// Helper para obtener db de forma segura
const getDb = () => database.db;

const login = (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Usuario y contraseña son requeridos.' });
    }

    try {
        const user = getDb().prepare("SELECT * FROM usuarios WHERE username = ? AND activo = 1").get(username);
        console.log(`[AUTH] Intento de login para usuario: ${username}`);

        if (!user) {
            console.warn(`[AUTH] Usuario no encontrado o inactivo: ${username}`);
            return res.status(401).json({ error: 'Credenciales inválidas.' });
        }

        const inputHash = hashPassword(password);
        if (inputHash !== user.password_hash) {
            console.warn(`[AUTH] Hash no coincide para usuario: ${username}`);
            return res.status(401).json({ error: 'Credenciales inválidas.' });
        }

        // --- VERIFICACIÓN DE SESIÓN CONCURRENTE ---
        if (user.current_session_token && user.last_active_at) {
            const lastActive = parseInt(user.last_active_at) || 0;
            const now = Date.now();
            const diffSeconds = (now - lastActive) / 1000;

            // Si la última actividad fue hace menos de 45 segundos (margen para evitar falsos positivos con pulso de 15s)
            // bloqueamos el acceso.
            if (diffSeconds > 0 && diffSeconds < 45) {
                console.warn(`[AUTH] Sesión activa detectada para: ${username} (hace ${diffSeconds.toFixed(1)} seg)`);
                return res.status(403).json({
                    error: 'Sesión activa detectada en otro dispositivo. Por favor, cierra la sesión allá o espera 1 minuto de inactividad.'
                });
            }
        }

        const sessionToken = crypto.randomUUID();

        // Actualizar token y actividad en DB usando TIMESTAMP UTC (Date.now())
        getDb().prepare("UPDATE usuarios SET current_session_token = ?, last_active_at = ? WHERE id = ?")
            .run(sessionToken, Date.now(), user.id);

        console.log(`[AUTH] Login exitoso para: ${username}. Nueva sesión: ${sessionToken}`);

        // --- ESTABLECER COOKIE DE SESIÓN httpOnly ---
        res.cookie('nexuspos_token', sessionToken, {
            httpOnly: true,    // JS del navegador NO puede leerla
            sameSite: 'Strict', // Solo se envía en el mismo dominio
            secure: process.env.NODE_ENV === 'production' // Solo HTTPS en producción
        });

        res.json({
            success: true,
            sessionToken: sessionToken,
            user: {
                id: user.id,
                username: user.username,
                nombre: user.nombre,
                rol: user.rol
            }
        });

    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

const logout = (req, res) => {
    const { userId } = req.body;
    try {
        getDb().prepare("UPDATE usuarios SET current_session_token = NULL, last_active_at = NULL WHERE id = ?").run(userId);
        // Borrar la cookie del servidor
        res.clearCookie('nexuspos_token', { httpOnly: true, sameSite: 'Strict' });
        res.json({ success: true });
    } catch (error) {
        console.error('Error en logout:', error);
        res.status(500).json({ error: 'Error al cerrar sesión.' });
    }
};

const pulse = (req, res) => {
    const sessionToken = req.headers['x-session-token'];
    if (!sessionToken) return res.status(401).json({ error: 'No token provided' });

    try {
        const result = getDb().prepare("UPDATE usuarios SET last_active_at = ? WHERE current_session_token = ?").run(Date.now(), sessionToken);
        if (result.changes === 0) {
            return res.status(401).json({ error: 'Sesión inválida o expirada.' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error en pulse:', error);
        res.status(500).json({ error: 'Error de servidor.' });
    }
};

const getUsers = (req, res) => {
    try {
        const users = getDb().prepare("SELECT id, username, nombre, rol, activo, creado_en FROM usuarios").all();
        res.json(users);
    } catch (error) {
        console.error('Error al obtener usuarios:', error);
        res.status(500).json({ error: 'Error al obtener usuarios.' });
    }
};

const createUser = (req, res) => {
    const { username, password, nombre, rol } = req.body;

    if (!username || !password || !rol) {
        return res.status(400).json({ error: 'Usuario, contraseña y rol son requeridos.' });
    }

    try {
        const hashed = hashPassword(password);
        getDb().prepare("INSERT INTO usuarios (username, password_hash, nombre, rol) VALUES (?, ?, ?, ?)").run(username, hashed, nombre, rol);
        res.json({ success: true, message: 'Usuario creado con éxito.' });
    } catch (error) {
        if (error.message.includes('UNIQUE constraint failed: usuarios.username')) {
            return res.status(400).json({ error: 'El nombre de usuario ya existe.' });
        }
        console.error('Error al crear usuario:', error);
        res.status(500).json({ error: 'Error al crear el usuario.' });
    }
};

const deleteUser = (req, res) => {
    const { id } = req.params;

    try {
        // No permitir borrar al admin principal con ID 1 (opcional, pero recomendado)
        if (id == 1) {
            return res.status(403).json({ error: 'No se puede eliminar el administrador principal.' });
        }

        getDb().prepare("DELETE FROM usuarios WHERE id = ?").run(id);
        res.json({ success: true, message: 'Usuario eliminado.' });
    } catch (error) {
        console.error('Error al eliminar usuario:', error);
        res.status(500).json({ error: 'Error al eliminar el usuario.' });
    }
};

const updateUserPassword = (req, res) => {
    const { id } = req.params;
    const { password } = req.body;

    if (!password) {
        return res.status(400).json({ error: 'La contraseña es requerida.' });
    }

    try {
        const hashed = hashPassword(password);
        const result = getDb().prepare("UPDATE usuarios SET password_hash = ? WHERE id = ?").run(hashed, id);
        
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }
        
        res.json({ success: true, message: 'Contraseña actualizada con éxito.' });
    } catch (error) {
        console.error('Error al actualizar contraseña:', error);
        res.status(500).json({ error: 'Error al actualizar la contraseña.' });
    }
};

const checkAuth = (req, res) => {
    // Simulación de verificación de sesión (el frontend manejará el token/estado)
    res.json({ authenticated: true });
};

module.exports = {
    login,
    logout,
    pulse,
    checkAuth,
    getUsers,
    createUser,
    updateUserPassword,
    deleteUser
};
