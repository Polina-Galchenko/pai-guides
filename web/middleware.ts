import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const ACCESS_COOKIE = 'pai_at';
const REFRESH_COOKIE = 'pai_rt';

/** Страницы, доступные без входа независимо ни от чего. */
const PUBLIC_PATHS = ['/login', '/invite'];

const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-insecure-secret-change-me-please-32-chars-min');

/**
 * Разделы базы знаний, открытые всем. Гость видит их всегда — но только те
 * гайды, что помечены «доступно публично»; остальные для него не существуют.
 * Сколько показать, решает уже сама страница, читая cookie (см. `audienceOf`).
 */
const KNOWLEDGE_BASE = [/^\/$/, /^\/c(\/|$)/, /^\/g(\/|$)/, /^\/search$/];

/**
 * Гейт доступа до отдачи страницы (Edge Runtime).
 *
 * Отвечает ровно на один вопрос: пускать ли вообще. База знаний открыта всем,
 * личные страницы — только своим. Что именно показать пришедшему, решают сами
 * страницы: они читают cookie и спрашивают backend от своего или от гостевого
 * имени. Ровно та же логика на проде живёт в Cloudflare Worker (PLAN §6.4).
 *
 * Подпись access-токена проверяется здесь по-настоящему: без этого достаточно
 * было бы поставить себе куку с нужным именем, чтобы пройти в личное.
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/') ||
    pathname === '/robots.txt' ||
    pathname === '/favicon.ico' ||
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))
  ) {
    return NextResponse.next();
  }

  if (await isMember(req)) return NextResponse.next();

  // База знаний открыта всем — гостя просто пропускаем, а сколько ему показать,
  // решит сама страница. Разводить аудитории по разным адресам нельзя: статус
  // меняется прямо посреди сессии (access-токен живёт 15 минут), и клиентский
  // роутер, обновив токены, уходил бы на адрес той ветки, с которой начал
  if (KNOWLEDGE_BASE.some((re) => re.test(pathname))) return NextResponse.next();

  // Личное (профиль, прогресс) — только своим. Истёкший access при живом
  // refresh пропускаем: на странице клиентский код обновит пару токенов,
  // иначе человека выкидывало бы на /login каждые 15 минут.
  if (req.cookies.get(REFRESH_COOKIE)?.value) return NextResponse.next();

  // Внешний адрес берём из заголовков, а не из req.nextUrl: за обратным прокси
  // Next.js строит nextUrl от адреса, на котором слушает сам (127.0.0.1:3000),
  // и увёл бы пользователя на внутренний адрес контейнера.
  // Относительный Location тоже не подходит — middleware разбирает его как URL.
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host;
  const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '');

  const url = new URL(`${proto}://${host}/login`);
  if (pathname !== '/') url.searchParams.set('next', pathname + search);
  return NextResponse.redirect(url);
}

/** Есть ли живой access-токен с ролью не ниже VIEWER. */
async function isMember(req: NextRequest): Promise<boolean> {
  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!access) return false;
  try {
    const { payload } = await jwtVerify(access, secret);
    return typeof payload.role === 'string' && payload.role !== 'NONE';
  } catch {
    return false; // истёк или подделан
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
