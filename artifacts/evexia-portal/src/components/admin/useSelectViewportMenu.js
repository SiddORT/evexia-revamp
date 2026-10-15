import { useLayoutEffect, useState } from 'react';

// Opt-in only: keep the listbox in its combobox's DOM/focus/outside-click
// boundary, but use the viewport as its containing block to escape card clips.
export default function useSelectViewportMenu(enabled, rootRef, menuRef) {
  const [style, setStyle] = useState(null);
  useLayoutEffect(() => {
    if (!enabled) { setStyle(null); return undefined; }
    const root = rootRef.current;
    const menu = menuRef.current;
    const viewport = window.visualViewport;
    function position() {
      const rect = root.getBoundingClientRect();
      const leftEdge = (viewport?.offsetLeft || 0) + 8;
      const topEdge = (viewport?.offsetTop || 0) + 8;
      const rightEdge = leftEdge + (viewport?.width || window.innerWidth) - 16;
      const bottomEdge = topEdge + (viewport?.height || window.innerHeight) - 16;
      const below = Math.max(0, bottomEdge - rect.bottom - 4);
      const above = Math.max(0, rect.top - topEdge - 4);
      const upward = below < Math.min(230, menu.scrollHeight + 2) && above > below;
      const width = Math.min(rect.width, Math.max(0, rightEdge - leftEdge));
      setStyle({
        position: 'fixed',
        left: Math.max(leftEdge, Math.min(rect.left, rightEdge - width)),
        right: 'auto',
        width,
        top: upward ? 'auto' : rect.bottom + 4,
        bottom: upward ? window.innerHeight - rect.top + 4 : 'auto',
        maxHeight: Math.min(230, upward ? above : below),
        visibility: rect.bottom <= topEdge || rect.top >= bottomEdge || rect.right <= leftEdge || rect.left >= rightEdge ? 'hidden' : 'visible',
      });
    }
    position();
    const observer = new ResizeObserver(position);
    observer.observe(root);
    observer.observe(menu);
    window.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    viewport?.addEventListener('resize', position);
    viewport?.addEventListener('scroll', position);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', position, true);
      window.removeEventListener('resize', position);
      viewport?.removeEventListener('resize', position);
      viewport?.removeEventListener('scroll', position);
    };
  }, [enabled, rootRef, menuRef]);
  return style;
}
