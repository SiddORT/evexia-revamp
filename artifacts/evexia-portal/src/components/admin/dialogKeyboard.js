/** Native modal Tab wrapping differs by engine (notably WebKit). */
export function containDialogTab(event) {
  if (event.key !== 'Tab' || event.defaultPrevented) return;
  const dialog = event.currentTarget;
  const controls = [...dialog.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
    .filter(node => node.tabIndex >= 0 && !node.matches(':disabled') && !node.closest('[inert]')
      && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden');
  if (!controls.length) return;
  event.preventDefault();
  const current = controls.indexOf(dialog.ownerDocument.activeElement);
  const next = current < 0 ? (event.shiftKey ? controls.length - 1 : 0)
    : (current + (event.shiftKey ? controls.length - 1 : 1)) % controls.length;
  controls[next].focus();
}
