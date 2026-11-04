import { Msg91OtpProvider } from '@/lib/auth/otp-providers';

// VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING: MSG91 endpoint, authkey header, and body fields.
// All cases use a fake fetch. The real MSG91 API is never called from tests.
function fakeFetch(body: string, status: number, calls: { url: string; init: RequestInit }[] = []) {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body, { status });
  }) as typeof fetch;
}

test('MSG91 adapter sends the code with the authkey header and E.164 digits', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = fakeFetch('{"type":"success"}', 200, calls);
  const p = new Msg91OtpProvider({ authKey: 'KEY', templateId: 'TPL', fetchImpl });
  const code = p.codeFor();
  expect(code).toMatch(/^\d{6}$/);
  const result = await p.send('+919876543210', code);
  expect(result).toEqual({ ok: true });
  expect(calls[0].url).toBe('https://control.msg91.com/api/v5/otp');
  expect((calls[0].init.headers as Record<string, string>).authkey).toBe('KEY');
  expect(JSON.parse(String(calls[0].init.body))).toEqual({ template_id: 'TPL', mobile: '919876543210', otp: code });
});

test('MSG91 adapter returns OTP_SEND_FAILED when a 200 body has type "error"', async () => {
  const p = new Msg91OtpProvider({
    authKey: 'x',
    templateId: 'y',
    fetchImpl: fakeFetch('{"type":"error","message":"Invalid authkey"}', 200),
  });
  const result = await p.send('+919876543210', '123456');
  expect(result).toEqual({ ok: false, code: 'OTP_SEND_FAILED' });
});

test('MSG91 adapter treats type "ERROR" (any case) as a failure', async () => {
  const p = new Msg91OtpProvider({
    authKey: 'x',
    templateId: 'y',
    fetchImpl: fakeFetch('{"type":"ERROR","message":"quota"}', 200),
  });
  expect(await p.send('+919876543210', '123456')).toEqual({ ok: false, code: 'OTP_SEND_FAILED' });
});

test('MSG91 adapter returns OTP_SEND_FAILED when a 200 body is not JSON', async () => {
  const p = new Msg91OtpProvider({
    authKey: 'x',
    templateId: 'y',
    fetchImpl: fakeFetch('<html>gateway page</html>', 200),
  });
  expect(await p.send('+919876543210', '123456')).toEqual({ ok: false, code: 'OTP_SEND_FAILED' });
});

test('MSG91 adapter returns OTP_SEND_FAILED on a non-2xx response', async () => {
  const p = new Msg91OtpProvider({ authKey: 'x', templateId: 'y', fetchImpl: fakeFetch('bad', 500) });
  expect(await p.send('+919876543210', '123456')).toEqual({ ok: false, code: 'OTP_SEND_FAILED' });
});

test('MSG91 adapter returns OTP_SEND_FAILED when the network request rejects', async () => {
  const fetchImpl = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
  const p = new Msg91OtpProvider({ authKey: 'x', templateId: 'y', fetchImpl });
  expect(await p.send('+919876543210', '123456')).toEqual({ ok: false, code: 'OTP_SEND_FAILED' });
});
