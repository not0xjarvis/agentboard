// ProseMirror plugin that powers @-mention cross-page links in Milkdown.
//
// Behavior:
//   - Type `@` on a word boundary → a floating popover appears.
//   - Every keystroke updates the query; results come from GET /api/search.
//   - ArrowUp/ArrowDown move selection, Enter/Tab insert, Escape closes.
//   - Inserting replaces the `@query` range with a link-marked run so the
//     markdown serializer emits `[Title](/ab/...)`.
//
// No new deps — builds on the ProseMirror primitives Milkdown already ships.

import { Plugin, PluginKey } from '@milkdown/prose/state';

const KEY = new PluginKey('ab-mention');

// Walk backwards from the cursor to find an @-trigger. Returns {from, to, query}
// or null. Triggers on word boundaries only (start of line or after whitespace).
function findTrigger(state) {
  const { $from } = state.selection;
  if (!state.selection.empty) return null;

  // Don't trigger inside code blocks / fences.
  const parent = $from.parent;
  if (parent.type.name === 'code_block' || parent.type.name === 'fence') return null;
  const codeMark = state.schema.marks.code || state.schema.marks.inlineCode;
  if (codeMark && codeMark.isInSet($from.marks())) return null;

  const textBefore = $from.parent.textBetween(
    Math.max(0, $from.parentOffset - 80),
    $from.parentOffset,
    null,
    '￼'
  );
  const match = /(?:^|[\s(])@([^\s@]{0,40})$/.exec(textBefore);
  if (!match) return null;
  const query = match[1];
  const atOffset = textBefore.length - query.length - 1;
  const from = $from.pos - (textBefore.length - atOffset);
  return { from, to: $from.pos, query };
}

// --- Popover (plain DOM, no React — simpler lifecycle) ---

class MentionPopover {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'ab-mention-popover';
    this.el.style.display = 'none';
    this.el.setAttribute('role', 'listbox');
    document.body.appendChild(this.el);
    this.items = [];
    this.selected = 0;
    this.onSelect = null;
  }
  isVisible() { return this.el.style.display !== 'none'; }
  setItems(items) {
    this.items = items;
    if (this.selected >= items.length) this.selected = 0;
    this.render();
  }
  getSelected() { return this.items[this.selected] || null; }
  move(delta) {
    if (!this.items.length) return;
    this.selected = (this.selected + delta + this.items.length) % this.items.length;
    this.updateSelection();
  }
  position(rect) {
    this.el.style.display = 'block';
    const width = 300;
    let left = rect.left;
    const maxLeft = window.innerWidth - width - 8;
    if (left > maxLeft) left = maxLeft;
    if (left < 8) left = 8;
    this.el.style.width = width + 'px';
    this.el.style.left = left + 'px';
    const h = this.el.offsetHeight || 240;
    const below = rect.bottom + 6;
    const above = rect.top - 6 - h;
    if (below + h > window.innerHeight - 8 && above > 8) {
      this.el.style.top = above + 'px';
    } else {
      this.el.style.top = below + 'px';
    }
  }
  hide() {
    this.el.style.display = 'none';
    this.items = [];
    this.selected = 0;
  }
  destroy() {
    if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
  }
  render() {
    this.el.innerHTML = '';
    if (!this.items.length) {
      const empty = document.createElement('div');
      empty.className = 'ab-mention-empty';
      empty.textContent = 'No matches';
      this.el.appendChild(empty);
      return;
    }
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      const row = document.createElement('div');
      row.className = 'ab-mention-item' + (i === this.selected ? ' selected' : '');
      row.setAttribute('role', 'option');

      const kind = document.createElement('span');
      kind.className = 'ab-mention-kind';
      kind.textContent = item.kind === 'project' ? 'Project' : 'Note';
      row.appendChild(kind);

      const label = document.createElement('span');
      label.className = 'ab-mention-label';
      label.textContent = item.label;
      row.appendChild(label);

      if (item.kind === 'note' && item.subtitle) {
        const sub = document.createElement('span');
        sub.className = 'ab-mention-sub';
        sub.textContent = 'in ' + item.subtitle;
        row.appendChild(sub);
      }

      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.selected = i;
        this.onSelect?.(item);
      });
      row.addEventListener('mouseenter', () => {
        this.selected = i;
        this.updateSelection();
      });
      this.el.appendChild(row);
    }
  }
  updateSelection() {
    const rows = this.el.querySelectorAll('.ab-mention-item');
    rows.forEach((r, i) => r.classList.toggle('selected', i === this.selected));
  }
}

// --- Search (debounced, abortable) ---

function createSearcher() {
  let current = null;
  let timer = null;
  return function search(query, cb) {
    if (timer) clearTimeout(timer);
    if (current) current.abort();
    timer = setTimeout(async () => {
      const ctrl = new AbortController();
      current = ctrl;
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(query)}&limit=12`,
          { signal: ctrl.signal }
        );
        if (!res.ok) { cb([]); return; }
        const data = await res.json();
        const items = [];
        for (const p of data.projects || []) {
          items.push({
            kind: 'project',
            id: p.id,
            label: p.name,
            url: `/ab/projects/${p.slug}`,
          });
        }
        for (const n of data.notes || []) {
          items.push({
            kind: 'note',
            id: n.id,
            label: n.title,
            subtitle: n.project_name,
            url: `/ab/notes/${n.id}`,
          });
        }
        cb(items);
      } catch (e) {
        if (e.name !== 'AbortError') cb([]);
      }
    }, 120);
  };
}

// A WeakMap bridges the plugin's view() and props.handleKeyDown.
const viewInstances = new WeakMap();

export function createMentionPlugin() {
  return new Plugin({
    key: KEY,
    view(editorView) {
      const popover = new MentionPopover();
      const search = createSearcher();
      let active = null; // { from, to, query }

      const insert = (item) => {
        if (!active) return;
        const { state, dispatch } = editorView;
        const linkMark = state.schema.marks.link;
        if (!linkMark) { popover.hide(); active = null; return; }
        const mark = linkMark.create({ href: item.url, title: null });
        const tr = state.tr
          .replaceWith(active.from, active.to, state.schema.text(item.label, [mark]))
          .insertText(' ');
        tr.removeStoredMark(linkMark);
        dispatch(tr);
        editorView.focus();
        popover.hide();
        active = null;
      };

      popover.onSelect = insert;
      viewInstances.set(editorView, { popover, insert });

      const update = () => {
        const state = editorView.state;
        const trigger = findTrigger(state);
        if (!trigger) {
          if (active) { popover.hide(); active = null; }
          return;
        }
        active = trigger;
        const coords = editorView.coordsAtPos(trigger.from);
        search(trigger.query, (items) => {
          if (!active || active.from !== trigger.from || active.query !== trigger.query) return;
          popover.setItems(items);
          popover.position({
            left: coords.left,
            top: coords.top,
            bottom: coords.bottom,
            right: coords.right,
          });
        });
      };

      return {
        update(view, prev) {
          if (view.state.doc !== prev.doc || !view.state.selection.eq(prev.selection)) {
            update();
          }
        },
        destroy() {
          viewInstances.delete(editorView);
          popover.destroy();
        },
      };
    },
    props: {
      handleKeyDown(view, event) {
        const inst = viewInstances.get(view);
        if (!inst || !inst.popover.isVisible()) return false;

        if (event.key === 'ArrowDown') { inst.popover.move(1); return true; }
        if (event.key === 'ArrowUp') { inst.popover.move(-1); return true; }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const sel = inst.popover.getSelected();
          if (sel) { inst.insert(sel); return true; }
          return false;
        }
        if (event.key === 'Escape') { inst.popover.hide(); return true; }
        return false;
      },
    },
  });
}
