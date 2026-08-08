import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ApiError, contentFetch, type Audience } from '@/lib/api';
import type { CategoryNode, GuideFull } from '@/lib/types';
import { LEVEL_LABEL, readingTimeLabel } from '@/lib/types';
import { GuideCardView, Header } from '@/components/Shell';
import { GuideContent } from '@/components/GuideContent';
import { Toc, TocMobile } from '@/components/Toc';
import { Feedback } from '@/components/Feedback';
import { ReadingTracker } from '@/components/ReadingTracker';

/**
 * Страница гайда, общая для своих и для гостей.
 *
 * Разница ровно одна — от чьего имени спрашиваем backend: гостю закрытый гайд
 * отвечает 404, и список разделов в шапке у него свой. Всё остальное совпадает,
 * поэтому вёрстка живёт здесь, а в `app/` остаются два тонких маршрута —
 * `/g/[slug]` и `/guest/g/[slug]`, каждый со своим ISR-кэшем.
 */

/** Заранее собираем все видимые этой аудитории гайды — их читают чаще всего. */
export async function guideStaticParams(audience: Audience) {
  try {
    const { items } = await contentFetch<{ items: { slug: string }[] }>(audience, '/guides?limit=100', 3600);
    return items.map((g) => ({ slug: g.slug }));
  } catch {
    // На сборке backend может быть недоступен — тогда страницы соберутся по запросу
    return [];
  }
}

async function loadGuide(audience: Audience, slug: string): Promise<GuideFull | null> {
  try {
    return await contentFetch<GuideFull>(audience, `/guides/${encodeURIComponent(slug)}`, 3600, [`guide:${slug}`]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export async function guideMetadata(audience: Audience, slug: string): Promise<Metadata> {
  const guide = await loadGuide(audience, slug);
  return {
    title: guide ? `${guide.title} — PAI Guides` : 'Гайд не найден',
    description: guide?.summary ?? undefined,
    robots: { index: false, follow: false },
  };
}

export async function GuideScreen({ audience, slug }: { audience: Audience; slug: string }) {
  // Никакого чтения cookie: страница отдаётся из ISR-кэша готовым HTML.
  // Персональное (имя в шапке, прогресс, фидбек) подтягивается на клиенте.
  const [guide, categories] = await Promise.all([
    loadGuide(audience, slug),
    contentFetch<CategoryNode[]>(audience, '/categories', 3600, ['categories']),
  ]);

  if (!guide) notFound();

  return (
    <>
      <Header categories={categories} />
      <ReadingTracker guideId={guide.id} readingTimeSec={guide.readingTimeSec} />

      <div className="mx-auto flex max-w-6xl gap-8 px-4 py-8">
        {guide.toc.length >= 2 && (
          <aside className="hidden w-64 shrink-0 lg:block">
            <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pb-4">
              <div className="mb-2 pl-3 text-xs uppercase tracking-wide text-ink-600">Содержание</div>
              <Toc items={guide.toc} />
            </div>
          </aside>
        )}

        {/* pb даёт запас прокрутки: без него последние разделы не могут встать
            под шапку, и оглавление на них никогда не переключится */}
        <article className="min-w-0 flex-1 pb-[45vh]">
          <nav aria-label="Хлебные крошки" className="flex items-center gap-1.5 text-sm text-ink-600">
            <Link href="/" className="hover:text-ink-400">
              Главная
            </Link>
            <span>/</span>
            <Link href={`/c/${guide.category.slug}`} className="hover:text-ink-400">
              {guide.category.title}
            </Link>
          </nav>

          <h1 className="mt-3 text-3xl font-semibold text-white">{guide.title}</h1>
          {guide.summary && <p className="mt-2 text-ink-400">{guide.summary}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-ink-600">
            <span>{readingTimeLabel(guide.readingTimeSec)}</span>
            <span>·</span>
            <span>{LEVEL_LABEL[guide.level]}</span>
            {guide.publishedAt && (
              <>
                <span>·</span>
                <span>обновлён {new Date(guide.updatedAt).toLocaleDateString('ru')}</span>
              </>
            )}
            {guide.author && (
              <>
                <span>·</span>
                <span>{guide.author.name}</span>
              </>
            )}
          </div>

          {guide.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {guide.tags.map((t) => (
                <Link
                  key={t.id}
                  href={`/c/${guide.category.slug}?tag=${t.slug}`}
                  className="rounded bg-ink-800 px-2 py-0.5 text-xs text-ink-400 hover:text-ink-200"
                >
                  {t.title}
                </Link>
              ))}
            </div>
          )}

          {/* На узких экранах оглавление сворачивается над текстом */}
          <TocMobile items={guide.toc} />

          <div className="mt-6 border-t border-ink-800 pt-2">
            <GuideContent guide={guide} />
          </div>

          <Feedback guideId={guide.id} />

          {guide.related.length > 0 && (
            <section className="mt-10">
              <h2 className="mb-3 text-lg font-semibold text-white">Читайте также</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {guide.related.map((g) => (
                  <GuideCardView key={g.id} guide={g} />
                ))}
              </div>
            </section>
          )}
        </article>
      </div>
    </>
  );
}
