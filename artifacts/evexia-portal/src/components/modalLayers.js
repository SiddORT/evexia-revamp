// Shared by the existing editor dialogs, not tied to any workspace or role.
const layers = [];
let originalOverflow = '';
export function enterModal(node) {
  if (!layers.length) originalOverflow = document.body.style.overflow;
  layers.push(node);
  document.body.style.overflow = 'hidden';
  return () => {
    const index = layers.indexOf(node);
    if (index !== -1) layers.splice(index, 1);
    if (!layers.length) document.body.style.overflow = originalOverflow;
  };
}
export const isTopModal = (node) => layers.at(-1) === node && !document.querySelector('[data-platform-confirmation]');
