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
 */
const KNOWLEDGE_BASE = [/^\/$/, /^\/c(\/|$)/, /^\/g(\/|$)/, /^\/search$/];

/**
 * Страницы, которые Next.js собирает заранее (ISR) и отдаёт готовым HTML.
 * У них две версии — своя и гостевая, — потому что список гайдов в них разный,
 * а одна запись кэша не может быть одновременно и той, и другой. Гостя уводим
 * в ветку `/guest/...`; адрес в браузере при этом не меняется.
 *
 * `/` и `/search` сюда не входят: они и так динамические и разбираются
 * с аудиторией сами, читая cookie (см. `audienceOf`).
 */
const PRERENDERED = [/^\/c(\/|$)/, /^\/g(\/|$)/];

/**
 * Гейт доступа до отдачи страницы (Edge Runtime).
 *
 * Подпись access-токена проверяется здесь по-настоящему — иначе кэш ISR отдавал
 * бы готовый HTML гайда любому, кто просто поставил себе куку с этим именем.
 * Ровно та же логика на проде живёт в Cloudflare Worker (PLAN §6.4).
 *
 * Роль берём из самого токена: `NONE` — это «зарегистрировался, но админ ещё
 * не подтвердил», и такому человеку полагается гостевая выдача, а не полная.
 * Роль в токене живёт до 15 минут, то есть может отставать от базы, — поэтому
 * решение здесь принимается только в сторону «показать меньше»: полный доступ
 * к личным данным всё равно проверяет backend на каждом запросе.
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Ветка `/guest` — внутренняя цель rewrite'а, а не адрес. Rewrite middleware
  // повторно не запускает, поэтому сюда попадают только те, кто набрал такой
  // путь руками; уводим их на настоящий адрес, чтобы не заводить второй набор
  // URL на те же страницы.
  if (pathname.startsWith('/guest/') || pathname === '/guest') {
    const url = req.nextUrl.clone();
    url.pathname = pathname.slice('/guest'.length) || '/';
    return NextResponse.redirect(url);
  }

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

  if (KNOWLEDGE_BASE.some((re) => re.test(pathname))) {
    if (!PRERENDERED.some((re) => re.test(pathname))) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = `/guest${pathname}`;
    return NextResponse.rewrite(url);
  }

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
