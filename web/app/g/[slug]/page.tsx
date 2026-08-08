import type { Metadata } from 'next';
import { GuideScreen, guideMetadata, guideStaticParams } from '@/components/screens/GuideScreen';

// ISR: страница гайда генерируется заранее и живёт час; при публикации backend
// сбрасывает её точечно через /api/revalidate (PLAN §5.3).
// Это версия для своих — гостя middleware уводит на /guest/g/[slug].
export const revalidate = 3600;

export function generateStaticParams() {
  return guideStaticParams('member');
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return guideMetadata('member', (await params).slug);
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  return <GuideScreen audience="member" slug={(await params).slug} />;
}
