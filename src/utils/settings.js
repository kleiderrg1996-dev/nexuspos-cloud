// src/utils/settings.js
const fs = require('fs');
const path = require('path');

// Prefer local 'data' directory for portability, but use ProgramData if in a protected system folder
// Detect if we are running from a bundled ASAR archive
const isAsar = __dirname.includes('app.asar');

let currentDir;
const isStealth = __dirname.endsWith('engine') || __dirname.includes('engine' + path.sep);

if (isAsar && process.resourcesPath) {
  // In a bundled Electron app, go one level up from the 'resources' folder to reach the app root
  currentDir = path.join(process.resourcesPath, '..');
} else if (isStealth) {
  // In a stealth/portable build, the bundled server is in the 'engine' folder
  currentDir = path.join(__dirname, '..');
} else {
  // In development, go two levels up from 'src/utils'
  currentDir = path.join(__dirname, '..', '..');
}

const isInProgramFiles = currentDir.toLowerCase().includes('program files');
const localDataPath = path.join(currentDir, 'data');
const programDataPath = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Nexus_Data');
const legacyPaths = [
  path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'NexusPOS_Data'),
  path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'BodegApp_Data')
];

// Prioritize local 'data' folder for portability (unless in Program Files),
// then predefined system paths.
let dataBasePath;

if (!isInProgramFiles) {
  // For portable use, always prefer the 'data' folder next to the app
  dataBasePath = localDataPath;
} else if (fs.existsSync(programDataPath)) {
  dataBasePath = programDataPath;
} else {
  // Check for any legacy path that might contain data
  const existingLegacyPath = legacyPaths.find(p => fs.existsSync(p));
  if (existingLegacyPath) {
    console.log(`Detectado directorio de datos antiguo (${path.basename(existingLegacyPath)}). Usando para migración.`);
    dataBasePath = existingLegacyPath;
  } else {
    dataBasePath = programDataPath;
  }
}

// Final safety check: NEVER allow a path inside app.asar (it is read-only)
if (dataBasePath.includes('app.asar')) {
  if (process.resourcesPath) {
    dataBasePath = path.join(process.resourcesPath, '..', 'data');
  } else {
    // Ultimate fallback if everything else fails
    dataBasePath = path.join(process.env.APPDATA || process.env.USERPROFILE, 'Nexus_Data');
  }
}

if (!fs.existsSync(dataBasePath)) {
  try {
    fs.mkdirSync(dataBasePath, { recursive: true });
    console.log(`Directorio de datos creado en: ${dataBasePath}`);
  } catch (error) {
    console.error(`Error crítico creando directorio de datos: ${error}`);
  }
}

const settingsPath = path.join(dataBasePath, 'business-settings.json');

const DEFAULT_SETTINGS = {
  businessName: "NexusPOS",
  logoPath: "/images/default-logo.png",
  licenseKey: "",
  adminPasswordHash: null,

  // --- CONFIGURACIÓN DE IMPRESIÓN BÁSICA (ya la tenías) ---
  printTicket: true,   // imprimir ticket sí/no
  ticketSize: 80,      // 58 o 80 mm

  // --- NUEVO: OPCIONES AVANZADAS DE IMPRESIÓN ---
  // 'preview' = abre PDF/navegador, 'direct' = impresión directa
  printMode: "preview",
  // nombre de impresora (si está vacío se usa la predeterminada)
  printerName: "",
  // número de copias del ticket
  printCopies: 1,
  // texto de encabezado del ticket
  printHeader: "",
  // texto de pie de página del ticket
  printFooter: "",

  // --- DATOS DE CONTACTO (Primer Uso) ---
  clientPhone: "",
  clientEmail: ""
};

function loadSettings() {
  try {
    // Si no existe el archivo, lo creamos con los valores por defecto
    if (!fs.existsSync(settingsPath)) {
      saveSettings(DEFAULT_SETTINGS);
      return { ...DEFAULT_SETTINGS };
    }

    const data = fs.readFileSync(settingsPath, 'utf8');
    if (!data) {
      saveSettings(DEFAULT_SETTINGS);
      return { ...DEFAULT_SETTINGS };
    }

    const settings = JSON.parse(data);

    // Aseguramos TODOS los campos con fallback a DEFAULT_SETTINGS
    if (!settings.businessName) {
      settings.businessName = DEFAULT_SETTINGS.businessName;
    }
    if (settings.logoPath === undefined) {
      settings.logoPath = DEFAULT_SETTINGS.logoPath;
    }
    if (settings.licenseKey === undefined) {
      settings.licenseKey = DEFAULT_SETTINGS.licenseKey;
    }
    if (settings.adminPasswordHash === undefined) {
      settings.adminPasswordHash = DEFAULT_SETTINGS.adminPasswordHash;
    }
    if (settings.printTicket === undefined) {
      settings.printTicket = DEFAULT_SETTINGS.printTicket;
    }
    if (settings.ticketSize === undefined) {
      settings.ticketSize = DEFAULT_SETTINGS.ticketSize;
    }

    // NUEVOS CAMPOS DE IMPRESIÓN AVANZADA
    if (settings.printMode === undefined) {
      settings.printMode = DEFAULT_SETTINGS.printMode;
    }
    if (settings.printerName === undefined) {
      settings.printerName = DEFAULT_SETTINGS.printerName;
    }
    if (settings.printCopies === undefined) {
      settings.printCopies = DEFAULT_SETTINGS.printCopies;
    }
    if (settings.printHeader === undefined) {
      settings.printHeader = DEFAULT_SETTINGS.printHeader;
    }
    if (settings.printFooter === undefined) {
      settings.printFooter = DEFAULT_SETTINGS.printFooter;
    }
    // NUEVOS CAMPOS DE CLIENTE (CONTACTO)
    if (settings.clientPhone === undefined) {
      settings.clientPhone = DEFAULT_SETTINGS.clientPhone;
    }
    if (settings.clientEmail === undefined) {
      settings.clientEmail = DEFAULT_SETTINGS.clientEmail;
    }

    return settings;
  } catch (error) {
    console.error('Error al cargar business-settings.json:', error);
    try {
      saveSettings(DEFAULT_SETTINGS);
    } catch (saveError) {
      console.error('Error fatal al intentar restaurar business-settings.json:', saveError);
    }
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  try {
    const settingsToSave = {
      businessName: settings.businessName || DEFAULT_SETTINGS.businessName,
      logoPath: settings.logoPath !== undefined ? settings.logoPath : DEFAULT_SETTINGS.logoPath,
      licenseKey: settings.licenseKey || DEFAULT_SETTINGS.licenseKey,
      adminPasswordHash: settings.adminPasswordHash !== undefined
        ? settings.adminPasswordHash
        : DEFAULT_SETTINGS.adminPasswordHash,

      // DATA DE CONTACTO
      clientPhone: settings.clientPhone || DEFAULT_SETTINGS.clientPhone,
      clientEmail: settings.clientEmail || DEFAULT_SETTINGS.clientEmail,

      // BÁSICO
      printTicket: typeof settings.printTicket === 'boolean'
        ? settings.printTicket
        : DEFAULT_SETTINGS.printTicket,
      ticketSize: typeof settings.ticketSize === 'number'
        ? settings.ticketSize
        : DEFAULT_SETTINGS.ticketSize,

      // AVANZADO
      printMode: settings.printMode || DEFAULT_SETTINGS.printMode,
      printerName: settings.printerName || DEFAULT_SETTINGS.printerName,
      printCopies: (typeof settings.printCopies === 'number' && settings.printCopies > 0)
        ? settings.printCopies
        : DEFAULT_SETTINGS.printCopies,
      printHeader: settings.printHeader || DEFAULT_SETTINGS.printHeader,
      printFooter: settings.printFooter || DEFAULT_SETTINGS.printFooter
    };

    const data = JSON.stringify(settingsToSave, null, 2);
    fs.writeFileSync(settingsPath, data, 'utf8');
    console.log('Configuración del negocio guardada:', settingsPath);
    return true;
  } catch (error) {
    console.error('Error al guardar business-settings.json:', error);
    return false;
  }
}

const ticketDesignPath = path.join(dataBasePath, 'ticket-design.json');
const ticketTemplatePath = path.join(dataBasePath, 'ticket-template.html');

const DEFAULT_TICKET_DESIGN = {
  fontFamily: "'Courier New', Courier, monospace",
  fontSize: 12,
  logoSize: 45,
  headerAlign: "center",
  footerAlign: "center",
  showLogo: true,
  showClient: true,
  showTasa: true
};

const DEFAULT_TICKET_TEMPLATE = `
<style>
  * { box-sizing: border-box; }
  .ticket-body {
    font-family: {{fontFamily}};
    font-size: {{fontSize}};
    width: 100%;
    max-width: {{widthCss}};
    margin: 0 auto;
    padding: 2mm;
    color: #000;
  }
  .header { text-align: {{headerAlign}}; margin-bottom: 10px; }
  .logo { display: {{logoDisplay}}; width: {{logoSize}}%; margin: 0 auto 10px auto; }
  .business-name { font-weight: bold; font-size: 1.2em; margin-bottom: 5px; }
  .client-info { display: {{clientDisplay}}; margin-bottom: 10px; border-bottom: 1px dashed #000; padding-bottom: 5px; }
  .table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  .table th { border-bottom: 1px solid #000; text-align: left; }
  .table td { padding: 2px 0; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .totals { border-top: 1px dashed #000; padding-top: 5px; margin-bottom: 10px; }
  .row { display: flex; justify-content: space-between; margin-bottom: 2px; }
  .total-row { font-weight: bold; font-size: 1.1em; }
  .tasa-info { display: {{tasaDisplay}}; text-align: center; font-size: 0.9em; margin-bottom: 10px; }
  .footer { text-align: {{footerAlign}}; font-size: 0.9em; border-top: 1px dashed #000; padding-top: 10px; }
</style><div class="ticket-body">
<div class="header">
  {{logoHtml}}
  <div class="business-name">{{businessName}}</div>
  <div>{{headerText}}</div>
  <div>Fecha: {{dateStr}} Hora: {{timeStr}}</div>
  <div>Ticket: #{{saleId}}</div>
</div>
{{clientInfo}}
<table class="table">
  <thead><tr><th>Cant</th><th>Descripción</th><th class="text-right">Monto</th></tr></thead>
  <tbody>{{productsHtml}}</tbody>
</table>
<div class="totals">
  <div class="row"><span>Subtotal:</span><span>Bs {{subtotalVes}}</span></div>
  <div class="row"><span>IVA:</span><span>Bs {{ivaTotal}}</span></div>
  <div class="row"><span>Total USD:</span><span>$ {{totalUsd}}</span></div>
  <div class="row total-row"><span>Total VES:</span><span>Bs {{totalVes}}</span></div>
</div>
<div class="payments">{{paymentsHtml}}</div>
<div class="tasa-info">Tasa BCV: Bs {{bcvRate}}</div>
{{extraInfoHtml}}
<div class="footer">{{footerText}}</div></div>
`;

function loadTicketDesign() {
  try {
    if (!fs.existsSync(ticketDesignPath)) {
      saveTicketDesign(DEFAULT_TICKET_DESIGN);
      return { ...DEFAULT_TICKET_DESIGN };
    }
    const data = fs.readFileSync(ticketDesignPath, 'utf8');
    return { ...DEFAULT_TICKET_DESIGN, ...JSON.parse(data) };
  } catch (err) {
    return { ...DEFAULT_TICKET_DESIGN };
  }
}

function saveTicketDesign(design) {
  try {
    fs.writeFileSync(ticketDesignPath, JSON.stringify(design, null, 2), 'utf8');
    return true;
  } catch (err) {
    return false;
  }
}

function loadTicketTemplate() {
  try {
    if (!fs.existsSync(ticketTemplatePath)) {
      saveTicketTemplate(DEFAULT_TICKET_TEMPLATE);
      return DEFAULT_TICKET_TEMPLATE;
    }
    let template = fs.readFileSync(ticketTemplatePath, 'utf8');

    // Auto-migrate: if the saved template uses the old fixed-width pattern,
    // update it to the new responsive pattern so the ticket fills the paper correctly.
    if (template.includes('width: {{widthCss}};') && !template.includes('max-width: {{widthCss}};')) {
      template = template
        .replace(
          /width:\s*\{\{widthCss\}\};/,
          'width: 100%;\n    max-width: {{widthCss}};'
        )
        .replace(
          /margin:\s*0;(\s*\n\s*padding:\s*10px 0;)/,
          'margin: 0 auto;$1'
        );
      // Add box-sizing if not present
      if (!template.includes('box-sizing')) {
        template = template.replace('<style>', '<style>\n  * { box-sizing: border-box; }');
      }
      saveTicketTemplate(template);
    }
    
    // Auto-migrate: add IVA fields if missing
    if (!template.includes('{{ivaTotal}}')) {
      const ivaRow = '<div class="row"><span>Subtotal:</span><span>Bs {{subtotalVes}}</span></div>\n  <div class="row"><span>IVA:</span><span>Bs {{ivaTotal}}</span></div>\n  ';
      template = template.replace('<div class="row"><span>Total USD:</span>', ivaRow + '<div class="row"><span>Total USD:</span>');
      saveTicketTemplate(template);
    }

    return template;
  } catch (err) {
    return DEFAULT_TICKET_TEMPLATE;
  }
}

function saveTicketTemplate(templateHtml) {
  try {
    fs.writeFileSync(ticketTemplatePath, templateHtml, 'utf8');
    return true;
  } catch (err) {
    return false;
  }
}

function resetTicketTemplate() {
  saveTicketTemplate(DEFAULT_TICKET_TEMPLATE);
  return DEFAULT_TICKET_TEMPLATE;
}

module.exports = {
  loadSettings,
  saveSettings,
  getDataBasePath: () => dataBasePath,
  loadTicketDesign,
  saveTicketDesign,
  loadTicketTemplate,
  saveTicketTemplate,
  resetTicketTemplate
};
