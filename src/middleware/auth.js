const database = require('../database');

const authMiddleware = (req, res, next) => {
    // Lista de rutas públicas que no requieren autenticación
    const publicPaths = [
        '/login.html',
        '/api/manage-users/login',
        '/css/',
        '/js/',
        '/favicon.ico',
        '/uploads/'
    ];

    const isPublic = publicPaths.some(path => req.path.startsWith(path));

    if (isPublic) {
        return next();
    }

    // Solo aplicar validación de token a rutas de la API
    // Las rutas de HTML se dejan pasar para que el frontend maneje la redirección si no hay sesión
    if (!req.path.startsWith('/api/')) {
        return next();
    }

    // Verificación de token de sesión para peticiones a la API
    const sessionToken = req.headers['x-session-token'];

    if (!sessionToken) {
        console.warn(`[AUTH] Intento de acceso sin token a: ${req.path}`);
        return res.status(401).json({ error: 'No autorizado. Token de sesión faltante.' });
    }

    try {
        const db = database.db;
        const user = db.prepare("SELECT id FROM usuarios WHERE current_session_token = ? AND activo = 1").get(sessionToken);

        if (!user) {
            console.warn(`[AUTH] Token de sesión inválido or expirado: ${sessionToken}`);
            return res.status(401).json({ error: 'Sesión inválida o expirada. Por favor, inicie sesión de nuevo.' });
        }

        // Token válido, guardamos el ID del usuario en el request por si se necesita
        req.userId = user.id;
        next();
    } catch (error) {
        console.error('Error en authMiddleware:', error);
        res.status(500).json({ error: 'Error interno de autenticación.' });
    }
};

module.exports = authMiddleware;
