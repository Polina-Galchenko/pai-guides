import type { Metadata } from 'next';
import { audienceOf, getMe } from '@/lib/api';
import { GuideScreen, guideMetadata } from '@/components/screens/GuideScreen';

/**
 * Страница рендерится на каждый запрос, а не живёт в ISR-кэше готовым HTML:
 * список гайдов и разделов у своих и у гостей разный, а одна запись кэша не
 * может быть одновременно и той, и другой.
 *
 * Тяжёлое при этом всё равно закэшировано — запросы к API идут с `revalidate`
 * и тегами, так что точечный сброс при публикации (PLAN §5.3) работает как
 * работал. Повторяется только сборка React-дерева из уже готовых данных.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return guideMetadata(audienceOf(await getMe()), (await params).slug);
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  return <GuideScreen audience={audienceOf(await getMe())} slug={(await params).slug} />;
}
