// controllers/client.controller.js
const { db, getBcvRate, getPreferredRate } = require('../src/database');
const fastcsv = require('fast-csv');
// Importamos el recalculador de ventas (única fuente de verdad)
const { recalcSalePendingAndStatus } = require('./sales.controller');

// ======== STATEMENTS Y HELPERS DE BD ========

// Tasa BCV
const getRatesStmt = db.prepare(`
  SELECT key, value
  FROM settings
  WHERE key = 'BCV'
`);

// Clientes
const listClientsStmt = db.prepare(`
  SELECT id, nombre, cedula, telefono, direccion, activo
  FROM clientes
  WHERE activo = 1
    AND (nombre LIKE @term OR cedula LIKE @term)
  ORDER BY nombre ASC
`);

const getClientByIdStmt = db.prepare(`
  SELECT id, nombre, cedula, telefono, direccion, activo
  FROM clientes
  WHERE id = ?
`);

const insertClientStmt = db.prepare(`
  INSERT INTO clientes (nombre, cedula, telefono, direccion, activo)
  VALUES (@nombre, @cedula, @telefono, @direccion, 1)
`);

const updateClientStmt = db.prepare(`
  UPDATE clientes
  SET nombre = @nombre,
      cedula = @cedula,
      telefono = @telefono,
      direccion = @direccion
  WHERE id = @id
`);

const softDeleteClientStmt = db.prepare(`
  UPDATE clientes
  SET activo = 0
  WHERE id = ?
`);

// 🔴 NUEVO: Ventas abiertas (FIADO/ABONADO) por cliente, usando monto_pendiente_usd
const getClientOpenSalesStmt = db.prepare(`
  SELECT
    id,
    cliente_id,
    creado_en,
    total_usd_bcv,
    monto_pendiente_usd,
    estado_pago,
    tasa_referencia
  FROM ventas
  WHERE cliente_id = ?
    AND estado_pago IN ('FIADO', 'ABONADO')
    AND IFNULL(monto_pendiente_usd, 0) > 0
  ORDER BY creado_en ASC
`);

// Abonos
const insertAbonoStmt = db.prepare(`
  INSERT INTO abonos (
    cliente_id,
    venta_id,
    monto_pagado_ves,
    monto_pagado_usd,
    tasa_bcv_momento,
    metodo,
    usuario_id,
    referencia
  )
  VALUES (
    @cliente_id,
    @venta_id,
    @monto_pagado_ves,
    @monto_pagado_usd,
    @tasa_bcv_momento,
    @metodo,
    @usuario_id,
    @referencia
  )
`);

const getAbonoByIdStmt = db.prepare(`
  SELECT *
  FROM abonos
  WHERE id = ?
`);

const deleteAbonoStmt = db.prepare(`
  DELETE FROM abonos
  WHERE id = ?
`);

const updateSaleStatusStmt = db.prepare(`
  UPDATE ventas
  SET estado_pago = ?, monto_pendiente_usd = ?
  WHERE id = ?
`);

// Historial completo de ventas por cliente
const getClientAllSalesStmt = db.prepare(`
  SELECT id, creado_en, total_ves, total_usd_bcv, monto_pendiente_usd, estado_pago
  FROM ventas
  WHERE cliente_id = ?
  ORDER BY creado_en DESC
`);

// Historial completo de abonos por cliente
const getClientAllAbonosStmt = db.prepare(`
  SELECT 
    id, 
    venta_id, 
    monto_pagado_ves, 
    monto_pagado_usd, 
    tasa_bcv_momento, 
    metodo, 
    fecha, 
    COALESCE(anulado, 0) as anulado
  FROM abonos
  WHERE cliente_id = ?
  ORDER BY fecha DESC
`);

// Pagos iniciales (POS) por cliente (para el estado de cuenta completo)
const getClientInitialPaymentsStmt = db.prepare(`
  SELECT 
    vp.id, 
    vp.venta_id, 
    vp.monto_en_ves, 
    vp.monto_recibido, 
    vp.metodo, 
    vp.tasa_bcv_momento,
    v.creado_en as fecha
  FROM venta_pagos vp
  JOIN ventas v ON vp.venta_id = v.id
  WHERE v.cliente_id = ?
  ORDER BY v.creado_en DESC
`);

// ======== HELPERS ========



// ======== CONTROLADORES ========

// GET /api/clients?search=
function getClients(req, res) {
  try {
    const search = (req.query.search || '').trim();
    const term = `%${search}%`;

    let clients = listClientsStmt.all({ term });

    // Deuda por cliente usando ventas.monto_pendiente_usd
    clients = clients.map((c) => {
      const sales = getClientOpenSalesStmt.all(c.id);

      let totalUsd = 0;
      let totalVes = 0;
      const tasasSet = new Set();

      sales.forEach((s) => {
        // FORZAR RECALCULO para asegurar consistencia (tasa implícita, 4 decimales)
        const updatedSale = recalcSalePendingAndStatus(s.id);
        if (updatedSale) {
          const pUsd = Number(updatedSale.monto_pendiente_usd) || 0;
          const pVes = Number(updatedSale.pendienteVes) || 0;
          if (pUsd > 0) totalUsd += pUsd;
          if (pVes > 0) totalVes += pVes;
        }
        // Registrar la tasa de referencia de esta venta
        if (s.tasa_referencia) tasasSet.add(s.tasa_referencia.toUpperCase());
      });

      return {
        id: c.id,
        nombre: c.nombre,
        cedula: c.cedula,
        telefono: c.telefono,
        direccion: c.direccion,
        deuda_total_usd: Number(totalUsd.toFixed(2)),
        deuda_total_ves: Number(totalVes.toFixed(2)),
        tasas_referencia: Array.from(tasasSet),   // ej: ['BCV'], ['PARALELO'], ['BCV','PARALELO']
      };
    });

    res.json(clients);
  } catch (error) {
    console.error('Error getClients:', error);
    res.status(500).json({ error: 'Error interno al obtener clientes.' });
  }
}

// GET /api/clients/:id
function getClientById(req, res) {
  try {
    const clientId = parseInt(req.params.id, 10);
    if (!clientId) return res.status(400).json({ error: 'ID de cliente inválido.' });

    const cliente = getClientByIdStmt.get(clientId);
    if (!cliente || cliente.activo === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado.' });
    }
    res.json(cliente);
  } catch (error) {
    console.error('Error getClientById:', error);
    res.status(500).json({ error: 'Error interno al obtener cliente.' });
  }
}

// GET /api/clients/:id/debts
function getClientDebts(req, res) {
  try {
    const clientId = parseInt(req.params.id, 10);
    if (!clientId) {
      return res.status(400).json({ error: 'ID de cliente inválido.' });
    }

    const cliente = getClientByIdStmt.get(clientId);
    if (!cliente || cliente.activo === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado.' });
    }


    const sales = getClientOpenSalesStmt.all(clientId);

    const deudas = sales.map((row) => {
      // FORZAR RECALCULO
      const updatedSale = recalcSalePendingAndStatus(row.id);

      const deudaOriginalUsd = updatedSale ? (Number(updatedSale.total_usd_bcv) || 0) : 0;
      const pendienteUsd = updatedSale ? (Number(updatedSale.monto_pendiente_usd) || 0) : 0;
      const pendienteVes = updatedSale ? (Number(updatedSale.pendienteVes) || 0) : 0;

      return {
        id: row.id,
        creado_en: row.creado_en,
        deuda_original_usd: Number(deudaOriginalUsd.toFixed(2)),
        monto_pendiente_usd: Number(pendienteUsd.toFixed(2)),
        monto_pendiente_ves: Number(pendienteVes.toFixed(2)),
        tasa_referencia: row.tasa_referencia,
      };
    });

    res.json({
      cliente: {
        id: cliente.id,
        nombre: cliente.nombre,
        cedula: cliente.cedula,
        telefono: cliente.telefono,
        direccion: cliente.direccion,
      },
      deudas,
    });
  } catch (error) {
    console.error('Error getClientDebts:', error);
    res.status(500).json({ error: 'Error interno al obtener deudas del cliente.' });
  }
}

// POST /api/clients
function createClient(req, res) {
  try {
    const { nombre, cedula = null, telefono = null, direccion = null } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre del cliente es obligatorio.' });
    }

    const info = insertClientStmt.run({
      nombre: nombre.trim(),
      cedula: cedula ? cedula.trim() : null,
      telefono: telefono ? telefono.trim() : null,
      direccion: direccion ? direccion.trim() : null,
    });

    res.status(201).json({ message: 'Cliente creado con éxito.', id: info.lastInsertRowid });
  } catch (error) {
    console.error('Error createClient:', error);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Ya existe un cliente con esa cédula.' });
    }
    res.status(500).json({ error: 'Error interno al crear cliente.' });
  }
}

// PUT /api/clients/:id
function updateClient(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) {
      return res.status(400).json({ error: 'ID de cliente inválido.' });
    }

    const { nombre, cedula = null, telefono = null, direccion = null } = req.body;
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre del cliente es obligatorio.' });
    }

    const existing = getClientByIdStmt.get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Cliente no encontrado.' });
    }

    const info = updateClientStmt.run({
      id,
      nombre: nombre.trim(),
      cedula: cedula ? cedula.trim() : null,
      telefono: telefono ? telefono.trim() : null,
      direccion: direccion ? direccion.trim() : null,
    });

    if (info.changes === 0) {
      return res.status(400).json({ error: 'No se realizaron cambios en el cliente.' });
    }

    res.json({ message: 'Cliente actualizado con éxito.' });
  } catch (error) {
    console.error('Error updateClient:', error);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Ya existe un cliente con esa cédula.' });
    }
    res.status(500).json({ error: 'Error interno al actualizar cliente.' });
  }
}

// DELETE /api/clients/:id  (Soft delete)
function deleteClient(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) {
      return res.status(400).json({ error: 'ID de cliente inválido.' });
    }

    const existing = getClientByIdStmt.get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Cliente no encontrado.' });
    }

    const info = softDeleteClientStmt.run(id);
    if (info.changes === 0) {
      return res.status(400).json({ error: 'No se pudo eliminar el cliente.' });
    }

    res.json({ message: 'Cliente eliminado (inactivado) con éxito.' });
  } catch (error) {
    console.error('Error deleteClient:', error);
    res.status(500).json({ error: 'Error interno al eliminar cliente.' });
  }
}

// POST /api/clients/payment
// body: { cliente_id, venta_id, monto, metodo, tasa_usd }
function registerPayment(req, res) {
  try {
    const { cliente_id, venta_id, monto, metodo, tasa_usd, referencia } = req.body;

    const clienteId = parseInt(cliente_id, 10);
    const ventaId = parseInt(venta_id, 10);
    let amount = parseFloat(monto);
    let tasa = parseFloat(tasa_usd);

    if (!clienteId || !ventaId) {
      return res.status(400).json({ error: 'cliente_id y venta_id son obligatorios.' });
    }
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'El monto debe ser mayor a 0.' });
    }
    if (!metodo) {
      return res.status(400).json({ error: 'El método de pago es obligatorio.' });
    }

    if (!tasa || tasa <= 0) {
      tasa = getPreferredRate(); // Usar PARALELO por defecto, no BCV
    }

    const ventaRow = db.prepare(`
      SELECT id, cliente_id
      FROM ventas
      WHERE id = ?
    `).get(ventaId);

    if (!ventaRow) {
      return res.status(404).json({ error: 'Venta no encontrada.' });
    }
    if (ventaRow.cliente_id !== clienteId) {
      return res.status(400).json({ error: 'La venta no pertenece a ese cliente.' });
    }

    const methodsEnBs = ['VES_EFECTIVO', 'TARJETA', 'PAGOMOVIL'];
    let montoPagadoUsd = 0;
    let montoPagadoVes = 0;

    if (metodo === 'USD_EFECTIVO') {
      montoPagadoUsd = amount;
      montoPagadoVes = amount * tasa;
    } else if (methodsEnBs.includes(metodo)) {
      montoPagadoVes = amount;
      montoPagadoUsd = amount / tasa;
    } else {
      return res.status(400).json({ error: 'Método de pago inválido.' });
    }

    const tx = db.transaction(() => {
      // Insertar abono
      insertAbonoStmt.run({
        cliente_id: clienteId,
        venta_id: ventaId,
        monto_pagado_ves: montoPagadoVes,
        monto_pagado_usd: montoPagadoUsd,
        tasa_bcv_momento: tasa,
        metodo,
        usuario_id: req.userId || req.body.usuario_id || null,
        referencia: referencia || null,
      });

      // Recalcular venta usando la misma lógica que detalles_venta
      const updatedSale = recalcSalePendingAndStatus(ventaId);
      if (!updatedSale) {
        throw new Error('No se pudo recalcular la deuda de la venta.');
      }

      // 🔴 FORCE SETTLE: Si el frontend determina que esto cierra la venta, forzamos el cierre
      if (req.body.force_settle) {
        updateSaleStatusStmt.run('PAGADO', 0, ventaId);
        updatedSale.estado_pago = 'PAGADO';
        updatedSale.monto_pendiente_usd = 0;
      }

      return updatedSale;
    });

    const result = tx();
    const pendienteUsd = Number(result.monto_pendiente_usd) || 0;
    const pendienteVes = Number(result.pendienteVes) || 0;

    res.json({
      success: true,
      venta_id: ventaId,
      pendiente_usd: Number(pendienteUsd.toFixed(4)),
      pendiente_ves: Number(pendienteVes.toFixed(2)),
    });
  } catch (error) {
    console.error('Error registerPayment:', error);
    res.status(500).json({ error: 'Error interno al registrar el abono.' });
  }
}

// POST /api/clients/payment/bulk
// body: { cliente_id, monto, metodo, tasa_usd }
// Distribuye el pago automáticamente a las deudas más antiguas
function bulkRegisterPayment(req, res) {
  try {
    const { cliente_id, monto, metodo, tasa_usd, referencia } = req.body;

    const clienteId = parseInt(cliente_id, 10);
    let amountTotal = parseFloat(monto); // Monto total a abonar por el usuario
    let tasa = parseFloat(tasa_usd);

    if (!clienteId) {
      return res.status(400).json({ error: 'cliente_id es obligatorio.' });
    }
    if (!amountTotal || amountTotal <= 0) {
      return res.status(400).json({ error: 'El monto debe ser mayor a 0.' });
    }
    if (!metodo) {
      return res.status(400).json({ error: 'El método de pago es obligatorio.' });
    }

    if (!tasa || tasa <= 0) {
      tasa = getPreferredRate(); // Usar PARALELO por defecto, no BCV
    }

    // 1. Calcular cuánto es el abono total en USD (moneda base del sistema)
    const methodsEnBs = ['VES_EFECTIVO', 'TARJETA', 'PAGOMOVIL'];
    let abonoDisponibleUsd = 0;

    if (metodo === 'USD_EFECTIVO') {
      abonoDisponibleUsd = amountTotal;
    } else if (methodsEnBs.includes(metodo)) {
      abonoDisponibleUsd = amountTotal / tasa;
    } else {
      return res.status(400).json({ error: 'Método de pago inválido.' });
    }

    // Redondeamos a 4 decimales para cálculos internos
    abonoDisponibleUsd = Math.round(abonoDisponibleUsd * 10000) / 10000;

    const tx = db.transaction(() => {
      // 2. Obtener todas las ventas pendientes del cliente (FIFO)
      // Reutilizamos la query pero asegurando orden por fecha
      const sales = getClientOpenSalesStmt.all(clienteId);

      const pagosRealizados = [];
      let remanenteUsd = abonoDisponibleUsd;

      for (const sale of sales) {
        if (remanenteUsd <= 0.0001) break; // Se acabó el dinero

        // Recalcular deuda actual real de esta venta
        const updatedSale = recalcSalePendingAndStatus(sale.id);
        if (!updatedSale) continue;

        let pendienteUsd = Number(updatedSale.monto_pendiente_usd) || 0;

        if (pendienteUsd <= 0.0001) continue; // Venta ya pagada, saltar

        // Determinar cuánto vamos a pagar a esta venta
        let pagoParaEstaVentaUsd = 0;
        if (remanenteUsd >= pendienteUsd) {
          // Alcanza para pagar toda esta venta
          pagoParaEstaVentaUsd = pendienteUsd;
        } else {
          // Solo alcanza para una parte
          pagoParaEstaVentaUsd = remanenteUsd;
        }

        // Calcular equivalentes para el registro
        let montoPagadoVes = 0;
        let montoPagadoUsd = 0;

        if (metodo === 'USD_EFECTIVO') {
          montoPagadoUsd = pagoParaEstaVentaUsd;
          montoPagadoVes = pagoParaEstaVentaUsd * tasa;
        } else {
          montoPagadoUsd = pagoParaEstaVentaUsd;
          montoPagadoVes = pagoParaEstaVentaUsd * tasa;
        }

        // Insertar abono para esta venta específica
        insertAbonoStmt.run({
          cliente_id: clienteId,
          venta_id: sale.id,
          monto_pagado_ves: montoPagadoVes,
          monto_pagado_usd: montoPagadoUsd,
          tasa_bcv_momento: tasa,
          metodo: metodo,
          usuario_id: req.userId || req.body.usuario_id || null,
          referencia: referencia || null,
        });

        // Actualizar estado de la venta
        recalcSalePendingAndStatus(sale.id);

        pagosRealizados.push({
          venta_id: sale.id,
          monto_usd: montoPagadoUsd,
          monto_ves: montoPagadoVes
        });

        // Restar del disponible
        remanenteUsd -= pagoParaEstaVentaUsd;
      }

      return { pagosRealizados, remanenteUsd };
    });

    const result = tx();

    res.json({
      success: true,
      message: `Abono distribuido en ${result.pagosRealizados.length} ventas.${result.remanenteUsd > 0.01 ? ' Quedó un saldo a favor no procesado.' : ''}`,
      details: result
    });

  } catch (error) {
    console.error('Error bulkRegisterPayment:', error);
    res.status(500).json({ error: 'Error interno al registrar el abono masivo.' });
  }
}

// POST /api/clients/payment/:id/void
// body opcional: { motivo }
function voidPayment(req, res) {
  try {
    const abonoId = parseInt(req.params.id, 10);
    const { motivo = null } = req.body || {};

    if (!abonoId) {
      return res.status(400).json({ error: 'ID de abono inválido.' });
    }

    const abono = getAbonoByIdStmt.get(abonoId);
    if (!abono) {
      return res.status(404).json({ error: 'Abono no encontrado.' });
    }
    if (!abono.venta_id) {
      return res.status(400).json({ error: 'El abono no está asociado a una venta.' });
    }

    const ventaId = abono.venta_id;

    const tx = db.transaction(() => {
      // Eliminar abono
      deleteAbonoStmt.run(abonoId);

      // Recalcular venta con abonos restantes y pagos iniciales
      const updatedSale = recalcSalePendingAndStatus(ventaId);
      if (!updatedSale) {
        throw new Error('No se pudo recalcular la deuda de la venta.');
      }
      return updatedSale;
    });

    const updatedSale = tx();
    const pendienteUsd = Number(updatedSale.monto_pendiente_usd) || 0;
    const deudaOriginalUsd = Number(updatedSale.total_usd_bcv) || 0;
    const pendienteVes = Number(updatedSale.pendienteVes) || 0;

    res.json({
      success: true,
      venta_id: ventaId,
      pendiente_usd: Number(pendienteUsd.toFixed(2)),
      pendiente_ves: Number(pendienteVes.toFixed(2)),
      deuda_original_usd: Number(deudaOriginalUsd.toFixed(2)),
      message: motivo || 'Abono anulado y eliminado correctamente.',
    });
  } catch (error) {
    console.error('Error voidPayment:', error);
    res.status(500).json({ error: 'Error interno al anular el abono.' });
  }
}

// GET /api/clients/:id/sales
function getClientSales(req, res) {
  try {
    const clientId = parseInt(req.params.id, 10);
    if (!clientId) return res.status(400).json({ error: 'ID de cliente inválido.' });

    const sales = getClientAllSalesStmt.all(clientId);
    res.json(sales);
  } catch (error) {
    console.error('Error getClientSales:', error);
    res.status(500).json({ error: 'Error interno al obtener historial de ventas.' });
  }
}

// GET /api/clients/:id/statement
function getClientAccountStatement(req, res) {
  try {
    const clientId = parseInt(req.params.id, 10);
    if (!clientId) return res.status(400).json({ error: 'ID de cliente inválido.' });

    const sales = getClientAllSalesStmt.all(clientId);
    const abonos = getClientAllAbonosStmt.all(clientId);
    const initialPayments = getClientInitialPaymentsStmt.all(clientId);

    // Combinar todo en una lista cronológica
    let movement = [];

    // Ventas como "Cargos"
    sales.forEach(s => {
      movement.push({
        tipo: 'VENTA',
        id: s.id,
        fecha: s.creado_en,
        monto_ves: s.total_ves,
        monto_usd: s.total_usd_bcv,
        estado: s.estado_pago,
        referencia: `Venta #${s.id}`
      });
    });

    // Abonos (Cobranza) como "Abonos"
    abonos.forEach(a => {
      if (a.anulado) return;
      movement.push({
        tipo: 'ABONO',
        id: a.id,
        venta_id: a.venta_id,
        fecha: a.fecha,
        monto_ves: a.monto_pagado_ves,
        monto_usd: a.monto_pagado_usd,
        metodo: a.metodo,
        referencia: a.venta_id ? `Abono a Venta #${a.venta_id}` : 'Abono General'
      });
    });

    // Pagos iniciales (POS) como "Abonos"
    initialPayments.forEach(p => {
      movement.push({
        tipo: 'PAGO_POS',
        id: p.id,
        venta_id: p.venta_id,
        fecha: p.fecha,
        monto_ves: p.monto_en_ves,
        monto_usd: p.metodo === 'USD_EFECTIVO' ? p.monto_recibido : (p.tasa_bcv_momento ? p.monto_en_ves / p.tasa_bcv_momento : 0),
        metodo: p.metodo,
        referencia: `Pago POS Venta #${p.venta_id}`
      });
    });

    // Ordenar por fecha descendente
    movement.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    res.json(movement);
  } catch (error) {
    console.error('Error getClientAccountStatement:', error);
    res.status(500).json({ error: 'Error interno al obtener estado de cuenta.' });
  }
}

// GET /api/clients/export
function exportClients(req, res) {
  try {
    const allClients = db.prepare('SELECT id, nombre, cedula, telefono, direccion, activo FROM clientes ORDER BY nombre ASC').all();

    const enriched = allClients.map((c) => {
      const sales = getClientOpenSalesStmt.all(c.id);
      let totalUsd = 0;
      let totalVes = 0;
      sales.forEach((s) => {
        const updated = recalcSalePendingAndStatus(s.id);
        if (updated) {
          const pUsd = Number(updated.monto_pendiente_usd) || 0;
          const pVes = Number(updated.pendienteVes) || 0;
          if (pUsd > 0) totalUsd += pUsd;
          if (pVes > 0) totalVes += pVes;
        }
      });
      return {
        ID: c.id,
        Nombre: c.nombre,
        Cedula: c.cedula || '',
        Telefono: c.telefono || '',
        Direccion: c.direccion || '',
        Deuda_USD: Number(totalUsd.toFixed(2)),
        Deuda_VES: Number(totalVes.toFixed(2)),
        Estado: c.activo ? 'Activo' : 'Inactivo'
      };
    });

    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const filename = `export-clientes-${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);

    fastcsv.write(enriched, { headers: true, delimiter: ';' }).pipe(res);
  } catch (error) {
    console.error('Error exportClients:', error);
    res.status(500).json({ error: 'Error exporting clients' });
  }
}

module.exports = {
  getClients,
  getClientById,
  getClientDebts,
  createClient,
  updateClient,
  deleteClient,
  registerPayment,
  bulkRegisterPayment,
  voidPayment,
  getClientSales,
  getClientAccountStatement,
  exportClients,
};
