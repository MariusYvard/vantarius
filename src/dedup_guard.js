/**
 * Dedup Guard — Vantarius
 *
 * Prevents sending duplicate messages to the same contact on the same day.
 * State is persisted to .dedup.json.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const DEDUP_FILE = path.join(process.cwd(), '.dedup.json');

function _load() {
    if (!fs.existsSync(DEDUP_FILE)) return {};
    try { return JSON.parse(fs.readFileSync(DEDUP_FILE, 'utf8')); } catch { return {}; }
}

function _save(data) {
    fs.writeFileSync(DEDUP_FILE, JSON.stringify(data, null, 2));
}

function _todayKey() {
    return new Date().toISOString().slice(0, 10);
}

/** Returns true if this contact was already processed today. */
function alreadyProcessedToday(linkedinUrl) {
    const data = _load();
    const today = _todayKey();
    return !!(data[today] && data[today].includes(linkedinUrl));
}

/** Mark a contact as processed today. */
function markAsProcessed(linkedinUrl) {
    const data  = _load();
    const today = _todayKey();
    if (!data[today]) data[today] = [];
    if (!data[today].includes(linkedinUrl)) data[today].push(linkedinUrl);
    // Keep only last 30 days
    const keys = Object.keys(data).sort().reverse();
    keys.slice(30).forEach(k => delete data[k]);
    _save(data);
}

/** Get today's processed count. */
function getTodayCount() {
    const data  = _load();
    const today = _todayKey();
    return (data[today] || []).length;
}

module.exports = { alreadyProcessedToday, markAsProcessed, getTodayCount };
