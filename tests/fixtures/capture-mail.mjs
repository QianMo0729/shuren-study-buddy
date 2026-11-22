import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

// Preloaded only by the matching API test server. Capture the provider payload without network access.
globalThis.fetch = async (url, options) => {
  if (url !== 'https://api.resend.com/emails' || options?.method !== 'POST') {
    throw new Error('Unexpected outgoing request from the test server');
  }
  appendFileSync(join(process.env.DATA_DIR, 'mail.jsonl'), options.body + '\n');
  return Response.json({ id: 'test-delivery' });
};
