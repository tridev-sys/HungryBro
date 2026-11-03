// Test-only POS credentials key. Production keys are never stored in the repository.
if (!process.env.POS_CREDENTIALS_KEY) {
  process.env.POS_CREDENTIALS_KEY = Buffer.alloc(32, 0x42).toString('base64');
}
