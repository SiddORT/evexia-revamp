import { Clock, Palette, FileText, MessagesSquare, Link2, Hash } from 'lucide-react';
import POTemplateSettings from './POTemplateSettings.jsx';
import CommunicationSettings from './CommunicationSettings.jsx';
import MessageTemplateSettings from './MessageTemplateSettings.jsx';
import RoleUrlSettings from './RoleUrlSettings.jsx';
import BatchNumberSettings from './BatchNumberSettings.jsx';
import { BasicSettings, AppearanceSettings } from './SettingsPanels.jsx';

export const SETTINGS_SECTIONS = [
  { id: 'basic', label: 'General', Icon: Clock, description: 'Date format, time zone and clock display.', keywords: ['basic', 'date', 'clock', 'time', 'zone', 'format', 'timestamp'], Component: BasicSettings },
  { id: 'ui', label: 'Appearance', Icon: Palette, description: 'Light or Dark appearance and Classic or Modern theme.', keywords: ['ui', 'theme', 'appearance', 'light', 'dark', 'classic', 'modern', 'colors'], Component: AppearanceSettings },
  { id: 'templates', label: 'Templates', Icon: FileText, description: 'Independent browser-local defaults for PO invoice, PR receipt, Box labels, Bottle labels, Instructions, Abroad letter, Shipping address and Immunotherapy order invoice. Labels and Immunotherapy documents are Settings samples only.', keywords: ['templates', 'invoice', 'po', 'pr', 'receipt', 'pdf', 'document', 'default', 'box', 'bottle', 'label', 'vial', 'browser', 'local', 'instructions', 'abroad', 'letter', 'shipping', 'address', 'immunotherapy', 'order', 'sample', 'double', 'dilution'], Component: POTemplateSettings },
  { id: 'batch-numbers', label: 'Batch Number Settings', Icon: Hash, superAdminOnly: true, description: 'Shared Manual, System sequence and Product-based PR batch defaults.', keywords: ['batch', 'number', 'pr', 'purchase', 'received', 'manual', 'system', 'product', 'prefix', 'sequence', 'shared'], Component: BatchNumberSettings },
  { id: 'communication', label: 'Communication', Icon: MessagesSquare, superAdminOnly: true, description: 'Shared encrypted Email, SMS and WABA configurations. No delivery activation.', keywords: ['email', 'smtp', 'api', 'platform', 'sms', 'waba', 'whatsapp', 'sender', 'provider', 'encrypted', 'shared'], Component: CommunicationSettings },
  { id: 'message-templates', label: 'Email & SMS Templates', Icon: MessagesSquare, description: 'System examples and your browser-local message content. No sending.', keywords: ['email', 'sms', 'message', 'templates', 'html', 'tokens', 'dlt', 'content'], Component: MessageTemplateSettings },
  { id: 'role-urls', label: 'Role URLs', Icon: Link2, superAdminOnly: true, description: 'Shared primary domain, DNS ownership and exact role-host admission.', keywords: ['role', 'urls', 'hostname', 'host', 'domain', 'primary', 'dns', 'txt', 'verification', 'activation', 'recovery', 'mapping', 'shared', 'super admin'], Component: RoleUrlSettings },
];
