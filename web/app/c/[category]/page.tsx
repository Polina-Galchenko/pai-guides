import type { Metadata } from 'next';
import { audienceOf, getMe } from '@/lib/api';
import { CategoryScreen, categoryMetadata } from '@/components/screens/CategoryScreen';

// Как и страница гайда: рендер на запрос, данные из кэша с тегами.
// Подробнее — в комментарии в app/g/[slug]/page.tsx
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  return categoryMetadata(audienceOf(await getMe()), (await params).category);
}

export default async function CategoryPage({ params }: { params: Promise<{ category: string }> }) {
  return <CategoryScreen audience={audienceOf(await getMe())} category={(await params).category} />;
}
