import { cookies } from 'next/headers';

/**
 * Server Components ходят в backend напрямую (внутри docker-сети), браузер —
 * по публичному адресу. Отсюда две базы.
 */
export const API_INTERNAL = (
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001'
).replace(/\/+$/, '');

export { API_PUBLIC } from './config';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Запрос к API из Server Component с пробросом cookie пользователя.
 * `cache: 'no-store'` по умолчанию — персональные данные кэшировать нельзя;
 * для контента, который одинаков для всех, передавайте `revalidate`.
 */
export async function serverFetch<T>(
  path: string,
  opts: { revalidate?: number; tags?: string[]; method?: string; body?: unknown } = {},
): Promise<T> {
  const cookieHeader = (await cookies()).toString();

  const res = await fetch(`${API_INTERNAL}/api${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      cookie: cookieHeader,
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    ...(opts.revalidate !== undefined
      ? { next: { revalidate: opts.revalidate, tags: opts.tags } }
      : { cache: 'no-store' as const }),
  });

  if (!res.ok) {
    let message = `Ошибка API ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      /* тело не JSON — оставляем общее сообщение */
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

/**
 * Кому показываем: своим — всё опубликованное, гостю — только гайды,
 * помеченные «доступно публично». Решает backend, здесь мы лишь говорим,
 * от чьего имени пришли.
 */
export type Audience = 'member' | 'guest';

/**
 * Не персональный контент: кэшируется ISR, cookie НЕ пробрасывается — иначе
 * кэш стал бы персональным. Именно так тянутся гайды и категории.
 *
 * Свой запрос идёт с внутренним токеном, гостевой — вообще без учётных данных.
 * Метка `as=guest` в адресе нужна ровно для кэша Next.js: он ключует записи по
 * URL, и без неё две аудитории делили бы одну запись — гость получил бы ответ,
 * собранный для своих. Backend этот параметр игнорирует: определять доступ по
 * тому, что прислал клиент, нельзя.
 */
export async function contentFetch<T>(
  audience: Audience,
  path: string,
  revalidate = 3600,
  tags?: string[],
): Promise<T> {
  const guest = audience === 'guest';
  const url = `${API_INTERNAL}/api${path}${guest ? (path.includes('?') ? '&' : '?') + 'as=guest' : ''}`;

  const res = await fetch(url, {
    headers: guest ? {} : { 'x-internal-token': process.env.REVALIDATE_SECRET ?? '' },
    next: { revalidate, tags },
  });
  if (!res.ok) throw new ApiError(res.status, `Ошибка API ${res.status}`);
  return res.json() as Promise<T>;
}

/** То же самое от имени своего — для страниц, которые гостю не отдаются. */
export function publicFetch<T>(path: string, revalidate = 3600, tags?: string[]): Promise<T> {
  return contentFetch<T>('member', path, revalidate, tags);
}

export interface Me {
  id: number;
  name: string;
  login: string | null;
  role: 'NONE' | 'VIEWER' | 'EDITOR' | 'ADMIN';
  teamRole: 'BUYER' | 'FARMER' | 'TECH' | 'MEDIABUYER' | 'MANAGER' | 'OTHER';
  email: string | null;
  /** Задан ли пароль. У пришедших по пригласительной ссылке его нет */
  hasPassword: boolean;
  telegramUsername: string | null;
  isActive: boolean;
}

/** Текущий пользователь или null, если кука невалидна. */
export async function getMe(): Promise<Me | null> {
  try {
    return await serverFetch<Me>('/auth/me');
  } catch {
    return null;
  }
}

/**
 * Правило то же, что на backend: `NONE` — это зарегистрировался, но доступ ему
 * ещё не выдали, и видеть он должен ровно то же, что случайный прохожий.
 */
export function audienceOf(me: Me | null): Audience {
  return me && me.role !== 'NONE' ? 'member' : 'guest';
}
