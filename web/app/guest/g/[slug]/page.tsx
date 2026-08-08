import type { Metadata } from 'next';
import { GuideScreen, guideMetadata, guideStaticParams } from '@/components/screens/GuideScreen';

// Гостевая версия страницы гайда. Сюда middleware переписывает запрос того,
// кто не вошёл; адрес в браузере остаётся /g/[slug]. Закрытый гайд отсюда
// отвечает 404 — решает backend, а не этот файл.
export const revalidate = 3600;

export function generateStaticParams() {
  return guideStaticParams('guest');
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return guideMetadata('guest', (await params).slug);
}

export default async function GuestGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  return <GuideScreen audience="guest" slug={(await params).slug} />;
}
