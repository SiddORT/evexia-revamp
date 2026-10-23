import { useRef } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Files } from 'lucide-react';
import { useAdminPreferences } from '../admin/adminPreferences.js';
import { IMMUNOTHERAPY_DOCUMENT_ACTIONS } from '../../services/immunotherapyDocumentActions.js';

export default function ImmDocumentActions({ order, onChoose }) {
  const { theme, appearance } = useAdminPreferences();
  const trigger = useRef(null);
  const pendingAction = useRef(null);

  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <button ref={trigger} type="button" className="admin-icon-button" aria-label={`Document actions for ${order.number}`}>
        <Files size={16} aria-hidden="true" />
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="admin-dropdown__menu imm-document-menu" data-admin-theme={theme} data-admin-appearance={appearance}
        align="end" sideOffset={6} collisionPadding={12} aria-label={`Documents for ${order.number}`}
        onCloseAutoFocus={(event) => {
          const action = pendingAction.current;
          if (!action) return;
          // Mount the dialog after the menu closes, without refocusing behind it.
          event.preventDefault();
          pendingAction.current = null;
          onChoose(action, order, trigger);
        }}>
        {IMMUNOTHERAPY_DOCUMENT_ACTIONS.map((action) => <DropdownMenu.Item key={action.key} className="admin-dropdown__item"
          onSelect={() => { pendingAction.current = action; }}>{action.label}</DropdownMenu.Item>)}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
