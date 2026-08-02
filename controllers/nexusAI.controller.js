// controllers/nexusAI.controller.js
const { db } = require('../src/database');

/**
 * Procesa una consulta de lenguaje natural del usuario y devuelve una respuesta basada en datos.
 * Nota: En una versión de producción real, esto usaría una API de LLM (como Gemini o OpenAI).
 * Para esta implementación local sin conexión externa obligatoria, usaremos un "motor de intención" basado en reglas.
 */
const queryAI = async (req, res) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Falta el prompt en la solicitud.' });
  }

  const query = prompt.toLowerCase();
  let response = {
    text: "Lo siento, no entiendo esa solicitud. ¿Podrías ser más específico? Por ahora puedo ayudarte con ventas, inventario y reportes.",
    intent: "unknown",
    data: null,
    action: null
  };

  try {
    // --- VENTAS DE HOY / PERÍODO ---
    if (query.includes('vendi hoy') || query.includes('ventas de hoy') || query.includes('cuanto se vendio hoy') || query.includes('ventas de esta semana') || query.includes('ventas de este mes')) {
      let interval = "date('now', 'localtime')";
      let label = "hoy";

      if (query.includes('semana')) {
        interval = "date('now', 'localtime', '-7 days')";
        label = "esta semana";
      } else if (query.includes('mes')) {
        interval = "date('now', 'localtime', 'start of month')";
        label = "este mes";
      }

      const sales = db.prepare(`
        SELECT SUM(total_ves) as total_ves, SUM(total_usd_bcv) as total_usd 
        FROM ventas 
        WHERE date(creado_en) >= ${interval} AND estado_pago != 'ANULADO'
      `).get();

      const count = db.prepare(`
        SELECT COUNT(*) as total FROM ventas 
        WHERE date(creado_en) >= ${interval} AND estado_pago != 'ANULADO'
      `).get();

      const totalVes = sales.total_ves || 0;
      const totalUsd = sales.total_usd || 0;
      const totalCount = count.total || 0;

      response.text = `En **${label}** has realizado **${totalCount} ventas**. El total acumulado es de **${totalVes.toFixed(2)} VES** (aprox. **$${totalUsd.toFixed(2)}**).`;
      response.intent = "sales_period";
      response.data = { totalVes, totalUsd, totalCount, label };
    }

    // --- DEUDORES / CUENTAS POR COBRAR ---
    else if (query.includes('deben') || query.includes('deudores') || query.includes('cuentas por cobrar')) {
      const debtors = db.prepare(`
        SELECT c.nombre, SUM(v.monto_pendiente_usd) as deuda_usd, COUNT(v.id) as por_cobrar
        FROM ventas v
        JOIN clientes c ON v.cliente_id = c.id
        WHERE v.monto_pendiente_usd > 0 AND v.estado_pago != 'ANULADO'
        GROUP BY c.id
        ORDER BY deuda_usd DESC
        LIMIT 5
      `).all();

      const totalDeuda = db.prepare(`
        SELECT SUM(monto_pendiente_usd) as total FROM ventas WHERE monto_pendiente_usd > 0 AND estado_pago != 'ANULADO'
      `).get();

      if (debtors.length > 0) {
        let listText = debtors.map(d => `- **${d.nombre}**: $${d.deuda_usd.toFixed(2)} (${d.por_cobrar} pendientes)`).join('\n');
        response.text = `Actualmente te deben un total de **$${(totalDeuda.total || 0).toFixed(2)}**. Aquí están tus principales deudores:\n\n${listText}`;
      } else {
        response.text = "¡Buenas noticias! No tienes cuentas por cobrar pendientes en este momento.";
      }
      response.intent = "debtors_summary";
      response.data = { debtors, total: totalDeuda.total };
    }

    // --- VALUACIÓN DE INVENTARIO ---
    else if (query.includes('valor del inventario') || query.includes('cuanto dinero tengo en productos') || query.includes('valor total')) {
      const bcvRow = db.prepare("SELECT value FROM settings WHERE key = 'BCV'").get();
      const bcv = bcvRow ? parseFloat(bcvRow.value) : 1;

      const stocks = db.prepare(`
        SELECT 
          SUM(stock * costo) as total_usd,
          SUM(stock * costo * CASE WHEN moneda_costo = 'VES' THEN 1 ELSE ${bcv} END) as total_ves
        FROM productos 
        WHERE activo = 1 AND stock > 0
      `).get();

      response.text = `El valor estimado de tu inventario actual es de **${(stocks.total_ves || 0).toFixed(2)} VES** (aprox. **$${(stocks.total_usd || 0).toFixed(2)}**).`;
      response.intent = "inventory_valuation";
      response.data = stocks;
    }

    // --- PRODUCTOS MÁS VENDIDOS ---
    else if (query.includes('mas vendido') || query.includes('productos populares')) {
      const popular = db.prepare(`
        SELECT p.nombre, SUM(vp.cantidad) as total_vendido
        FROM venta_productos vp
        LEFT JOIN productos p ON vp.producto_id = p.id
        GROUP BY vp.producto_id
        ORDER BY total_vendido DESC
        LIMIT 5
      `).all();

      if (popular.length > 0) {
        let listText = popular.map(item => `- **${item.nombre}**: ${item.total_vendido} unidades`).join('\n');
        response.text = `Estos son tus 5 productos más vendidos:\n\n${listText}`;
      } else {
        response.text = "Aún no hay suficientes ventas registradas para determinar los productos más vendidos.";
      }
      response.intent = "top_selling";
      response.data = popular;
    }

    // --- BAJO STOCK ---
    else if (query.includes('stock bajo') || query.includes('que falta') || query.includes('quedando sin')) {
      const lowStock = db.prepare(`
        SELECT nombre, stock FROM productos 
        WHERE stock <= 5 AND activo = 1 
        ORDER BY stock ASC 
        LIMIT 10
      `).all();

      if (lowStock.length > 0) {
        let listText = lowStock.map(p => `- **${p.nombre}**: ${p.stock} disponibles`).join('\n');
        response.text = `Tienes ${lowStock.length} productos con stock bajo (5 o menos):\n\n${listText}`;
      } else {
        response.text = "¡Excelente! Todos tus productos activos tienen un stock saludable (mayor a 5).";
      }
      response.intent = "low_stock";
      response.data = lowStock;
    }

    // --- NUEVO: CIERRE Y FLUJO DE CAJA ---
    else if (query.includes('flujo de caja') || query.includes('movimiento de caja') || query.includes('retiros')) {
      const retiros = db.prepare(`
        SELECT SUM(monto_ves) as total_ves, SUM(monto_usd) as total_usd 
        FROM retiros_caja 
        WHERE date(fecha) = date('now', 'localtime')
      `).get();

      const count = db.prepare(`SELECT COUNT(*) as total FROM retiros_caja WHERE date(fecha) = date('now', 'localtime')`).get();

      response.text = `Hoy se han registrado **${count.total || 0} retiros** de caja, por un total de **${(retiros.total_ves || 0).toFixed(2)} VES** y **$${(retiros.total_usd || 0).toFixed(2)}**.`;
      response.intent = "cash_flow_daily";
      response.data = retiros;
    }

    // --- NUEVO: MEJORES CLIENTES ---
    else if (query.includes('mejores clientes') || query.includes('quien compra mas')) {
      const best = db.prepare(`
        SELECT c.nombre, SUM(v.total_usd_bcv) as total_spent
        FROM ventas v
        JOIN clientes c ON v.cliente_id = c.id
        WHERE v.estado_pago != 'ANULADO'
        GROUP BY c.id
        ORDER BY total_spent DESC
        LIMIT 5
      `).all();

      if (best.length > 0) {
        let listText = best.map(item => `- **${item.nombre}**: $${item.total_spent.toFixed(2)} total`).join('\n');
        response.text = `Tus clientes más fieles son:\n\n${listText}`;
      } else {
        response.text = "Aún no hay suficientes datos de clientes para este análisis.";
      }
      response.intent = "best_customers";
      response.data = best;
    }

    // --- NUEVO: GANANCIAS / UTILIDAD ---
    else if (query.includes('ganancia') || query.includes('utilidad') || query.includes('cuanto gane')) {
      const profit = db.prepare(`
        SELECT 
          SUM(vp.cantidad * (vp.precio_unitario_ves - vp.costo_unitario_ves)) as utilidad_ves
        FROM venta_productos vp
        JOIN ventas v ON vp.venta_id = v.id
        WHERE v.estado_pago != 'ANULADO' AND date(v.creado_en) >= date('now', 'localtime', 'start of month')
      `).get();

      const bcvRow = db.prepare("SELECT value FROM settings WHERE key = 'BCV'").get();
      const bcv = bcvRow ? parseFloat(bcvRow.value) : 1;

      const uVes = profit.utilidad_ves || 0;
      const uUsd = uVes / bcv;

      response.text = `Tu utilidad estimada de **este mes** es de **${uVes.toFixed(2)} VES** (aprox. **$${uUsd.toFixed(2)}**). Esto se calcula restando tus costos registrados de tus ventas brutas.`;
      response.intent = "profit_summary";
      response.data = { uVes, uUsd };
    }

    // --- NUEVO: VENTAS POR CATEGORÍA ---
    else if (query.includes('categoria') || query.includes('departamento')) {
      const categories = db.prepare(`
        SELECT p.categoria, SUM(vp.cantidad * vp.precio_unitario_ves) as total_ves
        FROM venta_productos vp
        JOIN productos p ON vp.producto_id = p.id
        JOIN ventas v ON vp.venta_id = v.id
        WHERE v.estado_pago != 'ANULADO'
        GROUP BY p.categoria
        ORDER BY total_ves DESC
      `).all();

      if (categories.length > 0) {
        let listText = categories.map(c => `- **${c.categoria || 'Sin Categoría'}**: ${c.total_ves.toFixed(2)} VES`).join('\n');
        response.text = `Aquí tienes un resumen de tus ventas por categoría:\n\n${listText}`;
      } else {
        response.text = "Aún no hay datos de categorías en tus ventas.";
      }
      response.intent = "category_summary";
      response.data = categories;
    }

    // --- ACCIÓN: MOSTRAR REPORTES ---
    else if (query.includes('reporte') || query.includes('ver reportes')) {
      response.text = "Entendido. Te estoy redirigiendo al módulo de reportes para que puedas ver el análisis detallado.";
      response.intent = "show_reports";
      response.action = "redirect_reports";
    }

    // --- ACCIÓN: MOSTRAR INVENTARIO ---
    else if (query.includes('inventario') || query.includes('ver productos')) {
      response.text = "Abriendo el inventario para ti...";
      response.intent = "show_inventory";
      response.action = "redirect_inventory";
    }

    // --- SALUDO ---
    else if (query.includes('hola') || query.includes('buenos dias') || query.includes('quien eres')) {
      response.text = "¡Hola! Soy **NexusAI**, tu asistente de gestión. Puedo darte resúmenes de ventas, avisarte sobre falta de stock, decirte quién te debe dinero o llevarte a cualquier parte del sistema. ¿En qué te ayudo hoy?";
      response.intent = "greeting";
    }

    res.json(response);

  } catch (error) {
    console.error('Error en NexusAI Controller:', error);
    res.status(500).json({ error: 'Ocurrió un error al procesar tu solicitud con la IA.' });
  }
};

module.exports = {
  queryAI
};
