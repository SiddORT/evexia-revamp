import Dialog from './Dialog.jsx';

export default function ConfirmationDialog({ title, description, actionLabel, destructive, onConfirm, onClose, error, pending = false, blocked = false }) {
  return (
    <Dialog title={title} eyebrow="Please confirm" description={description} onClose={pending ? () => {} : onClose} footer={<>
      <button type="button" disabled={pending} className="admin-button admin-button--secondary" onClick={onClose} data-testid="button-cancel-confirmation">Cancel</button>
      <button type="button" disabled={pending || blocked} className={`admin-button${destructive ? ' admin-button--danger' : ''}`} onClick={onConfirm} data-testid="button-confirm-action">{pending ? 'Saving…' : actionLabel}</button>
    </>}>
      {error && <div className="admin-feedback admin-feedback--error" role="alert">{error}</div>}
    </Dialog>
  );
}