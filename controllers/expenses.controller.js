// controllers/expenses.controller.js
const { db, getBcvRate } = require('../src/database');

function getLocalDateStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// ---------- Categorías de Gastos ----------

const getCategories = (req, res) => {
  try {
    const categories = db.prepare('SELECT * FROM gastos_categorias ORDER BY nombre ASC').all();
    res.json({ success: true, data: categories });
  } catch (error) {
    console.error('Error fetching expense categories:', error);
    res.status(500).json({ error: 'Error al obtener categorías' });
  }
};

const createCategory = (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });

    db.prepare('INSERT INTO gastos_categorias (nombre) VALUES (?)').run(nombre.toUpperCase());
    res.json({ success: true });
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Ya existe una categoría con ese nombre' });
    }
    console.error('Error creating expense category:', error);
    res.status(500).json({ error: 'Error al crear categoría' });
  }
};

const deleteCategory = (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM gastos_categorias WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting expense category:', error);
    res.status(500).json({ error: 'Error al eliminar categoría' });
  }
};

// ---------- Gestión de Gastos ----------

const getExpenses = (req, res) => {
  try {
    const { startDate, endDate, categoryId, search } = req.query;
    
    let query = `
      SELECT g.*, gc.nombre as categoria_nombre 
      FROM gastos g
      LEFT JOIN gastos_categorias gc ON g.categoria_id = gc.id
      WHERE 1=1
    `;
    const params = [];

    if (startDate && endDate) {
      query += ` AND date(g.fecha) BETWEEN ? AND ?`;
      params.push(startDate, endDate);
    }

    if (categoryId) {
      if (categoryId === 'RETIRO') {
          // Special case handled in frontend sometimes, but here we filter by source if we added it.
          // For now, assume it filters by a specific category if it's a numeric ID.
          query += ` AND 0=1`; // Retiros are in a different table, handled below if needed or filtered out
      } else {
          query += ` AND g.categoria_id = ?`;
          params.push(categoryId);
      }
    }

    if (search) {
      query += ` AND (g.concepto LIKE ? OR g.descripcion LIKE ? OR g.notas LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    query += ` ORDER BY g.fecha DESC, g.id DESC`;

    const expenses = db.prepare(query).all(...params);

    // If "RETIRO" was requested or no category filter, include cash withdrawals as virtual expenses
    if (!categoryId || categoryId === 'RETIRO') {
        let withdrawalQuery = `SELECT id, fecha, metodo as categoria_nombre, monto_ves, monto_usd, tasa_bcv_momento as tasa_bcv, descripcion as concepto, 'PAGADO' as estado_pago, 0 as monto_pendiente_ves, 'RETIRO' as fuente FROM retiros_caja WHERE 1=1`;
        const wParams = [];
        if (startDate && endDate) {
            withdrawalQuery += ` AND date(fecha) BETWEEN ? AND ?`;
            wParams.push(startDate, endDate);
        }
        if (search) {
            withdrawalQuery += ` AND (descripcion LIKE ? OR metodo LIKE ?)`;
            const s = `%${search}%`;
            wParams.push(s, s);
        }
        
        const withdrawals = db.prepare(withdrawalQuery).all(...wParams);
        expenses.push(...withdrawals);
        
        // Final sort if we merged
        expenses.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    }

    res.json({ success: true, data: expenses });
  } catch (error) {
    console.error('Error fetching expenses:', error);
    res.status(500).json({ error: 'Error al obtener gastos' });
  }
};

const createExpense = (req, res) => {
  try {
    const { categoria_id, monto, moneda, concepto, fecha, estado, notas, usuario_id, tasa_bcv, tasa_tipo } = req.body;
    const bcv = (tasa_bcv && tasa_bcv > 0) ? tasa_bcv : getBcvRate();
    const amount = parseFloat(monto);
    
    let monto_ves, monto_usd;
    if (moneda === 'USD') {
      monto_usd = amount;
      monto_ves = amount * bcv;
    } else {
      monto_ves = amount;
      monto_usd = amount / bcv;
    }

    const m_pendiente_ves = (estado === 'FIADO' || estado === 'PENDIENTE' || estado === 'ABONADO') ? monto_ves : 0;
    const final_estado = (estado === 'ABONADO') ? 'PENDIENTE' : estado;

    const info = db.prepare(`
      INSERT INTO gastos (
        fecha, categoria_id, monto_ves, monto_usd, tasa_bcv, tasa_tipo, concepto, estado_pago, monto_pendiente_ves, usuario_id, moneda, notas
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      fecha || getLocalDateStr(),
      categoria_id,
      monto_ves,
      monto_usd,
      bcv,
      tasa_tipo || 'BCV',
      concepto,
      final_estado,
      m_pendiente_ves,
      usuario_id || null,
      moneda || 'VES',
      notas || ''
    );

    res.json({ success: true, id: info.lastInsertRowid });
  } catch (error) {
    console.error('Error creating expense:', error);
    res.status(500).json({ error: error.message });
  }
};

const updateExpense = (req, res) => {
  try {
    const { id } = req.params;
    const { categoria_id, monto, moneda, concepto, fecha, estado, notas, tasa_bcv, tasa_tipo } = req.body;
    const bcv = (tasa_bcv && tasa_bcv > 0) ? tasa_bcv : getBcvRate();
    const amount = parseFloat(monto);

    let monto_ves, monto_usd;
    if (moneda === 'USD') {
      monto_usd = amount;
      monto_ves = amount * bcv;
    } else {
      monto_ves = amount;
      monto_usd = amount / bcv;
    }

    // Recalcular pendiente si cambia estado
    const m_pendiente_ves = (estado === 'FIADO' || estado === 'PENDIENTE' || estado === 'ABONADO') ? monto_ves : 0;

    db.prepare(`
      UPDATE gastos SET
        categoria_id = ?,
        monto_ves = ?,
        monto_usd = ?,
        tasa_bcv = ?,
        tasa_tipo = ?,
        concepto = ?,
        fecha = ?,
        estado_pago = ?,
        monto_pendiente_ves = ?,
        moneda = ?,
        notas = ?
      WHERE id = ?
    `).run(categoria_id, monto_ves, monto_usd, bcv, tasa_tipo || 'BCV', concepto, fecha, estado, m_pendiente_ves, moneda, notas || '', id);

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating expense:', error);
    res.status(500).json({ error: error.message });
  }
};

const deleteExpense = (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM gastos WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting expense:', error);
    res.status(500).json({ error: 'Error al eliminar el gasto' });
  }
};

const registerAbono = (req, res) => {
  try {
    const { expense_id, purchase_id, amount, currency, method, referencia, usuario_id, tasa_bcv: customRate } = req.body;
    const bcv = customRate || getBcvRate();

    if (purchase_id) {
      // Abono a COMPRA
      const compra = db.prepare('SELECT * FROM compras WHERE id = ?').get(purchase_id);
      if (!compra) return res.status(404).json({ error: 'Compra no encontrada' });

      const compraTasa = compra.tasa_bcv || bcv;
      let monto_ves_abono, monto_usd_abono;

      if (currency === 'USD') {
        monto_usd_abono = amount;
        monto_ves_abono = amount * compraTasa;
      } else {
        monto_ves_abono = amount;
        monto_usd_abono = amount / bcv;
      }

      if (monto_ves_abono > (compra.monto_pendiente_ves + 0.01)) {
        return res.status(400).json({ error: 'El monto excede el saldo pendiente' });
      }

      const transaction = db.transaction(() => {
        db.prepare(`
          INSERT INTO compras_abonos (compra_id, monto_ves, monto_usd, tasa_bcv_momento, metodo, referencia, usuario_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(purchase_id, monto_ves_abono, monto_usd_abono, compraTasa, method, referencia || null, usuario_id || null);

        const nuevoPendienteVes = Math.max(0, compra.monto_pendiente_ves - monto_ves_abono);
        const nuevoPendienteUsd = Math.max(0, (compra.monto_pendiente_usd || 0) - monto_usd_abono);
        const nuevoEstado = (nuevoPendienteVes < 0.01) ? 'PAGADO' : 'ABONADO';

        db.prepare('UPDATE compras SET monto_pendiente_ves = ?, monto_pendiente_usd = ?, estado = ? WHERE id = ?')
          .run(nuevoPendienteVes, nuevoPendienteUsd, nuevoEstado, purchase_id);
      });

      transaction();
      return res.json({ success: true });
    }

    if (expense_id) {
      // Abono a GASTO
      const gasto = db.prepare('SELECT * FROM gastos WHERE id = ?').get(expense_id);
      if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' });

      const gastoTasa = gasto.tasa_bcv || bcv;
      let monto_ves_abono, monto_usd_abono;

      if (currency === 'USD') {
        monto_usd_abono = amount;
        monto_ves_abono = amount * gastoTasa;
      } else {
        monto_ves_abono = amount;
        monto_usd_abono = amount / bcv;
      }

      if (monto_ves_abono > (gasto.monto_pendiente_ves + 0.01)) {
        return res.status(400).json({ error: 'El monto excede el saldo pendiente' });
      }

      const transaction = db.transaction(() => {
        db.prepare(`
          INSERT INTO gastos_abonos (gasto_id, monto_ves, monto_usd, tasa_bcv_momento, metodo, referencia, usuario_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(expense_id, monto_ves_abono, monto_usd_abono, gastoTasa, method, referencia || null, usuario_id || null);

        const nuevoPendienteVes = Math.max(0, gasto.monto_pendiente_ves - monto_ves_abono);
        const nuevoEstado = (nuevoPendienteVes < 0.01) ? 'PAGADO' : 'ABONADO';

        db.prepare('UPDATE gastos SET monto_pendiente_ves = ?, estado_pago = ? WHERE id = ?')
          .run(nuevoPendienteVes, nuevoEstado, expense_id);
      });

      transaction();
      return res.json({ success: true });
    }

    return res.status(400).json({ error: 'Se requiere purchase_id o expense_id' });
  } catch (error) {
    console.error('Error registering abono:', error);
    res.status(500).json({ error: error.message });
  }
};

// ---------- Cuentas por Pagar ----------

const getCuentasPorPagar = (req, res) => {
  try {
    const compras = db.prepare(`
      SELECT 
        c.id,
        'COMPRA' as tipo,
        c.fecha,
        p.nombre as proveedor,
        c.numero_factura as referencia,
        c.moneda,
        c.tasa_bcv,
        c.total_compra,
        c.monto_pendiente_ves,
        c.monto_pendiente_usd as monto_pendiente_usd,
        c.monto_total_usd as monto_usd,
        p.rif
      FROM compras c
      LEFT JOIN proveedores p ON c.proveedor_id = p.id
      WHERE c.monto_pendiente_ves > 0.01
      ORDER BY c.fecha DESC
    `).all();

    const gastos = db.prepare(`
      SELECT 
        g.id,
        'GASTO' as tipo,
        g.fecha,
        g.concepto as proveedor,
        g.id as referencia,
        g.moneda,
        g.tasa_bcv,
        g.monto_ves as total_compra,
        g.monto_pendiente_ves,
        g.monto_usd
      FROM gastos g
      WHERE g.monto_pendiente_ves > 0.01
      ORDER BY g.fecha DESC
    `).all();

    const allDebts = [...compras, ...gastos].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    res.json({ success: true, data: allDebts });
  } catch (error) {
    console.error('Error fetching cuentas por pagar:', error);
    res.status(500).json({ error: 'Error al obtener cuentas por pagar' });
  }
};

module.exports = {
  getCategories,
  createCategory,
  deleteCategory,
  getExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  registerAbono,
  getCuentasPorPagar
};
