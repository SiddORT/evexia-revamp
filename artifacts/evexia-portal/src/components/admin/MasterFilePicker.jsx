import { forwardRef } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import '../../excel-import.css';

// Existing Master import presentation, shared without changing upload rules.
const MasterFilePicker = forwardRef(function MasterFilePicker({ children, icon: Icon = FileSpreadsheet, ...inputProps }, ref) {
  return <label className="excel-import__picker"><Icon size={19} aria-hidden="true" /><span>{children}</span><input ref={ref} type="file" {...inputProps} /></label>;
});
export default MasterFilePicker;
