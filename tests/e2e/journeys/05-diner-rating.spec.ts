// Journey 5: rating a completed order. Plan 05 Task 9 (POST /api/ratings) and Task 10 (Route 5 modal).
//
// NOT IMPLEMENTED at the page level. components/ratings/RatingModal.tsx exists, but no route mounts it:
// the only file that references it is itself. Looked in: app/dine/[restaurantId]/[tableNumber]/page.tsx,
// components/dine/DineSurface.tsx, components/dine/DineInScreen.tsx, app/delivery/page.tsx,
// app/profile/settings/page.tsx, app/page.tsx. The "no rating form" check cannot be asserted
// without a form to look for, so it is skipped too rather than passed vacuously.
import { test } from '@playwright/test';

test.describe('Journey 5: rating a completed order', () => {
  test.skip('NOT IMPLEMENTED: a diner with a completed order submits 1 to 5 stars with a tag', async () => {
    // Intended steps once a route mounts RatingModal:
    // 1. Sign in as a diner with a completed, paid order.
    // 2. Open the rating modal; check the title "Rate your experience (verified order)".
    // 3. Choose a star (role=radio, "1 star" to "5 stars"), then a tag such as "Piping Hot".
    // 4. Submit; expect the success state from onSubmitted.
  });

  test.skip('NOT IMPLEMENTED: a diner without a completed order sees no rating form', async () => {
    // Intended steps once a route mounts RatingModal:
    // 1. Sign in as a diner with no completed order and open the order page.
    // 2. Assert no "Rate your experience" text and no role=radio star buttons.
  });
});
