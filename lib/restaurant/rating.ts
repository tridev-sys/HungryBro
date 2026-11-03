/** Shown only from verified reviews. A restaurant with none shows "No ratings yet" (decision 1). */
export function formatRating(rating: number, verified: number): string {
  if (verified === 0) return 'No ratings yet';
  return `${rating.toFixed(1)}/5.0, ${verified} verified`;
}
