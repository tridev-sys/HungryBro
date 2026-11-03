import manifest from '@/app/manifest';

test('manifest is installable in standalone mode with the navy theme', () => {
  const m = manifest();
  expect(m.display).toBe('standalone');
  expect(m.theme_color).toBe('#0B1A36');
  expect(m.icons?.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
});
