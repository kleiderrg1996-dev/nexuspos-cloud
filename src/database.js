const path = require('path');
const { getDataBasePath } = require('./utils/settings');
const Database = require('better-sqlite3');

const dbPath = path.join(getDataBasePath(), 'mi-tienda.db');
console.log(`Usando base de datos en: ${dbPath}`);

let db;

function openDatabase() {
  try {
    if (db && db.open) return;
    db = new Database(dbPath, { verbose: console.log });
    console.log('Base de datos abierta correctamente.');
  } catch (error) {
    throw error;
  }
}

// Abrir inmediatamente al cargar
openDatabase();

function closeDatabase() {
  if (db && db.open) {
    try {
      db.close();
      console.log('Base de datos cerrada correctamente.');
    } catch (e) {
      console.error('Error cerrando base de datos:', e);
    }
  }
}

function reopenDatabase() {
  openDatabase();
}

/**
 * Obtiene la tasa BCV actual desde la tabla settings.
 * @returns {number} Tasa BCV o 1 si no se encuentra.
 */
function getBcvRate() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'BCV'").get();
    return row ? parseFloat(row.value) : 1;
  } catch (error) {
    console.error('Error al obtener tasa BCV:', error);
    return 1;
  }
}

/**
 * Obtiene la tasa PREFERIDA para pagos/deudas: PARALELO si existe y es > 0, sino BCV.
 * SIEMPRE usar esta función en contextos de pagos y cálculo de deudas.
 * @returns {number} Tasa PARALELO o BCV, nunca 0.
 */
function getPreferredRate() {
  try {
    const paralelo = db.prepare("SELECT value FROM settings WHERE key = 'PARALELO'").get();
    if (paralelo && parseFloat(paralelo.value) > 0) {
      return parseFloat(paralelo.value);
    }
    return getBcvRate();
  } catch (error) {
    console.error('Error al obtener tasa preferida:', error);
    return getBcvRate();
  }
}

function initializeDB() {
  console.log('Inicializando la base de datos (si es necesario)...');

  // Helpers para migraciones seguras
  const safeAddColumn = (tableName, columnName, definition) => {
    try {
      const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all();
      if (!tableInfo.some(col => col.name === columnName)) {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
        console.log(`Migración DB: Columna \`${columnName}\` añadida a ${tableName}.`);
      }
    } catch (e) {
      console.warn(`Error al añadir columna ${columnName} a ${tableName}:`, e.message);
    }
  };

  const safeAddSetting = (key, value) => {
    try {
      db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run(key, value);
    } catch (e) {
      console.warn(`Error al añadir setting ${key}:`, e.message);
    }
  };

  // ==========================
  // TABLAS NÚCLEO (Settings, Usuarios, Proveedores)
  // ==========================
  try {
    // 1. SETTINGS (Fundamental para tasas y configuración)
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY NOT NULL,
        value REAL NOT NULL
      );
    `);
    
    // 2. USUARIOS (Fundamental para sesiones)
    db.exec(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        nombre TEXT,
        rol TEXT NOT NULL CHECK(rol IN ('ADMIN', 'CAJERO', 'VISOR', 'VENDEDOR', 'MASTER', 'CONSULTOR')),
        activo INTEGER NOT NULL DEFAULT 1,
        creado_en DATETIME DEFAULT (datetime('now', 'localtime')),
        current_session_token TEXT,
        last_active_at DATETIME
      );
    `);

    // 3. PROVEEDORES (Necesaria para Compras por FK)
    db.exec(`
      CREATE TABLE IF NOT EXISTS proveedores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        rif TEXT UNIQUE,
        telefono TEXT,
        direccion TEXT,
        contacto TEXT,
        activo INTEGER NOT NULL DEFAULT 1,
        creado_en DATETIME DEFAULT (datetime('now', 'localtime'))
      );
    `);

    // 4. COMPRAS (Módulo SENIAT)
    db.exec(`
      CREATE TABLE IF NOT EXISTS compras (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proveedor_id INTEGER NOT NULL,
        usuario_id INTEGER,
        numero_factura TEXT NOT NULL,
        numero_control TEXT NOT NULL,
        moneda TEXT NOT NULL DEFAULT 'VES',
        tasa_bcv REAL NOT NULL DEFAULT 1,
        total_exento REAL NOT NULL DEFAULT 0,
        base_imponible_16 REAL NOT NULL DEFAULT 0,
        iva_16 REAL NOT NULL DEFAULT 0,
        base_imponible_8 REAL NOT NULL DEFAULT 0,
        iva_8 REAL NOT NULL DEFAULT 0,
        base_imponible_31 REAL NOT NULL DEFAULT 0,
        iva_31 REAL NOT NULL DEFAULT 0,
        base_imponible_0 REAL NOT NULL DEFAULT 0,
        total_compra REAL NOT NULL DEFAULT 0,
        monto_total_usd REAL NOT NULL DEFAULT 0,
        monto_pendiente_ves REAL DEFAULT 0,
        monto_pendiente_usd REAL DEFAULT 0,
        comprobante_iva TEXT,
        monto_retenido_iva REAL DEFAULT 0,
        porcentaje_iva REAL DEFAULT 0,
        estado TEXT DEFAULT 'COMPLETADO',
        fecha DATETIME DEFAULT (datetime('now', 'localtime')),
        creado_en DATETIME DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (proveedor_id) REFERENCES proveedores(id)
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS compras_detalle (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        compra_id INTEGER NOT NULL,
        producto_id INTEGER NOT NULL,
        cantidad REAL NOT NULL,
        costo_unitario REAL NOT NULL,
        alicuota TEXT NOT NULL DEFAULT '16%',
        total_linea REAL NOT NULL DEFAULT 0,
        FOREIGN KEY (compra_id) REFERENCES compras(id) ON DELETE CASCADE,
        FOREIGN KEY (producto_id) REFERENCES productos(id)
      );
    `);

    console.log('Tablas núcleo y módulo de compras inicializadas.');
  } catch (e) {
    console.error('Error crítico en inicialización de tablas núcleo:', e.message);
  }

  // (Migraciones de Usuarios)
  safeAddColumn('usuarios', 'current_session_token', 'TEXT');
  safeAddColumn('usuarios', 'last_active_at', 'DATETIME');

  // Verificar que MASTER y CONSULTOR estén en el CHECK constraint
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='usuarios'").get();
    if (tableInfo && !tableInfo.sql.includes("'MASTER'")) {
      console.log('Migracion: Agregando MASTER y CONSULTOR al CHECK constraint...');
      db.exec('DROP TABLE IF EXISTS usuarios_temp');
      db.exec(`
        CREATE TABLE usuarios_temp (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          nombre TEXT,
          rol TEXT NOT NULL CHECK(rol IN ('ADMIN', 'CAJERO', 'VISOR', 'VENDEDOR', 'MASTER', 'CONSULTOR')),
          activo INTEGER NOT NULL DEFAULT 1,
          creado_en DATETIME DEFAULT (datetime('now', 'localtime')),
          current_session_token TEXT,
          last_active_at DATETIME
        )
      `);
      db.exec(`INSERT INTO usuarios_temp SELECT * FROM usuarios`);
      db.exec('DROP TABLE usuarios');
      db.exec('ALTER TABLE usuarios_temp RENAME TO usuarios');
      console.log('Migracion completada: MASTER y CONSULTOR agregados.');
    }
  } catch (e) {
    console.warn('Verificacion de CHECK constraint:', e.message);
  }

  // Seed default master (user: master, pass: nexus2026 - hashed)
  // hash is: 1bdcce0539156a867ff7fb17b458dcc55c9f8cbe5a237480afa571839c0beef8
  try {
    const masterExists = db.prepare("SELECT id FROM usuarios WHERE username = 'master'").get();
    if (!masterExists) {
      db.prepare(`
        INSERT INTO usuarios (username, password_hash, nombre, rol)
        VALUES ('master', '1bdcce0539156a867ff7fb17b458dcc55c9f8cbe5a237480afa571839c0beef8', 'Administrador Master', 'MASTER')
      `).run();
      console.log('Usuario master creado por defecto.');
    }
  } catch (e) {
    console.warn('No se pudo crear el usuario master por defecto:', e.message);
  }

  // Migración: actualizar hash de admin viejo (Legacy) al nuevo
  try {
    const legacyHash = '240be518fabd2724ddb6f0403f35970f';
    const newHash = '0d2d4a3858decb1b26e6496214a58aa45cb34ce75cebfdb503d8c99513c2df34';

    const user = db.prepare("SELECT password_hash FROM usuarios WHERE username = 'admin'").get();
    if (user && user.password_hash === legacyHash) {
      db.prepare("UPDATE usuarios SET password_hash = ? WHERE username = 'admin'").run(newHash);
      console.log('Migración DB: Hash de admin actualizado a la nueva versión.');
    }
  } catch (e) {
    console.warn('Advertencia de migración, hash de admin no actualizado:', e.message);
  }

  // (Migraciones de Settings - se pueden añadir aquí si hiciera falta)

  // ==========================
  // PRODUCTOS
  // ==========================
  const createProductsTable = `
    CREATE TABLE IF NOT EXISTS productos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      costo REAL NOT NULL,
      costo_bulto REAL DEFAULT 0,
      unidades_bulto INTEGER DEFAULT 1,
      moneda_costo TEXT NOT NULL CHECK(moneda_costo IN ('VES', 'BCV', 'PARALELO', 'COP')),
      porcentaje_ganancia REAL NOT NULL,
      stock REAL DEFAULT 0,
      categoria TEXT,
      tipo_venta TEXT NOT NULL DEFAULT 'UNIDAD' CHECK(tipo_venta IN ('UNIDAD', 'PESO', 'LITRO')),
      proveedor TEXT,
      barcode TEXT UNIQUE DEFAULT NULL,
      activo BOOLEAN DEFAULT 1,
      exento_iva INTEGER NOT NULL DEFAULT 1,
      conteo_fisico REAL DEFAULT NULL,
      imagen TEXT DEFAULT NULL,
      creado_en DATETIME DEFAULT (datetime('now', 'localtime'))
    );
  `;
  db.exec(createProductsTable);

  // Migraciones seguras para productos
  safeAddColumn('productos', 'activo', 'BOOLEAN DEFAULT 1');
  safeAddColumn('productos', 'exento_iva', 'INTEGER NOT NULL DEFAULT 1');
  safeAddColumn('productos', 'conteo_fisico', 'REAL DEFAULT NULL');
  safeAddColumn('productos', 'imagen', 'TEXT DEFAULT NULL');
  safeAddColumn('productos', 'stock_minimo', 'REAL DEFAULT 0');
  safeAddColumn('productos', 'fecha_vencimiento', 'TEXT');

  // ==========================
  // PRESENTACIONES
  // ==========================
  const createPresentacionesTable = `
    CREATE TABLE IF NOT EXISTS presentaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      producto_id INTEGER NOT NULL,
      nombre TEXT NOT NULL,
      unidades_base REAL NOT NULL DEFAULT 1,
      precio_ves REAL NOT NULL DEFAULT 0,
      precio REAL NOT NULL DEFAULT 0,
      moneda TEXT NOT NULL DEFAULT 'VES' CHECK(moneda IN ('VES', 'BCV', 'PARALELO', 'COP')),
      barcode TEXT UNIQUE,
      activo INTEGER NOT NULL DEFAULT 1,
      precio_usd_bcv REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (producto_id) REFERENCES productos(id)
    );
  `;
  try {
    db.exec(createPresentacionesTable);
  } catch (e) {
    console.error('Error en tabla presentaciones:', e.message);
  }

  // Migraciones seguras para presentaciones
  safeAddColumn('presentaciones', 'precio_usd_bcv', 'REAL NOT NULL DEFAULT 0');
  safeAddColumn('presentaciones', 'moneda', "TEXT NOT NULL DEFAULT 'VES' CHECK(moneda IN ('VES', 'BCV', 'PARALELO', 'COP'))");
  safeAddColumn('presentaciones', 'precio', 'REAL NOT NULL DEFAULT 0');

  // Índices para mejorar rendimiento en búsquedas por producto y por código de barras
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_presentaciones_producto
    ON presentaciones(producto_id);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_presentaciones_barcode
    ON presentaciones(barcode);
  `);

  // (OPCIONAL) Inicializar precio_usd_bcv para presentaciones viejas
  // Y ahora también inicializar 'precio' y 'moneda' para presentaciones viejas
  try {
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'BCV'`).get();
    const bcv = row ? row.value : 0;

    // Primero aseguramos precio_usd_bcv para compatibilidad vieja
    if (bcv > 0) {
      const initStmt = db.prepare(`
        UPDATE presentaciones
        SET precio_usd_bcv =
          CASE
            WHEN (precio_usd_bcv IS NULL OR precio_usd_bcv = 0) AND precio_ves > 0
            THEN precio_ves / ?
            ELSE precio_usd_bcv
          END
      `);
      initStmt.run(bcv);
    }

    // Ahora poblamos las columnas nuevas para datos existentes
    db.exec(`
      UPDATE presentaciones
      SET moneda = 'BCV', precio = precio_usd_bcv
      WHERE precio_usd_bcv > 0 AND precio = 0
    `);

    db.exec(`
      UPDATE presentaciones
      SET moneda = 'VES', precio = precio_ves
      WHERE (precio_usd_bcv IS NULL OR precio_usd_bcv = 0) AND precio_ves > 0 AND precio = 0
    `);

    console.log('Migración DB: presentaciones inicializadas con nuevas columnas (moneda, precio).');

  } catch (e) {
    console.warn('No se pudieron inicializar precio_usd_bcv/nuevas columnas en presentaciones:', e.message);
  }

  // ==========================
  // CATEGORÍAS
  // ==========================
  const createCategoriesTable = `
    CREATE TABLE IF NOT EXISTS categorias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE
    );
  `;
  try {
    db.exec(createCategoriesTable);
  } catch (e) {
    console.error('Error en tabla categorías:', e.message);
  }

  // ==========================
  // CLIENTES
  // ==========================
  const createClientesTable = `
    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      cedula TEXT UNIQUE,
      telefono TEXT,
      direccion TEXT
    );
  `;
  try {
    db.exec(createClientesTable);
  } catch (e) {
    console.error('Error en tabla clientes:', e.message);
  }

  safeAddColumn('clientes', 'activo', 'BOOLEAN DEFAULT 1');

  // ==========================
  // VENTAS
  // ==========================
  const createVentasTable = `
    CREATE TABLE IF NOT EXISTS ventas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER,
      total_ves REAL NOT NULL,
      total_usd_bcv REAL NOT NULL,
      estado_pago TEXT NOT NULL DEFAULT 'PAGADO' CHECK(estado_pago IN ('PAGADO', 'FIADO', 'ABONADO', 'ANULADO', 'VALE')),
      monto_pendiente_usd REAL NOT NULL DEFAULT 0,
      creado_en DATETIME DEFAULT (datetime('now', 'localtime')),
      tasa_referencia TEXT DEFAULT 'BCV',
      usuario_id INTEGER REFERENCES usuarios(id),
      impuesto_total REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (cliente_id) REFERENCES clientes (id) ON DELETE SET NULL
    );
  `;
  db.exec(createVentasTable);

  // Migraciones seguras para ventas
  safeAddColumn('ventas', 'tasa_referencia', "TEXT DEFAULT 'BCV'");
  safeAddColumn('ventas', 'usuario_id', 'INTEGER REFERENCES usuarios(id)');
  safeAddColumn('ventas', 'impuesto_total', 'REAL NOT NULL DEFAULT 0');
  safeAddColumn('ventas', 'descuento_pct', 'REAL NOT NULL DEFAULT 0');
  safeAddColumn('ventas', 'descuento_ves', 'REAL NOT NULL DEFAULT 0');

  const createVentaProductosTable = `
    CREATE TABLE IF NOT EXISTS venta_productos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venta_id INTEGER NOT NULL,
      producto_id INTEGER NOT NULL,
      cantidad REAL NOT NULL,
      precio_unitario_ves REAL NOT NULL,
      costo_unitario_ves REAL NOT NULL,
      FOREIGN KEY (venta_id) REFERENCES ventas (id) ON DELETE CASCADE,
      FOREIGN KEY (producto_id) REFERENCES productos (id) ON DELETE SET NULL
    );
  `;
  db.exec(createVentaProductosTable);

  const createVentaPagosTable = `
    CREATE TABLE IF NOT EXISTS venta_pagos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venta_id INTEGER NOT NULL,
      metodo TEXT NOT NULL CHECK(metodo IN ('VES_EFECTIVO', 'USD_EFECTIVO', 'TARJETA', 'PAGOMOVIL', 'BIOPAGO', 'ZELLE')),
      monto_recibido REAL NOT NULL,
      monto_en_ves REAL NOT NULL,
      tasa_bcv_momento REAL,
      FOREIGN KEY (venta_id) REFERENCES ventas (id) ON DELETE CASCADE
    );
  `;
  db.exec(createVentaPagosTable);
  safeAddColumn('venta_pagos', 'referencia', 'TEXT');

  // Migración: añadir BIOPAGO a venta_pagos si no existe (Reconstrucción)
  try {
    const tableDefVP = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='venta_pagos'").get();
    if (tableDefVP && !tableDefVP.sql.includes("'BIOPAGO'")) {
      console.log('Migración DB: Actualizando tabla venta_pagos para soportar BIOPAGO...');

      const migrationBIOPAGO = db.transaction(() => {
        db.exec(`
          CREATE TABLE venta_pagos_temp (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            venta_id INTEGER NOT NULL,
            metodo TEXT NOT NULL CHECK(metodo IN ('VES_EFECTIVO', 'USD_EFECTIVO', 'TARJETA', 'PAGOMOVIL', 'BIOPAGO')),
            monto_recibido REAL NOT NULL,
            monto_en_ves REAL NOT NULL,
            tasa_bcv_momento REAL,
            FOREIGN KEY (venta_id) REFERENCES ventas (id) ON DELETE CASCADE
          );
        `);

        db.exec(`
          INSERT INTO venta_pagos_temp (id, venta_id, metodo, monto_recibido, monto_en_ves, tasa_bcv_momento)
          SELECT id, venta_id, metodo, monto_recibido, monto_en_ves, tasa_bcv_momento
          FROM venta_pagos;
        `);

        db.exec('DROP TABLE venta_pagos');
        db.exec('ALTER TABLE venta_pagos_temp RENAME TO venta_pagos');
      });

      migrationBIOPAGO();
      console.log('Migración DB: Tabla venta_pagos actualizada correctamente (soporte BIOPAGO).');
    }
  } catch (e) {
    console.error('Error FATAL en migración BIOPAGO:', e.message);
  }

  // Migración: añadir ZELLE a venta_pagos si no existe
  try {
    const tableDefVP2 = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='venta_pagos'").get();
    if (tableDefVP2 && !tableDefVP2.sql.includes("'ZELLE'")) {
      console.log('Migración DB: Actualizando tabla venta_pagos para soportar ZELLE...');

      const migrationZELLE = db.transaction(() => {
        db.exec(`
          CREATE TABLE venta_pagos_temp (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            venta_id INTEGER NOT NULL,
            metodo TEXT NOT NULL CHECK(metodo IN ('VES_EFECTIVO', 'USD_EFECTIVO', 'TARJETA', 'PAGOMOVIL', 'BIOPAGO', 'ZELLE')),
            monto_recibido REAL NOT NULL,
            monto_en_ves REAL NOT NULL,
            tasa_bcv_momento REAL,
            referencia TEXT,
            FOREIGN KEY (venta_id) REFERENCES ventas (id) ON DELETE CASCADE
          );
        `);

        db.exec(`
          INSERT INTO venta_pagos_temp (id, venta_id, metodo, monto_recibido, monto_en_ves, tasa_bcv_momento, referencia)
          SELECT id, venta_id, metodo, monto_recibido, monto_en_ves, tasa_bcv_momento, referencia
          FROM venta_pagos;
        `);

        db.exec('DROP TABLE venta_pagos');
        db.exec('ALTER TABLE venta_pagos_temp RENAME TO venta_pagos');
      });

      migrationZELLE();
      console.log('Migración DB: Tabla venta_pagos actualizada correctamente (soporte ZELLE).');
    }
  } catch (e) {
    console.error('Error FATAL en migración ZELLE:', e.message);
  }

  // ==========================
  // ABONOS
  // ==========================
  const createAbonosTable = `
    CREATE TABLE IF NOT EXISTS abonos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL,
      venta_id INTEGER,
      monto_pagado_ves REAL NOT NULL,
      monto_pagado_usd REAL NOT NULL,
      tasa_bcv_momento REAL NOT NULL,
      metodo TEXT NOT NULL,
      fecha DATETIME DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (cliente_id) REFERENCES clientes (id) ON DELETE CASCADE,
      FOREIGN KEY (venta_id) REFERENCES ventas (id) ON DELETE SET NULL
    );
  `;
  db.exec(createAbonosTable);
  safeAddColumn('abonos', 'referencia', 'TEXT');

  // Migraciones seguras para abonos
  safeAddColumn('abonos', 'anulado', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('abonos', 'anulado_en', 'DATETIME');
  safeAddColumn('abonos', 'motivo_anulacion', 'TEXT');
  safeAddColumn('abonos', 'usuario_id', 'INTEGER REFERENCES usuarios(id)');
  // ==========================
  // RETIROS DE CAJA
  // ==========================
  const createRetirosCajaTable = `
    CREATE TABLE IF NOT EXISTS retiros_caja (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha DATETIME DEFAULT (datetime('now','localtime')),
      metodo TEXT NOT NULL CHECK(metodo IN ('VES_EFECTIVO','USD_EFECTIVO')),
      monto_ves REAL NOT NULL DEFAULT 0,
      monto_usd REAL NOT NULL DEFAULT 0,
      tasa_bcv_momento REAL NOT NULL DEFAULT 0,
      descripcion TEXT,
      usuario_id INTEGER REFERENCES usuarios(id)
    );
  `;
  db.exec(createRetirosCajaTable);

  safeAddColumn('retiros_caja', 'fecha', "DATETIME DEFAULT (datetime('now','localtime'))");
  safeAddColumn('retiros_caja', 'usuario_id', 'INTEGER REFERENCES usuarios(id)');

  // ==========================
  // GASTOS OPERATIVOS
  // ==========================
  const createGastosTable = `
    CREATE TABLE IF NOT EXISTS gastos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha DATETIME DEFAULT (datetime('now', 'localtime')),
      categoria_id INTEGER,
      monto_ves REAL NOT NULL,
      monto_usd REAL,
      tasa_bcv REAL,
      tasa_tipo TEXT DEFAULT 'BCV',
      concepto TEXT,
      descripcion TEXT,
      estado_pago TEXT DEFAULT 'PAGADO',
      monto_pendiente_ves REAL DEFAULT 0,
      usuario_id INTEGER,
      moneda TEXT DEFAULT 'VES',
      notas TEXT
    );
  `;
  db.exec(createGastosTable);

  safeAddColumn('gastos', 'fecha', "DATETIME DEFAULT (datetime('now', 'localtime'))");
  safeAddColumn('gastos', 'notas', 'TEXT');
  safeAddColumn('gastos', 'tasa_tipo', "TEXT DEFAULT 'BCV'");

  // ==========================
  // CATEGORÍAS DE GASTOS
  // ==========================
  const createGastosCategoriasTable = `
    CREATE TABLE IF NOT EXISTS gastos_categorias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE
    );
  `;
  try {
    db.exec(createGastosCategoriasTable);
    // Seed default categories if empty
    const count = db.prepare("SELECT COUNT(*) as count FROM gastos_categorias").get().count;
    if (count === 0) {
      const defaultCats = ['ADMINISTRATIVO', 'OPERATIVO', 'NOMINA', 'SERVICIOS', 'OTROS'];
      const insertCat = db.prepare("INSERT INTO gastos_categorias (nombre) VALUES (?)");
      defaultCats.forEach(cat => insertCat.run(cat));
      console.log('Categorías de gastos por defecto creadas.');
    }
  } catch (e) {
    console.error('Error al crear tabla gastos_categorias:', e.message);
  }

  // ==========================
  // ABONOS A GASTOS
  // ==========================
  const createGastosAbonosTable = `
    CREATE TABLE IF NOT EXISTS gastos_abonos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gasto_id INTEGER NOT NULL,
      fecha DATETIME DEFAULT (datetime('now', 'localtime')),
      monto_ves REAL NOT NULL,
      monto_usd REAL NOT NULL,
      tasa_bcv_momento REAL NOT NULL,
      metodo TEXT NOT NULL,
      referencia TEXT,
      usuario_id INTEGER,
      FOREIGN KEY (gasto_id) REFERENCES gastos(id) ON DELETE CASCADE
    );
  `;
  try {
    db.exec(createGastosAbonosTable);
    console.log('Tabla gastos_abonos OK.');
  } catch (e) {
    console.error('Error al crear tabla gastos_abonos:', e.message);
  }


  // ==========================
  // KARDEX (MOVIMIENTOS DE INVENTARIO)
  // ==========================
  const createKardexTable = `
    CREATE TABLE IF NOT EXISTS kardex (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      producto_id INTEGER NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'ENTRADA' CHECK(tipo IN ('ENTRADA', 'SALIDA', 'AJUSTE')),
      cantidad REAL NOT NULL,
      motivo TEXT NOT NULL,
      referencia_id INTEGER,
      stock_anterior REAL NOT NULL,
      stock_nuevo REAL NOT NULL,
      fecha DATETIME DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (producto_id) REFERENCES productos(id)
    );
  `;
  try {
    db.exec(createKardexTable);
    console.log('Tabla kardex OK.');
  } catch (e) {
    console.error('Error al crear tabla kardex:', e.message);
  }

  // ==========================
  // REGISTRO DE AUDITORÍA
  // ==========================
  const createAuditLogsTable = `
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER,
      accion TEXT NOT NULL,
      entidad_tipo TEXT,
      entidad_id INTEGER,
      detalles_previos TEXT,
      detalles_nuevos TEXT,
      fecha DATETIME DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    );
  `;
  try {
    db.exec(createAuditLogsTable);
    console.log('Tabla audit_logs OK.');
  } catch (e) {
    console.error('Error al crear tabla audit_logs:', e.message);
  }

  // ==========================
  // APERTURAS DE CAJA
  // ==========================
  const createAperturasCajaTable = `
    CREATE TABLE IF NOT EXISTS aperturas_caja (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha DATETIME DEFAULT (datetime('now','localtime')),
      -- montos iniciales en caja
      opening_ves REAL NOT NULL DEFAULT 0,
      opening_usd REAL NOT NULL DEFAULT 0,
      -- tasa BCV registrada en el momento de la apertura
      tasa_bcv_momento REAL NOT NULL DEFAULT 0,
      notas TEXT
    );
  `;
  try {
    db.exec(createAperturasCajaTable);
    console.log('Tabla aperturas_caja OK (creada o ya existente).');
  } catch (e) {
    console.error('Error al crear tabla aperturas_caja:', e.message);
  }

  safeAddColumn('aperturas_caja', 'usuario_id', 'INTEGER REFERENCES usuarios(id)');

  // ==========================
  // CIERRES DE CAJA (CIERRE Z)
  // ==========================
  const createCierresCajaTable = `
    CREATE TABLE IF NOT EXISTS cierres_caja (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha DATETIME DEFAULT (datetime('now','localtime')),
      usuario_id INTEGER REFERENCES usuarios(id)
    );
  `;
  db.exec(createCierresCajaTable);

  const createCierresZTable = `
    CREATE TABLE IF NOT EXISTS cierres_z(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT DEFAULT(datetime('now', 'localtime')),
      total_sistema_ves REAL DEFAULT 0,
      total_sistema_usd REAL DEFAULT 0,
      total_manual_ves REAL DEFAULT 0,
      total_manual_usd REAL DEFAULT 0,
      diferencia_ves REAL DEFAULT 0,
      diferencia_usd REAL DEFAULT 0,
      notes TEXT,
      raw_json TEXT,
      usuario_id INTEGER REFERENCES usuarios(id)
    );
  `;
  db.exec(createCierresZTable);
  console.log('Tablas de cierre (caja y Z) OK.');

  safeAddColumn('cierres_caja', 'usuario_id', 'INTEGER REFERENCES usuarios(id)');
  safeAddColumn('cierres_z', 'usuario_id', 'INTEGER REFERENCES usuarios(id)');
  safeAddColumn('cierres_z', 'notes', 'TEXT');
  safeAddColumn('cierres_z', 'raw_json', 'TEXT');

  // ==========================
  // SEED RATES
  // ==========================
  const seedRates = `
    INSERT OR IGNORE INTO settings (key, value) VALUES
      ('BCV', 36.50),
      ('PARALELO', 39.80),
      ('COP', 0.00995),
      ('CALC_METHOD', 1),
      ('AUTO_BCV', 0);
  `;
  try {
    db.exec(seedRates);
  } catch (seedError) {
    console.warn("Advertencia al intentar sembrar tasas iniciales:", seedError.message);
  }

  // Asegurar que AUTO_BCV exista con valor 1 por defecto (para DBs existentes)
  try {
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('AUTO_BCV', 0)").run();
  } catch (e) {
    // Ignorar si ya existe
  }

  // ==========================
  // LIMPIAR BARCODES DE PRODUCTOS INACTIVOS
  // ==========================
  try {
    const limpiarBarcodesInactivos = db.prepare(`
      UPDATE productos
      SET barcode = NULL
      WHERE activo = 0
        AND barcode IS NOT NULL
    `);
    const info = limpiarBarcodesInactivos.run();
    console.log(
      'Migración DB: códigos de barras limpiados en productos inactivos (' +
      info.changes +
      ' filas actualizadas).'
    );
  } catch (e) {
    console.warn(
      'Advertencia de migración: no se pudieron limpiar barcodes de productos inactivos:',
      e.message
    );
  }

  // ==========================
  // MIGRACIÓN: SOPORTE PARA LITRO (Actualización robusta)
  // ==========================
  try {
    const tableDef = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='productos'").get();
    if (tableDef && !tableDef.sql.includes("'LITRO'")) {
      console.log('Migración DB: Actualizando tabla productos para soportar LITRO y asegurar columnas...');

      const migrationTransaction = db.transaction(() => {
        // 1. Crear tabla temporal con estructura COMPLETA ACTUAL
        db.exec(`
          CREATE TABLE productos_temp (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            costo REAL NOT NULL,
            costo_bulto REAL DEFAULT 0,
            unidades_bulto INTEGER DEFAULT 1,
            moneda_costo TEXT NOT NULL CHECK(moneda_costo IN ('VES', 'BCV', 'PARALELO', 'COP')),
            porcentaje_ganancia REAL NOT NULL,
            stock REAL DEFAULT 0,
            categoria TEXT,
            tipo_venta TEXT NOT NULL DEFAULT 'UNIDAD' CHECK(tipo_venta IN ('UNIDAD', 'PESO', 'LITRO')),
            proveedor TEXT,
            barcode TEXT UNIQUE DEFAULT NULL,
            activo BOOLEAN DEFAULT 1,
            exento_iva INTEGER NOT NULL DEFAULT 1,
            conteo_fisico REAL DEFAULT NULL,
            creado_en DATETIME DEFAULT (datetime('now', 'localtime'))
          );
        `);

        // 2. Copiar datos asegurando que si la columna no existe en la vieja, usamos el default
        // (Aunque para este punto ya deberían existir por los safeAddColumn de arriba)
        db.exec(`
          INSERT INTO productos_temp (
            id, nombre, costo, costo_bulto, unidades_bulto, moneda_costo, porcentaje_ganancia, 
            stock, categoria, tipo_venta, proveedor, barcode, activo, exento_iva, conteo_fisico, creado_en
          )
          SELECT 
            id, nombre, costo, costo_bulto, unidades_bulto, moneda_costo, porcentaje_ganancia, 
            stock, categoria, tipo_venta, proveedor, barcode, 
            COALESCE(activo, 1), COALESCE(exento_iva, 1), conteo_fisico, creado_en
          FROM productos;
        `);

        // 3. Dropear anterior
        db.exec('DROP TABLE productos');

        // 4. Renombrar
        db.exec('ALTER TABLE productos_temp RENAME TO productos');
      });

      migrationTransaction();
      console.log('Migración DB: Tabla productos actualizada correctamente con soporte LITRO.');
    }
  } catch (e) {
    console.error('Error FATAL en migración LITRO:', e.message);
  }


  // ==========================
  // MIGRACIÓN: AJUSTES DE IVA Y SETTINGS
  // ==========================
  safeAddSetting('IVA_PERCENTAGE', 16.0);
  safeAddSetting('IVA_MODE', 'INCLUDED');

  // ==========================
  // MIGRACIÓN: IMPUESTO TOTAL (VENTAS)
  // ==========================
  try {
    db.exec(`
      ALTER TABLE ventas
      ADD COLUMN impuesto_total REAL NOT NULL DEFAULT 0
    `);
    console.log('Migración DB: Columna `impuesto_total` añadida a ventas.');
  } catch (e) {
    if (!e.message.includes('duplicate column name: impuesto_total')) {
      console.warn('Advertencia de migración, columna `impuesto_total` no añadida:', e.message);
    }
  }

  // ==========================
  // MIGRACIÓN: PERMITIR PRODUCTO NULL EN VENTA_PRODUCTOS (AVANCES DE EFECTIVO)
  // ==========================
  try {
    const tableDefVP = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='venta_productos'").get();
    // Verificamos si la definición contiene "producto_id INTEGER NOT NULL" (con o sin espacios extra)
    if (tableDefVP && /producto_id\s+INTEGER\s+NOT\s+NULL/i.test(tableDefVP.sql)) {
      console.log('Migración DB: Actualizando tabla venta_productos para permitir NULL en producto_id...');

      const migrationVP = db.transaction(() => {
        // CUIDADO: hay que asegurarse de recrear la tabla con la estructura EXACTA deseada
        db.exec(`
          CREATE TABLE venta_productos_temp (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            venta_id INTEGER NOT NULL,
            producto_id INTEGER, -- Ahora permite NULL
            cantidad REAL NOT NULL,
            precio_unitario_ves REAL NOT NULL,
            costo_unitario_ves REAL NOT NULL,
            FOREIGN KEY (venta_id) REFERENCES ventas (id) ON DELETE CASCADE,
            FOREIGN KEY (producto_id) REFERENCES productos (id) ON DELETE SET NULL
          );
        `);

        // Copiar datos
        db.exec(`
          INSERT INTO venta_productos_temp (id, venta_id, producto_id, cantidad, precio_unitario_ves, costo_unitario_ves)
          SELECT id, venta_id, producto_id, cantidad, precio_unitario_ves, costo_unitario_ves
          FROM venta_productos;
        `);

        db.exec('DROP TABLE venta_productos');
        db.exec('ALTER TABLE venta_productos_temp RENAME TO venta_productos');
      });

      migrationVP();
      console.log('Migración DB: Tabla venta_productos actualizada correctamente (producto_id nullable).');
    }
  } catch (e) {
    console.error('Error FATAL en migración venta_productos nullable:', e.message);
  }

  // Migraciones adicionales de Compras (Asegurar columnas)
  safeAddColumn('compras', 'usuario_id', 'INTEGER REFERENCES usuarios(id)');
  safeAddColumn('compras', 'base_imponible_31', 'REAL NOT NULL DEFAULT 0');
  safeAddColumn('compras', 'iva_31', 'REAL NOT NULL DEFAULT 0');
  safeAddColumn('compras', 'base_imponible_0', 'REAL NOT NULL DEFAULT 0');
  safeAddColumn('compras', 'monto_total_usd', 'REAL NOT NULL DEFAULT 0');
  safeAddColumn('compras', 'estado', "TEXT DEFAULT 'COMPLETADO'");
  safeAddColumn('compras', 'creado_en', "DATETIME DEFAULT (datetime('now', 'localtime'))");

  console.log('¡Base de datos lista!');
}

module.exports = {
  get db() { return db; },
  initializeDB,
  closeDatabase,
  reopenDatabase,
  getBcvRate,
  getPreferredRate
};
