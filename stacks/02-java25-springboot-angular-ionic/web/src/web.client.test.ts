/**
 * Vitest unit tests for the Angular web client (Stack 02).
 *
 * Approach: page components are instantiated DIRECTLY (no TestBed — the
 * JIT/ngModule verifier is incompatible with vitest's ESM graph without the
 * official Angular vitest builder) with a stubbed Router and fetch mocked at
 * the network boundary. The assertions cover real behavior: envelope
 * unwrapping, error mapping, CSRF echo, polling cadence, logout wiring.
 * Template correctness is enforced by `ng build` (strictTemplates), run in
 * the same gate. Test literals are dictionary-style words only (no
 * leetspeak — GitGuardian entropy rule).
 *
 * The wire format itself is verified end-to-end by the backend's Spring
 * integration suite (REAL HTTP).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Angular components import @angular/router/common pieces whose module
// init requires the JIT compiler facade; vitest's ESM graph does not include
// it by default (the ng build path uses AOT). Loading it explicitly keeps
// the direct-instantiation tests working.
import '@angular/compiler';

import { ApiError, api, lastRequestId } from './app/api/client';
import { AlgorithmPageComponent } from './app/pages/algorithm-page.component';
import { HomePageComponent } from './app/pages/home-page.component';
import { LoginPageComponent } from './app/pages/login-page.component';
import { RegisterPageComponent } from './app/pages/register-page.component';

// --- fetch mock harness ------------------------------------------------------

type FetchHandler = (url: string, init: RequestInit) => Promise<Response> | Response;

let fetchHandler: FetchHandler = () => new Response('{}', { status: 500 });

const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => fetchHandler(String(url), init));
vi.stubGlobal('fetch', fetchMock);

function envelopeJson(data: unknown, requestId = 'web-test-request-id'): Response {
  return new Response(
    JSON.stringify({
      success: true,
      data,
      error: null,
      meta: { timestamp: new Date().toISOString(), request_id: requestId },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId } },
  );
}

function errorEnvelope(status: number, code: string, message: string, requestId = 'web-test-error-id'): Response {
  return new Response(
    JSON.stringify({
      success: false,
      data: null,
      error: { code, message },
      meta: { timestamp: new Date().toISOString(), request_id: requestId },
    }),
    { status, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId } },
  );
}

/** Router double recording navigation without any Angular module graph. */
function routerStub() {
  return { navigateByUrl: vi.fn().mockResolvedValue(true) } as never;
}

/** Drain pending microtasks so async component methods settle. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  fetchHandler = () => new Response('{}', { status: 500 });
  fetchMock.mockClear();
});

afterEach(() => {
  document.cookie = 'XSRF-TOKEN=;expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

// --- API client --------------------------------------------------------------

describe('api client', () => {
  it('unwraps successful envelopes and tracks the request id', async () => {
    fetchHandler = () => envelopeJson({ email: 'river.orchard@example.com' });
    const envelope = await api.register('river.orchard@example.com', 'Harbor Lantern 42');
    expect(envelope.success).toBe(true);
    expect(envelope.data?.email).toBe('river.orchard@example.com');
    // Correlation id from the envelope meta is tracked for support/debug.
    expect(lastRequestId).toBe('web-test-request-id');
  });

  it('maps non-2xx envelopes to ApiError with code and status', async () => {
    fetchHandler = () => errorEnvelope(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
    const promise = api.register('meadow.brook@example.com', 'Cedar Panel 77');
    await expect(promise).rejects.toMatchObject({
      code: 'EMAIL_TAKEN',
      status: 409,
    } satisfies Partial<ApiError>);
  });

  it('synthesizes NETWORK_ERROR for non-JSON failures', async () => {
    fetchHandler = () => new Response('bad gateway text', { status: 502 });
    await expect(api.home()).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 502 });
  });

  it('echoes the CSRF cookie as X-XSRF-TOKEN on POST and hits the api prefix', async () => {
    document.cookie = 'XSRF-TOKEN=orchard-token';
    let seenHeaders: Record<string, string> = {};
    fetchHandler = (_url, init) => {
      seenHeaders = init.headers as Record<string, string>;
      return envelopeJson({ email: 'river@example.test' });
    };
    await api.login('river@example.test', 'Harbor Lantern 42');
    expect(seenHeaders['X-XSRF-TOKEN']).toBe('orchard-token');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/login');
  });
});

// --- Register (screen 1) ------------------------------------------------------

describe('RegisterPageComponent', () => {
  it('submits credentials and routes to home on success', async () => {
    fetchHandler = () => envelopeJson({ email: 'river.orchard@example.com' }, 'reg-request-id');
    const router = routerStub();
    const page = new RegisterPageComponent(router);
    page.email = 'river.orchard@example.com';
    page.password = 'Harbor Lantern 42';
    await page.submit();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('/api/v1/register');
    expect((init as RequestInit).body).toContain('river.orchard@example.com');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/home');
    expect(page.formError).toBeNull();
  });

  it('maps the EMAIL_TAKEN envelope to form feedback without navigating', async () => {
    fetchHandler = () => errorEnvelope(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
    const router = routerStub();
    const page = new RegisterPageComponent(router);
    page.email = 'meadow.brook@example.com';
    page.password = 'Cedar Panel 77';
    await page.submit();
    expect(page.formError).toContain('already exists');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
});

// --- Login (screen 2) ---------------------------------------------------------

describe('LoginPageComponent', () => {
  it('submits credentials and routes to home on success', async () => {
    fetchHandler = () => envelopeJson({ email: 'amber.harbor@example.com' });
    const router = routerStub();
    const page = new LoginPageComponent(router);
    page.email = 'amber.harbor@example.com';
    page.password = 'Lantern Creek 58';
    await page.submit();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/home');
    expect(page.formError).toBeNull();
  });

  it('renders the RATE_LIMITED message from the 429 envelope verbatim', async () => {
    fetchHandler = () =>
      errorEnvelope(429, 'RATE_LIMITED', 'Too many failed attempts. Please wait before trying again.');
    const page = new LoginPageComponent(routerStub());
    page.email = 'copper.valley@example.com';
    page.password = 'Wrong Guess 11';
    await page.submit();
    expect(page.formError).toContain('Too many failed attempts');
  });
});

// --- Home (screen 3) ----------------------------------------------------------

describe('HomePageComponent', () => {
  it('loads profile and metrics, then polls at the documented cadence', async () => {
    // NOTE: real timers + spy on setInterval instead of fake timers — fake
    // timers freeze the microtask drain used by the async component methods
    // and leak into subsequent tests.
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    try {
      fetchHandler = () =>
        envelopeJson({ user: { email: 'amber.harbor@example.com' }, metrics: { algorithmsAvailable: 4 } });
      const page = new HomePageComponent(routerStub());
      page.ngOnInit();
      await tick();
      expect(page.home()?.user.email).toBe('amber.harbor@example.com');
      expect(page.loading()).toBe(false);
      expect(page.metricList()).toEqual([{ label: 'algorithmsAvailable', value: 4 }]);

      // Polling (NOT SSE): a repeating timer was registered at POLL_MS.
      expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 15_000);
    } finally {
      intervalSpy.mockRestore();
    }
  });

  it('surfaces the 401 envelope error and drops to login', async () => {
    fetchHandler = () => errorEnvelope(401, 'UNAUTHORIZED', 'Authentication is required.');
    const router = routerStub();
    const page = new HomePageComponent(router);
    await page.refresh();
    expect(page.error()).toContain('Authentication is required');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
  });
});

// --- Algorithm workbench (screen 4) -------------------------------------------

describe('AlgorithmPageComponent', () => {
  it('loads the fixed catalog and runs an algorithm with measured vs theoretical timing', async () => {
    const seen: Array<{ url: string; method: string }> = [];
    fetchHandler = (url, init) => {
      seen.push({ url: String(url), method: init.method ?? 'GET' });
      if (String(url).endsWith('/algorithm') && (init.method ?? 'GET') === 'GET') {
        return envelopeJson([
          {
            id: 'reverse',
            label: 'Reverse text',
            complexity: 'O(n)',
            explanation: 'Walks the input once and builds the reversed string.',
          },
        ]);
      }
      return envelopeJson({
        algorithmId: 'reverse',
        output: 'nretnal',
        executionMs: 1.2,
        complexity: 'O(n)',
        explanation: 'Walks the input once.',
      });
    };
    const page = new AlgorithmPageComponent();
    page.ngOnInit();
    await tick();
    expect(page.loading()).toBe(false);
    expect(page.catalog()).toHaveLength(1);
    expect(page.catalog()[0].label).toBe('Reverse text');
    expect(page.catalog()[0].complexity).toBe('O(n)');
    expect(page.selected()).toBe('reverse');

    page.input.set('lantern');
    await page.run();
    await tick();
    expect(page.runError()).toBeNull();
    expect(page.result()?.output).toBe('nretnal');
    expect(page.result()?.executionMs).toBe(1.2);
    expect(page.result()?.complexity).toBe('O(n)');
    // The run hit the API prefix with the algorithm id.
    expect(seen.some((call) => call.url === '/api/v1/algorithm?algorithm=reverse' && call.method === 'POST'))
      .toBe(true);
  });

  it('surfaces the oversized-input envelope error without a result', async () => {
    fetchHandler = (url, init) => {
      if (String(url).endsWith('/algorithm') && (init.method ?? 'GET') === 'GET') {
        return envelopeJson([
          { id: 'reverse', label: 'Reverse text', complexity: 'O(n)', explanation: 'Single pass.' },
        ]);
      }
      return errorEnvelope(413, 'INPUT_TOO_LARGE', 'Input exceeds the maximum length of 10000 characters.');
    };
    const page = new AlgorithmPageComponent();
    page.ngOnInit();
    await tick();
    page.input.set('river'.repeat(2_001));
    await page.run();
    await tick();
    expect(page.runError()).toContain('maximum length');
    expect(page.result()).toBeNull();
  });
});
