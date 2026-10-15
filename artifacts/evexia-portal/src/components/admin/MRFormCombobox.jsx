import SearchableControl from './SearchableControl.jsx';

// Preserve the MR field-name contract while sharing presentation with filters
// and phone countries. Remote reference fetching stays in its adapter.
export default function MRFormCombobox(props) {
  return <SearchableControl {...props} name={props.id.replace('mr-', '')} />;
}
