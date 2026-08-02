
// ---------- Registrar Avance de Efectivo (Cash Advance) ----------
const registerCashAdvance = (req, res) => {
    try {
        const { amount_out, fee_amount, method_in, description } = req.body;

        const cashOut = parseFloat(amount_out);
        const fee = parseFloat(fee_amount);
        const totalIn = cashOut + fee;

        if (!cashOut || cashOut <= 0) {
            return res.status(400).json({ error: 'El monto a entregar debe ser mayor a 0.' });
        }
        if (fee < 0) {
            return res.status(400).json({ error: 'La comisión no puede ser negativa.' });
        }
        if (!method_in) {
            return res.status(400).json({ error: 'Debe especificar el método de cobro.' });
        }

        const bcv = getBcvRate() || 1;

        // Transacción para asegurar integridad
        const tx = db.transaction(() => {
            // 1. Crear Venta (Ingreso Digital)
            // Como es un servicio, podemos poner cliente NULL o uno genérico "Mostrador"
            // Insertamos venta
            const insertSale = db.prepare(`
        INSERT INTO ventas (total_ves, total_usd_bcv, estado_pago, monto_pendiente_usd, creado_en)
        VALUES (?, ?, 'PAGADO', 0, datetime('now', 'localtime'))
      `);
            const saleInfo = insertSale.run(totalIn, totalIn / bcv);
            const saleId = saleInfo.lastInsertRowid;

            // Insertar producto abstracto "Avance de Efectivo"
            // Usamos costo = cashOut para que la ganancia refleje solo el fee
            const insertSaleProduct = db.prepare(`
        INSERT INTO venta_productos (venta_id, producto_id, cantidad, precio_unitario_ves, costo_unitario_ves)
        VALUES (?, NULL, 1, ?, ?)
      `);
            insertSaleProduct.run(saleId, totalIn, cashOut);

            // Insertar pago recibido (Total cobrado)
            const insertPayment = db.prepare(`
        INSERT INTO venta_pagos (venta_id, metodo, monto_recibido, monto_en_ves, tasa_bcv_momento)
        VALUES (?, ?, ?, ?, ?)
      `);
            // Asumimos que el método es digital (TARJETA/PAGOMOVIL/USD_EFECTIVO?)
            // Si es USD_EFECTIVO, el monto_recibido sería en USD?
            // Por simplicidad, asumimos que el input viene en operacion VES principal.
            // Si method_in es USD_EFECTIVO, totalIn es VES, convertimos?
            // El frontend debe mandar el método correcto.
            insertPayment.run(saleId, method_in, totalIn, totalIn, bcv);

            // 2. Crear Retiro de Caja (Salida Física)
            // Asumimos que entregamos VES_EFECTIVO. Si se permitiera entregar USD, habría que añadir lógica.
            // Por defecto, "Avance de efectivo" suele ser dar Bolívares.
            let monto_ves_retiro = cashOut;
            let monto_usd_retiro = cashOut / bcv;

            const insertRetiro = db.prepare(`
        INSERT INTO retiros_caja (metodo, monto_ves, monto_usd, descripcion, fecha)
        VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
      `);

            const descFinal = description ? `${description} (Venta #${saleId})` : `Avance de Efectivo (Venta #${saleId})`;
            insertRetiro.run('VES_EFECTIVO', monto_ves_retiro, monto_usd_retiro, descFinal);

            return { saleId, totalIn, cashOut, fee };
        });

        const result = tx();
        res.json({ success: true, ...result });

    } catch (error) {
        console.error('Error registrando avance de efectivo:', error);
        res.status(500).json({ error: 'Error interno al procesar el avance.' });
    }
};
