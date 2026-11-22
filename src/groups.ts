export interface Group {
  id: string;
  name: string;
  members: string[];
}

export interface GroupState {
  groups: Group[];
  /** null = play with every friend */
  active: string | null;
}

export const emptyGroups = (): GroupState => ({ groups: [], active: null });

export function parseGroups(raw: string | null): GroupState {
  try {
    const s = JSON.parse(raw || '');
    if (!Array.isArray(s?.groups)) return emptyGroups();
    const groups: Group[] = s.groups
      .filter((g: Group) => g && typeof g.id === 'string')
      .map((g: Group) => ({ id: g.id, name: String(g.name ?? ''), members: Array.isArray(g.members) ? g.members.filter((m) => typeof m === 'string') : [] }));
    const active = groups.some((g) => g.id === s.active) ? s.active : null;
    return { groups, active };
  } catch {
    return emptyGroups();
  }
}

export const activeGroup = (s: GroupState) => s.groups.find((g) => g.id === s.active) ?? null;

/** Friends that belong in the current game: the active group's members, or everyone. */
export function inPlay<T extends { id: string }>(s: GroupState, friends: T[]): T[] {
  const g = activeGroup(s);
  if (!g) return friends;
  const m = new Set(g.members);
  return friends.filter((f) => m.has(f.id));
}

export function addGroup(s: GroupState, id: string, name: string): GroupState {
  return { groups: [...s.groups, { id, name, members: [] }], active: id };
}

export const renameGroup = (s: GroupState, id: string, name: string): GroupState => ({
  ...s,
  groups: s.groups.map((g) => (g.id === id ? { ...g, name } : g)),
});

export const removeGroup = (s: GroupState, id: string): GroupState => ({
  groups: s.groups.filter((g) => g.id !== id),
  active: s.active === id ? null : s.active,
});

export function setMember(s: GroupState, groupId: string, friendId: string, on: boolean): GroupState {
  return {
    ...s,
    groups: s.groups.map((g) => {
      if (g.id !== groupId) return g;
      const has = g.members.includes(friendId);
      if (on === has) return g;
      return { ...g, members: on ? [...g.members, friendId] : g.members.filter((m) => m !== friendId) };
    }),
  };
}

/** Drop a deleted friend from every group. */
export const forgetFriend = (s: GroupState, friendId: string): GroupState => ({
  ...s,
  groups: s.groups.map((g) => ({ ...g, members: g.members.filter((m) => m !== friendId) })),
});
