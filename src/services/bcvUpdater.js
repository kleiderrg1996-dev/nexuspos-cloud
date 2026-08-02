const https = require('https');
const { db } = require('../database');

// BCV URL
const BCV_URL = 'https://www.bcv.org.ve/';

function fetchRate() {
    return new Promise((resolve, reject) => {
        const options = {
            rejectUnauthorized: false, // Bypass SSL issues
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            },
            timeout: 10000 // 10s timeout to prevent hanging
        };

        const req = https.get(BCV_URL, options, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`BCV Website Request Failed: ${res.statusCode}`));
            }

            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    // Regex to find the USD block specifically
                    // It looks for id="dolar" ... <span> USD</span> ... <strong> 273,58610000 </strong>
                    const dolarBlockRegex = /id="dolar"[\s\S]*?<strong>\s*([\d.,]+)\s*<\/strong>/;
                    const match = data.match(dolarBlockRegex);

                    if (!match || !match[1]) {
                        return reject(new Error('Could not find USD rate ("dolar" block) on BCV page'));
                    }

                    const rawRate = match[1].trim();
                    // Format: "273,58610000" (European style: comma decimal)
                    // Remove thousands separator (.) and replace decimal separator (,) with (.)
                    const normalizedRate = rawRate.replace(/\./g, '').replace(',', '.');
                    const rate = parseFloat(normalizedRate);

                    if (isNaN(rate) || rate <= 0) {
                        return reject(new Error(`Parsed invalid rate: ${rawRate} -> ${rate}`));
                    }

                    resolve({
                        promedio: rate,
                        fechaActualizacion: new Date().toISOString()
                    });

                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', err => reject(err));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('BCV Request Timed Out'));
        });
    });
}

// Update rate. force = true skips the database check (for manual updates)
function updateBCVRate(force = true) {
    if (force) {
        console.log('Starting BCV rate update check (Manual/Force)...');
    } else {
        console.log('Starting BCV rate update check (Scheduled)...');
        // Check if Auto-Update is enabled
        try {
            const stmt = db.prepare("SELECT value FROM settings WHERE key = 'AUTO_BCV'");
            const row = stmt.get();
            const autoEnabled = row ? parseInt(row.value) === 1 : false;

            if (!autoEnabled) {
                console.log('Auto-Update is disabled. Skipping check.');
                return Promise.resolve(); // Return empty promise
            }
        } catch (err) {
            console.error('Error checking AUTO_BCV setting:', err.message);
            return Promise.resolve();
        }
    }

    return fetchRate()
        .then(data => {
            const newRate = parseFloat(data.promedio);
            if (isNaN(newRate)) {
                console.error('Invalid rate data received:', data);
                return;
            }

            // Get current rate from DB
            const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
            const currentRateRow = stmt.get('BCV');
            const currentRate = currentRateRow ? parseFloat(currentRateRow.value) : 0;

            console.log(`Current Rate: ${currentRate}, Scraped Rate: ${newRate.toFixed(4)}`);

            // Update if different (threshold 0.001)
            if (Math.abs(newRate - currentRate) > 0.001) {
                const updateStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
                updateStmt.run('BCV', newRate.toFixed(4));
                console.log(`BCV rate updated to ${newRate.toFixed(4)}`);
                return newRate; // Return for caller usage
            } else {
                console.log('BCV rate unchanged');
                return currentRate;
            }
        })
        .catch(err => {
            console.error('Error updating BCV rate:', err.message);
            // We don't throw here to avoid crashing the scheduler, but the promise resolves undefined
        });
}

// Scheduler logic
function startScheduler() {
    console.log('Starting BCV update scheduler...');

    // Run immediately on startup (respecting auto setting)
    setTimeout(() => {
        updateBCVRate(false);
    }, 5000);

    // Schedule runs every 30 minutes (30 * 60 * 1000 = 1800000 ms)
    setInterval(() => {
        updateBCVRate(false);
    }, 30 * 60 * 1000);
}

module.exports = { updateBCVRate, startScheduler };
