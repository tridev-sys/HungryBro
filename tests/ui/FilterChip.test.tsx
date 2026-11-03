// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterChip } from '@/components/ui/FilterChip';

test('chip reports pressed state and toggles on click', () => {
  const onToggle = vi.fn();
  render(<FilterChip label="Jain" pressed={false} onToggle={onToggle} />);
  const chip = screen.getByRole('button', { name: 'Jain' });
  expect(chip).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(chip);
  expect(onToggle).toHaveBeenCalledTimes(1);
});
