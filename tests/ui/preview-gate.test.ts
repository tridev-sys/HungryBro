import { isPreviewEnabled } from '@/lib/ui/preview-gate';

test('preview is off when the flag is unset', () => {
  expect(isPreviewEnabled({})).toBe(false);
});

test('preview is on only when the flag is exactly "1"', () => {
  expect(isPreviewEnabled({ ENABLE_DEV_PREVIEW: '1' })).toBe(true);
  expect(isPreviewEnabled({ ENABLE_DEV_PREVIEW: '0' })).toBe(false);
  expect(isPreviewEnabled({ ENABLE_DEV_PREVIEW: 'true' })).toBe(false);
  expect(isPreviewEnabled({ ENABLE_DEV_PREVIEW: '' })).toBe(false);
});
