'use strict';

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const CONFIG_FILE = path.join(process.cwd(), 'config.yaml');
let _config = null;

function load() {
    if (_config) return _config;
    if (!fs.existsSync(CONFIG_FILE)) {
        throw new Error(`config.yaml not found. Copy from the project root and edit it.`);
    }
    const raw = yaml.load(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (process.env.SMTP_USER)      raw.email.smtp_user = process.env.SMTP_USER;
    if (process.env.SMTP_PASS)      raw.email.smtp_pass = process.env.SMTP_PASS;
    _config = raw;
    return _config;
}

function get(keyPath, fallback = undefined) {
    const cfg  = load();
    const keys = keyPath.split('.');
    let   val  = cfg;
    for (const k of keys) {
        if (val == null || typeof val !== 'object') return fallback;
        val = val[k];
    }
    return val !== undefined ? val : fallback;
}

module.exports = { load, get };
