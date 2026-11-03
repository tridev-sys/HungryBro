import { Msg91OtpProvider } from '@/lib/auth/otp-providers';

// VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING: MSG91 endpoint, authkey header, and body fields.
test('MSG91 adapter sends the code with the authkey header and E.164 digits', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response('{"type":"success"}', { status: 200 });
  }) as typeof fetch;
  const p = new Msg91OtpProvider({ authKey: 'KEY', templateId: 'TPL', fetchImpl });
  const code = p.codeFor();
  expect(code).toMatch(/^\d{6}$/);
  await p.send('+919876543210', code);
  expect(calls[0].url).toBe('https://control.msg91.com/api/v5/otp');
  expect((calls[0].init.headers as Record<string, string>).authkey).toBe('KEY');
  expect(JSON.parse(String(calls[0].init.body))).toEqual({ template_id: 'TPL', mobile: '919876543210', otp: code });
});

test('MSG91 adapter throws on a non-2xx response', async () => {
  const fetchImpl = (async () => new Response('bad', { status: 401 })) as typeof fetch;
  const p = new Msg91OtpProvider({ authKey: 'x', templateId: 'y', fetchImpl });
  await expect(p.send('+919876543210', '123456')).rejects.toThrow(/401/);
});
