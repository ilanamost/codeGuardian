// Plan 028 (Open Question 7): a small built-in list of common passwords that a new password may
// not be (compared lower-cased). No dependency. The frontend keeps the same list as a constant,
// so the register form and the server refuse the same values; keep both copies equal.
// Entries are lower case. Many of them would already fail the length or letter-and-digit rule;
// they stay so the list reads as the well-known one.
export const COMMON_PASSWORD_LIST: readonly string[] = [
  '123456', '123456789', '12345678', 'password', 'qwerty', '12345', '1234567', '111111', '1234567890', '123123',
  'abc123', '1234', 'password1', 'iloveyou', '1q2w3e4r', '000000', 'qwerty123', 'zaq12wsx', 'dragon', 'sunshine',
  'princess', 'letmein', '654321', 'monkey', '27653', '1qaz2wsx', '123321', 'qwertyuiop', 'superman', 'asdfghjkl',
  'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword1', 'welcome1', 'welcome123', 'admin123', 'administrator1', 'letmein1', 'abcd1234',
  'abc12345', 'qwerty1', 'qwerty12', 'qwer1234', 'asdf1234', 'zxcv1234', '1qazxsw2', 'q1w2e3r4', 'q1w2e3r4t5', '1q2w3e4r5t',
  'aa123456', 'a1b2c3d4', 'trustno1', 'baseball1', 'football1', 'football', 'baseball', 'master1', 'shadow1', 'michael1',
  'jennifer1', 'jordan23', 'hunter2', 'charlie1', 'access14', 'mustang1', 'starwars1', 'computer1', 'whatever1', 'freedom1',
  'secret123', 'changeme1', 'changeme123', 'default1', 'test1234', 'testing123', 'demo1234', 'user1234', 'login123', 'guest123',
  'summer2024', 'summer2025', 'summer2026', 'winter2024', 'winter2025', 'winter2026', 'spring2025', 'spring2026', 'autumn2025', 'autumn2026',
  'january1', 'october1', 'password2', 'password12', 'password1234', 'passwort1', 'motdepasse1', 'contrasena1', 'senha123', 'iloveyou1',
  'princess1', 'sunshine1', 'monkey123', 'dragon123', 'superman1', 'batman123', 'pokemon1', 'killer123', 'loveme1', 'flower123'
]
