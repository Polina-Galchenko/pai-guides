import { useCallback, useEffect, useRef, useState } from 'react';
import { BubbleMenu, EditorContent, useEditor, type Editor as TipTapEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import Typography from '@tiptap/extension-typography';
import Link from '@tiptap/extension-link';
import Highlight from '@tiptap/extension-highlight';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Fragment, Slice } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import { dropPoint } from '@tiptap/pm/transform';
import { createLowlight, common } from 'lowlight';
import {
  Bold,
  Code,
  Highlighter,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
} from 'lucide-react';
import { CUSTOM_EXTENSIONS, primeMediaCache } from './nodes';
import { INSERT_ITEMS, type InsertItem } from './insertItems';
import { Outline, OutlineMenu } from './Outline';
import { Uploads, addUpload, removeUpload, updateUpload, uploadPos } from './uploads';
import { uploadFile } from '../lib/upload';
import { errText, type Media } from '../api';

const lowlight = createLowlight(common);

/** Ближайшая к pos граница, где может стоять блок (в списке, таблице, шаге). */
function fitBlock(editor: TipTapEditor, pos: number): number {
  const probe = editor.schema.nodes.image!.create();
  return dropPoint(editor.state.doc, pos, new Slice(Fragment.from(probe), 0, 0)) ?? pos;
}

/**
 * Куда встанет блок, брошенный в точку экрана. Картинка — блок, а точка почти
 * всегда внутри абзаца. Сам ProseMirror выбрал бы сторону по месту в тексте:
 * левая половина строки — перед абзацем, правая — после. Человек же целится
 * между строк, поэтому решает вертикаль: верхняя половина абзаца — над ним,
 * нижняя — под ним.
 */
function blockDropPos(editor: TipTapEditor, event: DragEvent): number | null {
  const hit = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!hit) return null;

  let pos = hit.pos;
  const $pos = editor.state.doc.resolve(pos);
  if ($pos.parent.isTextblock && $pos.depth > 0) {
    const rect = (editor.view.nodeDOM($pos.before()) as HTMLElement | null)?.getBoundingClientRect();
    if (rect) pos = event.clientY < rect.top + rect.height / 2 ? $pos.before() : $pos.after();
  }
  return fitBlock(editor, pos);
}

/**
 * Куда встанет скриншот из буфера. Не в курсор: блок посреди строки разрезал бы
 * абзац пополам. Встаёт под абзацем с курсором, а на пустой строке — над ней,
 * чтобы под скриншотом сразу можно было печатать дальше.
 */
function pastePos(editor: TipTapEditor): number {
  const { selection } = editor.state;
  if (selection instanceof NodeSelection) return selection.to;
  const { $from } = selection;
  if (!$from.parent.isTextblock || $from.depth === 0) return fitBlock(editor, $from.pos);
  return fitBlock(editor, $from.parent.content.size === 0 ? $from.before() : $from.after());
}

/** Картинка под курсором мыши — файл, брошенный на неё, её заменяет. */
function imageUnder(editor: TipTapEditor, event: DragEvent): number | null {
  const hit = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!hit || hit.inside < 0) return null;
  return editor.state.doc.nodeAt(hit.inside)?.type.name === 'image' ? hit.inside : null;
}

const STAGE_LABEL = { hashing: 'подготовка', uploading: 'загрузка', processing: 'обработка' } as const;

let lastUploadId = 0;

/**
 * Загрузка одного файла с прогрессом на его заглушке. При ошибке заглушка
 * краснеет, называет причину и через несколько секунд исчезает сама.
 */
async function uploadShowingProgress(editor: TipTapEditor, file: File, id: string): Promise<Media | null> {
  let stage: keyof typeof STAGE_LABEL = 'hashing';
  let shownPct: number | null = null;
  const show = (pct: number | null) => {
    if (editor.isDestroyed) return;
    shownPct = pct;
    const suffix = pct === null ? '' : ` ${pct}%`;
    updateUpload(editor.view, { id, label: `${file.name} — ${STAGE_LABEL[stage]}${suffix}`, pct });
  };

  try {
    const { media } = await uploadFile(file, {
      onStage: (s) => {
        stage = s;
        show(s === 'uploading' ? 0 : null);
      },
      // Событий прогресса у XHR сотни — перерисовываем только на смене процента
      onProgress: (pct) => {
        if (stage === 'uploading' && pct !== shownPct) show(pct);
      },
    });
    primeMediaCache(media);
    return media;
  } catch (e) {
    if (editor.isDestroyed) return null;
    updateUpload(editor.view, { id, label: `${file.name}: ${errText(e)}`, pct: null, error: true });
    setTimeout(() => {
      if (!editor.isDestroyed) editor.view.dispatch(removeUpload(editor.state.tr, id));
    }, 6000);
    return null;
  }
}

/**
 * Файлы встают блоками в pos, по порядку. Заглушки появляются сразу на всю
 * пачку — видно, что и куда встанет, — а грузятся файлы по одному: так первый
 * гарантированно встаёт раньше второго и порядок не перемешивается.
 */
async function uploadInto(editor: TipTapEditor, files: File[], pos: number) {
  const batch = files.map((file, i) => ({ file, id: `upload-${++lastUploadId}`, side: i + 1 }));
  for (const { file, id, side } of batch) {
    addUpload(editor.view, { id, kind: 'insert', label: file.name, pct: null }, pos, side);
  }

  for (const { file, id } of batch) {
    const media = await uploadShowingProgress(editor, file, id);
    if (!media || editor.isDestroyed) continue;
    // Место берём у заглушки: пока шла загрузка, текст вокруг могли править
    const at = uploadPos(editor.state, id);
    if (!at) continue;
    const type = media.type === 'VIDEO' ? 'video' : media.type === 'FILE' ? 'fileAttachment' : 'image';
    editor
      .chain()
      .command(({ tr }) => !!removeUpload(tr, id))
      // Курсор не трогаем: человек мог продолжить печатать в другом месте
      .insertContentAt(at.from, { type, attrs: { mediaId: media.id } }, { updateSelection: false })
      .run();
  }
}

/** Новый файл у существующей картинки: подпись и прочие настройки остаются. */
async function replaceImage(editor: TipTapEditor, file: File, pos: number) {
  const id = `upload-${++lastUploadId}`;
  addUpload(editor.view, { id, kind: 'replace', label: file.name, pct: null }, pos);

  const media = await uploadShowingProgress(editor, file, id);
  if (!media || editor.isDestroyed) return;
  const at = uploadPos(editor.state, id);
  if (!at) return; // картинку удалили, пока грузилась замена
  editor
    .chain()
    .command(({ tr }) => {
      removeUpload(tr, id);
      const node = tr.doc.nodeAt(at.from);
      if (node?.type.name === 'image') tr.setNodeMarkup(at.from, undefined, { ...node.attrs, mediaId: media.id });
      return true;
    })
    .run();
}

export interface EditorHandle {
  editor: TipTapEditor | null;
}

interface Props {
  initialContent: unknown;
  onChange: (doc: unknown) => void;
  onPickMedia: (kind: 'IMAGE' | 'VIDEO' | 'FILE' | 'GALLERY') => Promise<Media | Media[] | null>;
  onPickGuide: () => Promise<number | null>;
  editable?: boolean;
}

export function Editor({ initialContent, onChange, onPickMedia, onPickGuide, editable = true }: Props) {
  const [slash, setSlash] = useState<{ x: number; y: number; query: string } | null>(null);
  const slashRef = useRef(slash);
  slashRef.current = slash;

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [2, 3, 4] },
        // Линия, куда встанет перетаскиваемый файл: по умолчанию она в 1px
        // цвета текста и на тёмном фоне почти не видна
        dropcursor: { color: '#8b5cf6', width: 2 },
      }),
      Placeholder.configure({
        placeholder: 'Пишите текст. «/» — меню блоков, Ctrl+V или перетаскивание — вставка скриншота.',
      }),
      CharacterCount,
      Typography,
      Highlight,
      Link.configure({ openOnClick: false, autolink: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      CodeBlockLowlight.configure({ lowlight }),
      ...CUSTOM_EXTENSIONS,
      Uploads,
    ],
    content: (initialContent as never) ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: {
      attributes: {
        class: 'pai-editor focus:outline-none min-h-[50vh]',
      },
      /** Вставка скриншота из буфера — главная фича по скорости наполнения (§4.1). */
      handlePaste(_view, event) {
        const files = Array.from(event.clipboardData?.files ?? []);
        const media = files.filter((f) => /^(image|video)\//.test(f.type));
        if (!media.length) return false;
        event.preventDefault();
        const ed = editorRef.current!;
        void uploadInto(ed, media, pastePos(ed));
        return true;
      },
      // Файлы с компьютера встают туда, куда их бросили, а не к курсору.
      // Одна картинка, брошенная на другую, заменяет её
      handleDrop(_view, event) {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
        if (!files.length) return false;
        event.preventDefault();
        const ed = editorRef.current!;
        const image = imageUnder(ed, event as DragEvent);
        if (image !== null && files.length === 1 && files[0]!.type.startsWith('image/')) {
          void replaceImage(ed, files[0]!, image);
        } else {
          void uploadInto(ed, files, blockDropPos(ed, event as DragEvent) ?? ed.state.selection.to);
        }
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getJSON());
      updateSlashState(ed);
    },
    onSelectionUpdate: ({ editor: ed }) => updateSlashState(ed),
  });

  const editorRef = useRef<TipTapEditor | null>(null);
  editorRef.current = editor;

  // Промах мимо текста (поля страницы, шапка, панель справа) по умолчанию
  // открывает файл во вкладке вместо админки — и несохранённые правки гайда
  // пропадают. Пока открыт редактор, файл, брошенный мимо, просто игнорируем.
  useEffect(() => {
    const swallow = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      // Курсор «нельзя» мимо текста — видно заранее, что бросать тут бесполезно
      const inEditor = e.target instanceof Node && editorRef.current?.view.dom.contains(e.target);
      if (e.type === 'dragover' && !inEditor) e.dataTransfer.dropEffect = 'none';
    };
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);

  /**
   * Слэш-меню без внешней зависимости: если текущий абзац начинается с «/»
   * и больше в нём ничего нет, показываем список блоков у курсора.
   */
  function updateSlashState(ed: TipTapEditor) {
    const { $from, empty } = ed.state.selection;
    if (!empty || $from.parent.type.name !== 'paragraph') return setSlash(null);

    const text = $from.parent.textContent;
    if (!text.startsWith('/') || text.includes(' ')) return setSlash(null);

    try {
      const coords = ed.view.coordsAtPos($from.pos);
      setSlash({ x: coords.left, y: coords.bottom + 4, query: text.slice(1).toLowerCase() });
    } catch {
      setSlash(null);
    }
  }

  const runInsert = useCallback(
    async (item: InsertItem) => {
      const ed = editorRef.current;
      if (!ed) return;

      // Убираем набранное «/запрос» перед вставкой блока
      const { $from } = ed.state.selection;
      const start = $from.start();
      const end = $from.pos;
      if (ed.state.doc.textBetween(start, end).startsWith('/')) {
        ed.chain().focus().deleteRange({ from: start, to: end }).run();
      }
      setSlash(null);

      await item.run(ed, { onPickMedia, onPickGuide });
    },
    [onPickGuide, onPickMedia],
  );

  // Стрелки и Enter внутри слэш-меню
  const [slashIndex, setSlashIndex] = useState(0);
  const filtered = slash
    ? INSERT_ITEMS.filter(
        (i) => !slash.query || i.title.toLowerCase().includes(slash.query) || i.keywords.includes(slash.query),
      )
    : [];

  useEffect(() => setSlashIndex(0), [slash?.query]);

  useEffect(() => {
    if (!slash) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return setSlash(null);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && filtered[slashIndex]) {
        e.preventDefault();
        void runInsert(filtered[slashIndex]!);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [slash, filtered, slashIndex, runInsert]);

  if (!editor) return <div className="p-6 text-ink-500">Редактор загружается…</div>;

  return (
    <div className="relative xl:flex xl:gap-6">
      <aside className="hidden w-48 shrink-0 xl:block">
        <Outline editor={editor} />
      </aside>

      <div className="min-w-0 flex-1">
        <Toolbar editor={editor} onInsert={runInsert} />

        {/* Обёртка не для вёрстки: BubbleMenu уносит свой элемент в tippy, и без
            неё React, вставляя что-то перед меню, падает на insertBefore — так
            плашка загрузки роняла редактор в пустой экран */}
        <div>
          <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }}>
            <div className="flex items-center gap-0.5 rounded-lg border border-ink-700 bg-ink-900 p-1 shadow-xl">
              <Mark editor={editor} name="bold" Icon={Bold} onClick={() => editor.chain().focus().toggleBold().run()} />
              <Mark editor={editor} name="italic" Icon={Italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
              <Mark editor={editor} name="strike" Icon={Strikethrough} onClick={() => editor.chain().focus().toggleStrike().run()} />
              <Mark editor={editor} name="code" Icon={Code} onClick={() => editor.chain().focus().toggleCode().run()} />
              <Mark editor={editor} name="highlight" Icon={Highlighter} onClick={() => editor.chain().focus().toggleHighlight().run()} />
              <button
                type="button"
                className="rounded p-1.5 text-ink-400 hover:bg-ink-800 hover:text-ink-200"
                title="Ссылка"
                onClick={() => {
                  const prev = editor.getAttributes('link').href as string | undefined;
                  const href = window.prompt('Адрес ссылки', prev ?? 'https://');
                  if (href === null) return;
                  if (href === '') editor.chain().focus().unsetLink().run();
                  else editor.chain().focus().setLink({ href }).run();
                }}
              >
                <LinkIcon size={14} />
              </button>
            </div>
          </BubbleMenu>
        </div>

        {slash && filtered.length > 0 && (
          <div
            className="fixed z-50 max-h-72 w-64 overflow-y-auto rounded-lg border border-ink-700 bg-ink-900 p-1 shadow-2xl"
            style={{ left: slash.x, top: slash.y }}
          >
            {filtered.map((item, i) => (
              <button
                key={item.title}
                type="button"
                onMouseEnter={() => setSlashIndex(i)}
                onClick={() => void runInsert(item)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                  i === slashIndex ? 'bg-brand-500/20 text-brand-200' : 'text-ink-300 hover:bg-ink-800'
                }`}
              >
                <item.Icon size={15} />
                <span className="flex-1">{item.title}</span>
                <span className="text-[10px] text-ink-600">{item.hint}</span>
              </button>
            ))}
          </div>
        )}

        <EditorContent editor={editor} />

        <div className="mt-4 border-t border-ink-800 pt-2 text-xs text-ink-600">
          {editor.storage.characterCount.words()} слов · {editor.storage.characterCount.characters()} символов
        </div>
      </div>
    </div>
  );
}

function Mark({
  editor,
  name,
  Icon,
  onClick,
}: {
  editor: TipTapEditor;
  name: string;
  Icon: typeof Bold;
  onClick: () => void;
}) {
  const active = editor.isActive(name);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded p-1.5 ${active ? 'bg-brand-500/25 text-brand-200' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'}`}
    >
      <Icon size={14} />
    </button>
  );
}

function Toolbar({ editor, onInsert }: { editor: TipTapEditor; onInsert: (item: InsertItem) => void }) {
  const [menu, setMenu] = useState(false);

  return (
    <div className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-1 border-b border-ink-800 bg-ink-950/95 py-2 backdrop-blur">
      {[2, 3, 4].map((level) => (
        <button
          key={level}
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: level as 2 | 3 | 4 }).run()}
          className={`rounded px-2 py-1 text-xs font-semibold ${
            editor.isActive('heading', { level }) ? 'bg-brand-500/25 text-brand-200' : 'text-ink-400 hover:bg-ink-800'
          }`}
        >
          H{level}
        </button>
      ))}
      <span className="mx-1 h-4 w-px bg-ink-800" />
      <Mark editor={editor} name="bulletList" Icon={List} onClick={() => editor.chain().focus().toggleBulletList().run()} />
      <Mark
        editor={editor}
        name="orderedList"
        Icon={ListOrdered}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <Mark
        editor={editor}
        name="blockquote"
        Icon={Quote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />
      <span className="mx-1 h-4 w-px bg-ink-800" />

      <div className="relative">
        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setMenu((v) => !v)}>
          + Вставить блок
        </button>
        {menu && (
          <div className="absolute left-0 top-full z-50 mt-1 max-h-80 w-64 overflow-y-auto rounded-lg border border-ink-700 bg-ink-900 p-1 shadow-2xl">
            {INSERT_ITEMS.map((item) => (
              <button
                key={item.title}
                type="button"
                onClick={() => {
                  setMenu(false);
                  onInsert(item);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-ink-300 hover:bg-ink-800"
              >
                <item.Icon size={15} />
                <span className="flex-1">{item.title}</span>
                <span className="text-[10px] text-ink-600">{item.hint}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="xl:hidden">
        <OutlineMenu editor={editor} />
      </div>

      <span className="ml-auto text-[11px] text-ink-600">Ctrl+V или перетащите файл</span>
    </div>
  );
}
