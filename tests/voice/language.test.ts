import { detectLanguage, replyLanguageFor, translateForLlm } from '@/lib/voice/language';
import { FakeTranslation } from '@/lib/voice/fakes';

test('plain English is en, including the Route 2 example', () => {
  expect(detectLanguage('Dinner for 3: Biryani & Kebab strictly under 800, delivered in 30 mins to Indiranagar')).toBe('en');
  expect(detectLanguage('Do you have garlic naan')).toBe('en');
});

test('romanized Hinglish with two or more markers is hi-en', () => {
  expect(detectLanguage('Bhaiya, 2 paneer tikka aur ek naan chahiye')).toBe('hi-en');
  expect(detectLanguage('Mujhe jain starter dikhao')).toBe('hi-en');
});

test('a single marker is not enough to switch to Hinglish', () => {
  expect(detectLanguage('Bhaiya, one naan please')).toBe('en');
});

test('Devanagari script is hi', () => {
  expect(detectLanguage('मुझे पनीर टिक्का चाहिए')).toBe('hi');
});

test('reply language is en for English and hi-en otherwise', () => {
  expect(replyLanguageFor('en')).toBe('en');
  expect(replyLanguageFor('hi')).toBe('hi-en');
  expect(replyLanguageFor('hi-en')).toBe('hi-en');
});

test('translateForLlm translates only non-English input', async () => {
  const t = new FakeTranslation({ table: { 'ek naan': 'one naan' } });
  expect(await translateForLlm(t, 'ek naan', 'hi-en')).toBe('one naan');
  expect(await translateForLlm(t, 'naan', 'en')).toBe('naan');
  expect(t.calls).toEqual([{ text: 'ek naan', from: 'hi-en', to: 'en' }]);
});
