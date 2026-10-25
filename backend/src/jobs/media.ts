import { prisma } from '../db.js';
import { addMissingVariants, processImage, type ImageVariant } from '../services/images.js';
import { processVideo } from '../services/video.js';
import { invalidateGuide } from '../services/cdn.js';
import { registerJob } from './index.js';

export const MEDIA_PROCESS = 'media.process';

export interface MediaProcessJob {
  mediaId: number;
}

/**
 * Обработка загруженного файла: картинка → варианты + blurhash,
 * видео → метаданные + постер. Файлы остальных типов просто помечаются READY.
 */
export async function processMedia({ mediaId }: MediaProcessJob): Promise<void> {
  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media) return;
  if (media.status === 'READY') return; // повторная доставка задачи — не переделываем

  await prisma.media.update({ where: { id: mediaId }, data: { status: 'PROCESSING', error: null } });

  try {
    if (media.type === 'IMAGE') {
      const result = await processImage(media.key, media.sha256);
      await prisma.media.update({
        where: { id: mediaId },
        data: {
          status: 'READY',
          width: result.width,
          height: result.height,
          blurhash: result.blurhash,
          variants: result.variants as never,
          processedAt: new Date(),
        },
      });
    } else if (media.type === 'VIDEO') {
      const result = await processVideo(media.key, media.sha256);
      await prisma.media.update({
        where: { id: mediaId },
        data: {
          status: 'READY',
          width: result.width,
          height: result.height,
          durationSec: result.durationSec,
          posterKey: result.posterKey,
          variants: result.variants as never,
          error: result.note,
          processedAt: new Date(),
        },
      });
    } else {
      await prisma.media.update({
        where: { id: mediaId },
        data: { status: 'READY', processedAt: new Date() },
      });
    }
  } catch (e) {
    await prisma.media.update({
      where: { id: mediaId },
      data: { status: 'FAILED', error: String(e).slice(0, 500) },
    });
    throw e;
  }
}

export const MEDIA_RESLICE = 'media.reslice';

/**
 * Дорезка вариантов картинкам, обработанным по старой сетке (images.ts,
 * variantWidths). Ставится при каждом старте: консоли у Amvera нет, и разовую
 * миграцию иначе не запустить. Повторный прогон дешёвый — картинки, которым
 * дорезать нечего, пропускаются без обращения к хранилищу.
 */
export async function resliceImages(log: (m: string) => void): Promise<void> {
  const images = await prisma.media.findMany({
    where: { type: 'IMAGE', status: 'READY', width: { not: null } },
    select: { id: true, key: true, sha256: true, width: true, variants: true },
  });

  const touched: number[] = [];
  for (const m of images) {
    try {
      const variants = await addMissingVariants({
        key: m.key,
        sha256: m.sha256,
        width: m.width!,
        variants: (m.variants ?? []) as unknown as ImageVariant[],
      });
      if (!variants) continue;
      await prisma.media.update({ where: { id: m.id }, data: { variants: variants as never } });
      touched.push(m.id);
    } catch (e) {
      // Одна битая картинка не должна останавливать остальные
      log(`[media] не удалось дорезать варианты #${m.id}: ${String(e)}`);
    }
  }
  if (!touched.length) return;
  log(`[media] дорезаны варианты у картинок: ${touched.length}`);

  // srcset собирается при отдаче страницы, но страницы в ISR-кэше — сбрасываем
  // те, где эти картинки стоят, чтобы новые ширины дошли до сайта сразу
  const guides = await prisma.guide.findMany({
    where: {
      OR: [{ media: { some: { mediaId: { in: touched } } } }, { coverId: { in: touched } }],
    },
    select: { slug: true, category: { select: { slug: true } } },
  });
  for (const g of guides) await invalidateGuide(g.slug, g.category.slug);
}

export async function registerMediaJobs(log: (m: string) => void): Promise<void> {
  await registerJob<MediaProcessJob>(MEDIA_PROCESS, processMedia);
  await registerJob<Record<string, never>>(MEDIA_RESLICE, () => resliceImages(log));
}
