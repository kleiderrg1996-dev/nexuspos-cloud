const { db } = require('../src/database');

// ====== STATEMENTS ======
const getRatesStmt = db.prepare(
  "SELECT key, value FROM settings WHERE key IN ('BCV', 'PARALELO', 'COP')"
);

// Ahora incluimos también precio_usd_bcv en todos los SELECT
const getPresentationsByProductStmt = db.prepare(`
  SELECT id, producto_id, nombre, unidades_base, precio_ves, precio_usd_bcv, moneda, precio, barcode, activo
  FROM presentaciones
  WHERE producto_id = ? AND activo = 1
  ORDER BY id ASC
`);

const getAllPresentationsStmt = db.prepare(`
  SELECT id, producto_id, nombre, unidades_base, precio_ves, precio_usd_bcv, moneda, precio, barcode, activo
  FROM presentaciones
  WHERE activo = 1
  ORDER BY producto_id ASC, id ASC
`);

const getPresentationByIdStmt = db.prepare(`
  SELECT id, producto_id, nombre, unidades_base, precio_ves, precio_usd_bcv, moneda, precio, barcode, activo
  FROM presentaciones
  WHERE id = ?
`);

const createPresentationStmt = db.prepare(`
  INSERT INTO presentaciones (
    producto_id,
    nombre,
    unidades_base,
    precio_ves,
    precio_usd_bcv,
    moneda,
    precio,
    barcode,
    activo
  ) VALUES (
    @producto_id,
    @nombre,
    @unidades_base,
    @precio_ves,
    @precio_usd_bcv,
    @moneda,
    @precio,
    @barcode,
    1
  )
`);

const updatePresentationStmt = db.prepare(`
  UPDATE presentaciones
  SET nombre         = @nombre,
      unidades_base  = @unidades_base,
      precio_ves     = @precio_ves,
      precio_usd_bcv = @precio_usd_bcv,
      moneda         = @moneda,
      precio         = @precio,
      barcode        = @barcode
  WHERE id = @id
`);

const softDeletePresentationStmt = db.prepare(`
  UPDATE presentaciones
  SET activo = 0,
      barcode = NULL
  WHERE id = ?
`);

const getPresentationByBarcodeStmt = db.prepare(`
  SELECT id, producto_id, nombre, unidades_base, precio_ves, precio_usd_bcv, moneda, precio, barcode, activo
  FROM presentaciones
  WHERE barcode = ? AND activo = 1
`);

const getProductMinimalStmt = db.prepare(`
  SELECT id, nombre, categoria, tipo_venta
  FROM productos
  WHERE id = ?
`);

// ====== HELPERS ======
function getRates() {
  const rows = getRatesStmt.all();
  return rows.reduce((acc, row) => {
    acc[row.key] = parseFloat(row.value);
    return acc;
  }, {});
}

/**
 * Enriquecemos la presentación con:
 * - precio_ves y precio_usd_bcv calculados en base a 'precio' y 'moneda' usando tasas actuales
 */
function enrichPresentation(presentation, rates) {
  const bcv = parseFloat(rates.BCV || 0) || 0;
  const paralelo = parseFloat(rates.PARALELO || 0) || 0;
  const cop = parseFloat(rates.COP || 0) || 0;

  // Valores base de BD
  const moneda = presentation.moneda || 'VES';
  const precioBase = parseFloat(presentation.precio || 0) || 0;

  let precioVes = 0;
  let precioUsdBcv = 0;

  // 1. Calcular precio en VES según moneda base
  if (precioBase > 0) {
    if (moneda === 'VES') {
      precioVes = precioBase;
    } else if (moneda === 'BCV') {
      precioVes = precioBase * bcv;
    } else if (moneda === 'PARALELO') {
      precioVes = precioBase * paralelo;
    } else if (moneda === 'COP') {
      precioVes = precioBase * cop;
    }
  }

  // 2. Calcular referencial en USD_BCV
  if (precioVes > 0 && bcv > 0) {
    precioUsdBcv = precioVes / bcv;
  }

  // Fallback para datos legacy si precioBase es 0 pero existen los viejos precio_ves
  if (precioBase <= 0 && presentation.precio_ves > 0) {
    precioVes = presentation.precio_ves;
    // recalcular USD si posible
    if (bcv > 0) precioUsdBcv = precioVes / bcv;
  }

  return {
    ...presentation,
    precio_ves: precioVes,
    precio_usd_bcv: precioUsdBcv,
    moneda: moneda,
    precio: precioBase
  };
}

// ====== CONTROLLER METHODS ======

// GET /api/presentations?productId=123
const getPresentations = (req, res) => {
  try {
    const { productId } = req.query;

    let rows;
    if (productId) {
      rows = getPresentationsByProductStmt.all(parseInt(productId, 10));
    } else {
      rows = getAllPresentationsStmt.all();
    }

    const rates = getRates();
    const result = rows.map(row => enrichPresentation(row, rates));
    res.json(result);
  } catch (error) {
    console.error('Error getting presentations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// GET /api/presentations/:id
const getPresentationById = (req, res) => {
  try {
    const { id } = req.params;
    const presentation = getPresentationByIdStmt.get(parseInt(id, 10));

    if (!presentation || presentation.activo === 0) {
      return res.status(404).json({ error: 'Presentación no encontrada' });
    }

    const rates = getRates();
    res.json(enrichPresentation(presentation, rates));
  } catch (error) {
    console.error('Error getting presentation by id:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// POST /api/presentations
// Body: { producto_id, nombre, unidades_base, precio, moneda, barcode? }
const createPresentation = (req, res) => {
  const {
    producto_id,
    nombre,
    unidades_base,
    precio,
    moneda,
    barcode = null
  } = req.body;

  if (!producto_id || isNaN(parseInt(producto_id, 10))) {
    return res.status(400).json({ error: 'producto_id es obligatorio.' });
  }
  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: 'El nombre de la presentación es obligatorio.' });
  }

  const unidades = parseFloat(unidades_base);
  if (isNaN(unidades) || unidades <= 0) {
    return res.status(400).json({ error: 'unidades_base debe ser un número mayor a 0.' });
  }

  const precioFinal = parseFloat(precio);
  if (isNaN(precioFinal) || precioFinal < 0) {
    return res.status(400).json({ error: 'El precio debe ser un número válido mayor o igual a 0.' });
  }

  const validCurrencies = ['VES', 'BCV', 'PARALELO', 'COP'];
  const monedaFinal = (moneda && validCurrencies.includes(moneda)) ? moneda : 'VES';

  // Calculamos los valores referenciales iniciales para guardarlos también
  // aunque enrichPresentation los recalculará al leer
  const rates = getRates();
  const bcv = parseFloat(rates.BCV || 0) || 0;
  const paralelo = parseFloat(rates.PARALELO || 0) || 0;
  const cop = parseFloat(rates.COP || 0) || 0;

  let precioVes = 0;
  if (monedaFinal === 'VES') precioVes = precioFinal;
  else if (monedaFinal === 'BCV') precioVes = precioFinal * bcv;
  else if (monedaFinal === 'PARALELO') precioVes = precioFinal * paralelo;
  else if (monedaFinal === 'COP') precioVes = precioFinal * cop;

  let precioUsdBcv = 0;
  if (bcv > 0 && precioVes > 0) precioUsdBcv = precioVes / bcv;

  try {
    const info = createPresentationStmt.run({
      producto_id: parseInt(producto_id, 10),
      nombre: nombre.trim(),
      unidades_base: unidades,
      precio_ves: precioVes,
      precio_usd_bcv: precioUsdBcv,
      moneda: monedaFinal,
      precio: precioFinal,
      barcode: barcode || null
    });

    res.status(201).json({
      message: 'Presentación creada con éxito',
      id: info.lastInsertRowid
    });
  } catch (error) {
    console.error('Error creating presentation:', error);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res
        .status(409)
        .json({ error: `El código de barras '${barcode}' ya está en uso por otra presentación.` });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

// PUT /api/presentations/:id
// Body: { nombre, unidades_base, precio, moneda, barcode }
const updatePresentation = (req, res) => {
  const { id } = req.params;
  const {
    nombre,
    unidades_base,
    precio,
    moneda,
    barcode = null
  } = req.body;

  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: 'El nombre de la presentación es obligatorio.' });
  }

  const unidades = parseFloat(unidades_base);
  if (isNaN(unidades) || unidades <= 0) {
    return res.status(400).json({ error: 'unidades_base debe ser un número mayor a 0.' });
  }

  const precioFinal = parseFloat(precio);
  if (isNaN(precioFinal) || precioFinal < 0) {
    return res.status(400).json({ error: 'El precio debe ser un número válido mayor o igual a 0.' });
  }

  const validCurrencies = ['VES', 'BCV', 'PARALELO', 'COP'];
  const monedaFinal = (moneda && validCurrencies.includes(moneda)) ? moneda : 'VES';

  const rates = getRates();
  const bcv = parseFloat(rates.BCV || 0) || 0;
  const paralelo = parseFloat(rates.PARALELO || 0) || 0;
  const cop = parseFloat(rates.COP || 0) || 0;

  let precioVes = 0;
  if (monedaFinal === 'VES') precioVes = precioFinal;
  else if (monedaFinal === 'BCV') precioVes = precioFinal * bcv;
  else if (monedaFinal === 'PARALELO') precioVes = precioFinal * paralelo;
  else if (monedaFinal === 'COP') precioVes = precioFinal * cop;

  let precioUsdBcv = 0;
  if (bcv > 0 && precioVes > 0) precioUsdBcv = precioVes / bcv;

  try {
    const existing = getPresentationByIdStmt.get(parseInt(id, 10));
    if (!existing || existing.activo === 0) {
      return res.status(404).json({ error: 'Presentación no encontrada.' });
    }

    const info = updatePresentationStmt.run({
      id: parseInt(id, 10),
      nombre: nombre.trim(),
      unidades_base: unidades,
      precio_ves: precioVes,
      precio_usd_bcv: precioUsdBcv,
      moneda: monedaFinal,
      precio: precioFinal,
      barcode: barcode || null
    });

    if (info.changes === 0) {
      return res
        .status(404)
        .json({ error: 'Presentación no encontrada o sin cambios.' });
    }

    res.json({ message: 'Presentación actualizada con éxito' });
  } catch (error) {
    console.error('Error updating presentation:', error);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res
        .status(409)
        .json({ error: `El código de barras '${barcode}' ya está en uso por otra presentación.` });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

// DELETE /api/presentations/:id  (soft delete)
const deletePresentation = (req, res) => {
  const { id } = req.params;
  try {
    const existing = getPresentationByIdStmt.get(parseInt(id, 10));
    if (!existing || existing.activo === 0) {
      return res.status(404).json({ error: 'Presentación no encontrada.' });
    }

    const info = softDeletePresentationStmt.run(parseInt(id, 10));
    if (info.changes === 0) {
      return res.status(404).json({ error: 'Presentación no encontrada.' });
    }

    res.json({ message: 'Presentación eliminada (ocultada) con éxito' });
  } catch (error) {
    console.error('Error deleting presentation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// GET /api/presentations/barcode/:barcode
// útil para escáner en el módulo de ventas
const getPresentationByBarcode = (req, res) => {
  const { barcode } = req.params;
  if (!barcode) {
    return res.status(400).json({ error: 'No barcode provided' });
  }

  try {
    const presentation = getPresentationByBarcodeStmt.get(barcode);
    if (!presentation || presentation.activo === 0) {
      return res
        .status(404)
        .json({ error: 'Presentación no encontrada con ese código de barras.' });
    }

    const product = getProductMinimalStmt.get(presentation.producto_id) || null;
    const rates = getRates();
    const enriched = enrichPresentation(presentation, rates);

    res.json({
      ...enriched,
      producto: product
    });
  } catch (error) {
    console.error('Error getting presentation by barcode:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getPresentations,
  getPresentationById,
  createPresentation,
  updatePresentation,
  deletePresentation,
  getPresentationByBarcode
};
