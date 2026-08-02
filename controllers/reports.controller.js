// controllers/reports.controller.js
const { db, getBcvRate } = require('../src/database');
const { loadSettings, getDataBasePath } = require('../src/utils/settings');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

// ================== QUERIES BASE ==================

// Ventas del día
const getSalesForDateStmt = db.prepare(`
  SELECT *
  FROM ventas
  WHERE date(creado_en) = date('now', 'localtime')
    AND estado_pago != 'ANULADO'
  ORDER BY creado_en ASC
`);

const getSalePaymentsForDateStmt = db.prepare(`
  SELECT vp.*
  FROM venta_pagos vp
  JOIN ventas v ON vp.venta_id = v.id
  WHERE date(v.creado_en) = date('now', 'localtime')
    AND v.estado_pago != 'ANULADO'
`);

// Ventas por rango
const getSalesByDateRangeStmt = db.prepare(`
  SELECT 
      v.id,
      v.total_ves,
      v.monto_pendiente_usd,
      v.impuesto_total,
      v.creado_en,
      v.estado_pago,
      u.username AS usuario_nombre,

      -- costo total de la mercancía en VES
      (
        SELECT 
          SUM(vp.costo_unitario_ves * vp.cantidad)
        FROM venta_productos vp
        WHERE vp.venta_id = v.id
      ) AS total_costo_ves,


--pagos hechos en el momento de la venta(POS)
  (
    SELECT 
          COALESCE(SUM(p.monto_en_ves), 0)
        FROM venta_pagos p
        WHERE p.venta_id = v.id
  ) AS total_pagos_ves,

    --abonos registrados luego(cobranza)
      (
        SELECT 
          COALESCE(SUM(a.monto_pagado_ves), 0)
        FROM abonos a
        WHERE a.venta_id = v.id
      ) AS total_abonos_ves

  FROM ventas v
  LEFT JOIN usuarios u ON v.usuario_id = u.id
  WHERE date(v.creado_en) BETWEEN date(?) AND date(?)
    AND v.estado_pago != 'ANULADO'
  ORDER BY v.creado_en ASC
  `);

const getSaleProductsForSaleIdStmt = db.prepare(`
  SELECT producto_id, cantidad 
  FROM venta_productos 
  WHERE venta_id = ?
  `);

const getSaleProductsForSaleIdWithNameStmt = db.prepare(`
  SELECT vp.cantidad, COALESCE(p.nombre, 'Avance de Efectivo') as producto_nombre 
  FROM venta_productos vp
  LEFT JOIN productos p ON vp.producto_id = p.id
  WHERE vp.venta_id = ?
`);

const searchSalesStmt = db.prepare(`
  SELECT
    v.id,
    v.total_ves,
    v.creado_en,
    v.estado_pago,
    c.nombre as cliente_nombre,
    u.username AS usuario_nombre,
    (SELECT SUM(vp.costo_unitario_ves * vp.cantidad) FROM venta_productos vp WHERE vp.venta_id = v.id) AS total_costo_ves,
    (SELECT COALESCE(SUM(p.monto_en_ves), 0) FROM venta_pagos p WHERE p.venta_id = v.id) AS total_pagos_ves,
    (SELECT COALESCE(SUM(a.monto_pagado_ves), 0) FROM abonos a WHERE a.venta_id = v.id) AS total_abonos_ves
  FROM ventas v
  LEFT JOIN clientes c ON v.cliente_id = c.id
  LEFT JOIN usuarios u ON v.usuario_id = u.id
  WHERE v.id LIKE ?
    OR c.nombre LIKE ?
    OR CAST(v.total_ves AS TEXT) LIKE ?
  ORDER BY v.creado_en DESC
  LIMIT 50
  `);

const getPaymentsByDateRangeStmt = db.prepare(`
SELECT
a.id,
  a.fecha,
  a.cliente_id,
  a.venta_id,
  a.monto_pagado_ves,
  a.monto_pagado_usd,
  a.tasa_bcv_momento,
  a.metodo,
  c.nombre AS cliente_nombre,
  u.username AS usuario_nombre
  FROM abonos a
  LEFT JOIN clientes c ON a.cliente_id = c.id
  LEFT JOIN usuarios u ON a.usuario_id = u.id
  WHERE date(a.fecha) BETWEEN date(?) AND date(?)
  ORDER BY a.fecha ASC, a.id ASC
  `);

// 🔹 NUEVO: Historial de Gastos y Retiros para el Dashboard
const getExpensesByDateRangeStmt = db.prepare(`
  SELECT date(fecha) as fecha, SUM(monto_ves) as total_ves
  FROM gastos
  WHERE date(fecha) BETWEEN date(?) AND date(?)
  GROUP BY date(fecha)
`);

const getWithdrawalsByDateRangeStmt = db.prepare(`
  SELECT date(fecha) as fecha, SUM(monto_ves) as total_ves
  FROM retiros_caja
  WHERE date(fecha) BETWEEN date(?) AND date(?)
  GROUP BY date(fecha)
`);

const getSaleSimpleStmt = db.prepare(`
  SELECT id, estado_pago, monto_pendiente_usd
  FROM ventas
  WHERE id = ?
  `);

const voidSaleStmt = db.prepare(`
  UPDATE ventas
  SET estado_pago = 'ANULADO',
  monto_pendiente_usd = 0
  WHERE id = ?
  `);

const restoreStockStmt = db.prepare(`
  UPDATE productos
  SET stock = stock + ?
  WHERE id = ?
    `);

// 🔹 NUEVA VERSIÓN: último cierre de UN USUARIO ESPECÍFICO
const getLastClosureStmtByUser = db.prepare(`
  SELECT MAX(fecha) AS last_cierre
  FROM cierres_caja
  WHERE usuario_id = ?
`);

// 🔴 borrar pagos y abonos asociados a una venta anulada
const deleteSalePaymentsStmt = db.prepare(`
  DELETE FROM venta_pagos
  WHERE venta_id = ?
`);

const deleteSaleAbonosStmt = db.prepare(`
  DELETE FROM abonos
  WHERE venta_id = ?
`);

// ---------------- PAGOS DEL DÍA (POS + COBRANZA) ----------------
// ⚠️ IMPORTANTE: esta versión SOLO cuenta movimientos DESPUÉS del último Cierre Z de hoy.

const getPaymentsSummarySinceStmt = db.prepare(`
  SELECT
    metodo,
    SUM(total_ves) AS total_ves,
    SUM(total_usd) AS total_usd
  FROM (
    -- PAGOS DEL POS (venta_pagos)
    SELECT 
      vp.metodo AS metodo,
      SUM(vp.monto_en_ves) AS total_ves,
      SUM(
        CASE 
          WHEN vp.metodo IN ('USD_EFECTIVO', 'ZELLE') THEN vp.monto_recibido 
          ELSE 0 
        END
      ) AS total_usd
    FROM venta_pagos vp
    JOIN ventas v ON vp.venta_id = v.id
    WHERE datetime(v.creado_en) > datetime(?)
      AND v.estado_pago != 'ANULADO'
      AND v.usuario_id = ?
    GROUP BY vp.metodo

    UNION ALL

    -- ABONOS DE COBRANZA (tabla abonos)
    SELECT 
      a.metodo AS metodo,
      SUM(a.monto_pagado_ves) AS total_ves,
      SUM(
        CASE 
          WHEN a.metodo IN ('USD_EFECTIVO', 'ZELLE') THEN a.monto_pagado_usd 
          ELSE 0 
        END
      ) AS total_usd
    FROM abonos a
    WHERE datetime(a.fecha) > datetime(?)
      AND a.usuario_id = ?
    GROUP BY a.metodo
  ) AS combined
  GROUP BY metodo
`);

// ---------------- APERTURAS DE CAJA DEL DÍA ----------------

// Totales de aperturas del día DESPUÉS de cierto momento (para Cierre Z incremental)
const getOpeningsTotalsSinceStmt = db.prepare(`
  SELECT
    COALESCE(SUM(opening_ves), 0) AS total_opening_ves,
    COALESCE(SUM(opening_usd), 0) AS total_opening_usd
  FROM aperturas_caja
  WHERE datetime(fecha) > datetime(?)
    AND usuario_id = ?
`);

// Detalle de aperturas del día (para el PDF Z y JSON)
const getOpeningsDetailSinceStmt = db.prepare(`
  SELECT
    id,
    fecha,
    opening_ves,
    opening_usd,
    tasa_bcv_momento,
    notas
  FROM aperturas_caja
  WHERE datetime(fecha) > datetime(?)
    AND usuario_id = ?
  ORDER BY fecha ASC, id ASC
`);

// Insertar una nueva apertura de caja
const insertOpeningStmt = db.prepare(`
  INSERT INTO aperturas_caja(opening_ves, opening_usd, tasa_bcv_momento, notas, usuario_id)
  VALUES(?, ?, ?, ?, ?)
`);

// ---------------- RETIROS DE CAJA DEL DÍA ----------------

const getWithdrawalsSummarySinceStmt = db.prepare(`
  SELECT
    metodo,
    SUM(monto_ves) AS total_ves,
    SUM(monto_usd) AS total_usd
  FROM retiros_caja
  WHERE datetime(fecha) > datetime(?)
    AND usuario_id = ?
  GROUP BY metodo
`);

// detalle de retiros del día (para el PDF Z, SIEMPRE TODO EL DÍA)
const getWithdrawalsDetailSinceStmt = db.prepare(`
  SELECT
    id,
    fecha,
    metodo,
    monto_ves,
    monto_usd,
    descripcion
  FROM retiros_caja
  WHERE datetime(fecha) > datetime(?)
    AND usuario_id = ?
  ORDER BY fecha ASC, id ASC
`);

const insertWithdrawalStmt = db.prepare(`
  INSERT INTO retiros_caja(metodo, monto_ves, monto_usd, descripcion, usuario_id)
VALUES(@metodo, @monto_ves, @monto_usd, @descripcion, @usuario_id)
  `);

// ---------------- CIERRES DE CAJA (HISTORIAL CIERRE Z) ----------------

// Tabla original usada para saber el último cierre del día (no la tocamos)
// Insertar un nuevo cierre GLOBAL o por usuario
const insertClosureStmt = db.prepare(`
  INSERT INTO cierres_caja (usuario_id) VALUES (?)
`);

const getLastClosureStmt = db.prepare(`
  SELECT MAX(fecha) AS last_cierre
  FROM cierres_caja
`);



const insertCierreZHistoryStmt = db.prepare(`
  INSERT INTO cierres_z(
    total_sistema_ves,
    total_sistema_usd,
    total_manual_ves,
    total_manual_usd,
    diferencia_ves,
    diferencia_usd,
    notes,
    raw_json,
    usuario_id
  ) VALUES(
    @total_sistema_ves,
    @total_sistema_usd,
    @total_manual_ves,
    @total_manual_usd,
    @diferencia_ves,
    @diferencia_usd,
    @notes,
    @raw_json,
    @usuario_id
  )
    `);

const getCierreZHistoryCountStmt = db.prepare(`
  SELECT COUNT(*) AS total
  FROM cierres_z
  `);

const getCierreZHistoryStmt = db.prepare(`
SELECT
id,
  fecha,
  total_sistema_ves,
  total_sistema_usd,
  total_manual_ves,
  total_manual_usd,
  diferencia_ves,
  diferencia_usd,
  notes,
  raw_json
  FROM cierres_z
  ORDER BY datetime(fecha) DESC
LIMIT ? OFFSET ?
  `);

const getCierreZByIdStmt = db.prepare(`
  SELECT *
  FROM cierres_z
  WHERE id = ?
  `);

const getZReportCorrelativeStmt = db.prepare(`
  SELECT COUNT(*) AS count
  FROM cierres_z
  WHERE usuario_id = ?
`);

// ---------------- DASHBOARD STATS ----------------

const getTodayDashboardStatsStmt_Ventas = db.prepare(`
  SELECT
    COUNT(id) as sale_count,
    SUM(COALESCE(total_ves, 0)) as total_ingresos_ves,
    (SELECT SUM(COALESCE(vp.monto_en_ves, 0)) 
     FROM venta_pagos vp 
     JOIN ventas v2 ON vp.venta_id = v2.id 
     WHERE date(v2.creado_en) = date('now', 'localtime') 
       AND v2.estado_pago != 'ANULADO'
    ) as total_cobrado_ventas_hoy,
    (SELECT SUM(CASE WHEN vp.metodo IN ('USD_EFECTIVO', 'ZELLE') THEN vp.monto_recibido ELSE 0 END)
     FROM venta_pagos vp 
     JOIN ventas v2 ON vp.venta_id = v2.id 
     WHERE date(v2.creado_en) = date('now', 'localtime') 
       AND v2.estado_pago != 'ANULADO'
    ) as total_cobrado_usd,
    (SELECT SUM(CASE WHEN vp.metodo IN ('USD_EFECTIVO', 'ZELLE') THEN vp.monto_recibido ELSE 0 END)
     FROM venta_pagos vp 
     JOIN ventas v2 ON vp.venta_id = v2.id 
     WHERE date(v2.creado_en) = date('now', 'localtime') 
       AND v2.estado_pago != 'ANULADO'
    ) as total_ventas_hoy_usd,
    SUM((SELECT SUM(COALESCE(costo_unitario_ves, 0) * COALESCE(cantidad, 0)) FROM venta_productos vp WHERE vp.venta_id = v.id)) as total_costo_ves
  FROM ventas v
  WHERE date(creado_en) = date('now', 'localtime')
    AND estado_pago != 'ANULADO'
  `);

const getTodayDashboardStatsStmt_Abonos = db.prepare(`
SELECT
SUM(monto_pagado_ves) as total_abonos_hoy,
SUM(CASE WHEN metodo IN ('USD_EFECTIVO', 'ZELLE') THEN monto_pagado_usd ELSE 0 END) as total_abonos_usd
  FROM abonos
  WHERE date(fecha) = date('now', 'localtime')
  `);

// ---------------- NUEVOS QUERIES PARA PDF INVENTARIO / FIADOS ----------------

// inventario: usamos los datos base y calculamos el precio con las tasas
const getInventoryForPdfStmt = db.prepare(`
SELECT
  id,
  nombre,
  costo,
  moneda_costo,
  porcentaje_ganancia,
  stock,
  conteo_fisico
  FROM productos
  WHERE activo = 1
  ORDER BY nombre COLLATE NOCASE ASC
  `);

// ventas fiadas / abonadas con saldo pendiente + nombre del cliente
const getFiadosForPdfStmt = db.prepare(`
SELECT
v.id,
  v.creado_en,
  v.monto_pendiente_usd,
  v.estado_pago,
  c.nombre AS cliente_nombre
  FROM ventas v
  LEFT JOIN clientes c ON v.cliente_id = c.id
  WHERE v.estado_pago IN('FIADO', 'ABONADO')
    AND v.monto_pendiente_usd > 0
  ORDER BY v.creado_en ASC
`);

// ================== HELPERS ==================

const uploadsBasePath = path.join(getDataBasePath(), 'uploads');

function formatCurrency(value) {
  return Number(value || 0).toFixed(2);
}



// ---------------- HELPERS: NORMALIZACIÓN CIERRE Z ----------------

function numberOr(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function mapMetodoLabel(metodo) {
  switch (metodo) {
    case 'VES_EFECTIVO':
      return 'Efectivo Bs';
    case 'USD_EFECTIVO':
      return 'Efectivo $';
    case 'TARJETA':
      return 'Tarjeta';
    case 'PAGOMOVIL':
      return 'Pago Móvil';
    case 'BIOPAGO':
      return 'Biopago';
    default:
      return metodo || 'Otro';
  }
}

function normalizeCurrencyFromMetodo(metodo) {
  const s = String(metodo || '').toUpperCase();
  return s.includes('USD') ? 'USD' : 'VES';
}

// Acepta summaryData en cualquiera de estos formatos:
// 1) { metodo, sistema, manual, diferencia, currency }
// 2) { metodo, total_ves, total_usd, ... }  (manual puede no existir)
function normalizeCierreZSummaryData(summaryData) {
  if (!Array.isArray(summaryData)) return [];

  return summaryData.map((item) => {
    const metodo = item?.metodo ?? item?.method ?? item?.nombre ?? 'Método';

    const currency =
      String(item?.currency || item?.moneda || normalizeCurrencyFromMetodo(metodo)).toUpperCase() === 'USD'
        ? 'USD'
        : 'VES';

    // sistema/manual/diferencia (si existen)
    let sistema = numberOr(item?.sistema, item?.totalSistema, item?.total_sistema, item?.system);
    let manual = numberOr(item?.manual, item?.totalManual, item?.total_manual, item?.manual_count);
    let diff = numberOr(item?.diferencia, item?.diff);

    // fallback: total_ves/total_usd
    if (sistema === null) {
      sistema =
        currency === 'USD'
          ? numberOr(item?.total_usd, item?.totalUsd, item?.usd)
          : numberOr(item?.total_ves, item?.totalVes, item?.ves, item?.total);
      if (sistema === null) sistema = 0;
    }

    // si no hay manual guardado, dejamos 0
    if (manual === null) {
      manual =
        currency === 'USD'
          ? numberOr(item?.manual_usd, item?.manualUsd)
          : numberOr(item?.manual_ves, item?.manualVes);
      if (manual === null) manual = 0;
    }

    if (diff === null) diff = manual - sistema;

    return {
      metodo,
      label: item?.label || mapMetodoLabel(metodo),
      currency,
      sistema,
      manual,
      diferencia: diff
    };
  });
}

// ---- helpers de precios (copiados del products.controller) ----

const getRatesForPricingStmt = db.prepare(
  "SELECT key, value FROM settings WHERE key IN ('BCV', 'PARALELO', 'COP', 'CALC_METHOD')"
);

function getRatesForPricing() {
  const ratesList = getRatesForPricingStmt.all();
  return ratesList.reduce((obj, rate) => {
    if (rate.key === 'CALC_METHOD') {
      const n = parseInt(rate.value, 10);
      obj[rate.key] = Number.isNaN(n) ? 1 : n;
    } else {
      const n = parseFloat(rate.value);
      obj[rate.key] = Number.isNaN(n) ? 0 : n;
    }
    return obj;
  }, {});
}

function calculateInternalCostVes(product, rates) {
  let costInVes = 0.0;

  const validRates = {
    BCV: typeof rates?.BCV === 'number' ? rates.BCV : 0,
    PARALELO: typeof rates?.PARALELO === 'number' ? rates.PARALELO : 0,
    COP: typeof rates?.COP === 'number' ? rates.COP : 0
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
      console.error(`Unknown cost currency: ${product.moneda_costo} for product ID ${product.id} `);
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

  const finalPriceUsdBcv = rates?.BCV && rates.BCV > 0 ? finalPriceVes / rates.BCV : 0;
  return {
    ...product,
    costo_en_ves: costInVes,
    precio_final_ves: finalPriceVes,
    precio_final_usd_bcv: finalPriceUsdBcv
  };
}

// === Helper: calcula ingresos / costo / ganancia REALIZADA y fiado por venta ===
function computeRealizedSummaryForSales(sales) {
  let totalIngresos = 0;
  let totalCosto = 0;
  let totalGanancia = 0;
  let totalFiado = 0;
  let totalFiadoUsd = 0;

  const detailedSales = sales.map((sale) => {
    const totalVes = Number(sale.total_ves) || 0;
    const costoVes = Number(sale.total_costo_ves) || 0;
    const pagosVes = Number(sale.total_pagos_ves) || 0; // venta_pagos
    const abonosVes = Number(sale.total_abonos_ves) || 0; // abonos

    // Lo realmente cobrado por esta venta
    let pagadoVes = pagosVes + abonosVes;

    // Se removió el tope (if pagadoVes > totalVes) para permitir 
    // registrar la ganancia por diferencia cambiaria
    if (pagadoVes < 0) pagadoVes = 0;

    // Lo que aún falta por cobrar
    let pendienteVes = totalVes - pagadoVes;
    if (pendienteVes < 0) pendienteVes = 0;
    if (pendienteVes > totalVes) pendienteVes = totalVes;

    let pendienteUsd = Number(sale.monto_pendiente_usd) || 0;

    // Seguridad: si estuviera ANULADO (aunque el query los excluye)
    if (sale.estado_pago === 'ANULADO') {
      pagadoVes = 0;
      pendienteVes = 0;
      pendienteUsd = 0;
    }

    // Costo y ganancia realizada: primero se cubre costo, luego hay ganancia
    let costoRealizado;
    let gananciaRealizada;

    if (pagadoVes <= costoVes) {
      costoRealizado = pagadoVes;
      gananciaRealizada = 0;
    } else {
      costoRealizado = costoVes;
      gananciaRealizada = pagadoVes - costoVes;
    }

    totalIngresos += pagadoVes;
    totalCosto += costoRealizado;
    totalGanancia += gananciaRealizada;
    totalFiado += pendienteVes;
    totalFiadoUsd += pendienteUsd;

    return {
      ...sale,
      total_ves: totalVes,
      total_costo_ves: costoVes,
      total_pagado_ves: pagadoVes,
      total_pendiente_ves: pendienteVes,
      realized_ingreso_ves: pagadoVes,
      realized_costo_ves: costoRealizado,
      realized_ganancia_ves: gananciaRealizada
    };
  });

  return {
    summary: {
      totalIngresos,
      totalCosto,
      totalGanancia,
      totalFiado,
      totalFiadoUsd,
      totalVentas: sales.length
    },
    detailedSales
  };
}

// ================== LÓGICA DE NEGOCIO ==================

// ---------- Anular venta ----------

const voidSaleTransaction = db.transaction((saleId) => {
  const id = parseInt(saleId, 10);
  if (!id) {
    throw new Error('ID de venta inválido.');
  }

  const sale = getSaleSimpleStmt.get(id);
  if (!sale) {
    throw new Error('Venta no encontrada.');
  }

  // Si ya está anulada, no hacemos nada más
  if (sale.estado_pago === 'ANULADO') {
    return { alreadyCancelled: true };
  }

  // 1) Devolver productos al stock
  const products = getSaleProductsForSaleIdStmt.all(id);
  for (const prod of products) {
    restoreStockStmt.run(prod.cantidad, prod.producto_id);
  }

  // 2) Borrar TODOS los pagos de esa venta (POS, vuelto, etc.)
  deleteSalePaymentsStmt.run(id);

  // 3) Borrar TODOS los abonos de esa venta (cobranza)
  deleteSaleAbonosStmt.run(id);

  // 4) Marcar venta como ANULADA y sin pendiente
  voidSaleStmt.run(id);

  return { alreadyCancelled: false };
});

const voidSale = (req, res) => {
  const { saleId } = req.params;
  try {
    const result = voidSaleTransaction(saleId);

    if (result.alreadyCancelled) {
      return res.json({
        success: true,
        message: `La venta #${saleId} ya estaba anulada.`
      });
    }

    res.json({
      success: true,
      message: `Venta #${saleId} anulada con éxito.Se devolvió el stock y se eliminaron pagos / abonos asociados.`
    });
  } catch (error) {
    console.error('Error al anular la venta:', error);
    res.status(400).json({ error: error.message || 'No se pudo anular la venta.' });
  }
};

// ---------- Resumen diario de ventas (PDF simple) ----------

const getDailyCloseReport = async (req, res) => {
  try {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayStr = `${year} -${month} -${day} `;

    const settings = loadSettings();
    const logoFullPath = settings.logoPath
      ? path.join(uploadsBasePath, path.basename(settings.logoPath))
      : null;

    const sales = getSalesForDateStmt.all().map((sale) => ({
      ...sale,
      total_ves: Number(sale.total_ves || 0),
      total_usd_bcv: Number(sale.total_usd_bcv || 0)
    }));

    const payments = getSalePaymentsForDateStmt.all().map((pay) => ({
      ...pay,
      monto_en_ves: Number(pay.monto_en_ves || 0)
    }));

    const doc = new PDFDocument({ margin: 50 });
    const filename = `resumen - ventas - ${todayStr}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename *= UTF - 8''${encodeURIComponent(filename)} `
    );
    doc.pipe(res);

    let currentY = doc.y;
    let logoPlacedHeight = 0;

    if (logoFullPath && fs.existsSync(logoFullPath)) {
      try {
        const img = doc.openImage(logoFullPath);
        const logoMaxHeight = 40;
        const logoMaxWidth = 100;
        const imgRatio = img.width / img.height;

        let finalLogoWidth = logoMaxWidth;
        let finalLogoHeight = finalLogoWidth / imgRatio;

        if (finalLogoHeight > logoMaxHeight) {
          finalLogoHeight = logoMaxHeight;
          finalLogoWidth = finalLogoHeight * imgRatio;
        }

        finalLogoWidth = Math.min(finalLogoWidth, logoMaxWidth);

        doc.image(logoFullPath, 50, currentY, {
          width: finalLogoWidth,
          height: finalLogoHeight,
          align: 'left'
        });

        logoPlacedHeight = finalLogoHeight + 5;
        doc.y = currentY + logoPlacedHeight;
      } catch (imgError) {
        console.error('Error cargando imagen del logo:', imgError);
        logoPlacedHeight = 10;
        doc.y = currentY + logoPlacedHeight;
      }
    } else {
      logoPlacedHeight = 10;
      doc.y = currentY + logoPlacedHeight;
    }

    const textStartX = 50;
    const textStartY = 50 + logoPlacedHeight;

    doc.fontSize(20).font('Helvetica-Bold').text(settings.businessName || 'Mi Negocio', textStartX, textStartY, {
      align: 'center'
    });
    doc.moveDown(1);

    doc.fontSize(16).font('Helvetica-Bold').text('Resumen de Ventas Diario', {
      align: 'center'
    });

    doc.fontSize(12).font('Helvetica').text(
      `Fecha: ${today.toLocaleDateString('es-VE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      })
      } `,
      { align: 'center' }
    );
    doc.moveDown(2);

    doc.fontSize(14).font('Helvetica-Bold').text('Resumen General');
    doc.moveDown(0.5);

    const totalVentasVes = sales.reduce((sum, sale) => sum + sale.total_ves, 0);
    const totalVentasUsd = sales.reduce((sum, sale) => sum + sale.total_usd_bcv, 0);
    const totalImpuestoVes = sales.reduce((sum, sale) => sum + (sale.impuesto_total || 0), 0);
    const totalPagosVesEquivalente = payments.reduce((sum, pay) => sum + pay.monto_en_ves, 0);

    doc.fontSize(11).font('Helvetica');
    doc.text(`Total Ventas(${sales.length}): ${formatCurrency(totalVentasVes)} Bs / ${formatCurrency(totalVentasUsd)} $`);
    doc.text(`Total IVA Cobrado: ${formatCurrency(totalImpuestoVes)} Bs`);
    doc.text(`Total Pagos Recibidos(Equiv.Bs): ${formatCurrency(totalPagosVesEquivalente)} Bs`);
    doc.moveDown(2);

    if (sales.length > 0) {
      doc.fontSize(14).font('Helvetica-Bold').text('Detalle de Ventas');
      doc.moveDown(0.5);

      const colWidthId = 50;
      const colWidthTime = 100;
      const colWidthVes = 150;
      const colWidthUsd = 150;
      const itemXId = doc.page.margins.left;
      const itemXTime = itemXId + colWidthId + 5;
      const itemXVes = itemXTime + colWidthTime + 5;
      const itemXUsd = itemXVes + colWidthVes + 5;

      const headerY = doc.y;

      doc.fontSize(9).font('Helvetica-Bold');
      doc.text('ID', itemXId, headerY);
      doc.text('Hora', itemXTime, headerY);
      doc.text('Total Bs', itemXVes, headerY, { width: colWidthVes, align: 'right' });
      doc.text('Total $', itemXUsd, headerY, { width: colWidthUsd, align: 'right' });

      const headerLineY = headerY + 12;
      doc.moveTo(itemXId, headerLineY)
        .lineTo(doc.page.width - doc.page.margins.right, headerLineY)
        .strokeColor('#cccccc')
        .stroke();

      let rowY = headerLineY + 5;
      doc.fontSize(8).font('Helvetica');

      sales.forEach((sale) => {
        const saleTime = new Date(sale.creado_en).toLocaleTimeString('es-VE', {
          hour: '2-digit',
          minute: '2-digit'
        });

        doc.text(sale.id, itemXId, rowY, { width: colWidthId });
        doc.text(saleTime, itemXTime, rowY, { width: colWidthTime });
        doc.text(formatCurrency(sale.total_ves), itemXVes, rowY, { width: colWidthVes, align: 'right' });
        doc.text(formatCurrency(sale.total_usd_bcv), itemXUsd, rowY, { width: colWidthUsd, align: 'right' });

        const textHeight = doc.heightOfString(saleTime, { width: colWidthTime });
        rowY += textHeight + 5;
      });
    } else {
      doc.fontSize(11).font('Helvetica').text('No se registraron ventas en esta fecha.');
    }

    doc.end();
  } catch (error) {
    console.error('Error generando reporte PDF:', error);
    res.status(500).json({ error: 'Error interno al generar el reporte PDF.' });
  }
};

// ---------- Reporte por rango (JSON) ----------

const getReportByDateRange = (req, res) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'Se requieren fechas de inicio y fin.' });
  }

  try {
    const rawSales = getSalesByDateRangeStmt.all(startDate, endDate);
    const { summary, detailedSales } = computeRealizedSummaryForSales(rawSales);

    const detailedSalesWithProducts = detailedSales.map((sale) => {
      const products = getSaleProductsForSaleIdWithNameStmt.all(sale.id);
      return {
        ...sale,
        products
      };
    });

    // 🔹 NUEVO: Gastos y Retiros históricos para el gráfico
    const historicalExpenses = getExpensesByDateRangeStmt.all(startDate, endDate) || [];
    const historicalWithdrawals = getWithdrawalsByDateRangeStmt.all(startDate, endDate) || [];

    res.json({
      summary,
      detailedSales: detailedSalesWithProducts,
      historicalExpenses,
      historicalWithdrawals
    });
  } catch (error) {
    console.error('Error generando reporte por rango:', error);
    res.status(500).json({ error: 'Error interno del servidor al generar el reporte.' });
  }
};

// ---------- Reporte de abonos por rango ----------

const getPaymentsByDateRange = (req, res) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'Se requieren fechas de inicio y fin.' });
  }

  try {
    const payments = getPaymentsByDateRangeStmt.all(startDate, endDate);
    res.json({ payments });
  } catch (error) {
    console.error('Error generando reporte de abonos por rango:', error);
    res.status(500).json({
      error: 'Error interno del servidor al generar el reporte de abonos.'
    });
  }
};

// ---------- Reporte por rango (PDF) ----------

const getReportByDateRangePDF = async (req, res) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).send('Se requieren fechas de inicio y fin.');
  }

  try {
    const rawSales = getSalesByDateRangeStmt.all(startDate, endDate);
    const payments = getPaymentsByDateRangeStmt.all(startDate, endDate);

    const settings = loadSettings();
    const logoFullPath = settings.logoPath
      ? path.join(uploadsBasePath, path.basename(settings.logoPath))
      : null;

    const { summary, detailedSales } = computeRealizedSummaryForSales(rawSales);

    const detailedSalesWithProducts = detailedSales.map((sale) => {
      const products = getSaleProductsForSaleIdWithNameStmt.all(sale.id);
      return {
        ...sale,
        products
      };
    });

    const bcvRate = getBcvRate() || 1;

    const totalIngresos = summary.totalIngresos || 0;
    const totalCosto = summary.totalCosto || 0;
    const totalGanancia = summary.totalGanancia || 0;
    const totalFiado = summary.totalFiado || 0;

    const totalIngresosUsd = bcvRate > 0 ? totalIngresos / bcvRate : 0;
    const totalCostoUsd = bcvRate > 0 ? totalCosto / bcvRate : 0;
    const totalGananciaUsd = bcvRate > 0 ? totalGanancia / bcvRate : 0;
    const totalFiadoUsd = bcvRate > 0 ? totalFiado / bcvRate : 0;

    const totalAbonosVes = payments.reduce((sum, p) => sum + (Number(p.monto_pagado_ves) || 0), 0);

    const doc = new PDFDocument({ margin: 50 });
    const pageW = doc.page.width;
    const contentW = pageW - 100;
    const filename = `reporte - ventas - ${startDate} -a - ${endDate}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename *= UTF - 8''${encodeURIComponent(filename)} `
    );
    doc.pipe(res);

    if (logoFullPath && fs.existsSync(logoFullPath)) {
      try {
        doc.image(logoFullPath, 50, 50, { width: 100 });
        doc.y = 130;
      } catch (imgError) {
        console.error('Error cargando imagen del logo para PDF:', imgError);
        doc.y = 60;
      }
    }

    doc.fontSize(20).font('Helvetica-Bold')
      .text(settings.businessName || 'NexusPOS', 50, doc.y, { align: 'center', width: contentW });
    doc.moveDown(0.5);

    doc.fontSize(16).font('Helvetica-Bold')
      .text('Reporte de Ventas y Ganancias (ingreso realizado)', 50, doc.y, { align: 'center', width: contentW });

    doc.fontSize(12).font('Helvetica').text(`Del ${startDate} al ${endDate}`, 50, doc.y + 4, { align: 'center', width: contentW });
    doc.moveDown(2);

    doc.fontSize(14).font('Helvetica-Bold').text('Resumen del Período');
    doc.moveDown(0.5);

    doc.fontSize(11).font('Helvetica');
    doc.text(`Ingresos cobrados(ventas): ${formatCurrency(totalIngresos)} Bs(${formatCurrency(totalIngresosUsd)} $)`);
    doc.text(`Costo asociado a lo cobrado: ${formatCurrency(totalCosto)} Bs(${formatCurrency(totalCostoUsd)} $)`);
    doc.text(`Saldo pendiente(fiado): ${formatCurrency(totalFiado)} Bs(${formatCurrency(totalFiadoUsd)} $)`);
    doc.text(`Total de abonos registrados en el período: ${formatCurrency(totalAbonosVes)} Bs`);

    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica-Oblique').fillColor('gray');
    doc.text('Nota: Los ingresos cobrados incluyen pagos en el momento de la venta y abonos posteriores asociados a ventas fiadas/abonadas.');
    doc.fillColor('black');
    doc.moveDown(1.5);

    doc.fontSize(12).font('Helvetica-Bold').fillColor('green');
    doc.text(`Ganancia realizada: ${formatCurrency(totalGanancia)} Bs(${formatCurrency(totalGananciaUsd)} $)`);
    doc.fillColor('black');
    doc.moveDown(2);

    doc.fontSize(14).font('Helvetica-Bold').text('Detalle de Ventas');
    doc.moveDown(0.5);

    const colX1 = 50;
    const colX2 = 100;
    const colX3 = 250;
    const colX4 = 350;
    const colX5 = 425;
    const colX6 = 500;

    let headerY = doc.y;

    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('ID', colX1, headerY);
    doc.text('Fecha', colX2, headerY);
    doc.text('Productos', colX3, headerY);
    doc.text('Cobrado', colX4, headerY, { width: 70, align: 'right' });
    doc.text('Costo', colX5, headerY, { width: 70, align: 'right' });
    doc.text('Ganancia', colX6, headerY, { width: 70, align: 'right' });

    let headerLineY = headerY + 12;

    doc.moveTo(colX1, headerLineY)
      .lineTo(doc.page.width - doc.page.margins.right, headerLineY)
      .strokeColor('#cccccc')
      .stroke();

    doc.fontSize(8).font('Helvetica');
    let rowY = headerLineY + 5;

    if (detailedSalesWithProducts.length === 0) {
      doc.moveDown(1);
      doc.fontSize(11).font('Helvetica').text('No se registraron ventas en este rango de fechas.');
    } else {
      detailedSalesWithProducts.forEach((sale) => {
        const saleDate = new Date(sale.creado_en);
        const formattedDate = saleDate.toLocaleDateString('es-VE');
        const formattedTime = saleDate.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });

        const productsList = (sale.products || [])
          .map((p) => `${p.cantidad} x ${p.producto_nombre} `)
          .join(', ');

        const textHeight = doc.heightOfString(productsList, { width: 100, align: 'left' });

        if (rowY + textHeight > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          headerY = doc.page.margins.top;

          doc.fontSize(9).font('Helvetica-Bold');
          doc.text('ID', colX1, headerY);
          doc.text('Fecha', colX2, headerY);
          doc.text('Productos', colX3, headerY);
          doc.text('Cobrado', colX4, headerY, { width: 70, align: 'right' });
          doc.text('Costo', colX5, headerY, { width: 70, align: 'right' });
          doc.text('Ganancia', colX6, headerY, { width: 70, align: 'right' });

          headerLineY = headerY + 12;
          doc.moveTo(colX1, headerLineY)
            .lineTo(doc.page.width - doc.page.margins.right, headerLineY)
            .strokeColor('#cccccc')
            .stroke();

          rowY = headerLineY + 5;
          doc.fontSize(8).font('Helvetica');
        }

        const cobradoVenta = Number(sale.realized_ingreso_ves || 0);
        const costoVenta = Number(sale.realized_costo_ves || 0);
        const gananciaVenta = Number(sale.realized_ganancia_ves || 0);

        const cobradoUsd = bcvRate > 0 ? cobradoVenta / bcvRate : 0;
        const costoUsd = bcvRate > 0 ? costoVenta / bcvRate : 0;
        const gananciaUsd = bcvRate > 0 ? gananciaVenta / bcvRate : 0;

        doc.text(`Venta #${sale.id} `, colX1, rowY);
        doc.text(`${formattedDate} ${formattedTime} `, colX2, rowY);
        doc.text(productsList, colX3, rowY, { width: 100, align: 'left' });
        doc.text(`${formatCurrency(cobradoVenta)} (${formatCurrency(cobradoUsd)} $)`, colX4, rowY, { width: 85, align: 'right' });
        doc.text(`${formatCurrency(costoVenta)} (${formatCurrency(costoUsd)} $)`, colX5, rowY, { width: 85, align: 'right' });
        doc.text(`${formatCurrency(gananciaVenta)} (${formatCurrency(gananciaUsd)} $)`, colX6, rowY, { width: 85, align: 'right' });

        rowY += textHeight + 5;
      });
    }

    if (payments.length > 0) {
      doc.addPage();

      doc.fontSize(14).font('Helvetica-Bold').text('Detalle de Abonos');
      doc.moveDown(0.5);

      const abCol1 = 50;
      const abCol2 = 140;
      const abCol3 = 200;
      const abCol4 = 350;
      const abCol5 = 440;
      const abCol6 = 520;

      let abHeaderY = doc.y;

      doc.fontSize(9).font('Helvetica-Bold');
      doc.text('Fecha', abCol1, abHeaderY);
      doc.text('ID', abCol2, abHeaderY);
      doc.text('Cliente', abCol3, abHeaderY);
      doc.text('Venta', abCol4, abHeaderY);
      doc.text('Método', abCol5, abHeaderY);
      doc.text('Monto Bs', abCol6, abHeaderY, { width: 60, align: 'right' });

      let abLineY = abHeaderY + 12;
      doc.moveTo(abCol1, abLineY)
        .lineTo(doc.page.width - doc.page.margins.right, abLineY)
        .strokeColor('#cccccc')
        .stroke();

      let abRowY = abLineY + 5;
      doc.fontSize(8).font('Helvetica');

      const getMetodoLabel = (metodo) => {
        switch (metodo) {
          case 'VES_EFECTIVO':
            return 'Efectivo Bs';
          case 'USD_EFECTIVO':
            return 'Efectivo $';
          case 'TARJETA':
            return 'Tarjeta';
          case 'PAGOMOVIL':
            return 'Pago Móvil';
          default:
            return metodo || 'Otro';
        }
      };

      payments.forEach((p) => {
        if (abRowY > doc.page.height - doc.page.margins.bottom - 20) {
          doc.addPage();

          abHeaderY = doc.page.margins.top;
          doc.fontSize(9).font('Helvetica-Bold');
          doc.text('Fecha', abCol1, abHeaderY);
          doc.text('ID', abCol2, abHeaderY);
          doc.text('Cliente', abCol3, abHeaderY);
          doc.text('Venta', abCol4, abHeaderY);
          doc.text('Método', abCol5, abHeaderY);
          doc.text('Monto Bs', abCol6, abHeaderY, { width: 60, align: 'right' });

          abLineY = abHeaderY + 12;
          doc.moveTo(abCol1, abLineY)
            .lineTo(doc.page.width - doc.page.margins.right, abLineY)
            .strokeColor('#cccccc')
            .stroke();

          abRowY = abLineY + 5;
          doc.fontSize(8).font('Helvetica');
        }

        const dateObj = p.fecha ? new Date(p.fecha) : null;
        let fechaStr = p.fecha || '';
        if (dateObj && !isNaN(dateObj.getTime())) {
          const d = dateObj.toLocaleDateString('es-VE');
          const h = dateObj.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
          fechaStr = `${d} ${h} `;
        }

        const cliente = p.cliente_nombre || 'Cliente';
        const ventaId = p.venta_id ? `Venta #${p.venta_id} ` : '-';
        const metodoLabel = getMetodoLabel(p.metodo);

        const montoVes = typeof p.monto_pagado_ves === 'number' ? p.monto_pagado_ves : 0;

        doc.text(fechaStr, abCol1, abRowY);
        doc.text(`#${p.id} `, abCol2, abRowY);
        doc.text(cliente, abCol3, abRowY, { width: 140 });
        doc.text(ventaId, abCol4, abRowY, { width: 80 });
        doc.text(metodoLabel, abCol5, abRowY, { width: 70 });
        doc.text(formatCurrency(montoVes), abCol6, abRowY, { width: 60, align: 'right' });

        abRowY += 14;
      });
    }

    doc.end();
  } catch (error) {
    console.error('Error generando reporte PDF por rango:', error);
    res.status(500).send('Error al generar PDF de ventas. Intente de nuevo.');
  }
};

// ---------- Resumen de pagos del día (para Cierre Z) ----------
// ⚠️ AQUÍ ES DONDE HACEMOS QUE, DESPUÉS DE UN CIERRE Z, EL SALDO DEL SISTEMA VUELVA A 0.

const getTodayPaymentSummary = (req, res) => {
  try {
    const usuario_id = req.query.usuario_id || null;

    // 1) Buscamos el último cierre del usuario (o global si no hay)
    let fromDateTime = '1970-01-01 00:00:00';
    try {
      const row = getLastClosureStmtByUser.get(usuario_id);
      if (row && row.last_cierre) {
        fromDateTime = row.last_cierre;
      }
    } catch (e) {
      console.warn('Advertencia: no se pudo obtener el último cierre de caja del usuario:', e.message);
    }

    // 2) Movimientos desde ese momento en adelante para ESTE usuario
    const payments = getPaymentsSummarySinceStmt.all(fromDateTime, usuario_id, fromDateTime, usuario_id);

    let withdrawals = [];
    let openingsTotals = null;

    try {
      withdrawals = getWithdrawalsSummarySinceStmt.all(fromDateTime, usuario_id);
    } catch (e) {
      console.warn('Advertencia: no se pudo obtener el resumen de retiros de caja:', e.message);
    }

    try {
      openingsTotals = getOpeningsTotalsSinceStmt.get(fromDateTime, usuario_id);
    } catch (e) {
      console.warn('Advertencia: no se pudo obtener el resumen de aperturas de caja:', e.message);
    }

    const byMethod = {};

    const ensureMethod = (metodo) => {
      if (!byMethod[metodo]) {
        byMethod[metodo] = {
          metodo,
          total_ves: 0,
          total_usd: 0
        };
      }
      return byMethod[metodo];
    };

    // 3) Sumamos aperturas de caja (saldo inicial desde el último cierre)
    if (openingsTotals) {
      const aperturaVes = Number(openingsTotals.total_opening_ves || 0);
      const aperturaUsd = Number(openingsTotals.total_opening_usd || 0);

      if (aperturaVes !== 0) {
        const mVes = ensureMethod('VES_EFECTIVO');
        mVes.total_ves += aperturaVes;
      }
      if (aperturaUsd !== 0) {
        const mUsd = ensureMethod('USD_EFECTIVO');
        mUsd.total_usd += aperturaUsd;
      }
    }

    // 4) Sumamos cobros del período (ventas + abonos)
    payments.forEach((row) => {
      const m = ensureMethod(row.metodo);
      m.total_ves += Number(row.total_ves || 0);
      m.total_usd += Number(row.total_usd || 0);
    });

    // 5) Restamos retiros de caja del período
    withdrawals.forEach((row) => {
      const m = ensureMethod(row.metodo);
      m.total_ves -= Number(row.total_ves || 0);
      m.total_usd -= Number(row.total_usd || 0);
    });

    const summary = Object.values(byMethod);
    res.json(summary);
  } catch (error) {
    console.error('Error al obtener resumen de pagos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ---------- PDF Cierre Z ----------

const printCierreZ = (req, res) => {
  const { summaryData, notes, totals } = req.body;

  try {
    const settings = loadSettings();
    const logoFullPath = settings.logoPath
      ? path.join(uploadsBasePath, path.basename(settings.logoPath))
      : null;

    const today = new Date();
    const todayStr = today.toLocaleDateString('sv-SE');

    // 🔹 Registrar un nuevo Cierre Z en el historial "simple" (tabla cierres_caja)
    const currentUserId = req.body.usuario_id || null;
    try {
      insertClosureStmt.run(currentUserId);
      console.log(`Cierre de caja registrado en cierres_caja para usuario: ${currentUserId}`);
    } catch (e) {
      console.error('Error registrando cierre de caja (cierres_caja):', e.message);
    }

    // 1) Determinar desde cuándo buscar (último cierre de ESTE usuario)
    let fromDateTime = '1970-01-01 00:00:00';
    try {
      const row = getLastClosureStmtByUser.get(currentUserId);
      if (row && row.last_cierre) {
        fromDateTime = row.last_cierre;
      }
    } catch (e) {
      console.warn('Advertencia: no se pudo obtener el último cierre de caja del usuario:', e.message);
    }

    // Aperturas de caja del período
    let openings = [];
    try {
      openings = getOpeningsDetailSinceStmt.all(fromDateTime, currentUserId);
    } catch (e) {
      console.warn('No se pudieron cargar las aperturas para el Cierre Z:', e.message);
    }

    // Retiros del período
    let withdrawals = [];
    try {
      withdrawals = getWithdrawalsDetailSinceStmt.all(fromDateTime, currentUserId);
    } catch (e) {
      console.warn('No se pudieron cargar los retiros para el Cierre Z:', e.message);
    }

    // 2) Obtener datos adicionales para el PDF y el snapshot
    let correlative = 0;
    try {
      const row = getZReportCorrelativeStmt.get(currentUserId);
      correlative = (row && row.count ? row.count : 0) + 1;
    } catch (e) {
      console.warn('Error obteniendo correlativo Z:', e.message);
      correlative = 1;
    }

    let openingTimeFormatted = 'N/A';
    if (openings.length > 0) {
      const firstOpening = openings[0];
      try {
        openingTimeFormatted = new Date(firstOpening.fecha).toLocaleString('es-VE', {
          dateStyle: 'short',
          timeStyle: 'short'
        });
      } catch (e) {
        openingTimeFormatted = firstOpening.fecha;
      }
    }
    const closingTimeFormatted = today.toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });

    // 🔹 Guardar snapshot detallado en tabla cierres_z (para historial / reimpresión)
    try {
      const sistemaVes = Number(totals && totals.sistemaVes !== undefined ? totals.sistemaVes : 0);
      const sistemaUsd = Number(totals && totals.sistemaUsd !== undefined ? totals.sistemaUsd : 0);
      const manualVes = Number(totals && totals.manualVes !== undefined ? totals.manualVes : 0);
      const manualUsd = Number(totals && totals.manualUsd !== undefined ? totals.manualUsd : 0);

      const diffVes =
        Number(
          totals && totals.diferenciaVes !== undefined
            ? totals.diferenciaVes
            : manualVes - sistemaVes
        ) || 0;

      const diffUsd =
        Number(
          totals && totals.diferenciaUsd !== undefined
            ? totals.diferenciaUsd
            : manualUsd - sistemaUsd
        ) || 0;

      const payload = {
        summaryData: summaryData || [],
        totals: totals || {},
        openings,
        withdrawals,
        correlative,
        openingTime: openingTimeFormatted,
        closingTime: closingTimeFormatted
      };

      insertCierreZHistoryStmt.run({
        total_sistema_ves: sistemaVes,
        total_sistema_usd: sistemaUsd,
        total_manual_ves: manualVes,
        total_manual_usd: manualUsd,
        diferencia_ves: diffVes,
        diferencia_usd: diffUsd,
        notes: notes ? String(notes) : null,
        raw_json: JSON.stringify(payload),
        usuario_id: req.body.usuario_id || null
      });

      console.log('Cierre Z registrado en tabla cierres_z.');
    } catch (e) {
      console.error('Error registrando historial de cierre Z (cierres_z):', e.message);
    }

    const doc = new PDFDocument({ margin: 50 });
    const filename = `cierre - z - ${todayStr}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename *= UTF - 8''${encodeURIComponent(filename)} `
    );
    doc.pipe(res);

    if (logoFullPath && fs.existsSync(logoFullPath)) {
      try {
        doc.image(logoFullPath, 50, doc.y, { width: 100, align: 'left' });
        doc.y += 50;
      } catch (imgError) {
        console.error('Error cargando imagen del logo para PDF:', imgError);
      }
    }

    doc.fontSize(20).font('Helvetica-Bold').text(settings.businessName || 'NexusPOS', {
      align: 'center'
    });
    doc.moveDown(1);

    doc.fontSize(16).font('Helvetica-Bold').text('Reporte de Cierre de Caja (Cierre Z)', {
      align: 'center'
    });

    doc.fontSize(12).font('Helvetica').text(
      `Fecha: ${today.toLocaleString('es-VE', { dateStyle: 'long', timeStyle: 'short' })}`,
      { align: 'center' }
    );

    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica-Bold').text(`N° Reporte Z: ${correlative}`, { align: 'center' });
    doc.moveDown(0.5);

    const timeY = doc.y;
    doc.fontSize(10).font('Helvetica');
    doc.text(`Apertura: ${openingTimeFormatted}`, 50, timeY, { width: 250, align: 'left' });
    doc.text(`Cierre: ${closingTimeFormatted}`, 300, timeY, { width: 250, align: 'right' });

    // ✅ FIX: resetear X al margen izquierdo antes de dibujar el conteo
    // (después de un text() con posición absoluta, el cursor X queda donde terminó el texto)
    doc.x = doc.page.margins.left;
    doc.moveDown(1.5);

    // -------- Conteo de pagos --------
    doc.fontSize(14).font('Helvetica-Bold').text('Conteo de Pagos');
    doc.moveDown(0.5);

    const col1 = 50;
    const col2 = 200;
    const col3 = 325;
    const col4 = 450;

    const headerY = doc.y;

    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Método de Pago', col1, headerY);
    doc.text('Total Sistema', col2, headerY, { width: 100, align: 'right' });
    doc.text('Conteo Manual', col3, headerY, { width: 100, align: 'right' });
    doc.text('Diferencia', col4, headerY, { width: 100, align: 'right' });

    let rowY = headerY + 15;

    doc.moveTo(col1, rowY - 5)
      .lineTo(doc.page.width - col1, rowY - 5)
      .strokeColor('#cccccc')
      .stroke();

    rowY += 5;

    doc.fontSize(10).font('Helvetica');

    (summaryData || []).forEach((item) => {
      doc.text(item.metodo, col1, rowY);
      doc.text(String(item.sistema ?? ''), col2, rowY, { width: 100, align: 'right' });
      doc.text(String(item.manual ?? ''), col3, rowY, { width: 100, align: 'right' });

      const diff = item.diferencia ?? 0;
      const diffStr = typeof diff === 'number' ? diff.toFixed(2) : String(diff);

      if (diff !== 0 && diffStr !== '0.00') {
        doc.fillColor('red').text(diffStr, col4, rowY, { width: 100, align: 'right' });
      } else {
        doc.fillColor('black').text(diffStr, col4, rowY, { width: 100, align: 'right' });
      }

      doc.fillColor('black');
      rowY += 20;
    });

    doc.moveTo(col1, rowY - 5)
      .lineTo(doc.page.width - col1, rowY - 5)
      .strokeColor('#cccccc')
      .stroke();

    doc.font('Helvetica-Bold');

    // Totales en VES
    doc.text('Total Bolívares (VES)', col1, rowY);
    doc.text(String(totals.sistemaVes ?? ''), col2, rowY, { width: 100, align: 'right' });
    doc.text(String(totals.manualVes ?? ''), col3, rowY, { width: 100, align: 'right' });

    const diffVes = totals.diferenciaVes ?? 0;
    const diffVesStr = typeof diffVes === 'number' ? diffVes.toFixed(2) : String(diffVes);

    if (diffVes !== 0 && diffVesStr !== '0.00') doc.fillColor('red');
    doc.text(diffVesStr, col4, rowY, { width: 100, align: 'right' });
    doc.fillColor('black');
    rowY += 20;

    // Totales en USD
    doc.text('Total Dólares (USD)', col1, rowY);
    doc.text(String(totals.sistemaUsd ?? ''), col2, rowY, { width: 100, align: 'right' });
    doc.text(String(totals.manualUsd ?? ''), col3, rowY, { width: 100, align: 'right' });

    const diffUsd = totals.diferenciaUsd ?? 0;
    const diffUsdStr = typeof diffUsd === 'number' ? diffUsd.toFixed(2) : String(diffUsd);

    if (diffUsd !== 0 && diffUsdStr !== '0.00') doc.fillColor('red');
    doc.text(diffUsdStr, col4, rowY, { width: 100, align: 'right' });
    doc.fillColor('black');
    rowY += 30;

    if (notes) {
      doc.fontSize(14).font('Helvetica-Bold').text('Notas / Justificación');
      doc.moveDown(0.5);
      doc.fontSize(11).font('Helvetica').text(String(notes));
    }

    // ---------- Aperturas de Caja del Día (vista histórica del día completo) ----------
    if (openings && openings.length > 0) {
      doc.addPage();

      doc.fontSize(14).font('Helvetica-Bold').text('Aperturas de Caja del Día');
      doc.moveDown(0.5);

      const aCol1 = 50; // Fecha
      const aCol2 = 150; // ID
      const aCol3 = 200; // Tasa BCV
      const aCol4 = 300; // Monto Bs
      const aCol5 = 380; // Monto $
      const aCol6 = 460; // Notas

      let aHeaderY = doc.y;

      doc.fontSize(9).font('Helvetica-Bold');
      doc.text('Fecha', aCol1, aHeaderY);
      doc.text('ID', aCol2, aHeaderY);
      doc.text('Tasa BCV', aCol3, aHeaderY, { width: 90, align: 'right' });
      doc.text('Monto Bs', aCol4, aHeaderY, { width: 70, align: 'right' });
      doc.text('Monto $', aCol5, aHeaderY, { width: 70, align: 'right' });
      doc.text('Notas', aCol6, aHeaderY);

      let aLineY = aHeaderY + 12;
      doc.moveTo(aCol1, aLineY)
        .lineTo(doc.page.width - doc.page.margins.right, aLineY)
        .strokeColor('#cccccc')
        .stroke();

      let aRowY = aLineY + 5;
      doc.fontSize(8).font('Helvetica');

      let totalAperturaVes = 0;
      let totalAperturaUsd = 0;

      openings.forEach((o) => {
        if (aRowY > doc.page.height - doc.page.margins.bottom - 20) {
          doc.addPage();

          aHeaderY = doc.page.margins.top;
          doc.fontSize(9).font('Helvetica-Bold');
          doc.text('Fecha', aCol1, aHeaderY);
          doc.text('ID', aCol2, aHeaderY);
          doc.text('Tasa BCV', aCol3, aHeaderY, { width: 90, align: 'right' });
          doc.text('Monto Bs', aCol4, aHeaderY, { width: 70, align: 'right' });
          doc.text('Monto $', aCol5, aHeaderY, { width: 70, align: 'right' });
          doc.text('Notas', aCol6, aHeaderY);

          aLineY = aHeaderY + 12;
          doc.moveTo(aCol1, aLineY)
            .lineTo(doc.page.width - doc.page.margins.right, aLineY)
            .strokeColor('#cccccc')
            .stroke();

          aRowY = aLineY + 5;
          doc.fontSize(8).font('Helvetica');
        }

        const dateObj = o.fecha ? new Date(o.fecha) : null;
        let fechaStr = o.fecha || '';
        if (dateObj && !isNaN(dateObj.getTime())) {
          const d = dateObj.toLocaleDateString('es-VE');
          const h = dateObj.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
          fechaStr = `${d} ${h} `;
        }

        const montoVes = Number(o.opening_ves || 0);
        const montoUsd = Number(o.opening_usd || 0);
        const tasaBcv = Number(o.tasa_bcv_momento || 0);
        const notas = o.notas || '';

        totalAperturaVes += montoVes;
        totalAperturaUsd += montoUsd;

        doc.text(fechaStr, aCol1, aRowY, { width: 90 });
        doc.text(`#${o.id} `, aCol2, aRowY, { width: 40 });
        doc.text(formatCurrency(tasaBcv), aCol3, aRowY, { width: 90, align: 'right' });
        doc.text(formatCurrency(montoVes), aCol4, aRowY, { width: 70, align: 'right' });
        doc.text(formatCurrency(montoUsd), aCol5, aRowY, { width: 70, align: 'right' });
        doc.text(notas, aCol6, aRowY, {
          width: doc.page.width - doc.page.margins.right - aCol6
        });

        aRowY += 14;
      });

      doc.fontSize(10).font('Helvetica-Bold');
      doc.text(
        `Total aperturas del día: ${formatCurrency(totalAperturaVes)} Bs / ${formatCurrency(totalAperturaUsd)} $`,
        aCol1,
        aRowY + 5
      );
    }

    // ---------- Retiros de Caja del Día (vista histórica del día completo) ----------
    if (withdrawals && withdrawals.length > 0) {
      doc.addPage();

      doc.fontSize(14).font('Helvetica-Bold').text('Retiros de Caja del Día');
      doc.moveDown(0.5);

      const wCol1 = 50; // Fecha
      const wCol2 = 150; // ID
      const wCol3 = 200; // Método
      const wCol4 = 300; // Monto Bs
      const wCol5 = 380; // Monto $
      const wCol6 = 460; // Descripción

      let wHeaderY = doc.y;

      doc.fontSize(9).font('Helvetica-Bold');
      doc.text('Fecha', wCol1, wHeaderY);
      doc.text('ID', wCol2, wHeaderY);
      doc.text('Método', wCol3, wHeaderY);
      doc.text('Monto Bs', wCol4, wHeaderY, { width: 70, align: 'right' });
      doc.text('Monto $', wCol5, wHeaderY, { width: 70, align: 'right' });
      doc.text('Descripción', wCol6, wHeaderY);

      let wLineY = wHeaderY + 12;
      doc.moveTo(wCol1, wLineY)
        .lineTo(doc.page.width - doc.page.margins.right, wLineY)
        .strokeColor('#cccccc')
        .stroke();

      let wRowY = wLineY + 5;
      doc.fontSize(8).font('Helvetica');

      let totalRetiroVes = 0;
      let totalRetiroUsd = 0;

      const mapMetodo = (metodo) => {
        switch (metodo) {
          case 'VES_EFECTIVO':
            return 'Efectivo Bs';
          case 'USD_EFECTIVO':
            return 'Efectivo $';
          case 'TARJETA':
            return 'Tarjeta';
          case 'PAGOMOVIL':
            return 'Pago Móvil';
          default:
            return metodo || 'Otro';
        }
      };

      withdrawals.forEach((w) => {
        if (wRowY > doc.page.height - doc.page.margins.bottom - 20) {
          doc.addPage();

          wHeaderY = doc.page.margins.top;
          doc.fontSize(9).font('Helvetica-Bold');
          doc.text('Fecha', wCol1, wHeaderY);
          doc.text('ID', wCol2, wHeaderY);
          doc.text('Método', wCol3, wHeaderY);
          doc.text('Monto Bs', wCol4, wHeaderY, { width: 70, align: 'right' });
          doc.text('Monto $', wCol5, wHeaderY, { width: 70, align: 'right' });
          doc.text('Descripción', wCol6, wHeaderY);

          wLineY = wHeaderY + 12;
          doc.moveTo(wCol1, wLineY)
            .lineTo(doc.page.width - doc.page.margins.right, wLineY)
            .strokeColor('#cccccc')
            .stroke();

          wRowY = wLineY + 5;
          doc.fontSize(8).font('Helvetica');
        }

        const dateObj = w.fecha ? new Date(w.fecha) : null;
        let fechaStr = w.fecha || '';
        if (dateObj && !isNaN(dateObj.getTime())) {
          const d = dateObj.toLocaleDateString('es-VE');
          const h = dateObj.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
          fechaStr = `${d} ${h} `;
        }

        const metodoLabel = mapMetodo(w.metodo);
        const montoVes = Number(w.monto_ves || 0);
        const montoUsd = Number(w.monto_usd || 0);

        totalRetiroVes += montoVes;
        totalRetiroUsd += montoUsd;

        const desc = w.descripcion || '';

        doc.text(fechaStr, wCol1, wRowY, { width: 90 });
        doc.text(`#${w.id} `, wCol2, wRowY, { width: 40 });
        doc.text(metodoLabel, wCol3, wRowY, { width: 90 });
        doc.text(formatCurrency(montoVes), wCol4, wRowY, { width: 70, align: 'right' });
        doc.text(formatCurrency(montoUsd), wCol5, wRowY, { width: 70, align: 'right' });
        doc.text(desc, wCol6, wRowY, {
          width: doc.page.width - doc.page.margins.right - wCol6
        });

        wRowY += 14;
      });

      doc.fontSize(10).font('Helvetica-Bold');
      doc.text(
        `Total retiros del día: ${formatCurrency(totalRetiroVes)} Bs / ${formatCurrency(totalRetiroUsd)} $`,
        wCol1,
        wRowY + 5
      );
    }

    doc.end();
  } catch (error) {
    console.error('Error generando PDF de Cierre Z:', error);
    res.status(500).send('Error al generar PDF de Cierre Z. Intente de nuevo.');
  }
};

// ---------- Dashboard (home) ----------
// ⚠️ NOTA: Esto sigue usando TODO el día, NO se ve afectado por los cierres.

const getTodayDashboardStats = (req, res) => {
  try {
    const bcvRate = getBcvRate();

    const statsVentas = getTodayDashboardStatsStmt_Ventas.get() || {};
    const statsAbonos = getTodayDashboardStatsStmt_Abonos.get() || {};

    const totalCobradoVes = Number(statsVentas.total_cobrado_ventas_hoy || 0) + Number(statsAbonos.total_abonos_hoy || 0);
    const totalCobradoUsd = Number(statsVentas.total_cobrado_usd || 0) + Number(statsAbonos.total_abonos_usd || 0);

    // --- NUEVO: GASTOS Y RETIROS ---
    const totalGastosInfo = db.prepare(`
        SELECT COALESCE(SUM(monto_ves), 0) as total, COALESCE(SUM(monto_usd), 0) as total_usd FROM gastos
        WHERE date(fecha) = date('now', 'localtime') AND estado_pago != 'ANULADO'
    `).get();
    const totalRetirosInfo = db.prepare(`
        SELECT COALESCE(SUM(monto_ves), 0) as total, COALESCE(SUM(monto_usd), 0) as total_usd FROM retiros_caja
        WHERE date(fecha) = date('now', 'localtime')
    `).get();

    const totalEgresosVes = (totalGastosInfo ? Number(totalGastosInfo.total || 0) : 0) + (totalRetirosInfo ? Number(totalRetirosInfo.total || 0) : 0);
    const totalEgresosUsd = (totalGastosInfo ? Number(totalGastosInfo.total_usd || 0) : 0) + (totalRetirosInfo ? Number(totalRetirosInfo.total_usd || 0) : 0);
    // ----------------------------

    const totalIngresosVes = Number(statsVentas.total_ingresos_ves || 0);
    const totalCostoVes = Number(statsVentas.total_costo_ves || 0);
    const profitVes = totalIngresosVes - totalCostoVes;

    const profitUsd = (bcvRate && bcvRate > 0) ? (profitVes / bcvRate) : 0;

    res.json({
      sale_count: Number(statsVentas.sale_count || 0),
      profit_ves: Number(profitVes.toFixed(2)),
      profit_usd: Number(profitUsd.toFixed(2)),
      total_cobrado_ves: Number(totalCobradoVes.toFixed(2)),
      total_cobrado_usd: Number(totalCobradoUsd.toFixed(2)),
      total_ventas_hoy_ves: Number((statsVentas.total_cobrado_ventas_hoy || 0).toFixed(2)),
      total_ventas_hoy_usd: Number((statsVentas.total_ventas_hoy_usd || 0).toFixed(2)),
      total_abonos_hoy_ves: Number((statsAbonos.total_abonos_hoy || 0).toFixed(2)),
      total_abonos_hoy_usd: Number((statsAbonos.total_abonos_usd || 0).toFixed(2)),
      total_gastos_hoy_ves: Number(totalEgresosVes.toFixed(2)),
      total_gastos_hoy_usd: Number(totalEgresosUsd.toFixed(2))
    });
  } catch (error) {
    console.error('Error al obtener estadísticas del dashboard:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ---------- Top productos ----------

const getTopSellingProducts = (req, res) => {
  try {
    const products = db.prepare(`
SELECT
p.nombre,
  SUM(vp.cantidad) as total_sold
        FROM venta_productos vp
        JOIN productos p ON vp.producto_id = p.id
        JOIN ventas v ON vp.venta_id = v.id
        WHERE v.creado_en >= date('now', '-28 days')
          AND v.estado_pago != 'ANULADO'
        GROUP BY vp.producto_id, p.nombre
        ORDER BY total_sold DESC
        LIMIT 5
      `).all();

    res.json(products);
  } catch (error) {
    console.error('Error al obtener top products:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ---------- Registrar retiro de caja ----------

const registerCashWithdrawal = (req, res) => {
  try {
    const { metodo, monto, descripcion = '' } = req.body;
    const amount = parseFloat(monto);

    if (!metodo || !['VES_EFECTIVO', 'USD_EFECTIVO'].includes(metodo)) {
      return res.status(400).json({ error: 'Método de retiro inválido.' });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'El monto debe ser mayor a 0.' });
    }

    const bcv = getBcvRate() || 1;

    let monto_ves = 0;
    let monto_usd = 0;

    if (metodo === 'VES_EFECTIVO') {
      monto_ves = amount;
      monto_usd = amount / bcv;
    } else if (metodo === 'USD_EFECTIVO') {
      monto_usd = amount;
      monto_ves = amount * bcv;
    }

    const info = insertWithdrawalStmt.run({
      metodo,
      monto_ves,
      monto_usd,
      descripcion: typeof descripcion === 'string' && descripcion.trim() ? descripcion.trim() : null,
      usuario_id: req.body.usuario_id || null
    });

    res.json({
      success: true,
      id: info.lastInsertRowid,
      metodo,
      monto_ves,
      monto_usd
    });
  } catch (error) {
    console.error('Error registrando retiro de caja:', error);
    res.status(500).json({
      error: 'Error interno al registrar el retiro de caja.'
    });
  }
};

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
    // fee puede ser 0
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
      // Como es un servicio, podemos poner cliente NULL (o id 0 si la FK lo requiere, pero suele ser NULL)
      // Estado PAGADO
      const insertSale = db.prepare(`
        INSERT INTO ventas (total_ves, total_usd_bcv, estado_pago, monto_pendiente_usd, creado_en)
        VALUES (?, ?, 'PAGADO', 0, datetime('now', 'localtime'))
      `);
      // total_in es en VES
      const infoSale = insertSale.run(totalIn, totalIn / bcv);
      const saleId = infoSale.lastInsertRowid;

      // Insertar producto abstracto "Avance de Efectivo"
      // Usamos costo = cashOut para que la ganancia refleje solo el fee (totalIn - cashOut)
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
      // Asumimos que el método es digital (TARJETA/PAGOMOVIL). El monto recibido es el totalIn en VES.
      insertPayment.run(saleId, method_in, totalIn, totalIn, bcv);

      // 2. Crear Retiro de Caja (Salida Física)
      // Asumimos que entregamos VES_EFECTIVO.
      const monto_ves_retiro = cashOut;
      const monto_usd_retiro = cashOut / bcv;

      const descFinal = description ? `${description} (Venta #${saleId})` : `Avance de Efectivo (Venta #${saleId})`;

      const insertRetiro = db.prepare(`
        INSERT INTO retiros_caja (metodo, monto_ves, monto_usd, descripcion, fecha)
        VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
      `);
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


// ---------- NUEVO: Registrar apertura de caja (versión robusta) ----------

const registerCashOpening = (req, res) => {
  try {
    console.log('🧾 Body recibido en /cash-opening:', req.body);

    const rawOpeningVes =
      req.body.opening_ves ?? req.body.openingVes ?? req.body.monto_ves ?? req.body.montoBs ?? 0;

    const rawOpeningUsd =
      req.body.opening_usd ?? req.body.openingUsd ?? req.body.monto_usd ?? req.body.montoUsd ?? 0;

    const rawNotes = req.body.notes ?? req.body.notas ?? req.body.descripcion ?? '';

    const aperturaVes = Number(rawOpeningVes) || 0;
    const aperturaUsd = Number(rawOpeningUsd) || 0;

    if (aperturaVes <= 0 && aperturaUsd <= 0) {
      return res.status(400).json({
        error: 'Debes ingresar al menos un monto distinto de 0.'
      });
    }

    const bcv = getBcvRate() || 0;

    const info = insertOpeningStmt.run(
      aperturaVes,
      aperturaUsd,
      bcv,
      typeof rawNotes === 'string' && rawNotes.trim() ? rawNotes.trim() : null,
      req.body.usuario_id || null
    );

    return res.json({
      success: true,
      id: info.lastInsertRowid,
      opening_ves: aperturaVes,
      opening_usd: aperturaUsd,
      tasa_bcv_momento: bcv
    });
  } catch (error) {
    console.error('Error registrando apertura de caja:', error);
    return res.status(500).json({
      error: 'Error interno al registrar la apertura de caja.',
      details: error.message
    });
  }
};

// ---------- Obtener aperturas de caja de hoy (JSON) ----------

const hasTodayOpeningStmt = db.prepare(`
  SELECT COUNT(*) as cnt FROM aperturas_caja
  WHERE date(fecha) = date('now', 'localtime')
`);

// Verificar si la caja del usuario actual está abierta
const isCashOpenStmt = db.prepare(`
  SELECT 
    (SELECT fecha FROM aperturas_caja WHERE usuario_id = ? ORDER BY fecha DESC LIMIT 1) as last_open,
    (SELECT fecha FROM cierres_z WHERE usuario_id = ? ORDER BY fecha DESC LIMIT 1) as last_close
`);

const getTodayCashOpening = (req, res) => {
  try {
    // Si se pide solo verificar si la caja está abierta (para POS)
    if (req.query.checkOnly === '1') {
      const usuario_id = req.query.usuario_id || null;
      if (!usuario_id) {
        return res.status(404).json({ error: 'No hay usuario.' });
      }
      const row = isCashOpenStmt.get(usuario_id, usuario_id);
      const isOpen = row && row.last_open && (!row.last_close || String(row.last_open) > String(row.last_close));
      if (!isOpen) {
        return res.status(404).json({ error: 'Caja cerrada. Abre caja para continuar.' });
      }
      return res.json({ ok: true, status: 'ABIERTA' });
    }

    const usuario_id = req.query.usuario_id || null;

    // 1) Determinar fecha del último cierre de ESTE usuario
    let fromDateTime = '1970-01-01 00:00:00';
    try {
      const row = getLastClosureStmtByUser.get(usuario_id);
      if (row && row.last_cierre) {
        fromDateTime = row.last_cierre;
      }
    } catch (e) {
      console.warn('No se pudo obtener el último cierre del usuario:', e.message);
    }

    // 2) Obtener aperturas desde ese cierre
    const openings = getOpeningsDetailSinceStmt.all(fromDateTime, usuario_id);
    const totals = getOpeningsTotalsSinceStmt.get(fromDateTime, usuario_id);

    if (openings.length === 0) {
      return res.status(404).json({ error: 'No se encontró apertura de caja para hoy.' });
    }

    res.json({
      openings,
      totals
    });
  } catch (error) {
    console.error('Error al obtener aperturas de caja:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ---------- PDF Inventario ----------

const printInventoryPdf = (req, res) => {
  try {
    const settings = loadSettings();
    const logoFullPath = settings.logoPath
      ? path.join(uploadsBasePath, path.basename(settings.logoPath))
      : null;

    const today = new Date();
    const todayStr = today.toLocaleDateString('sv-SE');

    const rates = getRatesForPricing();

    const productsDb = getInventoryForPdfStmt.all();
    const products = productsDb.map((p) => {
      const prod = {
        ...p,
        costo: parseFloat(p.costo) || 0,
        porcentaje_ganancia: parseFloat(p.porcentaje_ganancia) || 0
      };
      let priced = { nombre: p.nombre || '', stock: 0, precio_final_usd_bcv: 0, precio_final_ves: 0 };
      try {
        priced = calculateSalePrices(prod, rates);
      } catch (priceErr) {
        console.error('Error calculando precio:', priceErr);
      }

      return {
        nombre: priced.nombre || '',
        stock: Number(priced.stock || 0),
        conteoFisico: p.conteo_fisico !== null && p.conteo_fisico !== undefined ? Number(p.conteo_fisico) : null,
        priceUsd: Number(priced.precio_final_usd_bcv || 0),
        priceVes: Number(priced.precio_final_ves || 0)
      };
    });

    const doc = new PDFDocument({ margin: 40 });
    const filename = `inventario - ${todayStr}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename *= UTF - 8''${encodeURIComponent(filename)} `
    );
    doc.pipe(res);

    let y = doc.y;

    if (logoFullPath && fs.existsSync(logoFullPath)) {
      try {
        doc.image(logoFullPath, 50, y, { width: 100, align: 'left' });
        y += 50;
      } catch (err) {
        console.error('Error cargando logo inventario:', err);
      }
    }

    doc.fontSize(20).font('Helvetica-Bold').text(settings.businessName || 'NexusPOS', {
      align: 'center'
    });
    doc.moveDown(1);

    doc.fontSize(16).font('Helvetica-Bold').text('Inventario de Productos', { align: 'center' });

    doc.fontSize(11).font('Helvetica').text(`Fecha: ${today.toLocaleDateString('es-VE')} `, {
      align: 'center'
    });

    doc.moveDown(1);
    doc.fontSize(10).font('Helvetica');
    doc.text(`Tasa BCV usada: ${formatCurrency(rates.BCV || 0)} Bs / $`, { align: 'center' });
    doc.moveDown(2);

    const col1 = 50;
    const col2 = 250;
    const col3 = 320;
    const col4 = 390;
    const col5 = 470;

    const headerY = doc.y;

    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Producto', col1, headerY);
    doc.text('Stock', col2, headerY, { width: 60, align: 'right' });
    doc.text('Conteo', col3, headerY, { width: 60, align: 'right' });
    doc.text('Precio $', col4, headerY, { width: 60, align: 'right' });
    doc.text('Precio Bs', col5, headerY, { width: 70, align: 'right' });

    let rowY = headerY + 15;

    doc.moveTo(col1, rowY - 5)
      .lineTo(doc.page.width - doc.page.margins.right, rowY - 5)
      .strokeColor('#cccccc')
      .stroke();

    rowY += 5;

    if (products.length === 0) {
      doc.moveDown(1);
      doc.fontSize(11).font('Helvetica').text('No hay productos registrados en el inventario.');
      doc.end();
      return;
    }

    doc.fontSize(9).font('Helvetica');
    const lineHeight = 14;

    products.forEach((p) => {
      if (rowY > doc.page.height - doc.page.margins.bottom - lineHeight) {
        doc.addPage();
        rowY = doc.page.margins.top;

        const pageHeaderY = rowY;
        doc.fontSize(10).font('Helvetica-Bold');
        doc.text('Producto', col1, pageHeaderY);
        doc.text('Stock', col2, pageHeaderY, { width: 60, align: 'right' });
        doc.text('Conteo', col3, pageHeaderY, { width: 60, align: 'right' });
        doc.text('Precio $', col4, pageHeaderY, { width: 60, align: 'right' });
        doc.text('Precio Bs', col5, pageHeaderY, { width: 70, align: 'right' });

        rowY = pageHeaderY + 15;
        doc.moveTo(col1, rowY - 5)
          .lineTo(doc.page.width - doc.page.margins.right, rowY - 5)
          .strokeColor('#cccccc')
          .stroke();

        rowY += 5;
        doc.fontSize(9).font('Helvetica');
      }

      const conteoDisplay = p.conteoFisico !== null ? String(p.conteoFisico) : '-';
      const conteoColor = p.conteoFisico !== null && p.conteoFisico !== p.stock ? 'red' : 'black';
      
      doc.text(p.nombre, col1, rowY, { width: col2 - col1 - 10 });
      doc.text(String(p.stock), col2, rowY, { width: 60, align: 'right' });
      
      if (conteoColor === 'red') doc.fillColor('red');
      doc.text(conteoDisplay, col3, rowY, { width: 60, align: 'right' });
      doc.fillColor('black');
      
      doc.text(formatCurrency(p.priceUsd), col4, rowY, { width: 60, align: 'right' });
      doc.text(formatCurrency(p.priceVes), col5, rowY, { width: 70, align: 'right' });

      rowY += lineHeight;
    });

    doc.end();
  } catch (error) {
    console.error('Error generando PDF de inventario:', error);
    res.status(500).send('Error interno al generar el PDF de inventario.');
  }
};

// ---------- PDF Fiados ----------

const printFiadosPdf = (req, res) => {
  try {
    const settings = loadSettings();
    const logoFullPath = settings.logoPath
      ? path.join(uploadsBasePath, path.basename(settings.logoPath))
      : null;

    const today = new Date();
    const todayStr = today.toLocaleDateString('sv-SE');
    const bcv = getBcvRate() || 1;
    // ✅ FIX: usar tasa PREFERIDA (PARALELO > BCV) para coincidir con Cobranza
    const paraleloRow = db.prepare("SELECT value FROM settings WHERE key = 'PARALELO'").get();
    const paralelo = paraleloRow ? parseFloat(paraleloRow.value) || 0 : 0;
    const preferredRate = paralelo > 0 ? paralelo : bcv;
    const preferredLabel = paralelo > 0 ? 'PARALELO' : 'BCV';

    const fiados = getFiadosForPdfStmt.all().map((row) => {
      const pendienteUsd = Number(row.monto_pendiente_usd || 0);
      return {
        id: row.id,
        creado_en: row.creado_en,
        estado_pago: row.estado_pago,
        cliente_nombre: row.cliente_nombre || 'SIN NOMBRE',
        monto_pendiente_usd: pendienteUsd,
        pendiente_ves: pendienteUsd * preferredRate
      };
    });

    const totalPendienteUsd = fiados.reduce((acc, v) => acc + v.monto_pendiente_usd, 0);
    const totalPendienteVes = fiados.reduce((acc, v) => acc + v.pendiente_ves, 0);

    const doc = new PDFDocument({ margin: 40 });
    const filename = `fiados - ${todayStr}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename *= UTF - 8''${encodeURIComponent(filename)} `
    );
    doc.pipe(res);

    let y = doc.y;

    if (logoFullPath && fs.existsSync(logoFullPath)) {
      try {
        doc.image(logoFullPath, 50, y, { width: 100, align: 'left' });
        y += 50;
      } catch (err) {
        console.error('Error cargando logo fiados:', err);
      }
    }

    doc.fontSize(20).font('Helvetica-Bold').text(settings.businessName || 'NexusPOS', {
      align: 'center'
    });
    doc.moveDown(1);

    doc.fontSize(16).font('Helvetica-Bold').text('Reporte de Ventas a Crédito (Fiados)', {
      align: 'center'
    });

    doc.fontSize(11).font('Helvetica').text(`Fecha: ${today.toLocaleDateString('es-VE')} `, {
      align: 'center'
    });

    doc.moveDown(1);

    doc.fontSize(11).font('Helvetica-Bold').text('Resumen General');
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');
    // ✅ FIX: mostrar la tasa que realmente se usó (PARALELO si está disponible)
    doc.text(`Tasa ${preferredLabel} usada: ${formatCurrency(preferredRate)} Bs / $`);
    doc.text(`Total pendiente en USD: ${formatCurrency(totalPendienteUsd)} $`);
    doc.text(`Total pendiente en Bs: ${formatCurrency(totalPendienteVes)} Bs`);
    doc.moveDown(2);

    if (fiados.length === 0) {
      doc.fontSize(11).font('Helvetica').text('No hay ventas fiadas con saldo pendiente.');
      doc.end();
      return;
    }

    const col1 = 50;
    const col2 = 220;
    const col3 = 340;
    const col4 = 400;
    const col5 = 480;

    const headerY = doc.y;

    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Cliente', col1, headerY);
    doc.text('Fecha', col2, headerY);
    doc.text('Estado', col3, headerY);
    doc.text('Pendiente $', col4, headerY, { width: 60, align: 'right' });
    doc.text('Pendiente Bs', col5, headerY, { width: 70, align: 'right' });

    let rowY = headerY + 15;

    doc.moveTo(col1, rowY - 5)
      .lineTo(doc.page.width - doc.page.margins.right, rowY - 5)
      .strokeColor('#cccccc')
      .stroke();

    rowY += 5;

    doc.fontSize(9).font('Helvetica');
    const lineHeight = 14;

    fiados.forEach((f) => {
      if (rowY > doc.page.height - doc.page.margins.bottom - lineHeight) {
        doc.addPage();
        rowY = doc.page.margins.top;

        const pageHeaderY = rowY;

        doc.fontSize(10).font('Helvetica-Bold');
        doc.text('Cliente', col1, pageHeaderY);
        doc.text('Fecha', col2, pageHeaderY);
        doc.text('Estado', col3, pageHeaderY);
        doc.text('Pendiente $', col4, pageHeaderY, { width: 60, align: 'right' });
        doc.text('Pendiente Bs', col5, pageHeaderY, { width: 70, align: 'right' });

        rowY = pageHeaderY + 15;

        doc.moveTo(col1, rowY - 5)
          .lineTo(doc.page.width - doc.page.margins.right, rowY - 5)
          .strokeColor('#cccccc')
          .stroke();

        rowY += 5;
        doc.fontSize(9).font('Helvetica');
      }

      const fecha = new Date(f.creado_en);
      const fechaStr = fecha.toLocaleDateString('es-VE', { year: 'numeric', month: '2-digit', day: '2-digit' });
      const horaStr = fecha.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });

      doc.text(f.cliente_nombre, col1, rowY, { width: col2 - col1 - 10 });
      doc.text(`${fechaStr} ${horaStr} `, col2, rowY, { width: col3 - col2 - 10 });
      doc.text(String(f.estado_pago || ''), col3, rowY, { width: col4 - col3 - 10 });
      doc.text(formatCurrency(f.monto_pendiente_usd), col4, rowY, { width: 60, align: 'right' });
      doc.text(formatCurrency(f.pendiente_ves), col5, rowY, { width: 70, align: 'right' });

      rowY += lineHeight;
    });

    doc.end();
  } catch (error) {
    console.error('Error generando PDF de fiados:', error);
    res.status(500).send('Error interno al generar el PDF de fiados.');
  }
};

// ---------- NUEVOS CONTROLADORES: Historial y reimpresión de Cierre Z ----------

// GET /api/reports/cierre-z/history?limit=50&page=1&startDate=...&endDate=...
const getCierreZHistory = (req, res) => {
  try {
    const { limit: limitParam, page: pageParam, startDate, endDate } = req.query;

    let limit = 50;
    if (limitParam !== undefined) {
      const parsed = parseInt(limitParam, 10);
      if (!Number.isNaN(parsed) && parsed > 0) limit = parsed;
    }
    if (limit > 200) limit = 200;

    let page = 1;
    if (pageParam !== undefined) {
      const parsed = parseInt(pageParam, 10);
      if (!Number.isNaN(parsed) && parsed > 0) page = parsed;
    }

    // Build query dynamically for count
    let countSql = `SELECT COUNT(*) AS total FROM cierres_z`;
    let rowsSql = `
      SELECT id, fecha, total_sistema_ves, total_sistema_usd, 
             total_manual_ves, total_manual_usd, diferencia_ves, 
             diferencia_usd, notes, raw_json
      FROM cierres_z
    `;
    const params = [];

    if (startDate && endDate) {
      countSql += ` WHERE date(fecha) BETWEEN date(?) AND date(?)`;
      rowsSql += ` WHERE date(fecha) BETWEEN date(?) AND date(?)`;
      params.push(startDate, endDate);
    }

    const totalRow = db.prepare(countSql).get(...params) || { total: 0 };
    const total = Number(totalRow.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    if (page > totalPages) page = totalPages;

    const offset = (page - 1) * limit;

    rowsSql += ` ORDER BY datetime(fecha) DESC LIMIT ? OFFSET ?`;
    const rowsDb = db.prepare(rowsSql).all(...params, limit, offset) || [];

    const rows = rowsDb.map((r) => {
      let parsed = null;
      try {
        parsed = r.raw_json ? JSON.parse(r.raw_json) : null;
      } catch (e) {
        parsed = null;
      }

      const summaryData = parsed?.summaryData || [];
      const totalsFromJson = parsed?.totals || {};

      return {
        id: r.id,
        fecha: r.fecha,
        total_sistema_ves: r.total_sistema_ves,
        total_sistema_usd: r.total_sistema_usd,
        total_manual_ves: r.total_manual_ves,
        total_manual_usd: r.total_manual_usd,
        diferencia_ves: r.diferencia_ves,
        diferencia_usd: r.diferencia_usd,
        notes: r.notes,
        summaryData: normalizeCierreZSummaryData(summaryData),
        totalsFromJson
      };
    });

    res.json({
      page,
      limit,
      total,
      totalPages,
      rows
    });
  } catch (error) {
    console.error('Error cargando historial de cierres Z:', error);
    res.status(500).json({ error: 'No se pudo cargar el historial de cierres.' });
  }
};

// GET /api/reports/cierre-z/:id/pdf
const printCierreZById = (req, res) => {
  const id = parseInt(req.params.id, 10);

  if (!id) {
    return res.status(400).json({ error: 'ID de cierre inválido.' });
  }

  try {
    const cierre = getCierreZByIdStmt.get(id);
    if (!cierre) {
      return res.status(404).json({ error: 'Cierre Z no encontrado.' });
    }

    const settings = loadSettings();
    const logoFullPath = settings.logoPath
      ? path.join(uploadsBasePath, path.basename(settings.logoPath))
      : null;

    let fecha = new Date();
    if (cierre.fecha) {
      const tmp = new Date(cierre.fecha);
      if (!Number.isNaN(tmp.getTime())) {
        fecha = tmp;
      }
    }

    let summaryDataFromJson = [];
    let totalsFromJson = {};

    try {
      if (cierre.raw_json) {
        const raw = JSON.parse(cierre.raw_json);
        if (raw && typeof raw === 'object') {
          if (Array.isArray(raw.summaryData)) {
            summaryDataFromJson = raw.summaryData;
          }
          if (raw.totals && typeof raw.totals === 'object') {
            totalsFromJson = raw.totals;
          }
        }
      }
    } catch (e) {
      console.warn('No se pudo parsear raw_json para cierre Z #' + id, e);
    }

    const sistemaVes =
      Number(
        totalsFromJson.sistemaVes !== undefined ? totalsFromJson.sistemaVes : cierre.total_sistema_ves
      ) || 0;

    const sistemaUsd =
      Number(
        totalsFromJson.sistemaUsd !== undefined ? totalsFromJson.sistemaUsd : cierre.total_sistema_usd
      ) || 0;

    const manualVes =
      Number(
        totalsFromJson.manualVes !== undefined ? totalsFromJson.manualVes : cierre.total_manual_ves
      ) || 0;

    const manualUsd =
      Number(
        totalsFromJson.manualUsd !== undefined ? totalsFromJson.manualUsd : cierre.total_manual_usd
      ) || 0;

    const diffVes =
      Number(
        totalsFromJson.diferenciaVes !== undefined
          ? totalsFromJson.diferenciaVes
          : cierre.diferencia_ves !== null && cierre.diferencia_ves !== undefined
            ? cierre.diferencia_ves
            : manualVes - sistemaVes
      ) || 0;

    const diffUsd =
      Number(
        totalsFromJson.diferenciaUsd !== undefined
          ? totalsFromJson.diferenciaUsd
          : cierre.diferencia_usd !== null && cierre.diferencia_usd !== undefined
            ? cierre.diferencia_usd
            : manualUsd - sistemaUsd
      ) || 0;

    // ✅ Normalizar para soportar snapshots viejos/nuevos
    const normalizedSummary = normalizeCierreZSummaryData(summaryDataFromJson);

    const doc = new PDFDocument({ margin: 50 });
    const filename = `cierre - z - ${id}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename *= UTF - 8''${encodeURIComponent(filename)} `
    );
    doc.pipe(res);

    let y = doc.y;
    if (logoFullPath && fs.existsSync(logoFullPath)) {
      try {
        doc.image(logoFullPath, 50, y, { width: 100, align: 'left' });
        y += 50;
      } catch (err) {
        console.error('Error cargando logo para reimpresión de cierre Z:', err);
      }
    }

    doc.fontSize(20).font('Helvetica-Bold').text(settings.businessName || 'NexusPOS', {
      align: 'center'
    });
    doc.moveDown(1);

    doc.fontSize(16).font('Helvetica-Bold').text(`Cierre de Caja(Cierre Z) #${id} `, {
      align: 'center'
    });

    doc.fontSize(12).font('Helvetica').text(
      `Fecha de cierre: ${fecha.toLocaleString('es-VE', { dateStyle: 'long', timeStyle: 'short' })} `,
      { align: 'center' }
    );

    doc.moveDown(0.5);
    const correlative = (totalsFromJson && totalsFromJson.correlative) || id;
    doc.fontSize(11).font('Helvetica-Bold').text(`N° Reporte Z: ${correlative}`, { align: 'center' });
    doc.moveDown(0.5);

    const openingTime = (typeof totalsFromJson === 'object' && totalsFromJson.openingTime) || 'N/A';
    const closingTime = (typeof totalsFromJson === 'object' && totalsFromJson.closingTime) || fecha.toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });

    const timeY = doc.y;
    doc.fontSize(10).font('Helvetica');
    doc.text(`Apertura: ${openingTime}`, 50, timeY, { width: 250, align: 'left' });
    doc.text(`Cierre: ${closingTime}`, 300, timeY, { width: 250, align: 'right' });

    // ✅ FIX: resetear X al margen izquierdo antes de dibujar los totales
    // (después de un text() con posición absoluta, el cursor X queda donde terminó el texto)
    doc.x = doc.page.margins.left;
    doc.moveDown(1.5);

    doc.text(`Total sistema en Bolívares: ${formatCurrency(sistemaVes)} Bs`);
    doc.text(`Total sistema en Dólares: ${formatCurrency(sistemaUsd)} $`);
    doc.moveDown(0.5);
    doc.text(`Total conteo manual en Bolívares: ${formatCurrency(manualVes)} Bs`);
    doc.text(`Total conteo manual en Dólares: ${formatCurrency(manualUsd)} $`);
    doc.moveDown(0.5);

    doc.text(`Diferencia en Bolívares: ${formatCurrency(diffVes)} Bs`);
    doc.text(`Diferencia en Dólares: ${formatCurrency(diffUsd)} $`);
    doc.moveDown(1.5);

    const notasFinales = (cierre.notes && String(cierre.notes).trim()) || '';
    if (notasFinales) {
      doc.fontSize(13).font('Helvetica-Bold').text('Notas del cierre');
      doc.moveDown(0.5);
      doc.fontSize(11).font('Helvetica').text(notasFinales);
      doc.moveDown(1.5);
    }

    if (Array.isArray(normalizedSummary) && normalizedSummary.length > 0) {
      doc.fontSize(13).font('Helvetica-Bold').text('Detalle por método de pago');
      doc.moveDown(0.5);

      const col1 = 50;
      const col2 = 250;
      const col3 = 380;
      const col4 = 480;

      const headerY = doc.y;

      doc.fontSize(10).font('Helvetica-Bold');
      doc.text('Método', col1, headerY);
      doc.text('Sistema', col2, headerY, { width: 80, align: 'right' });
      doc.text('Manual', col3, headerY, { width: 80, align: 'right' });
      doc.text('Diferencia', col4, headerY, { width: 80, align: 'right' });

      let rowY = headerY + 15;

      doc.moveTo(col1, rowY - 5)
        .lineTo(doc.page.width - doc.page.margins.right, rowY - 5)
        .strokeColor('#cccccc')
        .stroke();

      rowY += 5;
      doc.fontSize(9).font('Helvetica');

      normalizedSummary.forEach((item) => {
        if (rowY > doc.page.height - doc.page.margins.bottom - 16) {
          doc.addPage();
          rowY = doc.page.margins.top;
        }

        const label = item.label || mapMetodoLabel(item.metodo);
        const cur = item.currency || normalizeCurrencyFromMetodo(item.metodo);
        const sistema = Number(item.sistema || 0);
        const manual = Number(item.manual || 0);
        const diff = Number(item.diferencia || manual - sistema);

        const suf = String(cur).toUpperCase() === 'USD' ? '$' : 'Bs';

        doc.text(label, col1, rowY, { width: 180 });
        doc.text(`${formatCurrency(sistema)} ${suf} `, col2, rowY, { width: 80, align: 'right' });
        doc.text(`${formatCurrency(manual)} ${suf} `, col3, rowY, { width: 80, align: 'right' });

        if (Math.abs(diff) > 0.005) doc.fillColor('red');
        else doc.fillColor('black');

        doc.text(`${formatCurrency(diff)} ${suf} `, col4, rowY, { width: 80, align: 'right' });
        doc.fillColor('black');

        rowY += 14;
      });
    }

    doc.end();
  } catch (error) {
    console.error('Error generando PDF de reimpresión de cierre Z:', error);
    res.status(500).json({ error: 'Error al generar PDF del cierre Z. Intente de nuevo.' });
  }
};

/**
 * Obtiene el estado actual de cada "caja" (usuario con rol CAJERO o ADMIN).
 * Indica si la caja está ABIERTA o CERRADA y los totales acumulados.
 */
const getCashStatus = (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let dateFilter = '';
    let params = [];

    if (startDate && endDate) {
      dateFilter = `AND date(v.creado_en) BETWEEN date(?) AND date(?)`;
      params = [startDate, endDate];
    } else {
      dateFilter = `AND datetime(v.creado_en) > datetime(?)`;
    }

    const users = db.prepare(`
      SELECT id, username, nombre, rol 
      FROM usuarios 
      WHERE rol IN ('ADMIN', 'CAJERO', 'VENDEDOR') AND activo = 1
    `).all();

    const globalSummary = {};

    const usersData = users.map(user => {
      // 1. Obtener última apertura
      const lastOpening = db.prepare(`
        SELECT fecha, opening_ves, opening_usd 
        FROM aperturas_caja 
        WHERE usuario_id = ? 
        ORDER BY fecha DESC LIMIT 1
      `).get(user.id);

      // 2. Obtener último cierre Z
      const lastClosure = db.prepare(`
        SELECT fecha 
        FROM cierres_z 
        WHERE usuario_id = ? 
        ORDER BY fecha DESC LIMIT 1
      `).get(user.id);

      // 3. Determinar estado
      let status = 'CERRADA';
      let lastActivityDate = null;
      let openSince = null;
      let lastClosureDate = lastClosure ? lastClosure.fecha : null;

      if (lastOpening) {
        lastActivityDate = lastOpening.fecha;
        if (!lastClosure || new Date(lastOpening.fecha) > new Date(lastClosure.fecha)) {
          status = 'ABIERTA';
          openSince = lastOpening.fecha;
        }
      }

      // 4. Calcular totales por método
      const methods = {};
      let totalVes = 0;
      let totalUsd = 0;

      // Si hay rango de fechas, ignoramos si la caja está "abierta" o no, sumamos todo el rango
      const effectiveOpenSince = (startDate && endDate) ? null : openSince;

      const salesQuery = `
        SELECT 
          vp.metodo,
          SUM(vp.monto_en_ves) as total_ves,
          SUM(CASE WHEN vp.metodo IN ('USD_EFECTIVO', 'ZELLE') THEN vp.monto_recibido ELSE 0 END) as total_usd
        FROM venta_pagos vp
        JOIN ventas v ON vp.venta_id = v.id
        WHERE v.usuario_id = ? 
        ${effectiveOpenSince ? "AND datetime(v.creado_en) > datetime(?)" : (startDate && endDate ? "AND date(v.creado_en) BETWEEN date(?) AND date(?)" : "AND date(v.creado_en) = date('now', 'localtime')")}
        AND v.estado_pago != 'ANULADO'
        GROUP BY vp.metodo
      `;

      const abonosQuery = `
        SELECT 
          metodo,
          SUM(monto_pagado_ves) as total_ves,
          SUM(CASE WHEN metodo IN ('USD_EFECTIVO', 'ZELLE') THEN monto_pagado_usd ELSE 0 END) as total_usd
        FROM abonos
        WHERE usuario_id = ? 
        ${effectiveOpenSince ? "AND datetime(fecha) > datetime(?)" : (startDate && endDate ? "AND date(fecha) BETWEEN date(?) AND date(?)" : "AND date(fecha) = date('now', 'localtime')")}
        GROUP BY metodo
      `;

      const queryParams = effectiveOpenSince ? [user.id, effectiveOpenSince] : (startDate && endDate ? [user.id, startDate, endDate] : [user.id]);

      const salesByMethod = db.prepare(salesQuery).all(...queryParams);
      const abonosByMethod = db.prepare(abonosQuery).all(...queryParams);

      // Consolidar
      [...salesByMethod, ...abonosByMethod].forEach(m => {
        if (!methods[m.metodo]) {
          methods[m.metodo] = { total_ves: 0, total_usd: 0 };
        }
        methods[m.metodo].total_ves += (m.total_ves || 0);
        methods[m.metodo].total_usd += (m.total_usd || 0);

        // Sumar al global
        if (!globalSummary[m.metodo]) {
          globalSummary[m.metodo] = { total_ves: 0, total_usd: 0 };
        }
        globalSummary[m.metodo].total_ves += (m.total_ves || 0);
        globalSummary[m.metodo].total_usd += (m.total_usd || 0);
      });

      // Totales generales del usuario
      totalVes = Object.values(methods).reduce((acc, m) => acc + m.total_ves, 0);
      totalUsd = Object.values(methods).reduce((acc, m) => acc + m.total_usd, 0);

      // Sumar fondo inicial si es reporte del día o caja actualmente abierta
      if (!startDate && lastOpening) {
        if (!globalSummary['VES_EFECTIVO']) globalSummary['VES_EFECTIVO'] = { total_ves: 0, total_usd: 0 };
        if (!globalSummary['USD_EFECTIVO']) globalSummary['USD_EFECTIVO'] = { total_ves: 0, total_usd: 0 };
        globalSummary['VES_EFECTIVO'].total_ves += (lastOpening.opening_ves || 0);
        globalSummary['USD_EFECTIVO'].total_usd += (lastOpening.opening_usd || 0);
      }

      return {
        userId: user.id,
        username: user.username,
        nombre: user.nombre,
        rol: user.rol,
        status,
        lastActivityDate,
        openSince,
        lastClosureDate,
        totalVes,
        totalUsd,
        methods,
        openingVes: lastOpening ? lastOpening.opening_ves : 0,
        openingUsd: lastOpening ? lastOpening.opening_usd : 0
      };
    });

    res.json({
      users: usersData,
      globalSummary
    });
  } catch (error) {
    console.error('Error en getCashStatus:', error);
    res.status(500).json({ error: 'Error al obtener el estado de las cajas' });
  }
};

/**
 * Exporta el Cuadre de Caja a PDF — Versión Profesional.
 * Incluye: encabezado con logo/razón social/RIF, resumen global por método de pago,
 * detalle por cajero (métodos, cantidad de ventas, retiros), y pie de página con paginación.
 */
const exportCashStatusPDF = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).send('Fechas requeridas');

    const settings = loadSettings();
    const logoFullPath = settings.logoPath
      ? path.join(uploadsBasePath, path.basename(settings.logoPath))
      : null;

    const users = db.prepare(`
      SELECT id, username, nombre, rol FROM usuarios
      WHERE activo = 1 ORDER BY nombre ASC
    `).all();

    // ── Colores ──────────────────────────────────────────────
    const BLUE_DARK   = '#1e3a5f';
    const BLUE_MED    = '#2563eb';
    const BLUE_LIGHT  = '#dbeafe';
    const GRAY_LIGHT  = '#f3f4f6';
    const GRAY_MED    = '#6b7280';
    const RED_BADGE   = '#ef4444';
    const GREEN_BADGE = '#10b981';

    const methodLabel = (m) => {
      const map = {
        VES_EFECTIVO: 'Efectivo Bolívares',
        USD_EFECTIVO: 'Efectivo Dólares',
        TARJETA:      'Tarjeta / Punto',
        PAGOMOVIL:    'Pago Móvil',
        BIOPAGO:      'Biopago',
        ZELLE:        'Zelle',
      };
      return map[m] || m;
    };

    const fmt = (n) =>
      Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // ── Iniciar PDFDocument ──────────────────────────────────
    const doc = new PDFDocument({ margin: 50, autoFirstPage: true,
      bufferPages: true,
      info: { Title: `Cuadre de Caja ${startDate} al ${endDate}` }
    });
    const filename = `cuadre-caja-${startDate}-a-${endDate}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    doc.pipe(res);

    const pageW    = doc.page.width;
    const margin   = 50;
    const contentW = pageW - margin * 2;

    // ── Helper: encabezado de sección ────────────────────────
    const drawSectionHeader = (title, y) => {
      doc.save()
         .rect(margin, y, 4, 16).fill(BLUE_MED)
         .restore();
      doc.fontSize(12).font('Helvetica-Bold').fillColor(BLUE_DARK)
         .text(title, margin + 12, y + 1, { width: contentW - 12 });
      return doc.y + 8;
    };

    // ── Helper: fila encabezado de tabla ─────────────────────
    const drawTableHeader = (cols, y, rowH = 18) => {
      doc.rect(margin, y, contentW, rowH).fill(BLUE_DARK);
      let x = margin;
      cols.forEach(col => {
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff')
           .text(col.label, x + 4, y + 4, { width: col.w - 8, align: col.align || 'left' });
        x += col.w;
      });
      doc.fillColor('#000000');
      return y + rowH;
    };

    // ── Helper: fila de tabla ────────────────────────────────
    const drawTableRow = (cols, values, y, rowH = 16, bg = null) => {
      if (bg) doc.rect(margin, y, contentW, rowH).fill(bg);
      let x = margin;
      cols.forEach((col, i) => {
        const val = values[i] !== undefined ? String(values[i]) : '';
        doc.fontSize(9).font(col.bold ? 'Helvetica-Bold' : 'Helvetica')
           .fillColor(col.color || BLUE_DARK)
           .text(val, x + 4, y + 3, { width: col.w - 8, align: col.align || 'left' });
        x += col.w;
      });
      doc.fillColor('#000000');
      return y + rowH;
    };

    const drawTableBorder = (y, h) => {
      doc.rect(margin, y, contentW, h).strokeColor('#d1d5db').lineWidth(0.5).stroke();
    };

    // ── 1. ENCABEZADO ────────────────────────────────────────
    let curY = margin;

    if (logoFullPath && fs.existsSync(logoFullPath)) {
      try {
        doc.image(logoFullPath, margin, curY, { width: 65, height: 65, fit: [65, 65] });
      } catch (e) { /* logo no cargó */ }
    }

    const textX = (logoFullPath && fs.existsSync(logoFullPath)) ? margin + 80 : margin;
    doc.fontSize(18).font('Helvetica-Bold').fillColor(BLUE_DARK)
       .text(settings.businessName || 'NexusPOS', textX, curY, { width: contentW - 80 });
    curY = doc.y;

    if (settings.businessRif) {
      doc.fontSize(10).font('Helvetica').fillColor(GRAY_MED)
         .text(`RIF: ${settings.businessRif}`, textX, curY, { width: contentW - 80 });
      curY = doc.y;
    }

    if (settings.businessAddress) {
      doc.fontSize(9).font('Helvetica').fillColor(GRAY_MED)
         .text(`${settings.businessAddress}`, textX, curY, { width: contentW - 80 });
      curY = doc.y;
    }

    curY += 15;

    doc.fontSize(16).font('Helvetica-Bold').fillColor(BLUE_DARK)
       .text('REPORTE DE CUADRE DE CAJA', margin, curY, { align: 'center', width: contentW });
    curY = doc.y + 4;

    const nowStr = new Date().toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });
    doc.fontSize(10).font('Helvetica').fillColor(GRAY_MED)
       .text(`Período: ${startDate} al ${endDate}`, margin, curY, { align: 'center', width: contentW });
    curY = doc.y + 2;
    doc.text(`Generado: ${nowStr}`, margin, curY, { align: 'center', width: contentW });
    curY = doc.y + 18;

    // ── 2. RECOPILAR DATOS POR USUARIO ───────────────────────
    const globalMethods = {};
    const usersReport = [];

    for (const user of users) {
      const lastOpening = db.prepare(`
        SELECT fecha, opening_ves, opening_usd FROM aperturas_caja
        WHERE usuario_id = ? ORDER BY fecha DESC LIMIT 1
      `).get(user.id);

      const lastClosure = db.prepare(`
        SELECT fecha FROM cierres_z
        WHERE usuario_id = ? ORDER BY fecha DESC LIMIT 1
      `).get(user.id);

      let status = 'CERRADA';
      if (lastOpening && (!lastClosure || new Date(lastOpening.fecha) > new Date(lastClosure.fecha))) {
        status = 'ABIERTA';
      }

      const salesByMethod = db.prepare(`
        SELECT vp.metodo,
          SUM(vp.monto_en_ves) as total_ves,
          SUM(CASE WHEN vp.metodo IN ('USD_EFECTIVO', 'ZELLE') THEN vp.monto_recibido ELSE 0 END) as total_usd
        FROM venta_pagos vp
        JOIN ventas v ON vp.venta_id = v.id
        WHERE v.usuario_id = ?
          AND date(v.creado_en) BETWEEN date(?) AND date(?)
          AND v.estado_pago != 'ANULADO'
        GROUP BY vp.metodo
      `).all(user.id, startDate, endDate);

      const abonosByMethod = db.prepare(`
        SELECT metodo,
          SUM(monto_pagado_ves) as total_ves,
          SUM(CASE WHEN metodo IN ('USD_EFECTIVO', 'ZELLE') THEN monto_pagado_usd ELSE 0 END) as total_usd
        FROM abonos
        WHERE usuario_id = ?
          AND date(fecha) BETWEEN date(?) AND date(?)
        GROUP BY metodo
      `).all(user.id, startDate, endDate);

      const ventaCountRow = db.prepare(`
        SELECT COUNT(*) as cnt FROM ventas
        WHERE usuario_id = ?
          AND date(creado_en) BETWEEN date(?) AND date(?)
          AND estado_pago != 'ANULADO'
      `).get(user.id, startDate, endDate);

      let retirosDetalle = [];
      let totalRetirosVes = 0;
      let totalRetirosUsd = 0;
      try {
        retirosDetalle = db.prepare(`
          SELECT fecha, metodo, monto_ves, monto_usd, descripcion
          FROM retiros_caja
          WHERE usuario_id = ?
            AND date(fecha) BETWEEN date(?) AND date(?)
          ORDER BY fecha ASC
        `).all(user.id, startDate, endDate);
        totalRetirosVes = retirosDetalle.reduce((a, r) => a + (r.monto_ves || 0), 0);
        totalRetirosUsd = retirosDetalle.reduce((a, r) => a + (r.monto_usd || 0), 0);
      } catch (e) { /* tabla retiros_caja puede no existir aún */ }

      const userMethods = {};
      [...salesByMethod, ...abonosByMethod].forEach(m => {
        if (!userMethods[m.metodo]) userMethods[m.metodo] = { ves: 0, usd: 0 };
        userMethods[m.metodo].ves += (m.total_ves || 0);
        userMethods[m.metodo].usd += (m.total_usd || 0);
        if (!globalMethods[m.metodo]) globalMethods[m.metodo] = { ves: 0, usd: 0 };
        globalMethods[m.metodo].ves += (m.total_ves || 0);
        globalMethods[m.metodo].usd += (m.total_usd || 0);
      });

      const totalVes = Object.values(userMethods).reduce((a, m) => a + m.ves, 0);
      const totalUsd = Object.values(userMethods).reduce((a, m) => a + m.usd, 0);

      if (totalVes > 0 || totalUsd > 0 || retirosDetalle.length > 0) {
        usersReport.push({
          user, status, lastOpening, lastClosure,
          userMethods, totalVes, totalUsd,
          ventaCount: ventaCountRow ? ventaCountRow.cnt : 0,
          retirosDetalle, totalRetirosVes, totalRetirosUsd
        });
      }
    }

    // ── 3. TABLA RESUMEN GLOBAL ──────────────────────────────
    curY = drawSectionHeader('RESUMEN GLOBAL POR MÉTODO DE PAGO', curY);

    const colsGlobal = [
      { label: 'Método de Pago', w: contentW * 0.50, align: 'left'  },
      { label: 'Total Bs',       w: contentW * 0.25, align: 'right' },
      { label: 'Total USD',      w: contentW * 0.25, align: 'right' },
    ];
    const globalTableStartY = curY;
    curY = drawTableHeader(colsGlobal, curY);

    let gTotalVes = 0, gTotalUsd = 0, rowIdx = 0;
    const sortedGlobal = Object.keys(globalMethods).sort();
    sortedGlobal.forEach(mKey => {
      const m = globalMethods[mKey];
      const bg = rowIdx % 2 === 0 ? '#ffffff' : GRAY_LIGHT;
      curY = drawTableRow(colsGlobal,
        [methodLabel(mKey), m.ves > 0 ? fmt(m.ves) + ' Bs' : '—', m.usd > 0 ? fmt(m.usd) + ' $' : '—'],
        curY, 16, bg);
      gTotalVes += m.ves;
      gTotalUsd += m.usd;
      rowIdx++;
    });

    if (sortedGlobal.length === 0) {
      curY = drawTableRow(colsGlobal, ['Sin movimientos en el período', '—', '—'], curY, 16, '#ffffff');
    }

    // Fila TOTAL
    doc.rect(margin, curY, contentW, 18).fill(BLUE_MED);
    let tx = margin;
    ['TOTAL GENERAL', fmt(gTotalVes) + ' Bs', fmt(gTotalUsd) + ' $'].forEach((val, i) => {
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#ffffff')
         .text(val, tx + 4, curY + 4, { width: colsGlobal[i].w - 8, align: colsGlobal[i].align });
      tx += colsGlobal[i].w;
    });
    curY += 18;
    drawTableBorder(globalTableStartY, curY - globalTableStartY);
    curY += 22;

    // ── 4. DETALLE POR CAJERO ────────────────────────────────
    curY = drawSectionHeader('DETALLE POR CAJERO / USUARIO', curY);
    curY += 6;

    const colsUser = [
      { label: 'Método de Pago', w: contentW * 0.46, align: 'left'  },
      { label: 'Total Bs',       w: contentW * 0.27, align: 'right' },
      { label: 'Total USD',      w: contentW * 0.27, align: 'right' },
    ];

    const colsRetiro = [
      { label: 'Fecha / Hora',  w: contentW * 0.30, align: 'left'  },
      { label: 'Método',        w: contentW * 0.22, align: 'left'  },
      { label: 'Monto Bs',      w: contentW * 0.24, align: 'right' },
      { label: 'Monto USD',     w: contentW * 0.24, align: 'right' },
    ];

    for (const report of usersReport) {
      const { user, status, lastOpening, userMethods, totalVes, totalUsd,
              ventaCount, retirosDetalle, totalRetirosVes, totalRetirosUsd } = report;

      // Nueva página si queda poco espacio
      if (curY > doc.page.height - doc.page.margins.bottom - 130) {
        doc.addPage();
        curY = doc.page.margins.top;
      }

      // ── Cabecera del cajero ──
      doc.rect(margin, curY, contentW, 40).fill(BLUE_LIGHT);

      // Badge estado
      const badgeColor = status === 'ABIERTA' ? GREEN_BADGE : GRAY_MED;
      const badgeW = 60;
      const badgeX = pageW - margin - badgeW - 4;
      doc.rect(badgeX, curY + 10, badgeW, 14).fill(badgeColor);
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff')
         .text(status, badgeX, curY + 13, { width: badgeW, align: 'center' });

      doc.fontSize(11).font('Helvetica-Bold').fillColor(BLUE_DARK)
         .text(`${user.nombre}  (@${user.username})  —  ${user.rol}`,
               margin + 8, curY + 7, { width: contentW - badgeW - 20 });

      let aperInfo = 'Sin apertura registrada en el período';
      if (lastOpening) {
        const aperDate = new Date(lastOpening.fecha)
          .toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });
        aperInfo = `Apertura: ${aperDate}  |  Fondo Inicial: ${fmt(lastOpening.opening_ves || 0)} Bs  |  ${fmt(lastOpening.opening_usd || 0)} $`;
      }
      doc.fontSize(8).font('Helvetica').fillColor(GRAY_MED)
         .text(aperInfo, margin + 8, curY + 24, { width: contentW - badgeW - 20 });

      curY += 46;

      // Cantidad de ventas
      doc.fontSize(9).font('Helvetica').fillColor(GRAY_MED)
         .text(`Transacciones en el período: ${ventaCount} venta(s)`, margin + 4, curY);
      curY = doc.y + 6;

      // ── Tabla métodos ──
      const userBlockStartY = curY;
      curY = drawTableHeader(colsUser, curY, 16);

      const methodKeys = Object.keys(userMethods).sort();
      let uRow = 0;
      methodKeys.forEach(mKey => {
        if (curY > doc.page.height - doc.page.margins.bottom - 40) {
          doc.addPage(); curY = doc.page.margins.top;
        }
        const m = userMethods[mKey];
        const bg = uRow % 2 === 0 ? '#ffffff' : GRAY_LIGHT;
        curY = drawTableRow(colsUser,
          [methodLabel(mKey), m.ves > 0 ? fmt(m.ves) + ' Bs' : '—', m.usd > 0 ? fmt(m.usd) + ' $' : '—'],
          curY, 15, bg);
        uRow++;
      });

      if (methodKeys.length === 0) {
        curY = drawTableRow(colsUser, ['Sin ventas en el período', '—', '—'], curY, 15, '#ffffff');
      }

      // Fila subtotal ventas
      doc.rect(margin, curY, contentW, 16).fill('#e8f0fe');
      let sx = margin;
      ['Subtotal Ventas', fmt(totalVes) + ' Bs', fmt(totalUsd) + ' $'].forEach((val, i) => {
        doc.fontSize(9).font('Helvetica-Bold').fillColor(BLUE_DARK)
           .text(val, sx + 4, curY + 3, { width: colsUser[i].w - 8, align: colsUser[i].align });
        sx += colsUser[i].w;
      });
      curY += 16;

      // ── Retiros de caja ──
      if (retirosDetalle.length > 0) {
        curY += 8;
        if (curY > doc.page.height - doc.page.margins.bottom - 80) {
          doc.addPage(); curY = doc.page.margins.top;
        }

        doc.fontSize(9).font('Helvetica-Bold').fillColor(RED_BADGE)
           .text('▼  RETIROS DE CAJA', margin + 4, curY);
        curY = doc.y + 4;

        curY = drawTableHeader(colsRetiro, curY, 15);

        retirosDetalle.forEach((r, ri) => {
          if (curY > doc.page.height - doc.page.margins.bottom - 30) {
            doc.addPage(); curY = doc.page.margins.top;
          }
          const rDate = new Date(r.fecha).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });
          const bg = ri % 2 === 0 ? '#fff5f5' : '#ffeeee';
          curY = drawTableRow(colsRetiro,
            [rDate, methodLabel(r.metodo), fmt(r.monto_ves) + ' Bs', fmt(r.monto_usd) + ' $'],
            curY, 14, bg);
        });

        // Fila total retiros
        doc.rect(margin, curY, contentW, 15).fill('#fee2e2');
        let rx = margin;
        ['Total Retiros', '', fmt(totalRetirosVes) + ' Bs', fmt(totalRetirosUsd) + ' $'].forEach((val, i) => {
          doc.fontSize(9).font('Helvetica-Bold').fillColor(RED_BADGE)
             .text(val, rx + 4, curY + 3, { width: colsRetiro[i].w - 8, align: colsRetiro[i].align });
          rx += colsRetiro[i].w;
        });
        curY += 15;
      }

      drawTableBorder(userBlockStartY, curY - userBlockStartY);
      curY += 22;
    }

    if (usersReport.length === 0) {
      doc.fontSize(11).font('Helvetica').fillColor(GRAY_MED)
         .text('No se registraron movimientos en el período seleccionado.',
               margin, curY, { align: 'center', width: contentW });
    }

    // ── 5. LIMPIEZA DE PÁGINAS VACÍAS ────────────────────────
    const pr = doc.bufferedPageRange();
    let lastContentPage = pr.start;
    for (let i = pr.start; i < pr.start + pr.count; i++) {
      doc.switchToPage(i);
      if (doc.y > doc.page.margins.top + 5) {
        lastContentPage = i;
      }
    }
    for (let i = pr.start + pr.count - 1; i > lastContentPage; i--) {
      doc.deletePage(i);
    }

    doc.end();

  } catch (error) {
    console.error('Error generando PDF de cuadre de caja:', error);
    res.status(500).send('Error generando PDF');
  }
};

/**
 * Exporta el Cuadre de Caja a Excel.
 */
const exportCashStatusExcel = (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).send('Fechas requeridas');

    const users = db.prepare(`SELECT id, username, nombre FROM usuarios WHERE activo = 1`).all();
    const data = [];

    users.forEach(user => {
      const salesQuery = `
        SELECT vp.metodo, vp.monto_en_ves, vp.monto_recibido, vp.tasa_momento, v.creado_en, 'VENTA' as tipo
        FROM venta_pagos vp JOIN ventas v ON vp.venta_id = v.id
        WHERE v.usuario_id = ? AND date(v.creado_en) BETWEEN date(?) AND date(?) AND v.estado_pago != 'ANULADO'
      `;
      const abonosQuery = `
        SELECT metodo, monto_pagado_ves as monto_en_ves, monto_pagado_usd as monto_recibido, tasa_bcv_momento as tasa_momento, fecha as creado_en, 'ABONO' as tipo
        FROM abonos WHERE usuario_id = ? AND date(fecha) BETWEEN date(?) AND date(?)
      `;

      const movements = [...db.prepare(salesQuery).all(user.id, startDate, endDate), ...db.prepare(abonosQuery).all(user.id, startDate, endDate)];

      movements.forEach(m => {
        data.push({
          Fecha: m.creado_en,
          Usuario: user.nombre,
          Tipo: m.tipo,
          Metodo: m.metodo,
          'Monto (Bs)': m.monto_en_ves,
          'Monto (USD)': m.metodo === 'USD_EFECTIVO' ? m.monto_recibido : (m.monto_en_ves / (m.tasa_momento || 1)),
          Tasa: m.tasa_momento
        });
      });
    });

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(data);
    xlsx.utils.book_append_sheet(wb, ws, 'Cuadre Cajas');
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="cuadre-caja-${startDate}-a-${endDate}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error generando Excel');
  }
};

/**
 * Exporta el reporte de ventas por rango a Excel.
 */
const exportSalesReportExcel = (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).send('Fechas requeridas');

    const sales = getSalesByDateRangeStmt.all(startDate, endDate) || [];
    const { detailedSales } = computeRealizedSummaryForSales(sales);

    const data = detailedSales.map(s => ({
      ID: s.id,
      Fecha: s.creado_en,
      Cliente: s.cliente_nombre || 'General',
      Usuario: s.usuario_nombre,
      'Total (Bs)': s.total_ves,
      'Pagado (Bs)': s.total_pagos_ves + s.total_abonos_ves,
      'Pendiente (Bs)': s.total_ves - (s.total_pagos_ves + s.total_abonos_ves),
      Estado: s.estado_pago,
      'Costo (Bs)': s.total_costo_ves,
      'Ganancia (Bs)': s.total_ves - s.total_costo_ves
    }));

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(data);
    xlsx.utils.book_append_sheet(wb, ws, 'Ventas');
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="reporte-ventas-${startDate}-a-${endDate}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error generando Excel');
  }
};

/**
 * Exporta el historial de cierres Z a Excel.
 */
const exportZHistoryExcel = (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let sql = `SELECT * FROM cierres_z`;
    const params = [];
    if (startDate && endDate) {
      sql += ` WHERE date(fecha) BETWEEN date(?) AND date(?)`;
      params.push(startDate, endDate);
    }
    sql += ` ORDER BY datetime(fecha) DESC`;

    const rows = db.prepare(sql).all(...params) || [];

    const data = rows.map(r => ({
      ID: r.id,
      Fecha: r.fecha,
      'Sist. VES': r.total_sistema_ves,
      'Sist. USD': r.total_sistema_usd,
      'Manual VES': r.total_manual_ves,
      'Manual USD': r.total_manual_usd,
      'Dif. VES': r.diferencia_ves,
      'Dif. USD': r.diferencia_usd,
      Notas: r.notes
    }));

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(data);
    xlsx.utils.book_append_sheet(wb, ws, 'Cierres Z');
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="historial-cierres-z.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error generando Excel');
  }
};

// ================== FACTURAS DEL DÍA POR USUARIO (Reimpresión POS) ==================

const getTodaySalesByUserStmt = db.prepare(`
  SELECT
    v.id,
    v.total_ves,
    v.total_usd_bcv,
    v.creado_en,
    v.estado_pago,
    COALESCE(c.nombre, 'Consumidor Final') AS cliente_nombre
  FROM ventas v
  LEFT JOIN clientes c ON v.cliente_id = c.id
  WHERE date(v.creado_en, 'localtime') = date('now', 'localtime')
    AND v.estado_pago != 'ANULADO'
    AND v.usuario_id = ?
    AND (
      CAST(v.id AS TEXT) LIKE ?
      OR COALESCE(c.nombre, '') LIKE ?
    )
  ORDER BY v.creado_en DESC
  LIMIT 100
`);

const getTodaySalesByUser = (req, res) => {
  try {
    const { usuario_id, q } = req.query;
    if (!usuario_id) {
      return res.json({ sales: [] });
    }
    const uid = parseInt(usuario_id, 10);
    const term = q && q.trim().length > 0 ? `%${q.trim()}%` : '%';

    const sales = getTodaySalesByUserStmt.all(uid, term, term);

    res.json({ sales });
  } catch (error) {
    console.error('Error en getTodaySalesByUser:', error);
    res.status(500).json({ error: 'Error al obtener las facturas del día.' });
  }
};

// ================== SEARCH ==================

const searchSales = (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) {
    return res.json({ detailedSales: [] });
  }

  try {
    const term = `% ${q}% `;
    const sales = searchSalesStmt.all(term, term, term);

    const { detailedSales } = computeRealizedSummaryForSales(sales);

    // Poblar productos
    const salesWithProducts = detailedSales.map(sale => {
      const products = getSaleProductsForSaleIdWithNameStmt.all(sale.id);
      return { ...sale, products };
    });

    res.json({ detailedSales: salesWithProducts });
  } catch (error) {
    console.error('Error searching sales:', error);
    res.status(500).json({ error: 'Error al buscar ventas' });
  }
};

const printPurchasePdf = (req, res) => {
    const { id } = req.params;
    try {
        const purchase = db.prepare(`
            SELECT c.*, p.nombre as proveedor_nombre, p.rif as proveedor_rif, p.direccion as proveedor_direccion, p.telefono as proveedor_telefono
            FROM compras c
            JOIN proveedores p ON c.proveedor_id = p.id
            WHERE c.id = ?
        `).get(id);

        if (!purchase) {
            return res.status(404).send('Compra no encontrada');
        }

        const items = db.prepare(`
            SELECT cd.*, p.nombre as producto_nombre, p.barcode
            FROM compras_detalle cd
            JOIN productos p ON cd.producto_id = p.id
            WHERE cd.compra_id = ?
        `).all(id);

        const settings = loadSettings();
        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        const filename = `compra_${id}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        doc.pipe(res);

        // Header
        const startYHeader = doc.y;
        doc.fontSize(22).font('Helvetica-Bold').fillColor('#1e3a5f').text(settings.businessName || 'NexusPOS', 50, startYHeader);
        doc.fontSize(10).font('Helvetica').fillColor('gray').text(`RIF: ${settings.businessRif || 'J-00000000-0'}`, 50, doc.y + 2);
        doc.text(settings.businessAddress || 'Dirección de la empresa', 50, doc.y + 2);
        
        // Right side info block at exactly the same start Y
        doc.fillColor('#1e3a5f').fontSize(14).font('Helvetica-Bold').text('COMPRA #' + purchase.id.toString().padStart(4, '0'), 350, startYHeader, { align: 'right', width: 200 });
        const fechaParts = (purchase.fecha || '').split(' ')[0].split('-');
        const fechaDisplay = fechaParts.length === 3 ? `${fechaParts[2]}/${fechaParts[1]}/${fechaParts[0]}` : purchase.fecha;
        const horaDisplay = (purchase.fecha || '').split(' ')[1] || '';
        doc.fillColor('black').fontSize(10).font('Helvetica').text(`Fecha: ${fechaDisplay}${horaDisplay ? ', ' + horaDisplay : ''}`, 350, doc.y + 2, { align: 'right', width: 200 });
        
        const estadoY = doc.y + 2;
        doc.fillColor('black').text('Estado: ', 350, estadoY, { align: 'right', width: 110 });
        doc.fillColor('green').font('Helvetica-Bold').text(purchase.estado || 'COMPLETADO', 460, estadoY, { align: 'right', width: 90 });
        
        doc.moveDown(1.5);
        doc.moveTo(50, doc.y).lineTo(550, doc.y).lineWidth(1).strokeColor('black').stroke();
        doc.moveDown(1.5);

        // Grid info
        const startY = doc.y;
        doc.fontSize(10).font('Helvetica-Bold').fillColor('gray').text('PROVEEDOR', 50, startY);
        doc.fillColor('black').font('Helvetica-Bold').text(purchase.proveedor_nombre, 50, doc.y + 2);
        doc.font('Helvetica').text(`RIF: ${purchase.proveedor_rif}`, 50, doc.y);
        doc.text(purchase.proveedor_direccion || '', 50, doc.y);
        doc.text(`Tel: ${purchase.proveedor_telefono || '--'}`, 50, doc.y);

        doc.fontSize(10).font('Helvetica-Bold').fillColor('gray').text('DETALLES FISCALES', 440, startY);
        doc.fillColor('black').font('Helvetica').text(`Factura Nro: ${purchase.numero_factura}`, 440, doc.y + 2);
        doc.text(`Control Nro: ${purchase.numero_control}`, 440, doc.y);
        doc.text(`Moneda Base: ${purchase.moneda}`, 440, doc.y);
        doc.text(`Tasa BCV: ${parseFloat(purchase.tasa_bcv).toFixed(2)}`, 440, doc.y);
        doc.moveDown(3);

        // Items Table
        const col1 = 50, col2 = 250, col3 = 350, col4 = 480;
        const tableHeaderY = doc.y;
        
        doc.rect(50, tableHeaderY, 500, 20).fillColor('#f9fafb').strokeColor('#d1d5db').fillAndStroke();
        doc.fillColor('#4b5563').fontSize(9).font('Helvetica-Bold');
        doc.text('DESCRIPCIÓN', col1 + 10, tableHeaderY + 5);
        doc.text('CANTIDAD', col2, tableHeaderY + 5, { width: 80, align: 'right' });
        doc.text('COSTO UNIT.', col3, tableHeaderY + 5, { width: 80, align: 'right' });
        doc.text('SUBTOTAL', col4, tableHeaderY + 5, { width: 60, align: 'right' });
        
        doc.y = tableHeaderY + 25;

        doc.fontSize(9).font('Helvetica').fillColor('black');
        items.forEach(item => {
            const currentY = doc.y;
            doc.text(item.producto_nombre, col1 + 10, currentY);
            doc.text(String(item.cantidad), col2, currentY, { width: 80, align: 'right' });
            doc.text(formatCurrency(item.costo_unitario), col3, currentY, { width: 80, align: 'right' });
            doc.text(formatCurrency(item.total_linea), col4, currentY, { width: 60, align: 'right' });
            
            const textHeight = doc.heightOfString(item.producto_nombre, { width: 180 });
            doc.y = currentY + Math.max(textHeight, 15);
            
            doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
            doc.y += 5;
        });

        // Totals
        const labelX = 50;
        const valueX = 350;
        const totalWidth = 200;
        let currentTotalY = doc.y + 15;
        
        // Total Exento
        doc.fontSize(11).font('Helvetica').fillColor('gray').text('Total Exento:', labelX, currentTotalY);
        doc.fillColor('black').text(formatCurrency(purchase.total_exento || 0), valueX, currentTotalY, { width: totalWidth, align: 'right' });
        
        currentTotalY += 18;
        
        // Base Imponible
        doc.fillColor('gray').text('Base Imponible (16%):', labelX, currentTotalY);
        doc.fillColor('black').text(formatCurrency(purchase.base_imponible_16 || 0), valueX, currentTotalY, { width: totalWidth, align: 'right' });
        
        currentTotalY += 18;
        
        // IVA (16%)
        doc.fillColor('gray').text('IVA (16%):', labelX, currentTotalY);
        doc.fillColor('black').text(formatCurrency(purchase.iva_16 || 0), valueX, currentTotalY, { width: totalWidth, align: 'right' });
        
        currentTotalY += 25;
        
        // Line
        doc.moveTo(50, currentTotalY).lineTo(550, currentTotalY).strokeColor('#e5e7eb').lineWidth(1.5).stroke();
        
        currentTotalY += 15;
        
        // TOTAL
        doc.fontSize(18).font('Helvetica-Bold').fillColor('#1e3a5f').text('TOTAL:', labelX, currentTotalY);
        doc.text(`${formatCurrency(purchase.total_compra)} ${purchase.moneda}`, valueX, currentTotalY, { width: totalWidth, align: 'right' });
        
        currentTotalY += 25;
        
        // Equivalente en Bs
        if (purchase.tasa_bcv > 0) {
            doc.fontSize(11).font('Helvetica').fillColor('gray').text('Equivalente en Bs:', labelX, currentTotalY);
            doc.text(`${formatCurrency(purchase.total_compra * purchase.tasa_bcv)} Bs`, valueX, currentTotalY, { width: totalWidth, align: 'right' });
            currentTotalY += 25;
        }
        
        doc.y = currentTotalY + 20;
        doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('black').lineWidth(0.5).stroke();
        const footerY = doc.y + 10;
        doc.fontSize(9).fillColor('gray').text('NexusPOS - Sistema de Punto de Venta y Gestión de Inventario', 50, footerY, { align: 'center', width: 500 });
        doc.text('Documento generado para fines de control interno.', 50, footerY + 14, { align: 'center', width: 500 });

        doc.end();
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al generar PDF');
    }
};

// ================== EXPORTS ==================

module.exports = {
  getDailyCloseReport,
  getReportByDateRange,
  getPaymentsByDateRange,
  getReportByDateRangePDF,
  voidSale,
  getTodayPaymentSummary,
  printCierreZ,
  getTodayDashboardStats,
  getTopSellingProducts,
  registerCashWithdrawal,
  registerCashOpening,
  getTodayCashOpening,
  registerCashAdvance, // <--- Nueva función
  printInventoryPdf,
  printFiadosPdf,
  printPurchasePdf,
  getCierreZHistory,
  printCierreZById,
  searchSales,
  getCashStatus,
  exportCashStatusPDF,
  exportCashStatusExcel,
  exportSalesReportExcel,
  exportZHistoryExcel,
  getTodaySalesByUser
};
