import { accountInitials, badgeText } from './rail';

describe('account rail', () => {
  it('caps the unread badge at 99+', () => {
    expect(badgeText(0)).toBe('');
    expect(badgeText(-3)).toBe('');
    expect(badgeText(1)).toBe('1');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
    expect(badgeText(12345)).toBe('99+');
  });

  it('derives initials from the name, else from the address', () => {
    expect(accountInitials({ name: 'Ada Lovelace', email: 'ada@example.com' })).toBe('AL');
    expect(accountInitials({ name: 'Đỗ Hồng Quân', email: 'q@example.com' })).toBe('ĐQ');
    expect(accountInitials({ name: 'Support', email: 's@example.com' })).toBe('SU');
    expect(accountInitials({ name: '', email: 'john.doe@example.com' })).toBe('JO');
    expect(accountInitials({ name: ' ', email: '@example.com' })).toBe('?');
  });
});
