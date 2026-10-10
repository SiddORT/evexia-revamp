import { Clock, Palette, FileText, MessagesSquare, Link2 } from 'lucide-react';
import POTemplateSettings from './POTemplateSettings.jsx';
import CommunicationSettings from './CommunicationSettings.jsx';
import MessageTemplateSettings from './MessageTemplateSettings.jsx';
import RoleUrlSettings from './RoleUrlSettings.jsx';
import { BasicSettings, AppearanceSettings } from './SettingsPanels.jsx';

export const SETTINGS_SECTIONS = [
  { id: 'basic', label: 'General', Icon: Clock, description: 'Date format, time zone and clock display.', keywords: ['basic', 'date', 'clock', 'time', 'zone', 'format', 'timestamp'], Component: BasicSettings },
  { id: 'ui', label: 'Appearance', Icon: Palette, description: 'Light or Dark appearance and Classic or Modern theme.', keywords: ['ui', 'theme', 'appearance', 'light', 'dark', 'classic', 'modern', 'colors'], Component: AppearanceSettings },
  { id: 'templates', label: 'Templates', Icon: FileText, description: 'Default layout for supplier PO invoices and PDFs.', keywords: ['templates', 'invoice', 'po', 'pdf', 'document', 'default'], Component: POTemplateSettings },
  { id: 'communication', label: 'Communication', Icon: MessagesSquare, description: 'Browser-local Email, SMS and WABA metadata previews. Nothing connects or sends.', keywords: ['email', 'smtp', 'api', 'platform', 'sms', 'waba', 'whatsapp', 'sender', 'provider', 'metadata'], Component: CommunicationSettings },
  { id: 'message-templates', label: 'Email & SMS Templates', Icon: MessagesSquare, description: 'System examples and your browser-local message content. No sending.', keywords: ['email', 'sms', 'message', 'templates', 'html', 'tokens', 'dlt', 'content'], Component: MessageTemplateSettings },
  { id: 'role-urls', label: 'Role URLs', Icon: Link2, superAdminOnly: true, description: 'Shared hostname to role mappings for all users.', keywords: ['role', 'urls', 'hostname', 'host', 'domain', 'mapping', 'shared', 'super admin'], Component: RoleUrlSettings },
];
