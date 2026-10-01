'use strict';

// ── Bigreel match notifier ───────────────────────────────────────────────
// Polls the streamed.pk API (which powers sports.bigreel.com.ng) and sends
// a notification LEAD_MINUTES before each configured sport's match starts.

const { getNotifier } = require('./notifier');
const fs = require('fs');

// Load .env manually (no dependencies) — real env vars take precedence.
(function loadDotEnv() {
    try {
        for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
            const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
            if (m && !(m[1] in process.env)) {
                process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
            }
        }
    } catch { /* no .env file — fine (e.g. on Render) */ }
})();

const API_BASE = 'https://streamed.pk/api';
const POLL_INTERVAL_MS = 30 * 1000;          // check the API every 30s
const STATE_FILE = 'sent.json';              // persists notified match IDs
const SITE_BASE_URL = process.env.SITE_BASE_URL || 'https://sports.bigreel.com.ng';

const VALID_SPORTS = [
    'football', 'basketball', 'hockey', 'baseball',
    'motorsport', 'fight', 'tennis', 'american-football',
];

// ── Config ───────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');
const LEAD_MINUTES = parseInt(process.env.LEAD_MINUTES || '5', 10);
const DIGEST_ENABLED = (process.env.DIGEST_ENABLED || 'true') === 'true';
const DIGEST_HOUR = parseInt(process.env.DIGEST_HOUR || '8', 10);   // WAT hour, 0-23
const POPULAR_ONLY = (process.env.POPULAR_ONLY || 'false') === 'true';
const SPORTS = (process.env.SPORTS || 'football')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

if (SPORTS.some(s => !VALID_SPORTS.includes(s))) {
    console.error(`Unknown sport in SPORTS. Valid values: ${VALID_SPORTS.join(', ')}`);
    process.exit(1);
}
if (!(DIGEST_HOUR >= 0 && DIGEST_HOUR <= 23)) {
    console.error('DIGEST_HOUR must be 0-23 (WAT).');
    process.exit(1);
}

// ── Slug / link (mirrors sports.bigreel.com.ng's utils.js) ───────────────
function slugify(text) {
    return (text || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function watchUrl(match) {
    return `${SITE_BASE_URL}/${match.category}/${slugify(match.title || match.id)}`;
}

// ── State (dedup across restarts) ────────────────────────────────────────
function loadState() {
    try {
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        const data = JSON.parse(raw);
        return new Set(Array.isArray(data.sent) ? data.sent : []);
    } catch {
        return new Set();
    }
}

function saveState(sentSet) {
    // Keep only recent IDs to stop the file growing forever.
    // Matches span ~10 days out, so anything older than 2 days is done.
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const recent = [...sentSet].filter(id => {
        // key format: "<matchId>|<dateMs>" — take the segment after the last pipe
        const idx = id.lastIndexOf('|');
        return idx !== -1 && Number(id.slice(idx + 1)) > twoDaysAgo;
    });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ sent: recent }, null, 2));
}

const sent = loadState();

// Match IDs include a timestamp suffix so identical-name rematches differ.
function matchKey(match) {
    return `${match.id}|${match.date}`;
}

// ── API helpers ──────────────────────────────────────────────────────────
async function fetchMatches() {
    const res = await fetch(`${API_BASE}/matches/all`);
    if (!res.ok) throw new Error(`API ${res.status} from /matches/all`);
    return res.json();
}

// ── Message formatting ───────────────────────────────────────────────────
const SPORT_EMOJI = {
    'football': '⚽',
    'basketball': '🏀',
    'hockey': '🏒',
    'baseball': '⚾',
    'motorsport': '🏎️',
    'fight': '🥊',
    'tennis': '🎾',
    'american-football': '🏈',
};

function buildMessage(match) {
    const emoji = SPORT_EMOJI[match.category] || '📣';
    const timeStr = new Date(match.date).toLocaleTimeString('en-NG', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos',
    });
    return [
        `${emoji} <b>${escapeHtml(match.title)}</b>`,
        `🕐 Kickoff: ${timeStr} (WAT) — starts in ~${LEAD_MINUTES} min!`,
        '',
        `📺 Watch: ${watchUrl(match)}`,
    ].join('\n');
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ── Daily digest ───────────────────────────────────────────────────────────────
// Posts one message each morning listing today's matches (WAT times),
// with per-sport sections and watch links.

const DAY_MS = 24 * 60 * 60 * 1000;
let lastDigestDate = null;   // 'YYYY-MM-DD' (WAT) of the last digest sent

function watDateString(ms) {
    return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }); // YYYY-MM-DD
}

function currentWatHour() {
    return Number(new Date().toLocaleString('en-GB', {
        hour: '2-digit', hour12: false, timeZone: 'Africa/Lagos',
    }));
}

function buildDigest(matches, dayStr) {
    const bySport = new Map();
    for (const m of matches) {
        const sport = m.category || 'other';
        if (!bySport.has(sport)) bySport.set(sport, []);
        bySport.get(sport).push(m);
    }

    const lines = [`📅 <b>Today's schedule</b> — ${dayStr}${POPULAR_ONLY ? ' (popular only)' : ''}`];
    for (const [sport, list] of bySport) {
        const emoji = SPORT_EMOJI[sport] || '📣';
        lines.push('', `${emoji} <b>${sport.charAt(0).toUpperCase() + sport.slice(1)}</b>`);
        for (const m of list.sort((a, b) => a.date - b.date)) {
            const time = new Date(m.date).toLocaleTimeString('en-NG', {
                hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos',
            });
            const star = m.popular ? ' ⭐' : '';
            lines.push(`• ${time} — <a href="${watchUrl(m)}">${escapeHtml(m.title)}</a>${star}`);
        }
    }
    lines.push('', `📺 Watch all free on sports.bigreel.com.ng`);
    return lines.join('\n');
}

async function sendDigestIfDue(sendFn) {
    const now = Date.now();
    const today = watDateString(now);
    if (lastDigestDate === today) return false;
    if (currentWatHour() < DIGEST_HOUR) return false;   // wait until the configured hour

    const matches = await fetchMatches();
    const todays = matches.filter(m => {
        if (!SPORTS.includes((m.category || '').toLowerCase())) return false;
        if (POPULAR_ONLY && !m.popular) return false;
        // Keep matches whose WAT date string equals today's
        return watDateString(m.date) === today;
    });

    if (todays.length === 0) {
        console.log('  Digest: no matches today, skipping');
        lastDigestDate = today;
        return false;
    }

    const message = buildDigest(todays, today);
    if (DRY_RUN) {
        console.log(`[DRY-RUN] Would send digest (${todays.length} matches):`);
        console.log(message.replace(/<[^>]+>/g, ''));
    } else {
        try {
            await sendFn(message);
            console.log(`✓ Sent daily digest (${todays.length} matches)`);
        } catch (err) {
            console.error(`✗ Digest send failed: ${err.message}`);
            return false;   // retry on next poll
        }
    }
    lastDigestDate = today;
    return true;
}

// ── Core check loop ──────────────────────────────────────────────────────
async function checkAndNotify(sendFn) {
    const matches = await fetchMatches();
    const now = Date.now();
    const notifyFrom = now;                        // window opens now
    const notifyUntil = now + LEAD_MINUTES * 60 * 1000;

    const due = matches.filter(m =>
        SPORTS.includes((m.category || '').toLowerCase()) &&
        m.date >= notifyFrom && m.date <= notifyUntil &&   // kickoff within the lead window
        !sent.has(matchKey(m))
    );

    for (const match of due) {
        if (DRY_RUN) {
            console.log(`[DRY-RUN] Would send now: ${match.title} (starts ${new Date(match.date).toISOString()})`);
            console.log(`          ${buildMessage(match).replace(/<[^>]+>/g, '')}`);
            sent.add(matchKey(match));   // mark as handled so dry-run doesn't spam on every poll
            continue;
        }

        try {
            await sendFn(buildMessage(match));
            sent.add(matchKey(match));
            console.log(`✓ Sent: ${match.title}`);
        } catch (err) {
            console.error(`✗ Failed to send "${match.title}": ${err.message}`);
            // Not marked sent → retried on the next poll
        }
    }

    if (sent.size) saveState(sent);
    return due.length;
}

// ── Entry ────────────────────────────────────────────────────────────────
async function main() {
    console.log(`Bigreel notifier starting`);
    console.log(`  Sports: ${SPORTS.join(', ')}`);
    console.log(`  Lead: ${LEAD_MINUTES} min | Poll: every ${POLL_INTERVAL_MS / 1000}s | Dry-run: ${DRY_RUN}`);
    if (DIGEST_ENABLED) {
        console.log(`  Digest: daily at ${String(DIGEST_HOUR).padStart(2, '0')}:00 WAT${POPULAR_ONLY ? ' | popular matches only' : ''}`);
    }

    const sendFn = DRY_RUN ? async () => {} : getNotifier();
    if (!DRY_RUN) console.log('  Notifier: telegram');

    // Health endpoint for Render free tier (keeps the service from idling out).
    if (!DRY_RUN && process.env.RENDER) {
        const http = require('http');
        const port = process.env.PORT || 3000;
        http.createServer((req, res) => {
            if (req.url === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, sports: SPORTS, tracked: sent.size }));
            } else {
                res.writeHead(404).end();
            }
        }).listen(port, () => console.log(`  Health endpoint on :${port}/health`));
    }

    const tick = async () => {
        try {
            if (DIGEST_ENABLED && !process.argv.includes('--no-digest')) {
                await sendDigestIfDue(sendFn);
            }
            const n = await checkAndNotify(sendFn);
            if (n > 0) console.log(`  Processed ${n} match(es) this poll`);
        } catch (err) {
            console.error(`Poll failed: ${err.message}`);
        }
    };

    await tick();                    // run once immediately
    if (DRY_RUN) {
        console.log('Dry-run complete — one check performed, exiting.');
        return;                      // let the event loop drain and exit cleanly
    }
    setInterval(tick, POLL_INTERVAL_MS);
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
