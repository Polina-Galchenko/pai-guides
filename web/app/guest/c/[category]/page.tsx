import type { Metadata } from 'next';
import { CategoryScreen, categoryMetadata, categoryStaticParams } from '@/components/screens/CategoryScreen';

// Гостевая версия раздела: свой ISR-кэш, свой список гайдов.
// Адрес в браузере остаётся /c/[category].
export const revalidate = 3600;

export function generateStaticParams() {
  return categoryStaticParams('guest');
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  return categoryMetadata('guest', (await params).category);
}

export default async function GuestCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  return <CategoryScreen audience="guest" category={(await params).category} />;
}
