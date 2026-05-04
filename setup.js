/**
 * Vantarius — First-Run Setup
 *
 * Opens a browser window to log in to LinkedIn manually.
 * Session is saved locally for all future runs.
 *
 * Usage: node setup.js
 *
 * Note: If you also use AxioMariuS, point both tools to the same
 * chrome-session directory to share the login.
 */

'use strict';

const puppeteer     = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path          = require('path');
const cfg           = require('./src/config_loader');

puppeteer.use(StealthPlugin());

(async () => {
    const sessionDir = path.resolve(process.cwd(), cfg.get('linkedin.session_dir', './chrome-session'));

    console.log('\n══════════════════════════════════════════════');
    console.log('  Vantarius — LinkedIn Setup');
    console.log('══════════════════════════════════════════════');
    console.log('A browser will open. Please:');
    console.log('  1. Log in to LinkedIn');
    console.log('  2. Once you see your feed, close the browser window');
    console.log('Your session will be saved automatically.');
    console.log('══════════════════════════════════════════════\n');

    const browser = await puppeteer.launch({
        headless: false,
        userDataDir: sessionDir,
        defaultViewport: null,
        args: ['--start-maximized'],
    });

    const page = await browser.newPage();
    await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });

    await new Promise(resolve => browser.on('disconnected', resolve));
    console.log('\n✓ Session saved. You can now run: node src/main.js\n');
})().catch(err => {
    console.error('Setup error:', err.message);
    process.exit(1);
});
