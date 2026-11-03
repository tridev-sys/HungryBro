import { notFound } from 'next/navigation';
import { isPreviewEnabled } from '@/lib/ui/preview-gate';
import { PreviewScreen } from './PreviewScreen';

// Read the flag per request. Without this, `next build` would prerender the 404 (flag unset) into static HTML.
export const dynamic = 'force-dynamic';

export default function DineInPreviewPage() {
  if (!isPreviewEnabled(process.env)) {
    notFound();
  }
  return <PreviewScreen />;
}
