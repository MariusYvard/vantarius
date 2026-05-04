'use strict';

const fs = require('fs');

async function atomicWriteCRM(workbook, filePath) {
    const tmpPath = filePath + '.tmp';
    const bakPath = filePath + '.bak';
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            await workbook.xlsx.writeFile(tmpPath);
            if (fs.existsSync(filePath)) fs.renameSync(filePath, bakPath);
            fs.renameSync(tmpPath, filePath);
            return;
        } catch (err) {
            if (attempt === MAX_RETRIES) {
                fs.copyFileSync(tmpPath, filePath);
                fs.unlinkSync(tmpPath);
                return;
            }
            await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }
}

function validateCRMIntegrity(filePath) {
    if (!fs.existsSync(filePath)) return false;
    try { return fs.statSync(filePath).size > 100; } catch { return false; }
}

module.exports = { atomicWriteCRM, validateCRMIntegrity };
