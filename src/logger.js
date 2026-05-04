'use strict';

const fs   = require('fs');
const path = require('path');

const LOG_DIR  = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, `vantarius_${new Date().toISOString().slice(0, 10)}.log`);

const C = { reset: '\x1b[0m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m' };

let _start = null;

function _write(level, msg, color) {
    const ts = new Date().toISOString().slice(11, 19);
    process.stdout.write(`${color}[${ts}] ${level.padEnd(7)} ${msg}${C.reset}\n`);
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
        fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${level} ${msg}\n`);
    } catch (_) {}
}

const logger = {
    info:    m => _write('INFO',    m, C.cyan),
    success: m => _write('SUCCESS', m, C.green),
    warn:    m => _write('WARN',    m, C.yellow),
    error:   m => _write('ERROR',   m, C.red),
    startSession() { _start = Date.now(); _write('INFO', '═══ Vantarius — Session started ═══', C.green); },
    endSession(sent, skipped, errors) {
        const elapsed = _start ? Math.round((Date.now() - _start) / 1000) : 0;
        _write('INFO', `═══ Done — ${sent} sent, ${skipped} skipped, ${errors} errors — ${elapsed}s ═══`, C.green);
    },
    getLogPath() { return LOG_FILE; },
};

module.exports = logger;
