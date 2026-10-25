import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

/**
 * Загрузки, которые видно в документе, но которые в него не попадают.
 *
 * Пока файл грузится, на месте будущего блока стоит заглушка с именем
 * и прогрессом, а у заменяемой картинки — затемнение со шкалой. И то и другое —
 * декорации ProseMirror: в автосохранение и в историю правок они не идут,
 * а позицию пересчитывают сами, так что текст вокруг можно править, пока
 * идёт загрузка, и файл встанет туда, где стояла заглушка.
 */

export interface UploadState {
  id: string;
  /** insert — новый блок на месте заглушки, replace — замена файла у существующей картинки. */
  kind: 'insert' | 'replace';
  label: string;
  /** Процент для шкалы; null — этап без прогресса (хеш, обработка на сервере). */
  pct: number | null;
  error?: boolean;
}

type Meta =
  | { add: UploadState & { pos: number; side: number } }
  | { update: Pick<UploadState, 'id'> & Partial<UploadState> }
  | { remove: string };

const key = new PluginKey<DecorationSet>('uploads');

function decoration(upload: UploadState, from: number, to: number, side: number): Decoration {
  if (upload.kind === 'replace') return Decoration.node(from, to, { class: 'is-uploading' }, { upload, side });
  return Decoration.widget(from, () => renderPlaceholder(upload), {
    upload,
    // Все заглушки одной пачки стоят в одной точке. Положительный side держит
    // их справа от вставки: встал первый файл — остальные уехали за него
    side,
    // Новый ключ — новый DOM: так ProseMirror перерисовывает прогресс
    key: `${upload.id}:${upload.label}:${upload.pct}:${upload.error ?? ''}`,
  });
}

function renderPlaceholder(upload: UploadState): HTMLElement {
  const root = document.createElement('div');
  root.className = `upload-placeholder${upload.error ? ' is-error' : ''}`;
  root.contentEditable = 'false';

  const label = document.createElement('div');
  label.className = 'upload-placeholder__label';
  label.textContent = upload.label;
  root.append(label);

  if (!upload.error) {
    const bar = document.createElement('div');
    bar.className = `upload-placeholder__bar${upload.pct === null ? ' is-indeterminate' : ''}`;
    const fill = document.createElement('div');
    if (upload.pct !== null) fill.style.width = `${upload.pct}%`;
    bar.append(fill);
    root.append(bar);
  }
  return root;
}

function find(set: DecorationSet, id: string): Decoration | undefined {
  return set.find(undefined, undefined, (spec) => spec.upload?.id === id)[0];
}

export const Uploads = Extension.create({
  name: 'uploads',
  addProseMirrorPlugins: () => [
    new Plugin<DecorationSet>({
      key,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, prev) {
          let set = prev.map(tr.mapping, tr.doc);
          const meta = tr.getMeta(key) as Meta | undefined;
          if (!meta) return set;

          if ('add' in meta) {
            const { pos, side, ...upload } = meta.add;
            const node = upload.kind === 'replace' ? tr.doc.nodeAt(pos) : null;
            if (upload.kind === 'replace' && !node) return set;
            return set.add(tr.doc, [decoration(upload, pos, pos + (node?.nodeSize ?? 0), side)]);
          }

          const id = 'remove' in meta ? meta.remove : meta.update.id;
          const current = find(set, id);
          if (!current) return set;
          set = set.remove([current]);
          if ('remove' in meta) return set;

          const upload = { ...(current.spec.upload as UploadState), ...meta.update };
          return set.add(tr.doc, [decoration(upload, current.from, current.to, current.spec.side as number)]);
        },
      },
      props: {
        decorations: (state) => key.getState(state),
      },
    }),
  ],
});

export function addUpload(view: EditorView, upload: UploadState, pos: number, side = 1) {
  view.dispatch(view.state.tr.setMeta(key, { add: { ...upload, pos, side } } satisfies Meta));
}

export function updateUpload(view: EditorView, update: Pick<UploadState, 'id'> & Partial<UploadState>) {
  view.dispatch(view.state.tr.setMeta(key, { update } satisfies Meta));
}

/** Снять заглушку. Вместе со вставкой файла — в той же транзакции, чтобы не мигало. */
export function removeUpload(tr: Transaction, id: string): Transaction {
  return tr.setMeta(key, { remove: id } satisfies Meta);
}

/** Где сейчас стоит заглушка; null — её место удалили, пока файл грузился. */
export function uploadPos(state: EditorState, id: string): { from: number; to: number } | null {
  const deco = find(key.getState(state) ?? DecorationSet.empty, id);
  return deco ? { from: deco.from, to: deco.to } : null;
}
