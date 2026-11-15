import type { CalendarKind, Role } from '../../lib/types';

export const ROLE_LABEL: Record<Role, string> = { admin: '管理員', coach: '教練', player: '球員' };
export const EVENT_KIND_LABEL: Record<CalendarKind, string> = {
  training: '訓練',
  game: '比賽',
  other: '其他',
};

export function newToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function inviteUrl(token: string): string {
  return `${location.origin}/#/join/${token}`;
}
