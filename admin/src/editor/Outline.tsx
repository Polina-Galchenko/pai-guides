import { useEffect, useState } from 'react';
import type { Editor as TipTapEditor } from '@tiptap/react';
import { ListTree } from 'lucide-react';

/**
 * Оглавление по заголовкам H2–H4 — для длинных гайдов, где до нужного шага
 * иначе долго листать. Берётся прямо из документа, поэтому заголовки внутри
 * шагов и сворачиваемых блоков в нём тоже есть.
 */

interface Heading {
  pos: number;
  /** Конец текста заголовка — туда ставим курсор после перехода. */
  end: number;
  level: number;
  text: string;
}

function collect(editor: TipTapEditor): Heading[] {
  const out: Heading[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return true;
    out.push({ pos, end: pos + node.nodeSize - 1, level: node.attrs.level as number, text: node.textContent.trim() });
    return false;
  });
  return out;
}

function useHeadings(editor: TipTapEditor): Heading[] {
  const [headings, setHeadings] = useState(() => collect(editor));
  useEffect(() => {
    const onUpdate = () => setHeadings(collect(editor));
    editor.on('update', onUpdate);
    return () => {
      editor.off('update', onUpdate);
    };
  }, [editor]);
  return headings;
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return null;
}

/** Какой раздел сейчас на экране: последний заголовок, ушедший под верх области прокрутки. */
function useActiveIndex(editor: TipTapEditor, headings: Heading[]): number {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const scroller = scrollParent(editor.view.dom);
    const onScroll = () => {
      const line = (scroller?.getBoundingClientRect().top ?? 0) + 96;
      let current = 0;
      headings.forEach((h, i) => {
        const dom = editor.view.nodeDOM(h.pos) as HTMLElement | null;
        if (dom && dom.getBoundingClientRect().top <= line) current = i;
      });
      setActive(current);
    };
    onScroll();
    const target = scroller ?? window;
    target.addEventListener('scroll', onScroll, { passive: true });
    return () => target.removeEventListener('scroll', onScroll);
  }, [editor, headings]);
  return active;
}

function jump(editor: TipTapEditor, h: Heading) {
  // Курсор — в конец заголовка: можно сразу дописать его или продолжить раздел.
  // Фокус до прокрутки, а не после: фокус обрывает начатую плавную прокрутку
  editor.chain().setTextSelection(h.end).focus(null, { scrollIntoView: false }).run();
  (editor.view.nodeDOM(h.pos) as HTMLElement | null)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const INDENT: Record<number, string> = { 2: 'pl-0', 3: 'pl-3', 4: 'pl-6' };

function HeadingList({
  editor,
  headings,
  active,
  onPick,
}: {
  editor: TipTapEditor;
  headings: Heading[];
  active: number;
  onPick?: () => void;
}) {
  return (
    <ul className="space-y-0.5">
      {headings.map((h, i) => (
        <li key={`${h.pos}-${i}`} className={INDENT[h.level] ?? 'pl-0'}>
          <button
            type="button"
            onClick={() => {
              jump(editor, h);
              onPick?.();
            }}
            className={`block w-full truncate rounded px-2 py-1 text-left text-xs ${
              i === active ? 'bg-brand-500/15 text-brand-200' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'
            } ${h.level === 2 ? 'font-medium' : ''}`}
            title={h.text}
          >
            {h.text || <span className="italic text-ink-600">Без названия</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Колонка слева от текста — на широком экране. */
export function Outline({ editor }: { editor: TipTapEditor }) {
  const headings = useHeadings(editor);
  const active = useActiveIndex(editor, headings);
  return (
    <nav className="sticky top-0 max-h-[calc(100vh-7rem)] overflow-y-auto pt-2">
      <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Содержание</div>
      {headings.length ? (
        <HeadingList editor={editor} headings={headings} active={active} />
      ) : (
        <p className="px-2 text-xs leading-relaxed text-ink-600">
          Здесь появятся заголовки H2–H4 — по ним удобно прыгать по длинному гайду.
        </p>
      )}
    </nav>
  );
}

/** Кнопка в панели инструментов — там, где на колонку не хватает ширины. */
export function OutlineMenu({ editor }: { editor: TipTapEditor }) {
  const headings = useHeadings(editor);
  const active = useActiveIndex(editor, headings);
  const [open, setOpen] = useState(false);
  if (!headings.length) return null;

  return (
    <div className="relative">
      <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setOpen((v) => !v)}>
        <ListTree size={14} />
        Содержание
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-80 w-72 overflow-y-auto rounded-lg border border-ink-700 bg-ink-900 p-1 shadow-2xl">
          <HeadingList editor={editor} headings={headings} active={active} onPick={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
