import { readFileSync } from 'node:fs';
import path from 'node:path';

// Reads the declared minimum sizes from the source class names, so the 44 px touch-target
// rule is enforced without a browser.
const MIN_TOUCH_PX = 44;
const src = readFileSync(path.resolve(__dirname, '../../app/delivery/_components/VoiceInput.tsx'), 'utf8');

function buttonClasses(predicate: (tag: string) => boolean): string {
  const tags = [...src.matchAll(/<button\b[\s\S]*?>/g)].map((m) => m[0]).filter(predicate);
  expect(tags.length).toBe(1);
  const cls = /className="([^"]*)"/.exec(tags[0]);
  expect(cls).not.toBeNull();
  return cls![1];
}

function declaredMin(classes: string, axis: 'h' | 'w'): number | null {
  const m = new RegExp(`(?:^|\\s)min-${axis}-\\[(\\d+)px\\]`).exec(classes);
  return m ? Number(m[1]) : null;
}

test('microphone button declares a minimum 44 px height and width', () => {
  const cls = buttonClasses((t) => t.includes('Voice input arrives'));
  expect(declaredMin(cls, 'h')).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
  expect(declaredMin(cls, 'w')).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
});

test('Find kitchens button declares a minimum 44 px height', () => {
  const cls = buttonClasses((t) => t.includes('type="submit"'));
  expect(declaredMin(cls, 'h')).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
});

test('the touch-target check fails for a 34 px button', () => {
  expect(declaredMin('rounded-full p-2', 'h')).toBeNull();
  expect(declaredMin('min-h-[34px]', 'h')).toBe(34);
});
