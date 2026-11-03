import { notFound } from 'next/navigation';
import { PreviewScreen } from './PreviewScreen';

export default function DineInPreviewPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }
  return <PreviewScreen />;
}
