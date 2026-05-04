/**
 * LLM Polisher — Vantarius
 *
 * Generates personalized outreach messages using a local LLM (Ollama).
 *
 * Strategy:
 *   1. Build a stage-aware prompt with few-shot examples and signal context
 *   2. Generate 2 variants at different temperatures
 *   3. Score each variant heuristically, pick the best
 *   4. Self-evaluate with LLM (0-10) — rewrite once if below threshold
 *   5. Validate: length, forbidden words, CTA presence
 */

'use strict';

const ollama = require('ollama');
const cfg    = require('./config_loader');
const logger = require('./logger');

// ── Quality gate ─────────────────────────────────────────────────────────────

function validateMessage(message) {
    if (!message || message.trim().length < 20) {
        return { valid: false, reason: 'Too short' };
    }
    if (message.length > 320) {
        const paragraphs = message.split('\n').filter(p => p.trim().length > 0);
        if (paragraphs.length > 1 && paragraphs[0].length <= 300) {
            return { valid: true, transformed: paragraphs[0] };
        }
        return { valid: false, reason: `Too long (${message.length} chars, max 300)` };
    }

    const forbidden = cfg.get('llm.forbidden_words', []);
    const extra     = [
        'hope you are well', 'best regards', 'kind regards',
        'i help', 'our platform', 'our tool', 'our solution'
    ];
    const allForbidden = [...forbidden, ...extra];
    const lower        = message.toLowerCase();
    const hit          = allForbidden.find(w => lower.includes(w.toLowerCase()));
    if (hit) return { valid: false, reason: `Forbidden word: "${hit}"` };

    const ctaPatterns = ['available', 'free', '15 min', '20 min', 'this week', 'chat', 'discuss', 'thoughts', '?'];
    if (!ctaPatterns.some(p => lower.includes(p))) {
        return { valid: false, reason: 'No CTA or question detected' };
    }

    return { valid: true, reason: 'OK' };
}

function cleanOutput(raw) {
    return raw
        .replace(/\*\*/g, '')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/^(Message|Body|Response)\s*[:：]\s*/i, '')
        .replace(/^(Hello|Hi|Dear|Bonjour)\s+[^,\n]*[,\n]\s*/i, '')
        .replace(/\n{2,}/g, ' ')
        .trim();
}

function scoreMessage(message, signal) {
    let score = 50;
    const len = message.length;
    if (len >= 150 && len <= 280) score += 20;
    else if (len >= 100 && len < 150) score += 10;
    else if (len > 280) score -= 10;

    const signalText  = typeof signal === 'object' ? (signal.verbatim || signal.label || '') : (signal || '');
    const signalWords = signalText.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    const lower       = message.toLowerCase();
    score += Math.min(signalWords.filter(w => lower.includes(w)).length * 5, 20);

    const powerWords = ['misalignment', 'friction', 'clarity', 'operational', 'decision', 'structural', 'signal'];
    score += Math.min(powerWords.filter(w => lower.includes(w)).length * 3, 15);

    const excl = (message.match(/!/g) || []).length;
    if (excl > 1) score -= excl * 5;
    if (/\?/.test(message)) score += 5;

    return Math.max(0, Math.min(100, score));
}

function extractMessage(raw) {
    return raw
        .replace(/<thinking>[\s\S]*?<\/thinking>/i, '')
        .replace(/<think>[\s\S]*?<\/think>/i, '')
        .replace(/^(Message|Body)\s*[:：]\s*/im, '')
        .trim()
        .split('\n')
        .find(l => l.trim().length > 10) || raw.trim();
}

// ── Prompt builder ────────────────────────────────────────────────────────────

const STAGE_CONTEXT = {
    J0:  'First cold outreach. The prospect does not know you. Goal: generate curiosity, not enthusiasm.',
    J3:  'First follow-up (J+3). They accepted your connection but did not reply. Bring a concrete proof.',
    J7:  'Second follow-up (J+7). Add value — share a relevant pattern. No pressure.',
    J10: 'Closing message (J+10). Exit cleanly. Leave a good impression. No pitch.',
};

function buildPrompt(firstName, company, signal, stage, variantIdx = 0) {
    const signalLabel   = typeof signal === 'object' ? (signal.label || '') : signal;
    const signalVerbatim = typeof signal === 'object' ? (signal.verbatim || null) : null;
    const signalCtx     = signalVerbatim
        ? `Signal: ${signalLabel}\nReal verbatim: "${signalVerbatim}"`
        : `Signal: ${signalLabel}`;

    const variantHints = [
        '',
        'Start with a factual observation about the industry.',
        'Start with a short rhetorical question.',
    ];

    return `<role>
You are a senior strategy consultant writing a cold outreach message for a B2B SaaS product.
You write like an expert who observes, not like a salesperson who pitches.
</role>

<task>
${STAGE_CONTEXT[stage] || STAGE_CONTEXT.J0}
</task>

<context>
Recipient: ${firstName} (decision-maker at ${company})
${signalCtx}
</context>

<good_examples>
CONTEXT: Sarah, restructuring at Acme Corp
MESSAGE: I spotted growing misalignment between Acme's leadership decisions and field execution — the kind of friction that becomes expensive before anyone names it. Worth 15 min?

CONTEXT: Thomas, high turnover at Globex
MESSAGE: High turnover at Globex isn't an HR problem — it's a symptom of unclear decision paths. That's measurable and fixable. Free to discuss?
</good_examples>

<constraints>
- START directly with content (no "Hi ${firstName}" — it will be added automatically)
- Length: 120–280 characters maximum
- FORBIDDEN: "solution", "platform", "help you", "hope you are well", "kind regards"
- REQUIRED: End with a direct question
- No markdown, no bullet points
${variantHints[variantIdx] || ''}
</constraints>

Message body only (without "Hi ${firstName}"):
`;
}

// ── Self-reflection ───────────────────────────────────────────────────────────

async function selfEvaluate(message, model) {
    const prompt = `Rate this outreach message from 0 to 10. Be strict — average messages score 5-6, great ones score 8+.

Deduct 3 points for each: generic CTA, wellness/HR jargon, "solution" or "platform", salesy tone.
Add 2 points for: punchy expert tone, specific signal reference, thought-provoking question.

Message: "${message}"

Reply with ONE integer only.`;

    try {
        const res = await ollama.default.chat({
            model, think: false,
            messages: [{ role: 'user', content: prompt }],
            options:  { temperature: 0.1, num_predict: 10 },
        });
        const n = parseInt((res.message.content || '').match(/\d+/)?.[0] || '7');
        return Math.max(0, Math.min(10, n));
    } catch { return 7; }
}

async function rewrite(message, firstName, company, signal, stage, model) {
    const prompt = `This outreach message was rated too generic or too long:
"${message}"

Rewrite it: sharper, more direct, expert tone. No "solution". Keep under 280 chars.
Context: ${firstName} at ${company}, Signal: ${typeof signal === 'object' ? signal.label : signal}, Stage: ${stage}

Return ONLY the rewritten body (no greeting, no explanation).`;

    try {
        const res = await ollama.default.chat({
            model, think: false,
            messages: [{ role: 'user', content: prompt }],
            options:  { temperature: 0.6, num_predict: 350 },
        });
        const raw = (res.message.content || '').trim();
        return raw ? cleanOutput(extractMessage(raw)) : null;
    } catch { return null; }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generate a polished outreach message.
 *
 * @param {string} firstName
 * @param {string} company
 * @param {string|object} signal  - string label OR { label, verbatim }
 * @param {string} stage          - 'J0' | 'J3' | 'J7' | 'J10'
 * @returns {Promise<string>}     - Full message with greeting prefix
 */
async function polishMessage(firstName, company, signal, stage = 'J0') {
    const model     = cfg.get('llm.model', 'gemma3:12b');
    const threshold = cfg.get('llm.quality_threshold', 7);

    logger.info(`Generating message [${stage}] for ${firstName} at ${company}...`);

    let bestMessage = null;
    let bestScore   = -1;
    let attempt     = 0;
    const maxRetries = 1;

    while (attempt <= maxRetries) {
        attempt++;

        for (let i = 0; i < 2; i++) {
            const prompt = buildPrompt(firstName, company, signal, stage, i);
            try {
                const res = await ollama.default.chat({
                    model, think: false,
                    messages: [{ role: 'user', content: prompt }],
                    options:  { temperature: 0.7 + i * 0.1, num_predict: 400 },
                });

                let raw = (res.message.content || '').trim();
                if (!raw && res.message.thinking) {
                    const lines = res.message.thinking.trim().split('\n').filter(l => l.length > 20);
                    raw = lines[lines.length - 1] || '';
                }

                let candidate = cleanOutput(extractMessage(raw));
                if (!candidate) continue;

                let validation = validateMessage(candidate);
                if (validation.transformed) { candidate = validation.transformed; validation = { valid: true }; }
                if (!validation.valid) { logger.warn(`Variant ${i + 1} invalid: ${validation.reason}`); continue; }

                const score = scoreMessage(candidate, signal);
                logger.info(`Variant ${i + 1} — score: ${score}/100`);

                if (score > bestScore) { bestScore = score; bestMessage = candidate; }
                if (score >= 80) break;

            } catch (err) {
                logger.warn(`Variant ${i + 1} failed: ${err.message}`);
            }
        }

        if (bestMessage) break;
        if (attempt <= maxRetries) {
            logger.warn(`Attempt ${attempt}: no valid variant. Retrying...`);
            if (typeof signal === 'object') signal = signal.label;
        }
    }

    // Fallback
    if (!bestMessage) {
        logger.warn('All variants failed — using static fallback.');
        const fallbacks = {
            J0:  `I've spotted organisational friction signals at ${company} — the kind that builds silently. Worth a 15-min call?`,
            J3:  `Sharing concrete data on ${company} — the tension I flagged is measurable and actionable. Does this resonate?`,
            J7:  `One recurring pattern at ${company}'s scale: the gap between leadership decisions and field execution widens during change. If this applies, I'm available.`,
            J10: `I won't clutter your inbox further. If the topic resurfaces, I'm here. Take care.`,
        };
        bestMessage = fallbacks[stage] || fallbacks.J0;
    } else {
        // Self-evaluation
        const aiScore = await selfEvaluate(bestMessage, model);
        logger.info(`AI self-score: ${aiScore}/10 (threshold: ${threshold})`);

        if (aiScore < threshold) {
            logger.warn(`Below threshold — rewriting...`);
            const rewritten = await rewrite(bestMessage, firstName, company, signal, stage, model);
            if (rewritten) {
                const v = validateMessage(rewritten);
                if (v.valid) { bestMessage = rewritten; logger.success('Rewrite accepted.'); }
                else logger.warn('Rewrite invalid — keeping original.');
            }
        }
    }

    // Strip accidental greeting prefix
    const prenomPattern = new RegExp(`^${firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[,\\s]+`, 'i');
    bestMessage = bestMessage.replace(prenomPattern, '').trim();

    return `Hi ${firstName}, ${bestMessage}`;
}

module.exports = { polishMessage };
