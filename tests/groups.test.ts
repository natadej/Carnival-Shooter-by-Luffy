import { describe, expect, it } from 'vitest';
import { activeGroup, addGroup, emptyGroups, forgetFriend, inPlay, parseGroups, removeGroup, renameGroup, setMember } from '../src/groups';

const friends = ['a', 'b', 'c'].map((id) => ({ id }));

describe('friend groups', () => {
  it('plays with everyone when no group is active', () => {
    expect(inPlay(emptyGroups(), friends)).toEqual(friends);
  });
  it('only plays the active group, never mixing other groups', () => {
    let s = addGroup(emptyGroups(), 'g1', 'ห้อง 1');
    s = setMember(s, 'g1', 'a', true);
    s = addGroup(s, 'g2', 'ห้อง 2');
    s = setMember(setMember(s, 'g2', 'b', true), 'g2', 'c', true);
    expect(inPlay(s, friends).map((f) => f.id)).toEqual(['b', 'c']);
    s = { ...s, active: 'g1' };
    expect(inPlay(s, friends).map((f) => f.id)).toEqual(['a']);
  });
  it('a friend can be in several groups; toggling is idempotent', () => {
    let s = addGroup(addGroup(emptyGroups(), 'g1', 'x'), 'g2', 'y');
    s = setMember(setMember(s, 'g1', 'a', true), 'g2', 'a', true);
    s = setMember(s, 'g1', 'a', true);
    expect(s.groups.map((g) => g.members)).toEqual([['a'], ['a']]);
    s = setMember(s, 'g1', 'a', false);
    expect(s.groups[0].members).toEqual([]);
  });
  it('rename, delete group and deleted friends', () => {
    let s = setMember(addGroup(emptyGroups(), 'g1', 'x'), 'g1', 'a', true);
    s = renameGroup(s, 'g1', 'แก๊งบ้าน');
    expect(activeGroup(s)?.name).toBe('แก๊งบ้าน');
    expect(forgetFriend(s, 'a').groups[0].members).toEqual([]);
    s = removeGroup(s, 'g1');
    expect(s).toEqual(emptyGroups());
  });
  it('survives bad storage and stale active ids', () => {
    expect(parseGroups(null)).toEqual(emptyGroups());
    expect(parseGroups('{oops')).toEqual(emptyGroups());
    const s = parseGroups(JSON.stringify({ groups: [{ id: 'g1', name: 'x', members: ['a', 3] }], active: 'gone' }));
    expect(s).toEqual({ groups: [{ id: 'g1', name: 'x', members: ['a'] }], active: null });
  });
});
