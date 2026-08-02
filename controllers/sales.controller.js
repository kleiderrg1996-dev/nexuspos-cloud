// controllers/sales.controller.js
const { db } = require('../src/database');
const { 
  loadSettings, 
  getDataBasePath, 
  loadTicketDesign, 
  loadTicketTemplate, 
  saveTicketDesign, 
  saveTicketTemplate, 
  resetTicketTemplate: resetTemplateUtil 
} = require('../src/utils/settings');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// ===== STATEMENTS GENERALES =====

const getRatesStmt = db.prepare(
  "SELECT key, value FROM settings WHERE key IN ('BCV', 'PARALELO', 'COP', 'CALC_METHOD', 'IVA_PERCENTAGE', 'IVA_MODE')"
);

// Productos
const getProductCountStmt = db.prepare(
  'SELECT COUNT(*) as count FROM productos WHERE nombre LIKE ? OR proveedor LIKE ? OR barcode LIKE ? OR categoria LIKE ?'
);
const getPaginatedProductsStmt = db.prepare(
  'SELECT * FROM productos WHERE nombre LIKE ? OR proveedor LIKE ? OR barcode LIKE ? OR categoria LIKE ? ORDER BY nombre ASC LIMIT ? OFFSET ?'
);
const exportAllProductsStmt = db.prepare(
  'SELECT id, nombre, costo, moneda_costo, porcentaje_ganancia, stock, categoria, tipo_venta, proveedor, barcode, costo_bulto, unidades_bulto FROM productos ORDER BY id ASC'
);
const exportCategoryProductsStmt = db.prepare(
  'SELECT id, nombre, costo, moneda_costo, porcentaje_ganancia, stock, categoria, tipo_venta, proveedor, barcode, costo_bulto, unidades_bulto FROM productos WHERE categoria = ? ORDER BY id ASC'
);
const createProductStmt = db.prepare(
  'INSERT INTO productos (nombre, costo, moneda_costo, porcentaje_ganancia, stock, categoria, tipo_venta, proveedor, barcode, costo_bulto, unidades_bulto) VALUES (@nombre, @costo, @moneda_costo, @porcentaje_ganancia, @stock, @categoria, @tipo_venta, @proveedor, @barcode, @costo_bulto, @unidades_bulto)'
);
const getProductByIdStmt = db.prepare(
  'SELECT id, nombre, stock, costo, moneda_costo, porcentaje_ganancia, tipo_venta, proveedor, categoria, barcode, costo_bulto, unidades_bulto, exento_iva FROM productos WHERE id = ?'
);
const updateProductStmt = db.prepare(
  'UPDATE productos SET nombre = @nombre, costo = @costo, moneda_costo = @moneda_costo, porcentaje_ganancia = @porcentaje_ganancia, stock = @stock, categoria = @categoria, tipo_venta = @tipo_venta, proveedor = @proveedor, barcode = @barcode, costo_bulto = @costo_bulto, unidades_bulto = @unidades_bulto WHERE id = @id'
);
const deleteProductStmt = db.prepare('DELETE FROM productos WHERE id = ?');
const getProductByBarcodeStmt = db.prepare('SELECT * FROM productos WHERE barcode = ?');
const updateBarcodeStmt = db.prepare('UPDATE productos SET barcode = @barcode WHERE id = @id');
const getBultoProductsStmt = db.prepare(
  'SELECT id, nombre, costo, moneda_costo, costo_bulto, unidades_bulto FROM productos WHERE unidades_bulto > 1 ORDER BY nombre ASC'
);

// Categorías
const getCategoriesStmt = db.prepare('SELECT * FROM categorias ORDER BY nombre ASC');
const createCategoryStmt = db.prepare('INSERT OR IGNORE INTO categorias (nombre) VALUES (?)');
const getCategoryByIdStmt = db.prepare('SELECT nombre FROM categorias WHERE id = ?');
const getCategoryUsageStmt = db.prepare('SELECT COUNT(id) as count FROM productos WHERE categoria = ?');
const updateCategoryNameStmt = db.prepare('UPDATE categorias SET nombre = ? WHERE id = ?');
const updateProductsCategoryStmt = db.prepare('UPDATE productos SET categoria = ? WHERE categoria = ?');
const deleteCategoryStmt = db.prepare('DELETE FROM categorias WHERE id = ?');

// Ventas / Clientes / Abonos
const getSaleByIdStmt = db.prepare('SELECT * FROM ventas WHERE id = ?');
const getSaleProductsBySaleIdStmt = db.prepare(`
  SELECT vp.*, p.nombre as producto_nombre, p.exento_iva, p.tipo_venta
  FROM venta_productos vp 
  LEFT JOIN productos p ON vp.producto_id = p.id 
  WHERE vp.venta_id = ?
`);
const getSalePaymentsBySaleIdStmt = db.prepare('SELECT * FROM venta_pagos WHERE venta_id = ?');

// 🔴 IMPORTANTE: sólo abonos ACTIVOS (anulado = 0)
const getAbonosBySaleIdStmt = db.prepare(`
  SELECT
    id,
    cliente_id,
    venta_id,
    monto_pagado_ves,
    monto_pagado_usd,
    tasa_bcv_momento AS tasa_usd,
    metodo,
    fecha,
    COALESCE(anulado, 0) AS anulado,
    anulado_en,
    motivo_anulacion
  FROM abonos
  WHERE venta_id = ?
    AND COALESCE(anulado, 0) = 0
  ORDER BY fecha ASC
`);

const getClienteByIdStmt = db.prepare('SELECT * FROM clientes WHERE id = ?');

// 🔽 PARA ANULAR VENTA
const deleteSalePaymentsStmt = db.prepare('DELETE FROM venta_pagos WHERE venta_id = ?');
const deleteSaleAbonosStmt = db.prepare('DELETE FROM abonos WHERE venta_id = ?');
const restoreStockOnCancelStmt = db.prepare('UPDATE productos SET stock = stock + ? WHERE id = ?');
const markSaleCancelledStmt = db.prepare(`
  UPDATE ventas
  SET estado_pago = 'ANULADO',
      monto_pendiente_usd = 0
  WHERE id = ?
`);

// 🔽 actualizar estado_pago y monto_pendiente_usd
const updateSaleStatusStmt = db.prepare(`
  UPDATE ventas
  SET estado_pago = ?, monto_pendiente_usd = ?
  WHERE id = ?
`);

// 🔽 KARDEX
const createKardexStmt = db.prepare(`
  INSERT INTO kardex (
    producto_id, tipo, cantidad, motivo, referencia_id, stock_anterior, stock_nuevo
  ) VALUES (
    @producto_id, @tipo, @cantidad, @motivo, @referencia_id, @stock_anterior, @stock_nuevo
  )
`);

const uploadsBasePath = path.join(getDataBasePath(), 'uploads');

// ===== HELPERS =====

function calculateInternalCostVes(product, rates) {
  let costInVes = 0.0;
  const validRates = {
    BCV: typeof rates?.BCV === 'number' ? rates.BCV : 0,
    PARALELO: typeof rates?.PARALELO === 'number' ? rates.PARALELO : 0,
    COP: typeof rates?.COP === 'number' ? rates.COP : 0,
  };
  switch (product.moneda_costo) {
    case 'VES':
      costInVes = product.costo;
      break;
    case 'BCV':
      costInVes = product.costo * validRates.BCV;
      break;
    case 'PARALELO':
      costInVes = product.costo * validRates.PARALELO;
      break;
    case 'COP':
      costInVes = product.costo * validRates.COP;
      break;
    default:
      console.error(`Unknown cost currency: ${product.moneda_costo} for product ID ${product.id}`);
  }
  return costInVes;
}

function calculateSalePrices(product, rates) {
  const costInVes = calculateInternalCostVes(product, rates);
  let finalPriceVes = 0;

  const calcMethod = rates.CALC_METHOD || 1;
  const percentage = product.porcentaje_ganancia / 100;

  if (calcMethod === 2) {
    if (percentage >= 1) {
      finalPriceVes = costInVes;
    } else {
      finalPriceVes = costInVes / (1 - percentage);
    }
  } else {
    finalPriceVes = costInVes * (1 + percentage);
  }

  const finalPriceUsdBcv =
    rates?.BCV && rates.BCV > 0 ? finalPriceVes / rates.BCV : 0;
  return {
    ...product,
    costo_en_ves: costInVes,
    precio_final_ves: finalPriceVes,
    precio_final_usd_bcv: finalPriceUsdBcv,
  };
}

const getRates = () => {
  const ratesList = getRatesStmt.all();
  return ratesList.reduce((obj, rate) => {
    obj[rate.key] = rate.value;
    return obj;
  }, {});
};

/**
 * 🔧 Recalcula cuánto falta realmente por pagar en una venta
 * usando los pagos iniciales (venta_pagos) + abonos (SOLO los no anulados),
 * y actualiza ventas.estado_pago / ventas.monto_pendiente_usd.
 */
function recalcSalePendingAndStatus(saleId) {
  const sale = getSaleByIdStmt.get(saleId);
  if (!sale) {
    return null;
  }

  // Ventas anuladas: no tocamos nada
  if (sale.estado_pago === 'ANULADO') {
    return {
      ...sale,
      pendienteVes: 0,
      pendienteUsd: 0,
      monto_pendiente_usd: 0,
      estado_pago: 'ANULADO',
    };
  }

  // Tasa de conversión de la venta (Forzar PARALELO para deudas si está disponible)
  let tasaTipo = sale.tasa_referencia || 'BCV';
  const rates = getRates();
  if (rates.PARALELO) tasaTipo = 'PARALELO';
  const currentRate = !isNaN(rates[tasaTipo]) && rates[tasaTipo] > 0 ? Number(rates[tasaTipo]) : 1;
  const bcvRate = !isNaN(rates.BCV) && rates.BCV > 0 ? Number(rates.BCV) : 1;

  // ===== LÓGICA DE CALCULO SUPER ESTRICTO (2 DECIMALES) =====

  // 1) Obtener Total Original USD y redondearlo a 2 decimales inmediatamente
  // Importante: Si la venta se guardó sin total_usd_bcv (versiones viejas), lo calculamos del total_ves
  let totalUsdOriginal = Number(sale.total_usd_bcv) || 0;
  if (!totalUsdOriginal) {
    const totalVes = Number(sale.total_ves) || 0;
    if (currentRate > 0 && totalVes > 0) {
      totalUsdOriginal = totalVes / currentRate;
    }
  }
  // Enforce 4 decimals
  totalUsdOriginal = Math.round(totalUsdOriginal * 10000) / 10000;

  // Calcular Tasa Implícita de la Venta (para usar como fallback en pagos históricos)
  const totalVesOriginal = Number(sale.total_ves) || 0;
  let saleImpliedRate = 0;
  if (totalUsdOriginal > 0 && totalVesOriginal > 0) {
    saleImpliedRate = totalVesOriginal / totalUsdOriginal;
  } else if (currentRate > 0) {
    saleImpliedRate = currentRate;
  }

  // Si no hay deuda original válida, asumo PAGADO y salgo
  if (totalUsdOriginal <= 0) {
    if (sale.estado_pago !== 'PAGADO') {
      updateSaleStatusStmt.run('PAGADO', 0, saleId);
    }
    return { ...sale, pendienteVes: 0, pendienteUsd: 0, monto_pendiente_usd: 0, estado_pago: 'PAGADO' };
  }

  // 2) Sumar pagos iniciales (venta_pagos)
  // Cada pago se convierte a USD y se redondea a 2 decimales INDIVIDUALMENTE antes de sumar
  let totalPagadoUsd = 0;

  const payments = getSalePaymentsBySaleIdStmt.all(saleId);
  payments.forEach((p) => {
    let pagoUsdRaw = 0;

    // Si ya venía en USD (USD_EFECTIVO, ZELLE y monto_recibido existe)
    if ((p.metodo === 'USD_EFECTIVO' || p.metodo === 'ZELLE') && p.monto_recibido) {
      pagoUsdRaw = Number(p.monto_recibido);
    } else {
      // Conversión desde VES
      const montoVes = Number(p.monto_en_ves) || 0;
      // USAR TASA IMPLICITA SI FALTA
      let tasaPago = Number(p.tasa_bcv_momento);
      if (!tasaPago || tasaPago <= 0) tasaPago = saleImpliedRate;
      pagoUsdRaw = montoVes / tasaPago;
    }

    // SUMA DIRECTA (sin redondear aquí)
    totalPagadoUsd += pagoUsdRaw;
  });

  // 3) Sumar Abonos
  const abonos = getAbonosBySaleIdStmt.all(saleId);
  abonos.forEach((a) => {
    let abonoUsdRaw = 0;

    // Prioridad: monto_pagado_usd explícito en la BD
    if (a.monto_pagado_usd != null && !isNaN(Number(a.monto_pagado_usd))) {
      abonoUsdRaw = Number(a.monto_pagado_usd);
    } else {
      // Fallback: calcular desde VES
      const montoVes = Number(a.monto_pagado_ves) || 0;
      const tasaAbono = Number(a.tasa_usd) || currentRate || 1;
      abonoUsdRaw = montoVes / tasaAbono;
    }

    // SUMA DIRECTA (sin redondear aquí)
    totalPagadoUsd += abonoUsdRaw;
  });

  // 4) Calcular Pendiente
  let pendienteUsd = totalUsdOriginal - totalPagadoUsd;
  // REDONDEO FINAL A 4 DECIMALES (Para soportar micro-pagos en Bs que no llegan a 1 centavo)
  pendienteUsd = Math.round((pendienteUsd + Number.EPSILON) * 10000) / 10000;

  // ===== REGLAS DE NEGOCIO Y TOLERANCIAS =====

  // 1. FORZADO ABSOLUTO: Si la BD dice 'PAGADO', se respeta 'PAGADO' (Monto = 0)
  // salvo que haya una discrepancia ENORME (más de 2 USD) que indique error de datos grave.
  // Esto asegura que "Saldar Deuda" sea definitivo.
  // 1. FORZADO ABSOLUTO (Relaxed Logic for Recovery)
  // Si la BD dice 'PAGADO', confiamos... pero si hay una deuda evidente (> $0.01),
  // asumimos que fue un error de "auto-cierre" anterior y la mostramos.
  if (sale.estado_pago === 'PAGADO') {
    if (pendienteUsd > 0.01) {
      // WARNING: La deuda es real. Dejamos que el sistema la muestre como pendiente.
    } else {
      pendienteUsd = 0;
    }
  }

  // 2. Tolerancia de redondeo (0.0005 USD)
  // Si falta menos de medio milésimo, se considera CERO.
  // 2. Tolerancia de redondeo (USD Tolerance)
  // Usamos 0.0001 para ser mucho mas estrictos que antes (0.0005)
  if (pendienteUsd > 0 && pendienteUsd <= 0.0001) {
    pendienteUsd = 0;
  }

  // 3. Tolerancia negativa (pagó de más por centavos)
  if (pendienteUsd < 0 && pendienteUsd >= -0.05) {
    pendienteUsd = 0;
  }

  // 5) Determinar Estado Final
  let nuevoEstado = '';
  if (pendienteUsd <= 0) {
    nuevoEstado = 'PAGADO';
    pendienteUsd = 0; // Asegurar que no sea -0.00
  } else if (totalPagadoUsd > 0) {
    nuevoEstado = 'ABONADO';
  } else {
    nuevoEstado = 'FIADO';
  }

  // 6) Persistencia solo si cambió algo
  const salePendienteActual = Number(sale.monto_pendiente_usd) || 0;
  if (
    nuevoEstado !== sale.estado_pago ||
    Math.abs(salePendienteActual - pendienteUsd) > Number.EPSILON
  ) {
    updateSaleStatusStmt.run(nuevoEstado, pendienteUsd, saleId);
    sale.estado_pago = nuevoEstado;
    sale.monto_pendiente_usd = pendienteUsd;
  }

  const pendienteVes = Number((pendienteUsd * currentRate).toFixed(2));

  return {
    ...sale,
    pendienteVes,
    pendienteUsd,
    monto_pendiente_usd: pendienteUsd,
    estado_pago: nuevoEstado,
  };
}



// ===== VENTA: CREAR =====

const processSaleTransaction = db.transaction(
  (cart, payments, totalVes, totalUsd, rates, cliente_id, estado_pago, monto_pendiente_usd, impuesto_total, usuario_id, descuento_pct, descuento_ves) => {
    const productDetails = {};

    for (const item of cart) {
      const product = getProductByIdStmt.get(item.id);
      if (!product) throw new Error(`Product with ID ${item.id} not found.`);
      if (product.stock < item.quantity) {
        throw new Error(
          `Stock insufficient for ${product.nombre}. Available: ${product.stock}, Required: ${item.quantity}`
        );
      }
      productDetails[item.id] = product;
    }

    const ventaInfo = db
      .prepare(
        'INSERT INTO ventas (total_ves, total_usd_bcv, cliente_id, estado_pago, monto_pendiente_usd, impuesto_total, tasa_referencia, usuario_id, descuento_pct, descuento_ves) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(totalVes, totalUsd, cliente_id, estado_pago, monto_pendiente_usd, impuesto_total, rates._tasa_referencia || 'BCV', usuario_id || null, descuento_pct || 0, descuento_ves || 0);
    const ventaId = ventaInfo.lastInsertRowid;

    // Insertar productos y descontar stock
    for (const item of cart) {
      const productData = productDetails[item.id];
      const costoUnitarioVes = calculateInternalCostVes(productData, rates);
      db.prepare(
        'INSERT INTO venta_productos (venta_id, producto_id, cantidad, precio_unitario_ves, costo_unitario_ves) VALUES (?, ?, ?, ?, ?)'
      ).run(ventaId, item.id, item.quantity, item.priceVes, costoUnitarioVes);

      const unidadesADescontar = (parseFloat(item.quantity) || 0) * (parseFloat(item.unidadesBase) || 1);

      const stockUpdateInfo = db
        .prepare('UPDATE productos SET stock = stock - ? WHERE id = ?')
        .run(unidadesADescontar, item.id);
      if (stockUpdateInfo.changes !== 1) {
        throw new Error(
          `Failed to update stock correctly for product ID ${item.id}. Changes: ${stockUpdateInfo.changes}`
        );
      }

      // REGISTRAR EN KARDEX
      createKardexStmt.run({
        producto_id: item.id,
        tipo: 'SALIDA',
        cantidad: unidadesADescontar,
        motivo: 'VENTA',
        referencia_id: ventaId,
        stock_anterior: productData.stock,
        stock_nuevo: productData.stock - unidadesADescontar
      });
    }

    // Insertar pagos iniciales
    for (const payment of payments) {
      const validMethods = ['VES_EFECTIVO', 'USD_EFECTIVO', 'TARJETA', 'PAGOMOVIL', 'BIOPAGO', 'ZELLE'];
      if (!validMethods.includes(payment.method)) {
        throw new Error(`Invalid payment method received: ${payment.method}`);
      }
      db.prepare(
        'INSERT INTO venta_pagos (venta_id, metodo, monto_recibido, monto_en_ves, tasa_bcv_momento, referencia) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        ventaId,
        payment.method,
        payment.amountReceived,
        payment.amountInVes,
        rates.BCV,
        payment.referencia || null
      );
    }

    return ventaId;
  }
);

const processSale = (req, res) => {
  const { cart, payments, totalVes, totalUsd, cliente_id, roundingAdjustment, tasa_referencia, usuario_id, descuento_pct, descuento_ves } = req.body;

  if (!Array.isArray(cart) || cart.length === 0)
    return res.status(400).json({ error: 'Cart is empty or invalid.' });
  if (!Array.isArray(payments))
    return res.status(400).json({ error: 'Payment information is missing or invalid.' });
  // Nota: totalVes aquí es el total redondeado si viene del frontend nuevo
  if (isNaN(parseFloat(totalVes)) || isNaN(parseFloat(totalUsd)))
    return res.status(400).json({ error: 'Total amounts are missing or invalid.' });

  try {
    const currentRates = getRates();
    if (isNaN(currentRates.BCV) || currentRates.BCV <= 0) {
      throw new Error('Tasa BCV no configurada o inválida.');
    }

    // Pasar el tipo de tasa seleccionado para indexación
    currentRates._tasa_referencia = tasa_referencia || 'BCV';

    const round2 = (n) => Math.round(n * 100) / 100;
    const final_cliente_id = cliente_id || null;

    // ASEGURAR REDONDEO DE ENTRADA PROYECTO
    const round4 = (n) => Math.round(n * 10000) / 10000;

    // Si viene roundingAdjustment (positivo o negativo), ya el totalVes viene redondeado.
    // Si queremos guardar el valor real de los productos, deberíamos recalcularlo.
    // PERO el usuario quiere que "el número redondeado salga en el ticket".
    // Así que guardaremos el totalVes tal cual viene (redondeado).
    // El roundingAdjustment nos sirve solo para log o validación si quisiéramos.

    // Si totalVes es el redondeado, lo usamos directo.
    let finalTotalVes = round2(parseFloat(totalVes));

    // Ajustar totalUsd proporcionalmente si hubo redondeo importante?
    // El frontend manda totalUsd basado en productos.
    // Si redondeamos Bs, el total en USD cambia ligeramente.
    // Recalculamos finalTotalUsd basado en finalTotalVes para consistencia
    // OJO: Esto puede variar si hay mezcla de monedas.
    // Mejor mantenemos el totalUsd original de los productos para control de inventario/ganancia,
    // y asumimos la diferencia de redondeo como ganancia/pérdida cambiaria.
    // EXCEPCIÓN: Si el redondeo es grande, ajustar totalUsd.
    // Por simplicidad, y dado que el redondeo es solo en Bs para efectivo, 
    // mantenemos totalUsd, PERO para "pagado completo" en USD, usamos la tolerancia.

    const finalTotalUsd = round4(parseFloat(totalUsd));

    let totalPagadoVes = 0;

    payments.forEach((p) => {
      totalPagadoVes += p.amountInVes;
    });

    // Comparar USD con tolerancia estricta
    // 0.0001 USD de tolerancia (mucho más estable que 0.05 Bs)
    const USD_TOLERANCE = 0.0001;

    // Calculamos lo que se pagó en USD (aproximado para la lógica de estado)
    // Nota: 'totalPagadoVes' sigue siendo útil para validaciones legacy, pero el estado lo define el USD.
    let totalPagadoUsdEstimado = 0;
    payments.forEach(p => {
      let valUsd = 0;
      if (p.method === 'USD_EFECTIVO') {
        valUsd = p.amountReceived;
      } else {
        // Convertir Bs a USD usando la tasa actual
        valUsd = p.amountInVes / currentRates.BCV;
      }
      totalPagadoUsdEstimado += valUsd;
    });

    const faltanteUsd = Math.max(0, finalTotalUsd - totalPagadoUsdEstimado);
    // Restore faltanteVes for legacy response usage
    const faltanteVes = Number((faltanteUsd * currentRates.BCV).toFixed(2));

    let estado_pago = 'PAGADO';
    let monto_pendiente_usd = 0;

    if (faltanteUsd > USD_TOLERANCE) {
      if (totalPagadoUsdEstimado > 0.01) {
        estado_pago = 'ABONADO';
      } else {
        estado_pago = 'FIADO';
      }

      if (final_cliente_id === null) {
        return res.status(400).json({
          error: 'Se debe seleccionar un cliente para guardar una venta a crédito.',
        });
      }

      // Asignamos el pendiente calculado
      monto_pendiente_usd = round4(faltanteUsd);
      if (monto_pendiente_usd < 0) monto_pendiente_usd = 0;
    }

    // Calcular Impuesto
    let totalImpuestoVes = 0;
    const ivaPercentage = currentRates.IVA_PERCENTAGE !== undefined ? parseFloat(currentRates.IVA_PERCENTAGE) : 16.0;
    const ivaRate = ivaPercentage / 100;
    const ivaMode = currentRates.IVA_MODE === 'EXCLUDED' ? 'EXCLUDED' : 'INCLUDED';

    for (const item of cart) {
      const product = getProductByIdStmt.get(item.id);
      // Si exento_iva es 0 o false, aplica impuesto
      if (product && (product.exento_iva === 0 || product.exento_iva === false)) {
        const lineTotal = item.priceVes * item.quantity;
        if (ivaMode === 'EXCLUDED') {
          // EXCLUDED: priceVes is Base. tax = base * rate
          totalImpuestoVes += (lineTotal * ivaRate);
        } else {
          // INCLUDED: priceVes is Final. tax = final - (final / (1+rate))
          const base = lineTotal / (1 + ivaRate);
          totalImpuestoVes += (lineTotal - base);
        }
      }
    }
    const finalImpuestoVes = Number(totalImpuestoVes.toFixed(2));

    const saleId = processSaleTransaction(
      cart,
      payments,
      finalTotalVes,
      finalTotalUsd,
      currentRates,
      final_cliente_id,
      estado_pago,
      monto_pendiente_usd,
      finalImpuestoVes,
      usuario_id,
      descuento_pct,
      descuento_ves
    );

    // 🔴 FORCE RECALC: Inmediatamente después de crear, forzamos el recálculo
    // para asegurar que lo guardado en BD sea idéntico a la lógica de lectura (recalcSalePendingAndStatus).
    // Esto evita inconsistencias de redondeo entre processSale y getClientDebts.
    recalcSalePendingAndStatus(saleId);

    // ===========================
    //  CARGAR CONFIG DE IMPRESIÓN
    // ===========================
    const settings = loadSettings();

    const rawPrintTicket =
      settings.printTicketEnabled !== undefined
        ? settings.printTicketEnabled
        : (settings.printTicket !== undefined ? settings.printTicket : false);

    const normalizedPrintTicket =
      rawPrintTicket === true ||
      rawPrintTicket === 'true' ||
      rawPrintTicket === 1 ||
      rawPrintTicket === '1';

    const printMode = settings.printMode || 'preview'; // 'preview' | 'direct'
    const printerName = settings.printerName || '';
    const printCopies = Number(settings.printCopies) || 1;
    const paperWidth =
      Number(settings.printPaperWidth || settings.ticketSize || 80) || 80;
    const printHeader = settings.printHeader || '';
    const printFooter = settings.printFooter || '';

    res.status(201).json({
      message: 'Sale completed successfully!',
      saleId: saleId,
      estado_pago: estado_pago,
      monto_pendiente: faltanteVes,
      monto_pendiente_usd: monto_pendiente_usd,

      printTicket: normalizedPrintTicket,

      printMode,
      printerName,
      printCopies,
      ticketSize: paperWidth,
      printHeader,
      printFooter,
      impuesto_total: finalImpuestoVes,
    });
  } catch (error) {
    console.error('Error processing sale transaction:', error);
    res.status(400).json({ error: error.message || 'Failed to process sale.' });
  }
};


// ===== RECIBO PDF =====

const getSaleReceipt = (req, res) => {
  const saleId = parseInt(req.params.id, 10);
  if (isNaN(saleId)) {
    return res.status(400).send('ID de venta invalido.');
  }

  try {
    const sale = getSaleByIdStmt.get(saleId);
    if (!sale) {
      return res.status(404).send('Venta no encontrada.');
    }

    // Tasas
    const ratesList = getRatesStmt.all();
    const currentRates = ratesList.reduce((obj, rate) => {
      obj[rate.key] = rate.value;
      return obj;
    }, {});
    const bcvRate = currentRates.BCV > 0 ? currentRates.BCV : 1;

    // Tasa de referencia real de esta venta (BCV o PARALELO)
    const saleRefType = sale.tasa_referencia || 'BCV';
    const saleRefRateRaw = parseFloat(currentRates[saleRefType]);
    const saleRefRate = (saleRefRateRaw > 0) ? saleRefRateRaw : bcvRate;

    // Datos venta
    const products = getSaleProductsBySaleIdStmt.all(saleId);
    const payments = getSalePaymentsBySaleIdStmt.all(saleId);
    const settings = loadSettings();

    let client = null;
    if (sale.cliente_id) {
      client = getClienteByIdStmt.get(sale.cliente_id);
    }

    // Configuracion de impresion
    const ticketSize = Number(settings.ticketSize) || 80;
    const is58mm = ticketSize === 58;
    const widthCss = is58mm ? '58mm' : '80mm';
    const fontSize = is58mm ? '11px' : '12px';

    // Logo
    let logoHtml = '';
    const logoFullPath = settings.logoPath
      ? path.join(uploadsBasePath, path.basename(settings.logoPath))
      : null;

    if (logoFullPath && fs.existsSync(logoFullPath)) {
      try {
        const logoData = fs.readFileSync(logoFullPath);
        const base64Image = logoData.toString('base64');
        const ext = path.extname(logoFullPath).toLowerCase().replace('.', '');
        const mime = ext === 'png' ? 'image/png' : (ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/generic');
        logoHtml = `<img src="data:${mime};base64,${base64Image}" class="logo" alt="Logo" />`;
      } catch (e) {
        console.error('Error leyendo logo para HTML:', e);
      }
    }

    const businessName = settings.businessName || 'Mi Negocio';
    const headerText = (settings.printHeader || '').replace(/\r?\n/g, '<br/>');
    const footerText = (settings.printFooter || '').replace(/\r?\n/g, '<br/>');

    const saleDate = new Date(sale.creado_en);
    const dateStr = saleDate.toLocaleDateString('es-VE');
    const timeStr = saleDate.toLocaleTimeString('es-VE');

    // Construcción de la lista de productos
    let productsHtml = '';
    products.forEach(p => {
      const totalItem = (p.cantidad * p.precio_unitario_ves).toFixed(2);
      const isExempt = (p.exento_iva === 1 || p.exento_iva === true || p.exento_iva === '1');
      const nameDisplay = p.producto_nombre || 'Producto';
      const indicator = isExempt ? ' (E)' : '';

      let unitSuffix = '';
      let cantidadDisplay = p.cantidad;
      if (p.tipo_venta === 'PESO') {
        unitSuffix = ' Kg';
        cantidadDisplay = Number(p.cantidad).toFixed(3);
      } else if (p.tipo_venta === 'LITRO') {
        unitSuffix = ' Lt';
        cantidadDisplay = Number(p.cantidad).toFixed(3);
      }

      productsHtml += `
        <tr>
          <td class="qty">${cantidadDisplay}${unitSuffix}</td>
          <td class="item">${nameDisplay}${indicator}</td>
          <td class="price text-right">${totalItem}</td>
        </tr>
      `;
    });

    // Construcción de pagos
    let paymentsHtml = '';
    let totalPagadoVes = 0;

    if (payments.length > 0) {
      paymentsHtml += `
        <div class="row bold" style="margin-top: 5px;">
          <span>Método de Pago:</span>
          <span></span>
        </div>
      `;
    }

    payments.forEach(p => {
      let label = '';
      let amountDetail = '';

      switch (p.metodo) {
        case 'VES_EFECTIVO':
          label = 'Efectivo Bs';
          amountDetail = `${p.monto_recibido.toFixed(2)}`;
          break;
        case 'USD_EFECTIVO':
          label = 'Efectivo $';
          amountDetail = `${(p.monto_recibido || 0).toFixed(2)}`;
          break;
        case 'TARJETA':
          label = 'Tarjeta';
          amountDetail = `${p.monto_recibido.toFixed(2)}`;
          break;
        case 'BIOPAGO':
          label = 'Biopago';
          amountDetail = `${p.monto_recibido.toFixed(2)}`;
          break;
        case 'PAGOMOVIL':
          label = 'Pago Móvil';
          amountDetail = `${p.monto_recibido.toFixed(2)}`;
          break;
        case 'ZELLE':
          label = 'Zelle $';
          amountDetail = `${(p.monto_recibido || 0).toFixed(2)}`;
          break;
        default:
          label = p.metodo;
          amountDetail = `${p.monto_en_ves.toFixed(2)}`;
      }

      totalPagadoVes += p.monto_en_ves;

      paymentsHtml += `
        <div class="row">
          <span>${label}:</span>
          <span>${amountDetail}</span>
        </div>
      `;
    });

    // Totales
    const totalVes = sale.total_ves.toFixed(2);
    const totalUsd = sale.total_usd_bcv.toFixed(2);
    const ivaTotal = (sale.impuesto_total || 0).toFixed(2);
    const subtotalVes = (sale.total_ves - (sale.impuesto_total || 0)).toFixed(2);
    const descuentoPct = sale.descuento_pct || 0;
    const descuentoVes = sale.descuento_ves || 0;
    let discountHtml = '';
    if (descuentoPct > 0) {
      discountHtml = `
        <div class="row" style="color: #d32f2f;">
          <span>Descuento (${descuentoPct}%):</span>
          <span>-${descuentoVes.toFixed(2)} Bs</span>
        </div>
      `;
    }

    // Deuda y vuelto
    let extraInfoHtml = '';
    if (sale.monto_pendiente_usd > 0) {
      const montoPendienteVes = (sale.monto_pendiente_usd * saleRefRate).toFixed(2);
      extraInfoHtml += `
        <div class="row bold" style="margin-top: 5px;">
          <span>PENDIENTE:</span>
          <span>${montoPendienteVes} Bs</span>
        </div>
        <div class="row small">
          <span>(${sale.monto_pendiente_usd.toFixed(2)} $)</span>
        </div>
      `;
    }

    const vuelto = totalPagadoVes - (sale.total_ves - (sale.monto_pendiente_usd * saleRefRate));
    if (vuelto > 0.005) {
      extraInfoHtml += `
        <div class="row" style="margin-top: 5px;">
          <span>Vuelto:</span>
          <span>${vuelto.toFixed(2)} Bs</span>
        </div>
      `;
    }

    // HTML Completo usando la plantilla dinámica
    const design = loadTicketDesign();
    const templateHtml = loadTicketTemplate();

    let clientInfo = '';
    if (client) {
      clientInfo = '<div class="client-info">' +
                   '<div class="row"><span>Cliente: ' + client.nombre + '</span></div>' +
                   '<div class="row"><span>C.I./RIF: ' + (client.cedula || 'N/A') + '</span></div>' +
                   '</div>';
    }

    const mapVars = {
      '{{fontFamily}}': design.fontFamily || "'Courier New', Courier, monospace",
      '{{fontSize}}': design.fontSize ? design.fontSize + 'px' : fontSize,
      '{{widthCss}}': widthCss,
      '{{headerAlign}}': design.headerAlign || 'center',
      '{{footerAlign}}': design.footerAlign || 'center',
      '{{logoDisplay}}': design.showLogo ? 'block' : 'none',
      '{{logoSize}}': design.logoSize || 45,
      '{{clientDisplay}}': design.showClient ? 'block' : 'none',
      '{{tasaDisplay}}': design.showTasa ? 'block' : 'none',
      '{{logoHtml}}': logoHtml,
      '{{businessName}}': businessName,
      '{{headerText}}': headerText ? '<div class="small">' + headerText + '</div>' : '',
      '{{dateStr}}': dateStr,
      '{{timeStr}}': timeStr,
      '{{saleId}}': sale.id,
      '{{clientInfo}}': clientInfo,
      '{{productsHtml}}': productsHtml,
      '{{totalUsd}}': totalUsd,
      '{{totalVes}}': totalVes,
      '{{subtotalVes}}': subtotalVes,
      '{{ivaTotal}}': ivaTotal,
      '{{discountHtml}}': discountHtml,
      '{{paymentsHtml}}': paymentsHtml,
      '{{bcvRate}}': `${saleRefRate.toFixed(2)} (${saleRefType})`,  // muestra tasa usada y su tipo
      '{{extraInfoHtml}}': extraInfoHtml,
      '{{footerText}}': footerText || '¡Gracias por su compra!'
    };

    let renderedTemplate = templateHtml;
    for (const [key, value] of Object.entries(mapVars)) {
      renderedTemplate = renderedTemplate.replace(new RegExp(key, 'g'), value);
    }

    const html = '<!DOCTYPE html>\n' +
'<html lang="es">\n' +
'<head>\n' +
'  <meta charset="UTF-8">\n' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'  <title>Recibo #' + sale.id + '</title>\n' +
'  <style>\n' +
'    * { box-sizing: border-box; }\n' +
'    body { background-color: #f3f4f6; margin: 0; padding: 0; display: flex; flex-direction: column; align-items: center; min-height: 100vh; }\n' +
'    .toolbar { position: sticky; top: 0; width: 100%; background: white; padding: 10px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); display: flex; justify-content: center; gap: 15px; z-index: 100; }\n' +
'    .btn { padding: 8px 16px; border-radius: 6px; border: none; font-weight: 500; cursor: pointer; display: flex; align-items: center; gap: 5px; font-size: 14px; font-family: sans-serif; }\n' +
'    .btn-print { background-color: #2563eb; color: white; }\n' +
'    .btn-close { background-color: #ef4444; color: white; }\n' +
'    .preview-container { margin-top: 20px; margin-bottom: 40px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1); background: white; width: ' + widthCss + '; overflow: hidden; }\n' +
'    @media print { @page { margin: 0; size: ' + widthCss + ' auto; } body { background: none; display: block; margin: 0; padding: 0; } .toolbar { display: none !important; } .preview-container { box-shadow: none; margin: 0; width: ' + widthCss + '; overflow: visible; } }\n' +
'  </style>\n' +
'</head>\n' +
'<body>\n' +
'  <div class="toolbar">\n' +
'    <button class="btn btn-print" onclick="window.print()">Imprimir</button>\n' +
'    <button class="btn btn-close" onclick="window.close()">Cerrar</button>\n' +
'  </div>\n' +
'  <div class="preview-container">\n' +
'    ' + renderedTemplate + '\n' +
'  </div>\n' +
'  <script>\n' +
'    window.onload = function() {\n' +
'      if (window.innerWidth > 400) {\n' +
'        window.resizeTo(380, 850);\n' +
'      }\n' +
'    };\n' +
'  </script>\n' +
'</body>\n' +
'</html>';

    res.send(html);

  } catch (error) {
    console.error(`Error generando recibo HTML para venta ${saleId}:`, error);
    res.status(500).send('Error interno al generar el recibo.');
  }
};

// ===== DETALLES DE VENTA (para la vista) =====


const getSaleDetails = (req, res) => {
  const { id } = req.params;
  const saleId = parseInt(id, 10);

  if (isNaN(saleId)) {
    return res.status(400).json({ error: 'ID de venta inválido.' });
  }

  try {
    // Normalizamos primero la venta (estado_pago + monto_pendiente_usd)
    const sale = recalcSalePendingAndStatus(saleId);
    if (!sale) {
      return res.status(404).json({ error: 'Venta no encontrada.' });
    }

    let cliente = null;
    if (sale.cliente_id) {
      cliente = getClienteByIdStmt.get(sale.cliente_id);
    }

    const products = getSaleProductsBySaleIdStmt.all(saleId);
    const payments = getSalePaymentsBySaleIdStmt.all(saleId);
    const abonos = getAbonosBySaleIdStmt.all(saleId); // 👈 sólo activos

    res.json({
      sale,
      cliente,
      products,
      payments,
      abonos,
    });
  } catch (error) {
    console.error(`Error obteniendo detalles de venta ${saleId}: `, error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

// ===== REGISTRAR VUELTO (cambio) =====

const registerChange = (req, res) => {
  const saleId = req.params.id;
  const { changePayments } = req.body;

  if (!changePayments || changePayments.length === 0) {
    return res.status(200).json({ message: 'No change to register.' });
  }

  try {
    const rates = getRates();

    const insertChangeStmt = db.prepare(
      'INSERT INTO venta_pagos (venta_id, metodo, monto_recibido, monto_en_ves, tasa_bcv_momento, referencia) VALUES (?, ?, ?, ?, ?, ?)'
    );

    const transaction = db.transaction((payments) => {
      for (const p of payments) {
        const amount = parseFloat(p.amount) * -1;

        let amountInVes = 0;
        let tasa = null;

        if (p.method === 'USD_EFECTIVO') {
          tasa = rates.BCV;
          amountInVes = amount * tasa;
        } else {
          amountInVes = amount;
        }

        insertChangeStmt.run(saleId, p.method, amount, amountInVes, tasa, p.referencia || null);
      }
    });

    transaction(changePayments);
    res.json({ success: true, message: 'Vuelto registrado correctamente en el sistema.' });
  } catch (error) {
    console.error('Error registrando el vuelto:', error);
    res.status(500).json({ error: 'Error interno al registrar el vuelto.' });
  }
};

// ===== ANULAR VENTA (revertir stock + borrar pagos + borrar abonos) =====

const cancelSale = (req, res) => {
  const saleId = parseInt(req.params.id, 10);
  if (isNaN(saleId)) {
    return res.status(400).json({ error: 'ID de venta inválido.' });
  }

  try {
    const tx = db.transaction((id) => {
      const sale = getSaleByIdStmt.get(id);
      if (!sale) {
        throw new Error('Venta no encontrada.');
      }

      if (sale.estado_pago === 'ANULADO') {
        return { alreadyCancelled: true };
      }

      const items = getSaleProductsBySaleIdStmt.all(id);
      items.forEach((item) => {
        // Obtener stock actual antes de restaurar para el Kardex
        const product = getProductByIdStmt.get(item.producto_id);
        const currentStock = product ? product.stock : 0;

        restoreStockOnCancelStmt.run(item.cantidad, item.producto_id);

        // REGISTRAR EN KARDEX
        createKardexStmt.run({
          producto_id: item.producto_id,
          tipo: 'ENTRADA',
          cantidad: item.cantidad,
          motivo: 'ANULACION',
          referencia_id: id,
          stock_anterior: currentStock,
          stock_nuevo: currentStock + item.cantidad
        });
      });

      deleteSalePaymentsStmt.run(id);
      deleteSaleAbonosStmt.run(id);
      markSaleCancelledStmt.run(id);

      return { alreadyCancelled: false };
    });

    const result = tx(saleId);

    if (result.alreadyCancelled) {
      return res.json({
        success: true,
        message: 'La venta ya estaba anulada previamente.',
      });
    }

    return res.json({
      success: true,
      message: 'Venta anulada correctamente. Stock restaurado y pagos/abonos eliminados.',
    });
  } catch (error) {
    console.error(`Error anulando venta ${saleId}: `, error);
    return res.status(500).json({ error: 'Error interno al anular la venta.' });
  }
};

const generateBudget = async (req, res) => {
  const { cart, totalVes, totalUsd, netSubtotalVes, totalTaxVes, cliente_id } = req.body;

  console.log('[Budget Backend] Received budget request');
  try {
    const { cart, totalVes, totalUsd, netSubtotalVes, totalTaxVes, cliente_id } = req.body;
    console.log('[Budget Backend] Data:', { totalVes, totalUsd, cliente_id, cartLength: cart?.length });

    if (!cart || !Array.isArray(cart)) {
      throw new Error('Cart is missing or invalid');
    }

    const settings = loadSettings();
    const rates = getRates();
    const bcvRate = rates.BCV > 0 ? rates.BCV : 1;

    let client = null;
    if (cliente_id) {
      console.log('[Budget Backend] Fetching client:', cliente_id);
      client = getClienteByIdStmt.get(cliente_id);
    }

    const ticketSize = Number(settings.ticketSize) || 80;
    const is58mm = ticketSize === 58;
    const widthCss = is58mm ? '58mm' : '80mm';
    const fontSize = is58mm ? '11px' : '12px';

    let logoHtml = '';
    const logoFullPath = settings.logoPath
      ? path.join(uploadsBasePath, path.basename(settings.logoPath))
      : null;

    if (logoFullPath && fs.existsSync(logoFullPath)) {
      try {
        const logoData = fs.readFileSync(logoFullPath);
        const base64Image = logoData.toString('base64');
        const ext = path.extname(logoFullPath).toLowerCase().replace('.', '');
        const mime = ext === 'png' ? 'image/png' : (ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/generic');
        logoHtml = `<img src="data:${mime};base64,${base64Image}" class="logo" alt="Logo" />`;
      } catch (e) {
        console.error('[Budget Backend] Error reading logo:', e);
      }
    }

    const businessName = settings.businessName || 'Mi Negocio';
    const headerText = (settings.printHeader || '').replace(/\r?\n/g, '<br/>');
    const footerText = (settings.printFooter || '').replace(/\r?\n/g, '<br/>');

    const dateStr = new Date().toLocaleDateString('es-VE');
    const timeStr = new Date().toLocaleTimeString('es-VE');

    let productsHtml = '';
    cart.forEach(p => {
      const q = Number(p.quantity) || 0;
      const pr = Number(p.priceVes) || 0;
      const lineTotal = (q * pr).toFixed(2);
      const isExempt = (p.exento_iva === 1 || p.exento_iva === true || p.exento_iva === '1');
      const indicator = isExempt ? ' (E)' : '';
      productsHtml += `
        <tr>
          <td class="qty">${q}</td>
          <td class="item">${p.name}${indicator}</td>
          <td class="price text-right">${lineTotal}</td>
        </tr>
      `;
    });

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Presupuesto</title>
  <style>
    body { 
      font-family: 'Courier New', Courier, monospace; 
      margin: 0; 
      padding: 0; 
      display: flex; 
      flex-direction: column; 
      align-items: center; 
      background: #f0f2f5; 
      color: #000;
    }
    .no-print-header { 
      width: 100%; 
      background: white; 
      padding: 10px 0; 
      display: flex; 
      justify-content: center; 
      gap: 15px; 
      border-bottom: 1px solid #ddd;
      margin-bottom: 20px;
    }
    .btn { 
      padding: 8px 20px; 
      border: none; 
      border-radius: 6px; 
      cursor: pointer; 
      font-weight: bold; 
      display: flex; 
      align-items: center; 
      gap: 8px;
      font-family: sans-serif;
      font-size: 16px;
    }
    .btn-print { background: #2563eb; color: white; }
    .btn-close { background: #ef4444; color: white; }
    .ticket { 
      width: ${widthCss}; 
      background: white; 
      padding: 15px; 
      box-shadow: 0 4px 15px rgba(0,0,0,0.1); 
      font-size: ${fontSize}; 
      line-height: 1.3; 
    }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .divider { border-top: 1px dashed #000; margin: 8px 0; height: 1px; }
    table { width: 100%; border-collapse: collapse; margin: 5px 0; }
    th { text-align: left; border-bottom: 1px dashed #000; padding-bottom: 5px; }
    .text-right { text-align: right; }
    .row { display: flex; justify-content: space-between; margin: 2px 0; }
    .client-info { margin: 8px 0; }
    
    @media print { 
      body { background: none; padding: 0; } 
      .ticket { box-shadow: none; width: 100%; border: none; padding: 0; } 
      .no-print-header { display: none; } 
    }
    
    /* Layout table columns */
    .col-can { width: 15%; }
    .col-prod { width: 55%; }
    .col-total { width: 30%; text-align: right; }
  </style>
</head>
<body>
  <div class="no-print-header">
    <button class="btn btn-print" onclick="window.print()">
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
      Imprimir
    </button>
    <button class="btn btn-close" onclick="window.close()">
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
      Cerrar
    </button>
  </div>

  <div class="ticket">
    <div class="center bold">${businessName}</div>
    <div class="center small">${headerText}</div>
    <div class="center small">Documento no fiscal</div>
    <div class="divider"></div>
    
    <div class="row">
      <span>Fecha: ${dateStr}</span>
      <span>${timeStr}</span>
    </div>
    <div class="bold">PRESUPUESTO #</div>
    <div class="divider"></div>
    
    ${client ? `
        <div class="client-info">
          <div>CLIENTE: ${client.nombre}</div>
          <div>C.I./RIF: ${client.cedula || 'N/A'}</div>
        </div>
        <div class="divider"></div>
      ` : ''}

    <table>
      <thead>
        <tr>
          <th class="col-can">Can</th>
          <th class="col-prod">Producto</th>
          <th class="col-total">Total</th>
        </tr>
      </thead>
      <tbody>
        ${cart.map(p => {
      const q = Number(p.quantity) || 0;
      const pr = Number(p.priceVes) || 0;
      const lineTotal = (q * pr).toFixed(2);
      const isExempt = (p.exento_iva === 1 || p.exento_iva === true || p.exento_iva === '1');
      const indicator = isExempt ? '(E)' : '';
      return `
            <tr>
              <td class="col-can">${q}</td>
              <td class="col-prod">${p.name}<br/>${indicator}</td>
              <td class="col-total">${lineTotal}</td>
            </tr>
          `;
    }).join('')}
      </tbody>
    </table>
    
    <div class="divider"></div>
    
    <div class="row bold">
      <span>TOTAL Bs:</span>
      <span>${(Number(totalVes) || 0).toFixed(2)}</span>
    </div>
    
    <div class="row">
      <span>TOTAL $ (Ref):</span>
      <span>${(Number(totalUsd) || 0).toFixed(2)}</span>
    </div>
    
    <div class="row text-right" style="justify-content: flex-end; gap: 10px;">
      <span>Tasa:</span>
      <span>${(Number(bcvRate) || 0).toFixed(4)}</span>
    </div>
    
    <div class="divider"></div>
    <div class="center">Gracias por su Compra.</div>
  </div>

  <script>
    window.onload = function() {
      if (window.innerWidth > 400) {
        window.resizeTo(380, 850);
      }
    };
  </script>
</body>
</html>`;

    console.log('[Budget Backend] HTML generated successfully');
    res.send(html);
  } catch (error) {
    console.error('[Budget Backend] Error generating budget:', error);
    res.status(500).json({ error: error.message || 'Failed to generate budget' });
  }
};

// ==========================================
// TICKET DESIGNER ENDPOINTS
// ==========================================
/* const {
  loadTicketDesign,
  saveTicketDesign,
  loadTicketTemplate,
  saveTicketTemplate,
  resetTicketTemplate: resetTemplateUtil
} = require('../src/utils/settings'); */

const getTicketDesign = (req, res) => {
  try {
    const design = loadTicketDesign();
    res.json(design);
  } catch (error) {
    res.status(500).json({ error: 'Error loading ticket design' });
  }
};

const saveTicketDesignController = (req, res) => {
  try {
    const success = saveTicketDesign(req.body);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to save design' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error saving ticket design' });
  }
};

const getTicketTemplate = (req, res) => {
  try {
    const template = loadTicketTemplate();
    res.json({ template });
  } catch (error) {
    res.status(500).json({ error: 'Error loading ticket template' });
  }
};

const saveTicketTemplateController = (req, res) => {
  try {
    const { template } = req.body;
    if (!template) {
      return res.status(400).json({ error: 'Template is required' });
    }
    const success = saveTicketTemplate(template);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to save template' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error saving ticket template' });
  }
};

const resetTicketTemplate = (req, res) => {
  try {
    const template = resetTemplateUtil();
    res.json({ success: true, template });
  } catch (error) {
    res.status(500).json({ error: 'Error resetting ticket template' });
  }
};

module.exports = {
  processSale,
  getSaleReceipt,
  getSaleDetails,
  registerChange,
  cancelSale,
  recalcSalePendingAndStatus,
  generateBudget,
  getTicketDesign,
  saveTicketDesign: saveTicketDesignController,
  getTicketTemplate,
  saveTicketTemplate: saveTicketTemplateController,
  resetTicketTemplate
};
