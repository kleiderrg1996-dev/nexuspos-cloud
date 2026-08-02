const { db } = require('../src/database');

const getKardex = (req, res) => {
    const { producto_id, producto_search, fecha_inicio, fecha_fin, tipo, motivo, limit = 100, offset = 0 } = req.query;

    try {
        let query = `
      SELECT k.*, p.nombre as producto_nombre, p.barcode
      FROM kardex k
      JOIN productos p ON k.producto_id = p.id
      WHERE 1=1
    `;
        const params = [];

        if (producto_id) {
            query += ` AND k.producto_id = ?`;
            params.push(producto_id);
        }

        if (producto_search) {
            query += ` AND (p.nombre LIKE ? OR p.barcode LIKE ?)`;
            params.push(`%${producto_search}%`);
            params.push(`%${producto_search}%`);
        }

        if (fecha_inicio) {
            query += ` AND k.fecha >= ?`;
            params.push(fecha_inicio);
        }

        if (fecha_fin) {
            query += ` AND k.fecha <= ?`;
            params.push(fecha_fin);
        }

        if (tipo) {
            query += ` AND k.tipo = ?`;
            params.push(tipo);
        }

        if (motivo) {
            query += ` AND k.motivo = ?`;
            params.push(motivo);
        }

        query += ` ORDER BY k.fecha DESC, k.id DESC LIMIT ? OFFSET ?`;
        params.push(parseInt(limit, 10));
        params.push(parseInt(offset, 10));

        const movements = db.prepare(query).all(...params);
        console.log(`Kardex fetch: found ${movements.length} rows for params:`, params);

        // Count for pagination
        let countQuery = `
            SELECT COUNT(*) as total 
            FROM kardex k 
            JOIN productos p ON k.producto_id = p.id
            WHERE 1=1
        `;
        const countParams = [];
        if (producto_id) { countQuery += ` AND k.producto_id = ?`; countParams.push(producto_id); }
        if (producto_search) {
            countQuery += ` AND (p.nombre LIKE ? OR p.barcode LIKE ?)`;
            countParams.push(`%${producto_search}%`);
            countParams.push(`%${producto_search}%`);
        }
        if (fecha_inicio) { countQuery += ` AND k.fecha >= ?`; countParams.push(fecha_inicio); }
        if (fecha_fin) { countQuery += ` AND k.fecha <= ?`; countParams.push(fecha_fin); }
        if (tipo) { countQuery += ` AND k.tipo = ?`; countParams.push(tipo); }
        if (motivo) { countQuery += ` AND k.motivo = ?`; countParams.push(motivo); }

        const total = db.prepare(countQuery).get(...countParams).total;

        res.json({
            success: true,
            data: movements,
            pagination: {
                total,
                limit: parseInt(limit, 10),
                offset: parseInt(offset, 10)
            }
        });
    } catch (error) {
        console.error('Error fetching Kardex:', error);
        res.status(500).json({ success: false, message: 'Error interno al obtener el Kardex.' });
    }
};

module.exports = {
    getKardex
};
