import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './platformConfirmation.css';
import { enterModal } from './modalLayers.js';

let current = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn(current));
function settle(value) {
  const choice = current;
  if (!choice) return;
  current = null;
  notify();
  choice.resolve(value);
}

// One choice at a time. A second action is cancelled, not queued behind a
// decision whose acceptance may unmount the originating editor.
export function usePlatformConfirm() {
  const owner = useRef({});
  useEffect(() => () => {
    if (current?.owner === owner.current) settle(false);
  }, []);
  return useCallback((description, options = {}) => {
    if (current) return Promise.resolve(false);
    return new Promise((resolve) => {
      const trigger = document.activeElement;
      // Dropdown portals are transient: never mount a choice into the menu
      // that closes as soon as its action returns.
      const target = trigger?.closest?.('dialog[open], .admin-shell') ||
        document.querySelector('dialog[open]') || document.querySelector('.admin-shell') || document.body;
      const menu = trigger?.closest?.('[role="menu"]');
      const returnTarget = menu?.id
        ? [...document.querySelectorAll('[aria-controls]')].find((node) => node.getAttribute('aria-controls') === menu.id)
        : null;
      current = { description, title: 'Please confirm', actionLabel: 'Discard changes', destructive: true, ...options, resolve, owner: owner.current, trigger, returnTarget, target };
      notify();
    });
  }, []);
}

function Choice({ choice }) {
  const id = useId();
  const ref = useRef(null);
  const cancel = useRef(null);
  useEffect(() => {
    const node = ref.current;
    const leaveLayer = enterModal(node);
    const siblings = [...choice.target.children].filter((child) => !child.contains(node));
    const inertBefore = siblings.map((child) => [child, child.inert]);
    siblings.forEach((child) => { child.inert = true; });
    const focus = () => cancel.current?.focus();
    focus();
    const frame = requestAnimationFrame(focus);
    const key = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); settle(false);
      } else if (event.key === 'Tab') {
        event.preventDefault(); event.stopImmediatePropagation();
        const buttons = [...node.querySelectorAll('button')];
        const index = buttons.indexOf(document.activeElement);
        buttons[(index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
      } else if (!node.contains(event.target)) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    };
    const contain = (event) => { if (!node.contains(event.target)) focus(); };
    window.addEventListener('keydown', key, true);
    document.addEventListener('focusin', contain, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', key, true);
      document.removeEventListener('focusin', contain, true);
      leaveLayer();
      inertBefore.forEach(([child, value]) => { child.inert = value; });
      const target = choice.trigger?.isConnected ? choice.trigger : choice.returnTarget;
      if (target?.isConnected) target.focus();
    };
  }, [choice]);
  return createPortal(<div className="platform-confirm-backdrop" data-platform-confirmation onMouseDown={(e) => {
    if (e.target === e.currentTarget) settle(false);
  }}>
    <section ref={ref} className="platform-confirm" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}>
      <p className="platform-confirm__eyebrow">Please confirm</p>
      <h2 id={`${id}-title`}>{choice.title}</h2>
      <p id={`${id}-description`}>{choice.description}</p>
      <div className="platform-confirm__actions">
        <button ref={cancel} type="button" onClick={() => settle(false)}>{choice.cancelLabel || 'Cancel'}</button>
        <button type="button" className={choice.destructive ? 'platform-confirm__danger' : ''} onClick={() => settle(true)}>{choice.actionLabel}</button>
      </div>
    </section>
  </div>, choice.target);
}

export default function PlatformConfirmationHost() {
  const [choice, setChoice] = useState(null);
  useEffect(() => { listeners.add(setChoice); setChoice(current); return () => { listeners.delete(setChoice); settle(false); }; }, []);
  return choice ? <Choice choice={choice} /> : null;
}
