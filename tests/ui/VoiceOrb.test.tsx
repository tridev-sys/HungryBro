// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { VoiceOrb } from '@/components/voice/VoiceOrb';

test('shows the active label and data-state when listening', () => {
  render(<VoiceOrb state="listening" />);
  expect(screen.getByText('VOICE AGENT ACTIVE')).toBeInTheDocument();
  expect(screen.getByTestId('voice-orb')).toHaveAttribute('data-state', 'listening');
});

test('idle shows the tap-to-speak label', () => {
  render(<VoiceOrb state="idle" />);
  expect(screen.getByText('TAP TO SPEAK')).toBeInTheDocument();
});

test('level is clamped to the 1.0 to 1.12 scale range (Review Focus 5 setup)', () => {
  render(<VoiceOrb state="speaking" level={5} />);
  const scale = getComputedStyle(screen.getByTestId('voice-orb-ring')).getPropertyValue('--orb-scale');
  expect(Number(scale)).toBeLessThanOrEqual(1.12);
});

test('pulse animation is disabled under reduced motion (Review Focus 5)', () => {
  // Assert the ring has the class 'motion-safe:animate-pulse' and no unconditional animate-pulse class.
  render(<VoiceOrb state="listening" />);
  const ring = screen.getByTestId('voice-orb-ring');
  expect(ring.className).toContain('motion-safe:animate-pulse');
  expect(ring.className).not.toMatch(/(^|\s)animate-pulse(\s|$)/);
});
