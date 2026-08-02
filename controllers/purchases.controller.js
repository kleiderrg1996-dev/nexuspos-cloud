const { db } = require('../src/database');

function getLocalDateStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

const createPurchase = (req, res) => {
    const { 
        proveedor_id, 
        numero_factura, 
        numero_control, 
        total_exento, 
        base_imponible_16, 
        iva_16, 
        base_imponible_8, 
        iva_8, 
        base_imponible_31, 
        iva_31, 
        total_compra, 
        moneda, 
        tasa_bcv, 
        fecha,
        tipo_pago,
        items 
    } = req.body;

    const usuario_id = req.body.usuario_id;

    if (!proveedor_id || !numero_factura || !numero_control || !items || items.length === 0) {
        return res.status(400).json({ error: 'Faltan datos obligatorios para la compra' });
    }

    try {
        const purchaseId = db.transaction(() => {
            // 1. Insertar la compra
            const stmtCompra = db.prepare(`
                INSERT INTO compras (
                    proveedor_id, usuario_id, numero_factura, numero_control, 
                    total_exento, base_imponible_16, iva_16, base_imponible_8, 
                    iva_8, base_imponible_31, iva_31, total_compra, moneda, tasa_bcv,
                    monto_total_usd, monto_pendiente_ves, monto_pendiente_usd,
                    fecha, estado
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const bcv = tasa_bcv || 1;
            const monedaFinal = moneda || 'VES';
            const esCredito = tipo_pago === 'CREDITO';
            const estado = esCredito ? 'PENDIENTE' : 'COMPLETADO';

            const montoTotalUsd = (monedaFinal === 'USD') ? (total_compra || 0) : ((total_compra || 0) / bcv);

            let monto_pendiente_ves = 0, monto_pendiente_usd = 0;
            if (esCredito) {
                if (monedaFinal === 'USD') {
                    monto_pendiente_usd = total_compra || 0;
                    monto_pendiente_ves = (total_compra || 0) * bcv;
                } else {
                    monto_pendiente_ves = total_compra || 0;
                    monto_pendiente_usd = (total_compra || 0) / bcv;
                }
            }

            const resultCompra = stmtCompra.run(
                proveedor_id,
                usuario_id || null,
                numero_factura,
                numero_control,
                total_exento || 0,
                base_imponible_16 || 0,
                iva_16 || 0,
                base_imponible_8 || 0,
                iva_8 || 0,
                base_imponible_31 || 0,
                iva_31 || 0,
                total_compra,
                monedaFinal,
                bcv,
                montoTotalUsd,
                monto_pendiente_ves,
                monto_pendiente_usd,
                fecha || getLocalDateStr(),
                estado
            );

            const compraId = resultCompra.lastInsertRowid;

            // 2. Insertar detalles y actualizar stock
            const stmtDetalle = db.prepare(`
                INSERT INTO compras_detalle (
                    compra_id, producto_id, cantidad, costo_unitario, total_linea
                ) VALUES (?, ?, ?, ?, ?)
            `);


            const stmtStock = db.prepare(`
                UPDATE productos 
                SET stock = stock + ?, costo = ?, moneda_costo = ?
                WHERE id = ?
            `);

            const stmtKardex = db.prepare(`
                INSERT INTO kardex (
                    producto_id, tipo, cantidad, motivo, referencia_id, stock_anterior, stock_nuevo
                ) VALUES (?, 'ENTRADA', ?, ?, ?, ?, ?)
            `);

            for (const item of items) {
                const costo = item.costo_unitario || 0;
                const totalLinea = item.total_linea || (item.cantidad * costo);

                stmtDetalle.run(
                    compraId,
                    item.producto_id,
                    item.cantidad,
                    costo,
                    totalLinea
                );

                const producto = db.prepare('SELECT stock, costo, moneda_costo FROM productos WHERE id = ?').get(item.producto_id);
                if (producto) {
                    const stockAnterior = producto.stock;
                    const stockActual = stockAnterior + item.cantidad;

                    let costoActualizar = costo;
                    let monedaActualizar = producto.moneda_costo || 'VES';
                    if (monedaActualizar === 'USD') monedaActualizar = 'BCV';

                    if (monedaFinal === 'USD' && monedaActualizar !== 'VES') {
                        costoActualizar = costo;
                    } else if (monedaFinal === 'USD' && monedaActualizar === 'VES') {
                        costoActualizar = costo * bcv;
                    } else if (monedaFinal !== 'USD' && monedaActualizar === 'VES') {
                        costoActualizar = costo;
                    } else if (monedaFinal !== 'USD' && (monedaActualizar === 'BCV' || monedaActualizar === 'PARALELO')) {
                        costoActualizar = costo / bcv;
                    }

                    stmtStock.run(item.cantidad, costoActualizar, monedaActualizar, item.producto_id);

                    stmtKardex.run(
                        item.producto_id,
                        item.cantidad,
                        `COMPRA - FACT: ${numero_factura}`,
                        compraId,
                        stockAnterior,
                        stockActual
                    );
                }
            }


            return compraId;
        })();

        res.status(201).json({ 
            success: true, 
            message: 'Compra registrada con éxito', 
            compra_id: purchaseId 
        });

    } catch (error) {
        console.error('Error al registrar compra:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor al procesar la compra',
            details: error.message,
            stack: error.stack
        });
    }
};

const getPurchases = (req, res) => {
    const { fecha_inicio, fecha_fin, numero_factura } = req.query;
    try {
        let sql = `
            SELECT c.*, p.nombre as proveedor_nombre 
            FROM compras c
            JOIN proveedores p ON c.proveedor_id = p.id
            WHERE 1=1
        `;
        const params = [];

        if (fecha_inicio) {
            sql += ` AND date(c.fecha) >= ?`;
            params.push(fecha_inicio);
        }
        if (fecha_fin) {
            sql += ` AND date(c.fecha) <= ?`;
            params.push(fecha_fin);
        }
        if (numero_factura) {
            sql += ` AND (c.numero_factura LIKE ? OR p.rif LIKE ? OR p.nombre LIKE ?)`;
            const searchTerm = `%${numero_factura}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }

        sql += ` ORDER BY c.fecha DESC`;

        const purchases = db.prepare(sql).all(params);
        res.json({ success: true, data: purchases });
    } catch (error) {

        console.error('Error al obtener compras:', error);
        res.status(500).json({ error: 'Error al obtener listado de compras' });
    }
};

const getLibroCompras = (req, res) => {
    const { mes, anio } = req.query;

    if (!mes || !anio) {
        return res.status(400).json({ error: 'Mes y año son requeridos' });
    }

    const fechaInicio = `${anio}-${mes.toString().padStart(2, '0')}-01 00:00:00`;
    let proximoMes = parseInt(mes) + 1;
    let proximoAnio = parseInt(anio);
    
    if (proximoMes > 12) {
        proximoMes = 1;
        proximoAnio++;
    }
    const fechaFin = `${proximoAnio}-${proximoMes.toString().padStart(2, '0')}-01 00:00:00`;

    try {
        const report = db.prepare(`
            SELECT 
                fecha as fecha_compra,
                numero_factura,
                numero_control,
                p.nombre as proveedor_nombre,
                p.rif as proveedor_rif,
                total_exento,
                base_imponible_16,
                iva_16,
                base_imponible_8,
                iva_8,
                base_imponible_31,
                iva_31,
                total_compra
            FROM compras c
            JOIN proveedores p ON c.proveedor_id = p.id
            WHERE c.fecha >= ? AND c.fecha < ?
            ORDER BY c.fecha ASC
        `).all(fechaInicio, fechaFin);


        res.json({ success: true, data: report });
    } catch (error) {
        console.error('Error al generar libro de compras:', error);
        res.status(500).json({ error: 'Error al generar libro de compras' });
    }
};

const getPurchaseDetails = (req, res) => {
    const { id } = req.params;
    try {
        const purchase = db.prepare(`
            SELECT c.*, p.nombre as proveedor_nombre, p.rif as proveedor_rif, p.direccion as proveedor_direccion, p.telefono as proveedor_telefono
            FROM compras c
            JOIN proveedores p ON c.proveedor_id = p.id
            WHERE c.id = ?
        `).get(id);

        if (!purchase) {
            return res.status(404).json({ error: 'Compra no encontrada' });
        }

        const items = db.prepare(`
            SELECT cd.*, p.nombre as producto_nombre, p.barcode
            FROM compras_detalle cd
            JOIN productos p ON cd.producto_id = p.id
            WHERE cd.compra_id = ?
        `).all(id);

        res.json({ success: true, data: { ...purchase, items } });
    } catch (error) {
        console.error('Error al obtener detalles de compra:', error);
        res.status(500).json({ error: 'Error al obtener detalles de la compra' });
    }
};

const deletePurchase = (req, res) => {
    try {
        const { id } = req.params;

        const compra = db.prepare('SELECT * FROM compras WHERE id = ?').get(id);
        if (!compra) return res.status(404).json({ error: 'Compra no encontrada' });

        const detalles = db.prepare('SELECT * FROM compras_detalle WHERE compra_id = ?').all(id);

        const transaction = db.transaction(() => {
            for (const det of detalles) {
                const producto = db.prepare('SELECT stock FROM productos WHERE id = ?').get(det.producto_id);
                if (producto) {
                    const nuevoStock = Math.max(0, producto.stock - det.cantidad);
                    db.prepare('UPDATE productos SET stock = ? WHERE id = ?').run(nuevoStock, det.producto_id);

                    db.prepare(`
                        INSERT INTO kardex (producto_id, tipo, cantidad, motivo, referencia_id, stock_anterior, stock_nuevo)
                        VALUES (?, 'SALIDA', ?, 'ELIMINACION DE COMPRA', ?, ?, ?)
                    `).run(det.producto_id, det.cantidad, id, producto.stock, nuevoStock);
                }
            }

            db.prepare('DELETE FROM compras_detalle WHERE compra_id = ?').run(id);
            db.prepare('DELETE FROM compras_abonos WHERE compra_id = ?').run(id);
            db.prepare('DELETE FROM compras WHERE id = ?').run(id);
        });

        transaction();
        res.json({ success: true, message: 'Compra eliminada y stock revertido' });
    } catch (error) {
        console.error('Error al eliminar compra:', error);
        res.status(500).json({ error: 'Error al eliminar la compra' });
    }
};

module.exports = {
    createPurchase,
    getPurchases,
    getLibroCompras,
    getPurchaseDetails,
    deletePurchase
};