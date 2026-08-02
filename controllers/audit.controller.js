const { db } = require('../src/database');

const getAuditLogsStmt = db.prepare(`
    SELECT a.*, u.username as usuario_nombre
    FROM audit_logs a
    LEFT JOIN usuarios u ON a.usuario_id = u.id
    ORDER BY a.fecha DESC
    LIMIT ? OFFSET ?
`);

const getAuditLogsCountStmt = db.prepare('SELECT COUNT(*) as count FROM audit_logs');

const createAuditLogStmt = db.prepare(`
    INSERT INTO audit_logs (usuario_id, accion, entidad_tipo, entidad_id, detalles_previos, detalles_nuevos)
    VALUES (@usuario_id, @accion, @entidad_tipo, @entidad_id, @detalles_previos, @detalles_nuevos)
`);

const getLogs = (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    try {
        const logs = getAuditLogsStmt.all(limit, offset);
        const total = getAuditLogsCountStmt.get().count;
        res.json({
            logs,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            totalLogs: total
        });
    } catch (error) {
        console.error('Error getting audit logs:', error);
        res.status(500).json({ error: 'Error interno obteniendo registros de auditoría' });
    }
};

const logAction = (usuario_id, accion, entidad_tipo, entidad_id, detalles_previos, detalles_nuevos) => {
    try {
        createAuditLogStmt.run({
            usuario_id,
            accion,
            entidad_tipo,
            entidad_id,
            detalles_previos: detalles_previos ? JSON.stringify(detalles_previos) : null,
            detalles_nuevos: detalles_nuevos ? JSON.stringify(detalles_nuevos) : null
        });
    } catch (error) {
        console.error('Error creating audit log:', error);
    }
};

module.exports = {
    getLogs,
    logAction
};
