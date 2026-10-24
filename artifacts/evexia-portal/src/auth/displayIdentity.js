// Presentation only. Names must never fall back to login/relationship identifiers.
export function mrDisplayIdentity(user) {
  return {
    name: user?.display_name?.trim() || 'MR name not available',
    account: user?.username?.trim() || 'Account ID not available',
  };
}
