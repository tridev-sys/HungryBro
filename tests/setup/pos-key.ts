// Test-only POS credentials key. Production keys are never stored in the repository.
if (!process.env.POS_CREDENTIALS_KEY) {
  process.env.POS_CREDENTIALS_KEY = Buffer.alloc(32, 0x42).toString('base64');
}
// Test-only allow-list: existing POS suites exercise every adapter. Production default is empty.
// tests/pos/allowlist.test.ts and tests/api/pos-allowlist.test.ts set their own values.
process.env.POS_PROVIDERS_ENABLED = 'petpooja,restroworks,urbanpiper';
