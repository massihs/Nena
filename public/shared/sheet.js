// Bottom sheet that can be dragged down to a peek (to see the map) and back up, on phones.
// Keeps --sheet-h (visible height) up to date so map controls float just above it.
const PEEK = 128;

export function draggableSheet(box, grip) {
  let offset = 0, startY = 0, startOffset = 0, dragging = false, moved = 0;
  const mobile = () => window.innerWidth < 900;
  const maxOffset = () => Math.max(0, box.offsetHeight - PEEK);

  const publish = () => document.documentElement.style.setProperty('--sheet-h', `${Math.max(0, box.offsetHeight - offset)}px`);
  function set(o, animate) {
    offset = mobile() ? Math.min(maxOffset(), Math.max(0, o)) : 0;
    box.style.transition = animate ? 'transform .28s cubic-bezier(.2,.8,.2,1)' : 'none';
    box.style.transform = offset ? `translateY(${offset}px)` : '';
    box.classList.toggle('collapsed', offset > 0);
    publish();
  }

  grip.addEventListener('pointerdown', (e) => {
    if (!mobile()) return;
    dragging = true;
    moved = 0;
    startY = e.clientY;
    startOffset = offset;
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    moved = e.clientY - startY;
    set(startOffset + moved, false);
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    if (Math.abs(moved) < 6) return set(offset ? 0 : maxOffset(), true); // tap toggles
    set(moved > 50 ? maxOffset() : moved < -50 ? 0 : offset > maxOffset() / 2 ? maxOffset() : 0, true);
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);

  new ResizeObserver(() => { if (offset > maxOffset()) set(maxOffset(), false); else publish(); }).observe(box);
  window.addEventListener('resize', () => set(offset, false));
  return { open: () => set(0, true), collapse: () => set(maxOffset(), true) };
}
