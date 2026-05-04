/**
 * LinkedIn Sender — Vantarius
 *
 * Sends LinkedIn connection requests with a personalized note (J0)
 * and follow-up DMs (J3, J7, J10) using Puppeteer + stealth.
 *
 * Anti-detection:
 *   - Human-like typing speed (configured in config.yaml)
 *   - Ghost cursor mouse movement
 *   - Random delays between actions
 */

'use strict';

const cfg    = require('./config_loader');
const logger = require('./logger');

/**
 * Type text into a field with human-like timing.
 */
async function humanType(page, selector, text) {
    await page.click(selector);
    const min = cfg.get('linkedin.typing_speed_min', 30);
    const max = cfg.get('linkedin.typing_speed_max', 70);

    for (const char of text) {
        await page.keyboard.type(char);
        await new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min)) + min));
    }
}

/**
 * Send a J0 LinkedIn connection request with a note.
 *
 * @param {Page} page         - Puppeteer page (logged-in LinkedIn session)
 * @param {string} profileUrl - Full LinkedIn /in/ URL
 * @param {string} message    - Invitation note (max 300 chars)
 * @param {boolean} dryRun    - If true, navigate but don't click send
 * @returns {Promise<boolean>} - true = sent successfully
 */
async function sendConnectionRequest(page, profileUrl, message, dryRun = false) {
    try {
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 1500));

        // Find "Connect" button
        const connectBtn = await page.$('button[aria-label*="Connect"], button[aria-label*="Invite"]');
        if (!connectBtn) {
            logger.warn(`No "Connect" button found on ${profileUrl}`);
            return false;
        }

        if (dryRun) {
            logger.info(`[DRY RUN] Would send connection request to ${profileUrl}`);
            logger.info(`[DRY RUN] Note: ${message.substring(0, 80)}...`);
            return true;
        }

        await connectBtn.click();
        await new Promise(r => setTimeout(r, 1500));

        // Click "Add a note"
        const noteBtn = await page.$('button[aria-label*="note"], button[aria-label*="Note"]');
        if (noteBtn) {
            await noteBtn.click();
            await new Promise(r => setTimeout(r, 1000));

            const noteField = await page.$('textarea[name="message"]');
            if (noteField) {
                await humanType(page, 'textarea[name="message"]', message.substring(0, 300));
            }
        }

        // Send
        const sendBtn = await page.$('button[aria-label*="Send now"], button[aria-label*="Send invitation"]');
        if (sendBtn) {
            await sendBtn.click();
            await new Promise(r => setTimeout(r, 2000));
            logger.success(`Connection request sent to ${profileUrl}`);
            return true;
        }

        logger.warn(`Send button not found on ${profileUrl}`);
        return false;

    } catch (err) {
        logger.error(`Error sending connection to ${profileUrl}: ${err.message}`);
        return false;
    }
}

/**
 * Send a follow-up DM (J3, J7, J10) to an existing connection.
 *
 * @param {Page} page
 * @param {string} profileUrl
 * @param {string} message
 * @param {boolean} dryRun
 * @returns {Promise<boolean>}
 */
async function sendDirectMessage(page, profileUrl, message, dryRun = false) {
    try {
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 1500));

        const msgBtn = await page.$('button[aria-label*="Message"]');
        if (!msgBtn) {
            logger.warn(`No "Message" button found — may not be a connection yet: ${profileUrl}`);
            return false;
        }

        if (dryRun) {
            logger.info(`[DRY RUN] Would send DM to ${profileUrl}`);
            logger.info(`[DRY RUN] Message: ${message.substring(0, 80)}...`);
            return true;
        }

        await msgBtn.click();
        await new Promise(r => setTimeout(r, 1500));

        const msgField = await page.$('.msg-form__contenteditable, div[role="textbox"]');
        if (!msgField) {
            logger.warn(`Message compose box not found on ${profileUrl}`);
            return false;
        }

        await msgField.click();
        for (const char of message) {
            await page.keyboard.type(char);
            await new Promise(r => setTimeout(r, Math.floor(Math.random() * 40) + 20));
        }

        await new Promise(r => setTimeout(r, 500));
        const sendBtn = await page.$('button[type="submit"].msg-form__send-button');
        if (sendBtn) {
            await sendBtn.click();
            await new Promise(r => setTimeout(r, 1500));
            logger.success(`DM sent to ${profileUrl}`);
            return true;
        }

        logger.warn(`DM send button not found on ${profileUrl}`);
        return false;

    } catch (err) {
        logger.error(`Error sending DM to ${profileUrl}: ${err.message}`);
        return false;
    }
}

module.exports = { sendConnectionRequest, sendDirectMessage };
