#!/usr/bin/env node
/**
 * Web-flow smoke for Stack 17 — exercises the Inertia (non-API) surface the
 * way a non-JS browser would: GET pages render the full HTML shell
 * (data-page JSON + csrf-token meta), and register/login/notes/logout run
 * through the web POST routes with CSRF token + session cookie, following
 * Laravel's 302 redirects. No X-Inertia header is sent: without it Laravel
 * always serves full HTML, which is what this smoke parses.
 *
 * Exit 0 = all checks passed.
 */

const BASE = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:8017';

const checks = [];
let failures = 0;

function check(name, condition, detail = '') {
    checks.push({ name, ok: condition });
    if (!condition) {
        failures += 1;
        console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
    } else {
        console.log(`ok:   ${name}`);
    }
}

function makeJar() {
    const jar = new Map();
    return {
        capture(res) {
            const raw = res.headers.getSetCookie?.() ?? [];
            for (const line of raw) {
                const [pair] = line.split(';');
                const idx = pair.indexOf('=');
                if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
            }
        },
        header() {
            return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
        },
    };
}

async function req(path, { method = 'GET', jar, body, headers = {} } = {}) {
    const h = { ...headers };
    if (jar) h.Cookie = jar.header();
    if (body !== undefined) {
        h['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: h,
        body: body === undefined ? undefined : new URLSearchParams(body).toString(),
        redirect: 'manual',
    });
    if (jar) jar.capture(res);
    return res;
}

function decodeEntities(s) {
    return s
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

function extractCsrf(html) {
    const m = html.match(/name="csrf-token" content="([^"]+)"/);
    return m ? m[1] : null;
}

function extractDataPage(html) {
    // Inertia 2 renders the page context as a JSON script tag:
    // <script data-page="app" type="application/json">{...}</script>
    const m = html.match(
        /<script data-page="[^"]*" type="application\/json">([\s\S]*?)<\/script>/,
    );
    if (!m) return null;
    try {
        return JSON.parse(decodeEntities(m[1]));
    } catch {
        return null;
    }
}

function locationPath(res) {
    const loc = res.headers.get('location') ?? '';
    if (loc.startsWith('http')) {
        const u = new URL(loc);
        return u.pathname + (u.search || '');
    }
    return loc;
}

// -- 1. welcome page renders the Inertia shell --------------------------------
const welcome = await req('/');
check('welcome page is 200', welcome.status === 200);
const welcomeHtml = await welcome.text();
check('welcome carries csrf-token meta', welcomeHtml.includes('name="csrf-token"'));
const welcomePage = extractDataPage(welcomeHtml);
check('welcome data-page component is Welcome', welcomePage?.component === 'Welcome');
check('welcome data-page carries auth prop', welcomePage !== null && 'auth' in (welcomePage?.props ?? {}));
check(
    'welcome injects Ziggy route() global',
    welcomeHtml.includes('const Ziggy={') ||
        welcomeHtml.includes('const Ziggy = {') ||
        welcomeHtml.includes('window.route') ||
        welcomeHtml.includes('function route('),
);

// -- 2. register through the WEB route (CSRF + session) -----------------------
const getReg = await req('/register');
const regHtml = await getReg.text();
const csrf = extractCsrf(regHtml);
check('register page provides CSRF token', Boolean(csrf));
const regJar = makeJar();
regJar.capture(getReg);

const reg = await req('/register', {
    method: 'POST',
    jar: regJar,
    body: {
        _token: csrf,
        name: 'Web Flow User',
        email: 'webflow@example.com',
        password: 'correcthorse1',
        password_confirmation: 'correcthorse1',
    },
});
check('web register redirects after success', reg.status === 302, `status ${reg.status}`);

// -- 3. login through the WEB route -------------------------------------------
const getLogin = await req('/login');
const loginHtml = await getLogin.text();
const csrf2 = extractCsrf(loginHtml);
const loginJar = makeJar();
loginJar.capture(getLogin);
const login = await req('/login', {
    method: 'POST',
    jar: loginJar,
    body: { _token: csrf2, email: 'webflow@example.com', password: 'correcthorse1' },
});
check('web login redirects to dashboard', login.status === 302 && (login.headers.get('location') ?? '').includes('/dashboard'), `status ${login.status}`);

// -- 4. dashboard renders with the session ------------------------------------
const dash = await req(locationPath(login) || '/dashboard', { jar: loginJar });
check('dashboard renders 200 after login', dash.status === 200, `status ${dash.status}`);
const dashHtml = await dash.text();
const dashPage = extractDataPage(dashHtml);
check('dashboard component is Dashboard', dashPage?.component === 'Dashboard');
check('dashboard carries the logged-in user', JSON.stringify(dashPage?.props?.auth ?? {}).includes('Web Flow User'));

// -- 5. create a note through the WEB route -----------------------------------
const getCreate = await req('/notes/create', { jar: loginJar });
const createHtml = await getCreate.text();
const csrf3 = extractCsrf(createHtml);
const createPage = extractDataPage(createHtml);
check('notes/create page renders with CSRF', getCreate.status === 200 && Boolean(csrf3) && createPage?.component === 'Notes/Form');
const create = await req('/notes', {
    method: 'POST',
    jar: loginJar,
    body: { _token: csrf3, title: 'Web note', body: 'Created through the Inertia web flow.' },
});
check('web note create redirects', create.status === 302, `status ${create.status}`);

const list = await req('/notes', { jar: loginJar });
const listPage = extractDataPage(await list.text());
check('notes list shows the created note', JSON.stringify(listPage?.props ?? {}).includes('Web note'));

// -- 6. logout through the WEB route revokes the session ----------------------
const dashHtml2 = await (await req('/dashboard', { jar: loginJar })).text();
const csrf4 = extractCsrf(dashHtml2);
const logout = await req('/logout', { method: 'POST', jar: loginJar, body: { _token: csrf4 } });
check('web logout redirects', logout.status === 302, `status ${logout.status}`);
const afterLogout = await req('/dashboard', { jar: loginJar, redirect: 'manual' });
check('dashboard requires auth after logout (302 to login)', afterLogout.status === 302 && (afterLogout.headers.get('location') ?? '').includes('/login'), `status ${afterLogout.status}`);

console.log(`\nweb-flow checks: ${checks.length - failures}/${checks.length} passed`);
if (failures > 0) {
    console.error('WEB SMOKE FAILED');
    process.exit(1);
}
console.log('WEB SMOKE PASSED');
