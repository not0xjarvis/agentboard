import { useEffect, useRef } from 'react';
import { Crepe } from '@milkdown/crepe';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame-dark.css';

export default function NotesEditor({ value, onChange, placeholder }) {
  const containerRef = useRef(null);
  const crepeRef = useRef(null);
  const onChangeRef = useRef(onChange);

  // Keep latest onChange in a ref so we can wire it once and not stale-close
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

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

    crepe.on((listener) => {
      listener.markdownUpdated((_, md) => {
        onChangeRef.current?.(md);
      });
    });

    crepe.create();
    crepeRef.current = crepe;

    return () => {
      crepe.destroy();
      crepeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount once; parent must unmount/remount via key when switching documents

  return <div ref={containerRef} className="notes-editor-milkdown" />;
}
