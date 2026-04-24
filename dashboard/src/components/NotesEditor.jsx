import { useEffect, useRef } from 'react';
import { Crepe } from '@milkdown/crepe';
import { prosePluginsCtx } from '@milkdown/core';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame-dark.css';
import { createMentionPlugin } from './mentionPlugin.js';

export default function NotesEditor({ value, onChange, placeholder, onNavigate }) {
  const containerRef = useRef(null);
  const crepeRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const onNavigateRef = useRef(onNavigate);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onNavigateRef.current = onNavigate; }, [onNavigate]);

  useEffect(() => {
    if (!containerRef.current) return;

    const crepe = new Crepe({
      root: containerRef.current,
      defaultValue: value || '',
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: placeholder || 'Start writing… type / for commands',
          mode: 'block',
        },
      },
    });

    // Register the @-mention ProseMirror plugin before create().
    crepe.editor.config((ctx) => {
      const plugins = ctx.get(prosePluginsCtx);
      ctx.set(prosePluginsCtx, [...plugins, createMentionPlugin()]);
    });

    crepe.on((listener) => {
      listener.markdownUpdated((_, md) => {
        onChangeRef.current?.(md);
      });
    });

    crepe.create();
    crepeRef.current = crepe;

    // Intercept clicks on /ab/... links and route via onNavigate.
    // Capture phase so we beat Crepe's link-tooltip handlers.
    const root = containerRef.current;
    const clickHandler = (e) => {
      const a = e.target.closest && e.target.closest('a[href^="/ab/"]');
      if (!a) return;
      if (!root.contains(a)) return;
      // Let Alt/Cmd/Ctrl/Shift-clicks behave normally (new tab etc.) — but
      // our `/ab/` URLs aren't real routes, so still intercept to prevent a
      // failed navigation.
      e.preventDefault();
      e.stopPropagation();
      const href = a.getAttribute('href');
      onNavigateRef.current?.(href);
    };
    root.addEventListener('click', clickHandler, true);

    return () => {
      root.removeEventListener('click', clickHandler, true);
      crepe.destroy();
      crepeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount once; parent must unmount/remount via key when switching documents

  return <div ref={containerRef} className="notes-editor-milkdown" />;
}
