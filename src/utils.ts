export function isValidAddress(address: string): boolean {
  if (!address) {
    return false;
  }
  const parts = address.split("@");
  if (parts.length !== 2) {
    return false;
  }
  const [local, domain] = parts;
  if (!local || !domain) {
    return false;
  }
  if (!domain.includes(".")) {
    return false;
  }
  return true;
}
