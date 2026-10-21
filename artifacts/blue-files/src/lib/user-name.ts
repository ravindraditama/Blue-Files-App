// The app has no login, so "who did this" is a typed name. The last name used is
// remembered in this browser to save typing.
const KEY = 'blue-files:user-name';

export function loadUserName(): string {
  try {
    return window.localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveUserName(name: string): void {
  try {
    const trimmed = name.trim();
    if (trimmed) window.localStorage.setItem(KEY, trimmed);
  } catch {
    // Storage can be unavailable (private mode); remembering the name is optional.
  }
}
