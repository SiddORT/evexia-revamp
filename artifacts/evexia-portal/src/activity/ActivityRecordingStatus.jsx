import { useSyncExternalStore } from 'react';
import { getActivityStatus, subscribeActivityStatus, retryActivity } from './activityTracker.js';

export default function ActivityRecordingStatus() {
  const { error } = useSyncExternalStore(subscribeActivityStatus, getActivityStatus);
  return error ? <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-activity-recording">
    Some activity could not be recorded. Pending reports are kept in this tab only.
    {' '}<button type="button" className="admin-button admin-button--secondary" onClick={retryActivity}>Retry recording</button>
  </div> : null;
}
