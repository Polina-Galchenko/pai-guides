import type { Metadata } from 'next';
import { CategoryScreen, categoryMetadata, categoryStaticParams } from '@/components/screens/CategoryScreen';

// Версия для своих — гостя middleware уводит на /guest/c/[category]
export const revalidate = 3600;

export function generateStaticParams() {
  return categoryStaticParams('member');
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  return categoryMetadata('member', (await params).category);
}

export default async function CategoryPage({ params }: { params: Promise<{ category: string }> }) {
  return <CategoryScreen audience="member" category={(await params).category} />;
}
